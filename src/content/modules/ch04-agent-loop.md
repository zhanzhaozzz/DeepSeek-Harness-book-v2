---
order: 4
title: "第4章：Agent Loop —— step 与 turn"
summary: "ReactLoopAgent 怎样打开 turn、认领 inbox、跑 step，并把助手流留在进程内，直到结算写入会话日志。"
status: published
words: 1268
codeLines: 41
minutes: 6
updated: "2026-11-22"
---

# 第4章：Agent Loop —— step 与 turn

**一句话定义：step 是一次模型请求加上它调用的工具；turn 是零个或多个 step，在认领第一条输入之前打开，在不再欠任何工作时关上。**

定义来自 [`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 的 Turn flow：

```md
A **step** is one model request plus the tools it calls. A **turn** is zero or more steps: it opens before its first input is claimed and closes once nothing is owed.
```

同页的文本图把持久事件和活的扩展点放在一张图上。`turn/*`、`step/*`、`system/message`、`user/message`、`assistant/message`、`assistant/attempt`、`tool/*` 是持久的 session 事件；`agent/pre-step`、`agent/request`、`llm/stream`、三条 `tools/*` 是 waterfall；`agent/turn-stopping` 是 serial，没有 `next()`。

旧笔记写过的 tool-calls.ts，以及放在 agent 包里的 inbox.ts，在本钉都不存在。循环目录 [`packages/core/agent-loop/src/`](https://github.com/deepseek-ai/deepseek-harness/tree/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src) 现在是 `agent.ts`、`index.ts`、`inbox.ts`、`assistant-stream.ts`、`runtime-context.ts`、`constants.ts`。

## 工厂服务

[`packages/core/agent-loop/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src/index.ts) 里的 `AgentLoop` 是具体工厂，服务键 `agentLoop`。它显式注入第 1 章那张表上的邻居：

```ts
export class AgentLoop extends Service implements AgentFactory {
  static inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections']
```

并行工具调用的默认上限在 [`packages/core/agent-loop/src/constants.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src/constants.ts)：

```ts
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10
```

配置里的 `maxParallelToolCalls` 省略时用这个默认；`1` 表示串行。初始化时工厂向 `ctx.sessionProjections` 注册模型选择和 inbox 两个投影，再 `ctx.agents.setFactory(this)`。投影让「还没活着的 Agent」也能露出待处理输入。

## 驱动一个会话

[`packages/core/agent-loop/src/agent.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src/agent.ts) 的类注释写明每条请求都从会话日志导出：

文件开头的模块注释：

```ts
/**
 * Default Agent driver over queued turns and step-boundary input. Every request
 * is derived from the session log.
 * @module dsh-agent-loop/agent
 */
```

类本身的上一行是：

```ts
/** Drives one session through turn and step boundaries. */
export class ReactLoopAgent implements Agent {
```

三条入口把用户消息放进不同的 inbox 目标：

```ts
  followup(input: UserMessage): void {
    this.send(input, 'next-turn', true)
  }

  steer(input: UserMessage): void {
    this.send(input, 'next-step', true)
  }

  inject(input: UserMessage): void {
    this.send(input, 'next-step', false)
  }
```

`followup` 排队等下一个 turn，并且唤醒驱动。`steer` 排到下一个 step 边界，也唤醒。`inject` 同样进 `next-step`，但是 `wakeup` 为 false：上下文先躺在队列里，等一次真正醒来的消息再被认领。第 10 章专门讲 `inject`。

`kick()` 把 turn 一直跑到没有欠账：

```ts
  private async kick(): Promise<void> {
    try {
      while (await this.turn()) {}
    } catch (_error) {
      // Reported failures and cancellation are contained at the driver boundary.
    } finally {
```

## turn 先于认领

`turn()` 在提出第一个 step 之前先写 `turn/start`：

```ts
    const turn = phase.turn + 1
    try {
      this.session.append('turn/start', { turn })
    } catch (error: unknown) {
      this.throwError(error)
    }
    phase.turn = turn
```

循环体里，`preStep` 先 `inbox.claim`，再解析工具集、组装 system prompt，然后走 `agent/pre-step` waterfall。拒绝或第一条就被改成空消息时，这个 turn 可以在没有 step 的情况下结束。进入之后才写 `step/start`，调用 `step()`，并在 `finally` 里写 `step/end`。step 失败时，`ToolCallRecovery` 补上还没记下的工具结果，避免日志留下有调用无结果的洞。

一个 step 结束后，如果还欠下一轮请求，或者 `next-step` 里又有输入，目标改成 `'next-step'` 再转一圈。否则先 `agent/turn-stopping`（serial），再跳出。`finally` 写 `turn/end`。队列里还有待处理消息时，`turn()` 返回 `true`，`kick` 再开一个 turn。

## inbox 在循环包里

[`packages/core/agent-loop/src/inbox.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src/inbox.ts) 的投影键就是 `'inbox'`，状态是两个只读数组：

```ts
export const inboxProjectionDefinition = {
  key: 'inbox',
  stateSchema: inboxProjectionSchema,
  init: (): InboxState => ({ 'next-turn': [], 'next-step': [] }),
```

`apply` 只认 `agent/inbox/spliced`。非法 splice、重复 message id 会在重建时抛错，所以待处理输入本身也是会话日志上的持久事实，而不是只活在内存里的队列。

`ReactLoopInbox.claim` 先取走全部 `next-step`，若这次边界还要消费一个排队的 turn，再从 `next-turn` 头部取一条，并为每条消息发出 `agent/inbox/claimed`。

## 助手流与运行时上下文

一次模型尝试的进程内帧在 [`packages/core/agent-loop/src/assistant-stream.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src/assistant-stream.ts)：

```ts
/** Folds one model attempt into one compact stream plus ordered transient frames. */
export class AssistantStreamAttempt {
```

`step()` 在准备好请求后 `new AssistantStreamAttempt(...)`，帧通过 `agent/assistant-stream` 发出。架构文档写明：循环把完整的紧凑流作为一条消息或仅日志的 attempt 提交之后，才发已提交的 end 帧。活的 UI 增量来自这个事件；进程在结算前硬退出，就不会留下持久的 attempt 流。

动态上下文的投影在 [`packages/core/agent-loop/src/runtime-context.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src/runtime-context.ts)，类名 `RuntimeContextProjection`。它记住上一份已经留下的 runtime-context 快照，提交仍由 step 写进 `user/message`。

## 不变量

- turn 在 claim 之前 append `turn/start`；没有欠账时以 `turn/end` 关上。空的第一次 enter 可以关上一个没有 step 的持久 turn。
- 模型请求从日志导出。`agent/assistant-stream` 是进程内的；进模型历史的是结算后的 `assistant/message`。
- inbox 有 `next-turn` 与 `next-step` 两个持久列表，实现位于 `packages/core/agent-loop/src/inbox.ts`。
- `followup` 唤醒下一个 turn，`steer` 唤醒下一个 step，`inject` 把上下文放进 `next-step` 且不自行唤醒。
- step 失败时先尽力补上缺失的 `tool/result`，再把错误冒泡。`max-tokens` 一旦出现，后面正常完成的 step 不能把它降级。

## 下一章

第 5 章看 `session.append` 写下的那条只追加日志：校验、surface 折叠、fork 和中断修复。
