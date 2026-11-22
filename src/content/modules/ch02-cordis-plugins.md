---
order: 2
title: "第2章：Cordis 与插件"
summary: "插件、context、inject、类型化事件与可逆 effect。dsh 的每个能力都挂在这五个想法上。"
status: published
words: 777
codeLines: 40
minutes: 4
updated: "2026-11-22"
---

# 第2章：Cordis 与插件

**一句话定义：Cordis 是 dsh 下面的插件框架；插件向共享 context 贡献服务、类型化事件和可逆 effect。**

[`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 用两段把边界说完：

```md
[Cordis](cordis-primer.md) is the framework under dsh: plugins contribute services, typed events, and reversible effects to a shared context. Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so each is replaceable from configuration.

There is no privileged core to patch: you extend dsh by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads.
```

Cordis 源码以 vendor 形式放在 [`vendor/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/vendor/README.md) 所描述的目录里。读 harness 时先读 [`docs/cordis-primer.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/cordis-primer.md) 和 [`docs/cordis-tutorial/01-first-plugin.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/cordis-tutorial/01-first-plugin.md)，不必先把 vendor 整树读完。

## 五个想法

Primer 的 Cordis In Five Ideas 是这一章的提纲。原文如下（第二句的冠词是上游文本）：

```md
- **A plugin is a object that implements Service.** It can be a function with optional `inject` and `apply(ctx)` fields, or a `Service` subclass whose lifecycle Cordis mounts into the current context.
- **A context is a repository of services.** A service claims a stable `ctx.<key>` such as `ctx.tools`, `ctx.llm`, or `ctx.sessions` from a context; other plugins find services via key instead of importing a concrete implementation.
- **Declare service dependency via `inject`.** A plugin that names required services waits until those services exist, so load order is expressed through service requirements rather than manual boot sequencing.
- **Typed Events for communication.** Services declare event names through TypeScript declaration merging, then dispatch them as `emit`, `waterfall`, `parallel`, `serial`, or `bail` depending on whether listeners observe, wrap, fan out, run in order, or stop at the first bail value.
- **Registrations are reversible effects.** Prompt sections, tool schemas, adapters, providers, and listeners are installed through `ctx.effect()` or `ctx.on()` so reload and teardown unwind them predictably.
```

`ctx` 键就是第 1 章那张核心表。调用方写 `ctx.llm`，拿到的是当前 context 里登记在这个键上的服务，文件顶部的 import 只提供类型。

## 三种插件形态

教程第 1 章给出最小函数插件。下面整段来自 [`docs/cordis-tutorial/01-first-plugin.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/cordis-tutorial/01-first-plugin.md)：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

同一页接着列出另外两种形态：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. Function plugin (what you just wrote).
export function apply(ctx: Context) {}

// 2. Object plugin: an object with an `apply` method.
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}

// 3. Class plugin: a Service subclass (covered in chapter 3).
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

`super(ctx, 'myTutorialService')` 的第二个参数就是 `ctx.myTutorialService` 这个键。后面各章的真实服务用的是同一写法：`AgentLoop` 构造时 `super(ctx, 'agentLoop')`，`LlmRuntime` 用 `'llm'`，`ToolsService` 用 `'tools'`。

教程同时提醒：`cordis.yml` 里的条目会并发启动，列表位置不决定谁先就绪。顺序来自 `inject`，也就是「我要等哪些服务出现」。

## 注册是 effect

[`AGENTS.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/AGENTS.md) 把这条写成仓库约定：

```md
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer, directly or through its documented registration handle.
```

因此 `tools.register()`、`llm.registerAdapter()`、`systemPrompt.section()` 返回的都是卸载函数。插件被卸下或 HMR 重放时，Cordis 调用这些 disposer，注册表回到挂载之前。这就是「旁边再挂一个插件」能够成立的原因：新贡献走 effect，旧贡献在卸载时自己收回。

## 事件的五种派发

Primer 的 Dispatch Modes 表规定一个事件只能有一种模式：

```md
| Mode | Awaited? | Dispatch Order | Has Return Value? |
|---|---|---|---|
| `emit` | No | listeners observe in registration order | No |
| `waterfall` | No | listeners observe in registration order | Yes |
| `parallel` | Yes | all listeners observe the event in parallel | No |
| `serial` | Yes | listeners observe in registration order | Yes |
| `bail` | No | listeners observe in registration order until one bails | Yes |
```

Waterfall 的语义在下一节写得很具体：监听器收到 `(...args, next)`，调用 `next()` 才把结果交给下一个监听器；不调用就短路。AGENTS.md 把同一义务写成必须遵守的约定：waterfall 监听器必须调用 `next()`。第 8 章会在三个事件域里看到哪些名字是 emit，哪些是 waterfall 或 serial。

## 不变量

- 扩展 dsh 的方式是再挂一个插件。注册通过 `ctx.effect()` 或 `ctx.on()` 进入，卸载时按 disposer 收回。
- 服务用稳定的 `ctx.<key>` 查找。依赖用 `inject` 声明，列表顺序不代替依赖。
- 事件名用声明合并挂到 Cordis 的 `Events` 上，并且每个事件有一个 `@mode`。
- 函数插件、对象插件、`Service` 子类是三种合法形态。要对外提供 `ctx` 键时用类，构造函数把键名交给 `super`。

## 下一章

第 3 章看这些插件怎样在启动时被叠成一棵树：profile 点名 bundle，bundle 指向一份 `cordis.patch.yml`，空的入口列表上再盖用户补丁。
