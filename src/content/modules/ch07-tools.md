---
order: 7
title: "第7章：工具注册与执行管线"
summary: "工具按作用域注册进 ctx.tools。一次调用先记 tool/call，再穿过三条瀑布和守卫，最后以一条 tool/result 回到日志。"
status: published
words: 951
codeLines: 27
minutes: 5
updated: "2026-11-22"
---

# 第7章：工具注册与执行管线

**一句话定义：`ctx.tools` 是带作用域的工具注册表和被守卫的执行管线；模型看见的 schema 从这张表进入 system prompt。**

[`packages/core/tools/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/tools/src/index.ts) 打开文件就说明执行器是插件自己的：

```ts
/** Tool definitions and scoped dispatch to plugin-owned executors. @module */
```

```ts
export class ToolsService extends Service {
  static inject = ['systemPrompt']
  static Config = z.object({
    mode: z.never().description('Removed. Mount a native or PTC tool executor instead.'),
    maxParallelSubCalls: z.never().description('Moved to the PTC tool executor configuration.'),
  })
```

配置字段 `mode` 与 `maxParallelSubCalls` 被标成已删除。本钉把执行器分成原生与 PTC 两套插件：`packages/core/tool-executor-native/` 与 `packages/core/tool-executor-ptc/`。注册表不再用一个 mode 开关选择运行时。

## 注册返回 disposer

```ts
  register(definition: ToolDefinition, options: ToolRegistrationOptions = {}): () => void {
    const name = definition.name
```

函数要求每个工具声明 `output`（含 `schema`、`render`，可选 `presentationMeta`），`timeoutMs` 若给出则必须是正的有限数。名字 `run_code` 无条件保留：

```ts
    if (name === RUN_CODE_NAME) {
      throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the PTC mode presentation transport and cannot be registered or shadowed`)
    }
    return this.layers.effect(
      this.ctx,
      layer => layer.tools.insert(name, { definition, when: options.when }),
      { label: 'tools.register()' },
    )
```

作用域内的工具遮蔽全局工具；同一层重复名字失败。`restrict()` 只能在 `agent.ctx` 上调用，用来收紧这个 agent 能看见的全局工具。构造函数把当前作用域的工具描述交给 `ctx.systemPrompt.tools(...)`，所以第 10 章组装提示词时，schema 来自同一次 step 已经解析好的工具集。

## 三条瀑布

事件声明在 [`packages/core/tools/src/events.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/tools/src/events.ts)。三条都是 waterfall，并且按作用域过滤：

```ts
    'tools/pre-execute'(this: Scoped<ToolsService>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
```

```ts
    'tools/execute'(this: Scoped<ToolsService>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>
```

```ts
    'tools/post-execute'(this: Scoped<ToolsService>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>
```

`pre-execute` 在派发前允许、拒绝、取消或询问。`execute` 包住真正的派发，适合超时、重试和指标，包装器只能换 `exec.signal`，调用身份保持不变。`post-execute` 接受、替换、丰富或阻断已经规范化的结果。监听器要放行就必须调用 `next()`。

[`docs/tool-execution-pipeline.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/tool-execution-pipeline.md) 把顺序写成一段话。内建执行器拥有原始批次的解析、调度、取消和会话里的 call/result 日志。`tools/pre-execute` 最先跑，接着是单调守卫，然后才是 `tools/execute` 与 `tools/post-execute`。定义自己的 `projectContent` 在 post-execute 之前装上准备好的内容；`finalizeContent` 和 `tools/result` 在其后。文件系统的读后写检查留在 `tool-fs` 下面的 `fs/*` 事件上。审批由 `ctx.approval` 在单调守卫之前解决一次性询问。

PTC 模式把保留的 `run_code` 传输和它内部有序的子调用都送进同一条管线。子调用带父 token，记下 `tool/ptc-dispatch`，拒绝作为有约束力的 rejection 返回，并省略 `additionalContexts`，以保住 call 与 result 的相邻。

## Web 这组工具现在的包

[`packages/web/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/web/README.md) 的包表是这一家族的地图。旧笔记里的 web-search-exa 包在本钉不存在。

```md
| Package | Role | ctx key |
|---|---|---|
| [`web/`](web/README.md) | Search/fetch service: search and fetch URLs through interchangeable backends, one selection and error policy | `ctx.web` |
| [`web-search-deepseek/`](web-search-deepseek/README.md) | Searches through DeepSeek Messages | registers on `ctx.web` |
| [`web-deepseek-api/`](web-deepseek-api/README.md) | Searches and fetches pages through the DeepSeek Search and Fetch APIs | registers on `ctx.web` |
| [`web-fetch-http/`](web-fetch-http/README.md) | Fetches HTTP(S) pages anonymously | registers on `ctx.web` |
| [`tool-web/`](tool-web/README.md) | Exposes `web_search` and `web_fetch` to the model | registers on `ctx.tools` |
```

模型面对的是 `ctx.tools` 上的 `web_search` 与 `web_fetch`。搜索和抓取的后端注册在 `ctx.web`。换后端时，工具名和错误报告保持同一套，这就是第 9 章接缝要讲的「消费者不 import 具体提供者」。

## 不变量

- 工具用 `register()` 进入分层注册表，返回值就是卸下它的 disposer。`run_code` 不能被注册或遮蔽。
- 执行器是独立插件。`ToolsService` 的 `mode` 配置已经删除。
- 一次模型侧调用先成为会话里的 `tool/call`，穿过 pre / guards / execute / post，再以一条 `tool/result` 结束。
- 三条 `tools/*` 都是 waterfall。不调用 `next()` 就是短路，这是策略监听器的合法手段，观察者则必须委托。
- Web 搜索与抓取的包是 `web`、`web-search-deepseek`、`web-deepseek-api`、`web-fetch-http`、`tool-web`。

## 下一章

第 8 章把事件收成三个域：要活过重载的写进会话日志，要观察飞行中的工作就听 `agent/*`，要给一条接缝加策略就听 `fs/*`、`tools/*`、`telemetry/*` 这一类名字。
