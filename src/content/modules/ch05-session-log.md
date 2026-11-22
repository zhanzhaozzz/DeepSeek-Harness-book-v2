---
order: 5
title: "第5章：只追加的会话日志"
summary: "Session 是内存中的只追加事件日志。校验、surface 折叠、fork 与中断修复都从这条日志推导，模型看见的历史也从这里来。"
status: published
words: 1204
codeLines: 43
minutes: 6
updated: "2026-11-22"
---

# 第5章：只追加的会话日志

**一句话定义：会话日志是模型所见上下文的来源；`deriveMessages()` 从它投影出模型历史，持久化插件只订阅已经提交的事件。**

[`packages/core/session/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/index.ts) 的模块注释把持久化推出这个包：

```ts
/**
 * Event-sourced session service: append-only session log, in-memory store, and
 * the derived LLM message history. Persistence is a plugin concern (subscribe
 * to `session/event`, drain on `session/flush`).
 *
 * @module @deepseek-ai/dsh-session
 */
```

`SessionStore` 挂在 `ctx.sessions`。创建公告是 `session/created`，离开存储是 `session/disposed`，提交之后的只读喂给是 `session/event`。监听器失败被记日志，不能把已经提交的 append 再判失败。

旧笔记引用过 core/session 下的 invariant.ts，本钉没有这个文件。同目录现在有 [`validation.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/validation.ts)、[`surface.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/surface.ts)、[`repair.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/repair.ts)、[`fork.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/fork.ts)，以及 `types.ts`、`request-header.ts`、`preparation.ts`、`known-event-types.ts`、`tool-history.ts`、`seq-ranges.ts`、`fork-error.ts`。

## 头与当前逻辑版本

[`packages/core/session/src/types.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/types.ts) 把当前写入版本钉成一个单调整数：

```ts
export const SESSION_FORMAT_VERSION = 4
```

`SessionHeader.version` 的类型就是 `typeof SESSION_FORMAT_VERSION`。注释写明：当前 Session 与持久化代码只接受这个值；只读头的读者可以分类受支持的历史格式；读事件体时，先沿构建期固定的相邻迁移链走一遍，再以这个最终代际构造 Session。同版本不跑迁移链。未知事件类型由每条事件上的 `ignorable` 决定，而不是由任意嵌套字段决定。

`Session` 类把 header 放在事件日志外面：

```ts
export class Session {
  private log: SessionEvent[] = []
```

类注释说明：header 是创建元数据（格式版本、cwd、谱系、是否存在 fork 历史），由 `ctx.sessions.create()` 供给。没有存储头时会合成一份最小头，并盖上当前 `SESSION_FORMAT_VERSION`。它是存储问题，不是可重放的对话状态。`inheritedEventCount` 是从 fork 父会话继承的前缀长度。

## 校验拒绝错版本

[`packages/core/session/src/validation.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/validation.ts) 在冻结 header 之前核对版本、id 和 `createdAt`：

```ts
  if (record.version !== SESSION_FORMAT_VERSION) {
    throw new Error(`session header version must be ${SESSION_FORMAT_VERSION}, got ${String(record.version)}`)
  }
  if (record.id !== id) {
    throw new Error(`session header id "${String(record.id)}" does not match session id "${id}"`)
  }
```

进入这条内存路径之前，历史文件应先被迁移到当前逻辑格式。磁盘上的代际选择和「拒绝未来版本」属于持久化层，第 12 章写。这里的校验面对的是已经变成当前逻辑事件的记录。`seedLength` 作为 header 字段会被直接拒绝。`isSeeded` 必须是布尔。`origin` 若存在，只能是 `"subagent"`。

## surface：日志折叠成模型能看见的序列

[`packages/core/session/src/surface.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/surface.ts) 的 `foldSurface` 重放整段日志：

```ts
export function foldSurface(events: readonly SessionEvent[], projections: readonly SessionMessageProjection[] = []): SurfaceFoldResult {
  const state = createFoldState()
  const replacements: SurfaceFoldReplacement[] = []
  for (const [index, event] of events.entries()) {
    const replacement = applySurfaceEvent(
      state,
      event,
      SessionSeq(index),
      events,
      SessionLogOffset(0),
      projections,
    )
```

架构文档的原话是：模型可见意味着已记录。新的、要进入模型请求的输入必须是 session 事件。插件若要改已有消息的内容，就注册纯的 message projection；脱离会话的读者必须显式带上同一组定义。`Session.surface` 由内部的 `SurfaceManager` 增量维护，和这条折叠对齐。

## fork 与中断修复

[`packages/core/session/src/fork.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/fork.ts) 按调用方给出的边界切前缀，插上 `session/end-seed`，再用修复器补上未关闭的尾部：

```ts
export function buildForkSeed(events: readonly SessionEvent[], boundary: SessionSeqType): SessionEvent[] {
  const prefix = events.slice(0, boundary + 1)
  prefix.push({
    type: 'session/end-seed', seq: SessionSeq(boundary + 1),
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the caller validated this exact source event.
    time: events[boundary]!.time,
    data: { inherited: true },
  })
  return prefix.concat(openTurnClosers(prefix, { kind: 'forked' }))
}
```

[`packages/core/session/src/repair.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/repair.ts) 把两种收尾原因分清：

```ts
export const TOOL_NOT_STARTED = 'TOOL_NOT_STARTED'

/** Recovery code for a recorded tool call whose completed outcome was not durably recorded. */
export const TOOL_OUTCOME_UNKNOWN = 'TOOL_OUTCOME_UNKNOWN'
```

```ts
export type OpenTurnCloseCause = { readonly kind: 'interrupted' } | { readonly kind: 'forked' }
```

`interrupted` 是崩溃恢复，`forked` 是在父会话尚未结束的 turn 里切开。两者共用错误码，模型可见的措辞不同。第 4 章里 step 失败时用的 `ToolCallRecovery` 也从这里导出：活的失败先补缺失结果，持久日志上的未封口尾巴则由 handle 的消费方负责普通修复。迁移只会在文档写明的有界情形里插入缺失的 `turn/end`。

## 不变量

- 内存日志只追加。`session/event` 在提交之后发出，监听器不能撤销这次 append。
- 当前逻辑格式版本是 `SESSION_FORMAT_VERSION = 4`。header 不在可重放的事件序列里。
- 模型请求必须能从日志重建。改已有消息内容走纯投影，而不是改写历史事件。
- fork 复制到边界为止的前缀，用 `session/end-seed` 标出继承切点，再补上未关闭的工具结果和 step/turn 边界。
- `TOOL_NOT_STARTED` 与 `TOOL_OUTCOME_UNKNOWN` 描述的是「日志里记录到哪一步」，调用方据此决定能否重试。

## 下一章

第 6 章看 step 里那次模型调用：`ctx.llm` 是适配器注册表，真正的字节流在 `llm/stream` 瀑布之后才到达具体适配器。
