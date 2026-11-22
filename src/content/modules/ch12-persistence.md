---
order: 12
title: "第12章：持久化、压缩与遥测"
summary: "当前写入格式是 Session V4。句柄只追加，未来版本会被拒绝，历史代际靠相邻迁移变成当前逻辑事件。压缩替换 surface，遥测走独立的 OTel 通道。"
status: published
words: 2156
codeLines: 81
minutes: 11
updated: "2026-11-22"
---

# 第12章：持久化、压缩与遥测

**一句话定义：持久化是会话日志的插件；本钉的写入格式是 Session V4，压缩替换一段 surface，遥测把已经发生的事实送到独立通道。**

旧笔记说 `SessionHeader` 没有迁移、版本不符就拒绝。本钉分成两层。内存与「已经恢复成当前逻辑格式」的头仍然只接受版本 4，这是第 5 章 `validateSessionHeader` 的行为。磁盘上的历史代际由相邻迁移包变成版本 4，再交给这层校验。旧笔记写过的 coordinator.ts 与 write-behind.ts 在本钉不存在。该目录现在是 [`handle.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence/src/handle.ts)、[`storage-contract.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence/src/storage-contract.ts)、[`revision.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence/src/revision.ts)、[`errors.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence/src/errors.ts) 和 `index.ts`。

## 写入版本是 4

[`docs/session-format-status.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/session-format-status.md) 把三个数字分开。代码里的权威是 `packages/core/session/src/types.ts` 的 `SESSION_FORMAT_VERSION`。定稿记录和发布记录在本钉都是 4：

```yaml
latestFinalizedVersion: 4
```

```yaml
latestReleasedVersion: 4
evidenceTag: dsh-v0.2.0-rc.2
```

文档写明：alpha、beta 或 release candidate 的产品发布就会建立已发布 Session 格式的义务。GitHub 的 prerelease 标记不会让已经写下的用户数据变成可丢弃的。证据标签是 `dsh-v0.2.0-rc.2`，不必是第一个带上该格式的发布。本钉的写入器与已发布格式同为 4，所以当前格式已经随产品发布过。以后若写入器大于发布记录，才表示新版本尚未记入发布。怎样把旧代际迁到 4，写在第 17 章。这一章固定句柄、版本门、压缩和遥测。

[`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 的 Session log 节描述读路径：只看头的 `stat` 和 `list` 扫描会话目录，选择数值最大的规范代际，翻译受支持的历史头，不加载事件，也不发布后继。`open` 选择同一代际，拒绝未来版本，或者把静态的相邻迁移链组合一次，再返回校验过的当前逻辑事件。读打开使用内存结果，不发布后继；写打开先编码、校验，并在不改动源文件的前提下独占发布最终的、带版本名的后继。已提交的代际路径永不改名、替换或删除。

文件名规则在 [`packages/session/session-format/src/filename.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-format/src/filename.ts)：

```ts
export function sessionFormatLogFilename(version: number): string {
  const generation = sessionFormatVersion(version, 'Session log generation version')
  return generation === 0 ? 'session.jsonl' : `session.v${generation}.jsonl`
}
```

v0 是 `session.jsonl`，v1 及以后是小写的 `session.vN.jsonl`。压缩后缀由 JSONL 提供者另加。每个相邻包只拥有一步 `vN -> vN+1`。本钉目录里有 `session-format-v0-to-v1`、`session-format-v1-to-v2`、`session-format-v2-to-v3`、`session-format-v3-to-v4`。最后一步的文件头在 [`packages/session/session-format-v3-to-v4/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-format-v3-to-v4/src/index.ts)：

```ts
/** Tool-role V3-to-V4 migration with native V4 framing and delivery validation. */
```

纯的迁移机器在 [`packages/session/session-format/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-format/src/index.ts)，模块注释是 “Pure adjacent streaming Session format migration machinery.” JSONL 与 SQLite 是两种后端包：`session-persistence-jsonl`、`session-persistence-sqlite`。

## 句柄与版本门

[`packages/session/session-persistence/src/handle.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence/src/handle.ts) 把一次打开定义成单所有者通道：

```ts
export type SessionAccess = 'read' | 'write'
```

```ts
export interface SessionHandle extends AsyncDisposable {
  /** The stored session this handle addresses. */
  readonly id: SessionId
  /** The immutable stored header, fixed at `create`/`open`. */
  readonly header: SessionHeader
  /**
   * Exact fork-inherited prefix length stored with the log; `0` when
   * `header.isSeeded` is false. Storage metadata paired with the header for
   * every body read, never part of the replayable event log.
   */
  readonly inheritedEventCount: SessionLogOffset
  /** Whether this handle may mutate the log. */
  readonly access: SessionAccess
```

`write` 是唯一修改者，同时能读自己的日志。`read` 只观察，不取得所有权。`read` 不回退到这个句柄已经见过的更旧状态。写句柄上的 `append` 或 `flush` 一旦 resolve，之后在同一后端实例上开始的读都能看见至少那个前缀。`close()` 是唯一的拆卸，幂等且不可取消。

JSONL 打开路径上的版本门在 [`packages/session/session-persistence-jsonl/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence-jsonl/src/index.ts) 的 `JsonlSessionPersistence.requireStoredLog`。`sourceVersion` 小于 4 时进入 `loadStoredMigration`；后继只在写打开时发布。大于 4 时交给 `readGenerationHeader`，注释写明可读的未来头在那里被拒绝，不会变成当前逻辑会话：

```ts
    if (selected.sourceVersion < SESSION_FORMAT_VERSION) {
      const sourceRevision = fileRevision(await stat(selected.sourcePath, { bigint: true }))
      signal?.throwIfAborted()
      let preparation = this.migrationPreparations.get(id)
      if (preparation === undefined
        || preparation.sourcePath !== selected.sourcePath
        || preparation.sourceRevision !== sourceRevision) {
        const controller = new AbortController()
        const promise = this.loadStoredMigration(id, selected, sourceRevision, controller.signal)
```

```ts
    if (selected.sourceVersion > SESSION_FORMAT_VERSION) {
      const header = await this.readGenerationHeader(selected, id, signal)
      /* v8 ignore else -- a readable future header is rejected inside readGenerationHeader. */
```

`readGenerationHeader` 在头状态是 `unsupported` 且 `storedVersion` 大于当前写入器时，用 `sessionFormatVersionRefusal` 抛出 `SessionFormatUnsupportedError`：

```ts
    if (result.status === 'unsupported') {
      const physicalId = String((value as { id?: unknown }).id)
      let reason = result.reason
      /* v8 ignore else -- released historical header migrations cannot refuse after physical decoding. */
      if (result.storedVersion > SESSION_FORMAT_VERSION) {
        reason = sessionFormatVersionRefusal(physicalId, result.storedVersion)
      }
      throw new SessionFormatUnsupportedError(
        `${reason} (raw log: ${selected.sourcePath})`,
        { kind: 'jsonl', path: selected.sourcePath },
      )
    }
```

同一包的 [`packages/session/session-persistence-jsonl/src/format.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence-jsonl/src/format.ts) 在 `parseHeaderRecord` 里、校验当前头形状和解码事件行之前调用 `refuseForeignFormatVersion`。数字版本不是 `SESSION_FORMAT_VERSION` 就拒绝：

```ts
function refuseForeignFormatVersion(parsed: object): void {
  const { version, id } = parsed as { version?: unknown; id?: unknown }
  if (typeof version !== 'number' || version === SESSION_FORMAT_VERSION) return
  throw new SessionFormatUnsupportedError(
    sessionFormatVersionRefusal(typeof id === 'string' ? id : String(id), version),
  )
}
```

两处拒绝文案都来自 [`packages/session/session-persistence/src/errors.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence/src/errors.ts) 的 `sessionFormatVersionRefusal`。更新的日志要求升级 harness；更旧、又没有恢复成当前格式的日志说这个构建没有升级路径：

```ts
export function sessionFormatVersionRefusal(id: string, version: number): string {
  return version > SESSION_FORMAT_VERSION
    ? `session "${id}" uses log format v${version}, but this harness reads only v${SESSION_FORMAT_VERSION}: the log was written by a newer harness — upgrade the harness to open it`
    : `session "${id}" uses log format v${version}, older than the supported v${SESSION_FORMAT_VERSION}, and this build ships no upgrade path for it`
}
```

`SessionFormatUnsupportedError` 的类注释把这种拒绝和损坏分开：日志是完整的，只是这个运行时不能忠实解释；后端保留单文件时，原始日志仍留在 `location`。未知且未标 `ignorable` 的事件类型也使用这个错误类。

[`packages/session/session-persistence/src/storage-contract.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence/src/storage-contract.ts) 里的 `assertVersion` 同样在 `version !== SESSION_FORMAT_VERSION` 时拒绝，但本钉的 JSONL 打开路径不调用它。它的调用点在同目录的测试里。打开时拒绝未来版本的是上面的 `requireStoredLog` / `readGenerationHeader` / `refuseForeignFormatVersion`。

轻量观察用 [`packages/session/session-persistence/src/revision.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence/src/revision.ts) 的 `SessionPersistenceRevision`：一个不透明标记，同时标识存储源和日志修订，不是会话内容本身。

## 压缩

[`packages/compaction/compaction/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/compaction/compaction/src/index.ts) 是另一条接缝，键 `ctx.compaction`：

```ts
export abstract class CompactionEngine extends Service {
  constructor(ctx: Context) {
    super(ctx, 'compaction')
  }
```

成功的一次运行用一个摘要节点替换选中的 surface 区间，并阻止同一会话并发压缩。替换用的用户消息带有检查点来源，消费者可以认出它。`compactIfNeeded` 对明确的触发器考虑自动压缩：常规压力看最近一条持久的路由请求，上下文溢出即使低于平常阈值也可以强制做有用的缩减。没有安全区间时返回 `null`。单独一个过大的保留单元不能靠 surface 压缩修好。

基本提供者、图像卸载和工具结果修剪是 `packages/compaction/` 里的实现插件。它们听 `agent/pre-step` 或 `agent/request-error`，决策之后仍然通过会话事件改写 surface，所以下一次 `derive` 出来的历史已经是压缩后的。

## 遥测

[`packages/telemetry/otel/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/telemetry/otel/src/index.ts) 提供共享传输，服务键 `otel`。挂载本身不创建队列、身份或网络连接：

```ts
export default class OTel extends Service {
  constructor(ctx: Context) { super(ctx, 'otel') }

  /**
   * Create an independent ordinary-event channel with count-based batching.
   * The injected consumer must drain it during its fiber disposal.
   * @param options - transport, scope, resource, queue, and diagnostic settings selected by the consumer.
   * @returns the caller-owned channel; no state is shared with other channels.
   */
  createEventReporter(options: EventLogOptions): EventLogReporter { return new EventLogReporter(options) }

  /**
   * Create an independent byte-bounded Session-log channel.
   * Authorization and redaction precede reporting; the consumer owns shutdown and its outer deadline.
   * @param options - transport, scope, resource, queue, and diagnostic settings selected by the consumer.
   * @returns the caller-owned channel, preserving complete accepted events within the request byte ceiling.
   */
  createSessionLogReporter(options: SessionLogOptions): SessionLogReporter { return new SessionLogReporter(options) }
}
```

普通事件通道按条数批量，会话日志通道按字节设上限。授权和脱敏在上报之前；消费者拥有关闭和外部期限。会话侧的报告插件在 `packages/session/session-telemetry/` 与 `packages/session/session-telemetry-otel/`。遥测读已提交的事实，不成为模型上下文的第二条来源。

## 不变量

- 本钉写入器、定稿版本和已发布版本都是 4。发布证据标签是 `dsh-v0.2.0-rc.2`。预发布产品发布已经让这个格式承担兼容义务。
- 历史代际保留原文件。写打开发布 `session.vN.jsonl` 后继，不改名、不覆盖、不删除已提交代际。
- 迁移是相邻的 `vN -> vN+1`。本钉最后一步是 v3 到 v4。JSONL 打开时，`sourceVersion` 小于 4 进入 `loadStoredMigration`，大于 4 在 `readGenerationHeader` 里被拒绝。文案是 `sessionFormatVersionRefusal`：更新的日志要升级 harness，未恢复的更旧日志说这个构建没有升级路径。
- `SessionHandle` 的 `write` 是单一修改者。关闭后的操作失败。格式不能解释时抛 `SessionFormatUnsupportedError`，这和日志损坏是两类错误。
- 压缩替换 surface 上的一段并写入可重建的摘要。OTel 通道在事实发生之后独立送出，挂载 `ctx.otel` 本身不打开连接。

## 下一章

十二条脊柱到持久化为止：Cordis 插件叠成 profile，默认循环把 turn 和 step 写进只追加日志，模型与工具是可换的接缝，提示词和 inject 把事实送进下一次请求，子代理、workflow 和 jobs 把工作送出这个循环，V4 日志留在句柄后面。第 13 章离开这条进程内的脊柱，看 Electron 怎样用保留的 `desktop` profile 把同一棵 Web 应用树拉起来。Session 文件怎样从旧代际走到 v4，放在第 17 章，避免和第 12 章的句柄契约重复。
