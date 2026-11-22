---
order: 16
title: "第16章：Teams —— 默认关闭的共享任务板"
summary: "Agent Teams 是 packages/team 里的产品包，随 dsh-base 挂上。新会话默认关闭；打开它是根 Session 的选择，不是实验 profile。"
status: published
words: 944
codeLines: 16
minutes: 5
updated: "2026-11-22"
---

# 第16章：Teams —— 默认关闭的共享任务板

**一句话定义：Agent Teams 给一棵子代理树加一块持久的共享任务板；包在 `packages/team`，随 base 挂载，新的根会话默认关闭。**

它不在 `packages/experimental`。实验分组的 README 把「整个公开契约仍在评估」的包留在那个目录里，并另指到 Agent Teams 子系统，说明任务板已经是产品服务 `ctx.agentTeams`。早先那个可选 bundle 被退休了。[`docs/upgrade-guide/v0.2.1-rc.2/session-team-mode/guide.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/upgrade-guide/v0.2.1-rc.2/session-team-mode/guide.md) 的 Change 节：

```md
Agent Teams ships with base-backed profiles; new Sessions default to off. The Plugins page has no separate Agent Teams switch. The root Session’s selection controls task tools and Team guidance throughout its subagent tree. The model and reasoning menu offers **Use Agent Teams**, and the root conversation’s Subagent header control opens members above shared tasks in one panel while enabled. Child conversations retain navigation without a shared task board.
```

同一指南的迁移步骤写明：启动一次现有 profile 后，加载逻辑会从 `dsh.profile.bundles` 里拿掉退休的 `@deepseek-ai/dsh-experimental-agent-team-profile`。base 和 Web bundle 提供原来的插件。自定义组合要把 `@deepseek-ai/dsh-experimental-agent-team`、`@deepseek-ai/dsh-experimental-tool-agent-team`、`@deepseek-ai/dsh-experimental-client-ui-agent-team` 换成不带 `experimental-` 的包名。`/team on` 和 `/team off` 已经删除。

## base 里的两行

[`packages/bundle/base/cordis.patch.yml`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/bundle/base/cordis.patch.yml) 在子代理旁边插入服务和工具：

```yaml
    - id: agent-team
      name: '@deepseek-ai/dsh-agent-team'
      config:
        maxTasks: 256

    - id: tool-agent-team
      name: '@deepseek-ai/dsh-tool-agent-team'
```

[`packages/team/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/team/README.md) 把两行的角色写成表：`agent-team` 拥有共享任务板和保存下来的 Team 模式，键是 `ctx.agentTeams`；`tool-agent-team` 在 Team 模式打开时把任务工具登记到 `ctx.tools`。子代理的创建、发现、消息和打断仍在 `packages/subagent`。

因此「要不要 Teams」不是再选一个 profile。base 支持的 profile（web、headless、sdk、acp）已经把这两行叠进去。`sdk-minimal` 不套 `dsh-base`，它的树里没有这两行，除非调用者自己补上。打开与否是根 Session 的保存选择。

## 服务默认关着

[`packages/team/agent-team/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/team/agent-team/src/index.ts)：

```ts
export class TeamService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'subagents']

  static Config: z<Config> = z.object({
    maxTasks: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS),
    defaultEnabled: z.boolean().default(false),
  })
```

构造函数 `super(ctx, 'agentTeams')`。`DEFAULT_MAX_TASKS` 是 256，和 base 补丁里的 `maxTasks: 256` 一致。`defaultEnabled` 默认 false。只有把它设成 true，初始化时才会在 `agent/created` 上给还没有选择的新根会话调用 `setEnabled`。已有选择优先；恢复会话不会套用这个默认值，包括当初没保存过选择的会话。后代使用活着的根的模式。

已经删掉的配置键如果还出现在行上，启动直接失败：

```ts
const REMOVED_CONFIG_KEYS = ['maxMembers', 'maxMessageBytes', 'disposalTimeoutMs'] as const
```

注释说明队友就是子代理，所以人数、消息大小和释放超时改由子代理限制和 inbox 投递负责。

选择写进会话日志的事件是 `team/mode`。关掉 Team 会在后续 step 里藏起工具和指引，任务和子代理还在。一次变更不等待已经排队的任务修改：已经接纳的操作做完，排队的操作要到自己开始时再看当前模式。历史任务板如果没有保存过选择，仍视为开启。根可以改这个选择，后代共享它。

## 不变量

- Teams 是 `packages/team` 的产品包，不是 `packages/experimental` 里的能力，也不再靠实验 profile bundle。
- `dsh-base` 同时挂上 `@deepseek-ai/dsh-agent-team` 和 `@deepseek-ai/dsh-tool-agent-team`。新会话默认关闭。
- 开关是根 Session 的 `team/mode` 记录。插件页没有单独的 Agent Teams 开关。
- 任务板上限默认 256。`maxMembers`、`maxMessageBytes`、`disposalTimeoutMs` 会让这一行启动失败。
- 发现、消息和打断仍走子代理。Team 加上的是可比较并交换的任务所有权和依赖。

## 下一章

第 17 章回到会话文件：第 12 章已经固定 V4 句柄和版本门，这一章只写相邻迁移怎样把 0 到 3 的日志变成当前代际，以及不该怎样改已提交的文件。
