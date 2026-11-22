---
order: 10
title: "第10章：system-prompt 与 agent.inject"
summary: "提示词按节注册、按作用域覆盖，再在 step 里组装。inject 把一条用户消息放进 next-step，并且不自己叫醒循环。"
status: published
words: 1134
codeLines: 28
minutes: 6
updated: "2026-11-22"
---

# 第10章：system-prompt 与 agent.inject

**一句话定义：系统提示词是分节注册表加上一次组装；`agent.inject()` 把额外用户消息放进下一次被承认的请求，而且要等一条会醒来的消息。**

[`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 的扩展表把工具 schema 和 inject 放在同一张机制表里。从「给模型一个能力」到「给模型一段上下文」是连续的几行：

```md
| Add a model-facing capability | register on `ctx.tools`; its schema joins prompt assembly |
| Give one session a different capability set | compose an agent preset; a service row there needs an `isolate` realm |
| Add shell execution | register a `ctx.shell` backend; the local one spawns through `ctx.subprocess` |
| Add persistent terminal execution | register a `ctx.terminals` backend plus `dsh-tool-terminal` |
| Add a human command | register on `ctx.commands`; it dispatches without a model turn |
| Manage background jobs | register on `ctx.jobs`; `job_*` tools read or stop jobs |
| Start a Session from an external webhook | register a trusted rule on `ctx.webhookRuntime` and mount a provider adapter |
| Add filesystem access or policy | register a `ctx.fs` provider or listen to `fs/*` events |
| Confine spawned processes | use a `ctx.sandbox` backend; consumers wrap argv before spawning |
| Intercept a request, tool, or turn | use its `agent/*` or `tools/*` event; `agent/turn-stopping` stops a turn |
| Add model-facing context | call `agent.inject()`; it lands in the next admitted request |
```

模型要看见的东西，要么成为提示词的一节或工具 schema，要么成为日志里的一条消息。第 8 章的「模型可见 ⟺ 已记录」在这里落地。

## 节是 effect

[`packages/core/system-prompt/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/system-prompt/src/index.ts) 的模块注释：注册表管理有序的系统节、动态上下文、工具 schema 和提示词变量。

`section()` 要求 order 是有限数，retirement 文本不能是空串，然后用 effect 把注册推进最近的一层：

```ts
  section(section: PromptSection): () => void {
    if (!Number.isFinite(section.order)) {
      throw new TypeError(`prompt section "${section.name}" order must be a finite number`)
    }
```

返回的 disposer 摘掉这一次注册。最近的作用域赢，同一作用域里后注册的赢。作用域变量遮蔽全局变量。事件 `system-prompt/assemble` 是展示用的 waterfall：返回的节文本决定更新；省略一个先前承认过的节，等于留下它的指令不动；空文本撤回指令。注释写明，监听器不能借这次瀑布给该作用域新增或替换那份已经注册好的完整节。工具声明仍由提供者拥有。

`assemble()` 的注释把顺序说清楚：先收集全局和作用域提供者，分离工具参数，做规范排序，再跑展示瀑布。节的文本和生命周期在这里固定；稍后 `systemUpdates()` 拿它们和已经提交的状态比较。

```ts
  async assemble(context: AssembleContext = {}): Promise<PromptAssembly> {
    const scope = context.scope
```

第 4 章的 `preStep` 在 claim 之后调用的就是 `this.loopCtx.systemPrompt.assemble(...)`，并且把本次 `modelSelection` 和已经 `resolve` 的 `toolSet` 放进上下文。step 里每次尝试还会 `refreshContext`，再把 `systemUpdates()` 写成 `system/message`。第一次尝试把 enter 决策里的用户消息写成 `user/message`。压缩摘要之后的第一次尝试会清掉保留的系统追加，并用捕获到的指令换掉最初的系统节点，仍然通过普通的 `system/message` 事件。

## inject 不叫醒

[`packages/core/agent-loop/src/agent.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src/agent.ts) 把三种写入分成唤醒与否：

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

`inject` 走 `send(..., 'next-step', false)`。消息进入持久 inbox（第 4 章的 `agent/inbox/spliced`），驱动不会因此从 idle 被踢起来。下一次 `followup`、`steer` 或循环自己继续的 step 在 `claim` 时把它和别的 `next-step` 消息一起取走。`preStep` 的默认 enter 决策还会在认领的消息后面附上当前 runtime context 投影；那份投影的类在 [`packages/core/agent-loop/src/runtime-context.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src/runtime-context.ts)。

因此「给模型塞一段背景」有两条正路。稳定的指令用 `systemPrompt.section()`，随卸载消失。一次性或会话中的事实用 `agent.inject()`，等下一次被承认的请求，并作为 `user/message` 进日志。两条路都是 effect 或日志，没有第三条隐藏通道。

## 和工具 schema 的交界

`ToolsService` 构造时调用 `ctx.systemPrompt.tools(...)`。组装看到的工具描述来自这次 step 选中的执行器和该作用域的定义。`restrict()` 收紧某个 agent 的全局工具后，下一次组装自然少掉那些 schema。提示词包不维护第二份工具名单。

## 不变量

- 系统节通过 `section()` 注册，返回 disposer。最近作用域优先，其后才是注册顺序。
- `assemble()` 固定节文本和生命周期。写进日志的系统更新由 `systemUpdates()` 和已提交状态比较得出。
- `agent.inject()` 追加到 `next-step` 且不唤醒。它进入下一次被承认的请求，并成为日志上的用户消息。
- `followup` 与 `steer` 会唤醒；只有需要模型现在就看到上下文时才用它们。
- 工具 schema 在组装时从 `ctx.tools` 加入，提示词瀑布不能改写这份提供者拥有的声明。

## 下一章

第 11 章看一个消费者怎样把工作交给别的执行体：子代理注册表、用 PTC 跑起来的 workflow，以及后台 jobs。
