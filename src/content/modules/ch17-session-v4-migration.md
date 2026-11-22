---
order: 17
title: "第17章：Session V4 迁移"
summary: "把旧会话迁到当前格式是一条从 0 到 4 的相邻链。写打开在旧文件旁边发布后继；同版本不迁移，更新的版本被拒绝。"
status: published
words: 1269
codeLines: 39
minutes: 6
updated: "2026-11-22"
---

# 第17章：Session V4 迁移

**一句话定义：Session 迁移是一条不许跳步的 `vN -> vN+1` 链；本钉的终点是 4，写打开在不改动源文件的前提下发布 `session.v4.jsonl`。**

第 12 章已经写过句柄、`assertVersion`、压缩和遥测。这里不再重复那份存储契约，只看格式怎样从旧代际走到当前写入器，以及一份已经落盘的日志该怎样移动。

## 写入器是 4，链必须凑齐

[`packages/core/session/src/types.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/session/src/types.ts) 里唯一手工维护的当前写入号是：

```ts
export const SESSION_FORMAT_VERSION = 4
```

[`docs/session-format-status.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/session-format-status.md) 规定目录生成器用这个常数检查相邻迁移是否走到它。包版本、codec 导出名、fixture 文件名都不是写入器的权威。本钉的定稿记录和发布记录都是 4，证据标签是 `dsh-v0.2.0-rc.2`。预发布的产品发布已经让这个格式承担兼容义务。

[`packages/session/session-format/src/chain.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-format/src/chain.ts) 在冻结一条迁移声明时要求步长正好是 1：

```ts
export function defineSessionFormatMigration(migration: SessionFormatMigration): SessionFormatMigration {
  if (typeof migration.name !== 'string' || migration.name.length === 0) {
    throw new SessionFormatError('Session migration name must be a non-empty string')
  }
  const from = sessionFormatVersion(migration.fromVersion, `${migration.name} fromVersion`)
  const to = sessionFormatVersion(migration.toVersion, `${migration.name} toVersion`)
  if (to !== from + 1) {
    throw new SessionFormatError(`${migration.name} must declare adjacent v${from}->v${from + 1}`)
  }
  return Object.freeze({ ...migration })
}
```

`createSessionFormatChain` 再检查从 0 到当前版本的每一步都有且只有一条声明。缺一步抛 `SessionFormatUnsupportedMigrationError`，多出来的、不通向当前版本的边也会被拒绝。这个错误类型定义在 [`packages/session/session-format/src/error.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-format/src/error.ts)：可读、但已发布的源策略没有受支持迁移。

规划时，比写入器更新的头同样被拒绝，而不是降级读取：

```ts
  private plan(fromVersion: number): readonly SessionFormatMigration[] {
    const from = sessionFormatVersion(fromVersion, 'stored Session format version')
    if (from > this.currentVersion) {
      throw new SessionFormatUnsupportedMigrationError(
        `stored Session uses newer format v${from}; this build writes v${this.currentVersion}`,
      )
    }
    return Object.freeze(this.migrations.slice(from))
  }
```

同版本不进入这条链。[`docs/cookbook/adding-a-session-format-version.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/cookbook/adding-a-session-format-version.md)：

```md
Same-version logs bypass adjacent migrations and can mix historical and newer record variants after resume. Each integer therefore identifies a family of supported representations, not one fixed schema. Owning readers must retain and distinguish those variants; the next outgoing migration must handle them. Do not add same-version migrations or rely on `restoreCurrent` alone for normalization: current-version JSONL reads using transformed validation bypass that hook. Use disposable, isolated Harness homes for interim integration formats; rerun changed adjacent conversions from unchanged historical input rather than rewriting a committed generation or using a real user's home.
```

文件名仍由 [`packages/session/session-format/src/filename.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-format/src/filename.ts) 决定：v0 是 `session.jsonl`，其后是 `session.vN.jsonl`。已提交的代际不改名、不覆盖、不删除。

## 本钉的四步

每一包只拥有一步，文件头写明这一步保留什么：

[`packages/session/session-format-v0-to-v1/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-format-v0-to-v1/src/index.ts)

```ts
/** Frozen released-v0 physical codec and identity migration into shared-layout v1. */
```

[`packages/session/session-format-v1-to-v2/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-format-v1-to-v2/src/index.ts)

```ts
/** Frozen released-v1 physical codec and assistant-stream migration into v2. */
```

[`packages/session/session-format-v2-to-v3/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-format-v2-to-v3/src/index.ts)

```ts
/** Released-V2 codec and streaming system, canonical-envelope, and PTC migration into V3. */
```

[`packages/session/session-format-v3-to-v4/src/migration.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-format-v3-to-v4/src/migration.ts) 的最后一步先改头，事件体还要调用者提供历史子会话事实；没有子会话时也要传空数组：

```ts
export const sessionFormatV3ToV4 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v3-to-v4',
  fromVersion: 3,
  toVersion: 4,
  migrateHeader(header) {
    assertReleasedV3Header(header)
    return { ...header, version: 4 }
  },
  createStage() {
    throw new SessionFormatUnsupportedMigrationError('V3 catalog migration requires explicit historical child facts, including an empty array for a parent without children')
  },
  validateTargetHeader: assertReleasedV4Header,
})
```

`createSessionFormatV3ToV4(children)` 把那份证据绑进 stage。目录生成器要求从 0 到写入器的每一步恰好一个包，并且目录是构建期静态的：历史可读性不取决于运行时有没有把某个插件挂上。

## 怎样移动一份已经落盘的会话

[`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 把读打开和写打开分开：

```md
A read open uses that in-memory result without publishing a successor; a write open first encodes, verifies, and exclusively publishes the final version-named successor beside the unchanged source.
```

用本钉的运行时对旧会话做一次写打开，就会在原文件旁边得到当前代际。源文件留着。只读打开只在内存里给出当前逻辑事件，不发布后继。头已经是 4 时，相邻链不跑，读者必须自己接受这一版里并存的历史写法。头大于 4 时，这条链拒绝解释，原始日志仍留在后端指出的位置。不要手改、重命名或删除已经提交的 `session.jsonl` / `session.vN.jsonl`。试验中的格式用一次性的、隔离的 Harness home，并从没有改过的历史输入重跑转换。

官方 [`docs/upgrade-guide/`](https://github.com/deepseek-ai/deepseek-harness/tree/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/upgrade-guide) 记录各次产品发布里用户能感知的破坏性变更。格式整数本身的权威仍是 `SESSION_FORMAT_VERSION` 和 `docs/session-format-status.md`，不是某一篇升级指南的标题。

## 不变量

- 当前写入器是 4。迁移声明的 `toVersion` 必须等于 `fromVersion + 1`。从 0 到 4 的每一步都要有唯一的包。
- 四步分别是 v0→v1 的身份与共享布局、v1→v2 的助手流、v2→v3 的系统消息与 PTC、v3→v4 的工具角色。v3→v4 的事件体要有显式的历史子会话事实。
- 同版本绕过相邻迁移。比 4 新的存储版本被 `SessionFormatUnsupportedMigrationError` 拒绝。
- 写打开在源文件旁边发布最终代际。读打开不发布后继。已提交代际不改写。
- 第 12 章的句柄和 `assertVersion` 面对的是已经恢复成当前逻辑格式的头。迁移发生在那扇门之前。

## 读完十七章

脊柱从 Cordis 和 profile 走到循环、日志、模型和工具，再走到提示词、子代理和 V4 持久化。后面五章补上 Desktop 的 `desktop` profile、Python 的显式 home、MCP 工具前缀、默认关闭的 Teams，以及这条相邻迁移链。下一颗官方标签仍以 `docs/upgrade-guide/` 和这一钉的 SHA 对照来改摘录，而不是把链接改回默认分支。
