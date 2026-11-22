---
order: 9
title: "第9章：能力接缝 —— Definition、Provider、Consumer"
summary: "一条接缝要同时有接口声明、实现和消费者。文件系统、子代理和模型工具都按这三种角色拆开，所以换一个提供者可以带动整片产品。"
status: published
words: 1007
codeLines: 12
minutes: 5
updated: "2026-11-22"
---

# 第9章：能力接缝 —— Definition、Provider、Consumer

**一句话定义：接缝是可替换的能力，由 Service Definition、Service Provider、Consumer 三种角色组成；只做一个角色还不是接缝。**

[`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 的 Capability seams：

```md
A **seam** is a swappable capability with three roles: a **Service Definition** declaring the interface, a **Service Provider** implementing it, and a **Consumer** using it, commonly a model-facing tool. A package may combine roles, but one role alone is not a seam; adding a capability means designing all three ([capability graph](capability-seams.md)).
```

[`AGENTS.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/AGENTS.md) 把同一句话写成贡献约定：接缝包含这三种角色，并且是完整的；只有当角色会独立演化时才拆包。生成图在 [`docs/capability-seams.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/capability-seams.md)，文件头写明它由 `scripts/gen-doc-graphs.ts` 生成。那张图回答「谁声明服务、谁实现、谁直接消费」，读包之前先在图上找到 `ctx` 键。

## 文件系统：抽象类就是 Definition

[`packages/fs/fs/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/fs/fs/src/index.ts) 的 `FileSystem` 把键名定成 `fs`：

```ts
export abstract class FileSystem extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }
```

类注释规定提供者必须遵守的事实：目标在别名之间保持身份；读暴露常规 UTF-8 文本或类型化错误；目录列表稳定且不含内容；单文件发布是原子的。默认 `watch` 直接拒绝，并说明这个提供者没有实现监听。本地盘、沙箱盘、SSH 盘各自成为 Provider，注册成 `ctx.fs`。`tool-fs` 是 Consumer：它面对模型，真正的读写交给当前 context 里的那个 `FileSystem`。

架构文档接着解释为什么一个提供者能带动一片：文件系统和子进程提供者共享同一个执行世界，把它们指向远程沙箱时，Bash、PTY 和 LSP 一起走，不必为每个工具分叉一个提供者。

## 子代理：注册表也是 Definition

[`packages/subagent/subagent/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/subagent/subagent/src/index.ts)：

```ts
/** Named provider registry with managed activations, durable discovery, and local child messaging. */
export class SubagentRuntime extends TypertRemoteService {
  static Config = z.object({
    maxDepth: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(1).volatile(),
    maxActiveSubagents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8).volatile(),
  })
  static inject = ['workingDirectory', 'sessionProjections']
```

构造函数 `super(ctx, 'subagents')`。默认深度 1，同时活着的可继续子代理默认 8。`packages/subagent/` 里的提供者包括进程内 fork、进程内 spawn、ACP、Claude Code、Codex、dsh SDK。模型面对的工具在 `tool-subagent` 与 `tool-subagent-control`。消费者依赖 `ctx.subagents` 这张注册表，不依赖某一个子进程实现。

架构文档用一句话概括变化幅度：子代理提供者可以是一个全新的子 agent，也可以是把一轮委托到另一个产品里，接口仍是这一张。Agent Teams 在启用时为根 Session 加上任务策略和共享任务板；身份、消息、发现、打断和 inbox 等待仍属于普通子代理控制。Teams 专章以后再写。

## 第 6、7 章已经是同一形状

`packages/llm/llm` 声明 `ctx.llm`，`llm-deepseek` 与 `llm-pi-ai` 是 Provider，agent loop 是 Consumer。`packages/core/tools` 声明 `ctx.tools`，各工具包 `register` 进来，执行器插件负责批次。`packages/web/web` 声明 `ctx.web`，`tool-web` 把 `web_search` 和 `web_fetch` 暴露给模型。看到一个新目录时，先问它是声明、实现，还是消费，再决定该改哪一个包。

[`packages/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/README.md) 的 Dependencies 节写明扩展插件依赖 Service Definition，不依赖具体 Provider。`dsh-agent-loop` 可以换掉；UI、hook 和工具插件使用 `dsh-agent`。

## 不变量

- 新增一种能力时，三种角色一起设计。一个包可以兼任，但单独一个角色不构成接缝。
- Definition 用 `super(ctx, key)` 占用 `ctx` 键。Provider 实现这个类或向注册表登记。Consumer 只通过键调用。
- 共享执行世界的提供者要一起换。文件系统与子进程指向远程沙箱时，Bash、PTY、LSP 跟随。
- 子代理的差异留在 `ctx.subagents` 的提供者后面。默认 `maxDepth` 是 1，`maxActiveSubagents` 是 8。

## 下一章

第 10 章看消费者怎样把事实送进下一次模型请求：要么注册 system prompt 的一节，要么 `agent.inject()`，两者最后都要落进会话日志。
