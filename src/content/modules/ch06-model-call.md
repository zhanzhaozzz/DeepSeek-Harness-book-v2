---
order: 6
title: "第6章：llm 服务与流式适配器"
summary: "ctx.llm 是适配器注册表加可拦截的流式调用。适配器只讲线协议，循环提交的请求在 llm/stream 上对监听器是只读的。"
status: published
words: 749
codeLines: 30
minutes: 4
updated: "2026-11-22"
---

# 第6章：llm 服务与流式适配器

**一句话定义：`ctx.llm` 是适配器注册表和流式调用 API；换供应商就是再注册一个 `LlmAdapter`，调用方仍然走 `llm/stream`。**

[`packages/llm/llm/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/llm/llm/src/index.ts) 的模块注释：

```ts
/**
 * LLM service: adapter registry with a waterfall-interceptable streaming call
 * API. Exports the `LlmRuntime` default, the abstract `LlmAdapter` for
 * provider backends, and `BlockAssembler` for chunk assembly.
 *
 * @module @deepseek-ai/dsh-llm
 */
```

服务声明把键名固定为 `llm`，并把拦截点声明成 waterfall：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    llm: LlmRuntime
  }

  interface Events {
    /**
     * Waterfall around every streaming model call (retry, replay, routing).
     * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
     * adapter's stream, or yield your own chunks to short-circuit.
```

注释后半段是这条瀑布的只读契约：循环建造的请求带有进程内的 `markAgentLoopRequest` 标记，并且是深冻结的。它的内容是会话日志的纯函数，监听器只能读，不能改。手写的调用不带这个标记，调用方自己保证请求在流结束前不被修改。

## 运行时与适配器

```ts
export class LlmRuntime extends TypertRemoteService {
  private adapters = new Map<string, AdapterRegistration>()
```

构造函数 `super(ctx, 'llm')`。注册一个适配器时，空的 provider 列表会被拒绝，重复路由整批失败，成功则包进 effect，卸载时删掉路由：

```ts
  registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle {
    // The routes this registration currently holds; `replace` rewrites it, and
    // the disposer releases whatever it holds at disposal time.
    const owned = new Set<string>()
    // The disposer has run: `owned` being empty cannot say so on its own,
    // because `replace([])` legally leaves a live registration holding none.
    let released = false
    const dispose = this.ctx.effect(function* (this: LlmRuntime) {
      if (providers.length === 0) throw new LlmError('an adapter must register at least one provider', 'INVALID_ADAPTER')
      this.commitRoutes(owned, this.prepareRoutes(providers, adapter, owned))
```

抽象适配器的类注释要求：每个供应商 HTTP 请求都带上 `attributionHeaders()`。直接 fetch 的 DeepSeek 适配器和库背书的 pi-ai 适配器用不同的内部结构满足同一契约。

```ts
export abstract class LlmAdapter {
```

本钉 `packages/llm/` 下能看到的邻居包括 `llm-deepseek`、`llm-deepseek-api-key`、`llm-deepseek-account`、`llm-pi-ai`、`llm-retry`、`token-meter`、`deepseek-llm-api-extensions`。它们都是挂到 `ctx.llm` 上的提供者或围绕调用的策略，循环本身不 import 某一个 HTTP 客户端。

## 循环怎样用它

第 4 章的 `step()` 在提交 system 与 user 消息之后调用 `buildRequest`，再把流交给 `AssistantStreamAttempt`。架构文档把这段接在 `agent/request -> prepareCall` 之后：`prepareCall()` 绑定适配器；取消发生在这段异步阶段时，系统候选和已接受的用户消息都不提交。每次尝试都刷新运行时事实并从日志导出历史。

`llm/stream` 的监听器若要重试、回放或改路由，必须调用 `next()` 才会到达适配器；自己产出 chunk 则是短路。这和 primer 里 waterfall 的 `next()` 是同一条规则。`llm-retry` 就是挂在失败瀑布上的一个监听者，具体触发点在事件矩阵里还能看到 `agent/request-error`。

## 不变量

- 模型词汇和流式接缝在 `ctx.llm`。供应商实现注册进这张表，用 effect 收回。
- 循环建造的请求在 `llm/stream` 上是深冻结的。要改变模型看见的内容，回到会话日志，而不是改这次请求对象。
- 适配器负责线协议和 attribution 头。重试、计量、账号路由是旁边的插件。
- 一次尝试的增量帧走 `agent/assistant-stream`；写进日志的 `assistant/message` 或 `assistant/attempt` 才是结算。

## 下一章

第 7 章看这次响应里的工具调用怎样进入注册表：`tools.register` 返回 disposer，执行要穿过 `tools/pre-execute`、`tools/execute`、`tools/post-execute` 三条瀑布。
