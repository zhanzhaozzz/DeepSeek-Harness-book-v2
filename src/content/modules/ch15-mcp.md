---
order: 15
title: "第15章：MCP —— 外部服务器变成 ctx.tools"
summary: "mcp 分组把外部 Model Context Protocol 服务器收成连接、舰队和资源工具。模型只在作用域里真有服务器时才看见这些工具。"
status: published
words: 867
codeLines: 28
minutes: 4
updated: "2026-11-22"
---

# 第15章：MCP —— 外部服务器变成 ctx.tools

**一句话定义：MCP 分组把外部 Model Context Protocol 服务器的工具和资源接进 harness；每台服务器一个客户端，工具以带服务器前缀的名字登记在 `ctx.tools` 上。**

[`packages/mcp/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/mcp/README.md) 的 Summary：

```md
The `mcp/` group lets the model call external Model Context Protocol (MCP) tools and read server resources. Configure `mcp-client` entries directly, or let `mcp-manager` run a settings-driven fleet of them that a management surface edits at runtime; shipped profiles already mount `mcp-resources` once. MCP tools and prompt text appear only for callers with a configured server in scope. Connections also supply server instructions.
```

同一页的包表把四种角色分开：

```md
| Package | What it provides |
|---|---|
| [`mcp-account/`](mcp-account/README.md) | Show each MCP connector's OAuth server account on the Plugins page through the connector account registry |
| [`mcp-client/`](mcp-client/README.md) | Connect one MCP server, expose its tools and instructions, and provide its resource operations |
| [`mcp-manager/`](mcp-manager/README.md) | Manage a settings-driven fleet of mcp-client instances: live add/edit/enable/disable/delete, status, restart, probe |
| [`mcp-resources/`](mcp-resources/README.md) | Discover and read resources through shared tools with explicit server selection |
```

这仍是第 9 章的三种角色。`mcp-client` 是连到一台服务器的 Provider。`mcp-resources` 是跨连接的 Consumer，把资源操作做成模型工具。`mcp-manager` 不自己实现协议，它按设置挂上或卸下一组 `mcp-client`。`mcp-account` 把 OAuth 账号显示到插件页的连接器账号注册表。

## 一个插件实例，一台服务器

[`packages/mcp/mcp-client/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/mcp/mcp-client/src/index.ts) 是命名导出的函数插件，没有默认导出。模块注释写明公开名字的形状：`mcp__<serverName>__<rawName>`。`inject` 只有 `tools`。

`apply` 在任何 effect 登记之前就拒绝配错的连接：

```ts
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (hasOAuthWithAuthorizationHeader(config)) {
    throw new Error('MCP OAuth and an Authorization header cannot be configured together')
  }
  const oauth = config.transport === 'streamable-http' && config.oauth !== undefined
    ? new McpOAuthCredentials(ctx, config.oauth)
    : undefined
  // Fail loud at load: reconnect misconfiguration (including programmatic
  // construction that bypassed Schemastery) rejects THIS instance before any
  // effect registers.
  const reconnect = resolveReconnectPolicy(config.reconnect, `mcp-client(${config.serverName}): reconnect`)
```

传输是 `stdio`（拉起子进程）或 `streamable-http`。`serverName` 必须匹配 `[A-Za-z0-9_-]{1,32}`，并且在同一注册作用域里唯一。作用域由 `scopeOf(ctx)` 决定；agent 作用域里的服务器可以和另一个 agent 重用同一个名字，全局实例则互斥。卸载时 effect 的 disposer 断开连接、卸下全部工具，并放开这个 `serverName`。HMR 用卸掉旧实例、创建新实例来换；相同的 `serverName` 会得到相同的公开工具名。

注释还解释 `apply` 为什么必须是 `async`：Cordis 会把带原型的普通函数当成构造器，那样返回的 Promise 就不算启动工作。

管理面要同时管多台服务器时，不复制这份 `apply`，而是使用导出的 `McpClientHost` 去做校验、挂载、探测和授权。

## 资源工具是另一层

[`packages/mcp/mcp-resources/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/mcp/mcp-resources/src/index.ts) 把资源运行时挂到 `ctx.mcpResources`：

```ts
export class McpResourceRuntime extends Service {
  /** Tool registry required by the resource consumer. */
  static inject = ['tools']

  private readonly layers = new ScopedLayers(() => new ResourceLayer(), () => undefined)
  /** Shared tool registrations outlive any one server's registering context. */
  private readonly selfCtx: Context

  constructor(ctx: Context) {
    super(ctx, 'mcpResources')
```

连接插件把自己登记成 `McpResourceProvider`。共享工具在调用时显式选择服务器，操作是 `resources/list`、`resources/templates/list` 或 `resources/read`。工具可以并行派发，所以一个 provider 必须让并发请求各自结束。随安装的 profile 已经把 `mcp-resources` 挂上一次；没有配置服务器的调用者看不到 MCP 工具，也看不到对应的提示词文本。连接还可以提供服务器说明，供提示词使用。

## 不变量

- 模型调用的是 `ctx.tools` 上的工具，名字是 `mcp__<serverName>__<rawName>`。协议留在 `mcp-client` 里。
- 一个插件实例只连一台服务器。多台服务器是多行配置，或由 `mcp-manager` 按设置组成的舰队。
- OAuth 和手写的 `Authorization` 头不能同时配置。重连策略在 effect 登记前就校验。
- `serverName` 在一个注册作用域内唯一。卸载收回工具和这个名字。
- 资源发现和读取走 `ctx.mcpResources`。没有落在作用域里的服务器，调用者看不见 MCP 工具和相关提示词。

## 下一章

第 16 章看子代理树上的共享任务板。它已经随 `dsh-base` 装上，但新会话默认关闭，不再靠一个实验 profile 来打开。
