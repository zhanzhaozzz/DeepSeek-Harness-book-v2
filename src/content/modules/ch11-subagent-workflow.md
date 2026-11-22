---
order: 11
title: "第11章：子代理、workflow 与 jobs"
summary: "子代理是 ctx.subagents 上的命名提供者。workflow 的定义在 ctx.workflowEngine，本钉的执行提供者跑在 PTC 上。jobs 是另一条后台契约。"
status: published
words: 1285
codeLines: 33
minutes: 6
updated: "2026-11-22"
---

# 第11章：子代理、workflow 与 jobs

**一句话定义：子代理、workflow 和 jobs 是三条接缝——委托给别的 agent、在沙箱里跑一段编排脚本、以及登记一个后台任务。**

旧笔记里的 workflow-worker-thread 目录在本钉不存在。workflow 分组现在是 [`packages/workflow/workflow/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/workflow/workflow/src/index.ts)（Service Definition）、[`packages/workflow/workflow-ptc/src/host.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/workflow/workflow-ptc/src/host.ts)（PTC 提供者）和 [`packages/workflow/tool-workflow/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/workflow/tool-workflow/src/index.ts)（模型工具）。执行能力的家在 [`packages/ptc-runtime/ptc-runtime/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/ptc-runtime/ptc-runtime/src/index.ts)，它接替的是已不存在的 code-runtime 分组。

## 子代理运行时

第 9 章已经看见 [`packages/subagent/subagent/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/subagent/subagent/src/index.ts) 的 `SubagentRuntime`：服务键 `subagents`，注入 `workingDirectory` 和 `sessionProjections`，默认深度 1、同时继续的子代理 8。初始化时它注册目录投影和计时投影。提供者可以是进程内的 fork 或 spawn，也可以是 ACP、Claude Code、Codex 或 dsh SDK。Activation 是运行时树上的成员，生命周期事件被包住，避免一个监听器的失败拆掉整棵树。

模型侧的委托工具消费这张注册表。父会话用日志记录委托事实；子会话有自己的 header，`origin` 可以是 `"subagent"`，`parentSession` 指向直接创建者。普通 fork 可以不写 `parentSession`。是否为子代理看 `origin`，不能只看这个字段在不在。

## Workflow 的定义与 PTC 运行

[`packages/workflow/workflow/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/workflow/workflow/src/index.ts) 把服务键定成 `workflowEngine`。文件头：

```ts
/**
 * Service Definition for the workflow capability seam. Service Providers execute orchestration scripts;
 * observe-only lifecycle events never expose run control.
 * @module @deepseek-ai/dsh-workflow
 */
```

类声明紧挨着的注释是：

```ts
/**
 * Workflow Service Definition contract. Invalid requests throw before publication; a live
 * run is holder-owned, its result never rejects, and disposal waits for script
 * and child cleanup. Lifecycle
 * listener failures are contained, and `workflow/end` fires exactly once as the
 * result settles.
 */
export abstract class WorkflowEngine extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workflowEngine')
  }
```

`start()` 是抽象的：解析并执行脚本，返回活的 run，其 `result` 在脚本结束时 resolve。非法请求在发布之前抛出。生命周期监听器的失败被接住并记日志，`workflow/end` 在结果结算时恰好发出一次。同一文件声明的观察事件还有 `workflow/start`、`workflow/phase`、`workflow/log`、`workflow/agent-start`、`workflow/agent-end`，模式都是 emit。它们给观察者看进度，不把运行控制交出去。

本钉的提供者在 [`packages/workflow/workflow-ptc/src/host.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/workflow/workflow-ptc/src/host.ts)。文件第一行：

```ts
/** Workflow child ownership and progress over the shared sandboxed PTC executor. */
```

类前面的注释：

```ts
/**
 * Holder-owned workflow. Cancellation stops the program immediately; settlement waits for
 * its managed process and every admitted child startup/disposal. Engine unload does not
 * invalidate the captured runtime or subagent handles.
 */
export class PtcWorkflowRun implements WorkflowRun {
```

取消会立刻停下程序；结算要等它管理的进程以及每个已经接纳的子启动和释放。引擎卸载不会使它捕获的 runtime 或 subagent 句柄失效。客人脚本通过 `PtcRuntime` 的绑定调用宿主，子 `agent()` 走 `SubagentRuntime`。

## PTC 运行时本身

[`packages/ptc-runtime/ptc-runtime/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/ptc-runtime/ptc-runtime/src/index.ts) 是执行接缝的 Definition。模块注释写明：运行时不知道工具和会话，那些是消费者的事。

```ts
export abstract class PtcRuntime extends Service {
```

它登记 `ctx.ptcRuntime`。程序、预算、中止和底座失败放进 `PtcRunResult`；只有违反 Service Definition 契约才以 `PtcRuntimeError` 拒绝。实现把程序当成不可信的对等方，隔离不同的状态所有者，并在卸载时终止并等待进行中的运行。随附的 Node 提供者在 [`packages/ptc-runtime/ptc-runtime-node/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/ptc-runtime/ptc-runtime-node/src/index.ts)：

```ts
/** Node execution under file policy, with optional owner-scoped retained memory. */
export class NodePtcRuntime extends PtcRuntime {
  static inject = ['fs', 'subprocess', 'sandbox', 'sandboxPolicy']
  static Config = NodeConfig
  readonly language = 'typescript'
  readonly isolation = 'process'
```

语言标识是 `'typescript'`，隔离是进程。它注入的是文件系统、子进程和沙箱，也就是第 9 章说的那一个执行世界。工具侧的 PTC 执行器 `packages/core/tool-executor-ptc/` 是消费者：它把 `run_code` 和子调用送进第 7 章的管线。workflow-ptc 是另一个消费者，编排脚本而不是单次工具展示。

## Jobs

[`packages/jobs/jobs/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/jobs/jobs/src/index.ts) 声明另一条接缝，键是 `ctx.jobs`：

```ts
/**
 * The background-job Service Definition (`ctx.jobs`). It owns the contract for
 * job ids, session-scoped access, lifecycle state, the per-job output ring —
```

进程内注册表在 `@deepseek-ai/dsh-jobs-local`。模型通过 `packages/jobs/tool-jobs/` 读取或停止任务。架构文档的扩展表写：管理后台任务就注册到 `ctx.jobs`。job 的输出环是一条有界流，模型和任意观察者按各自的游标读，生产者自己保留执行资源。它和 workflow 的差别在于：workflow 跑一段会调用 `agent()` 的脚本；job 是会话范围内的后台句柄。

## 不变量

- 子代理差异在 `ctx.subagents` 的提供者后面。谱系看 header 的 `origin`，父 id 是 `parentSession`。
- `ctx.workflowEngine` 只声明启动和观察事件。本钉的脚本执行在 `workflow-ptc`，底下是 `ctx.ptcRuntime`。
- `NodePtcRuntime` 的语言是 `typescript`，隔离是 `process`，依赖 `fs`、`subprocess`、`sandbox`、`sandboxPolicy`。
- `run_code` 这个工具名保留给 PTC 展示传输。workflow 与工具执行器都是 PTC 的消费者。
- `ctx.jobs` 拥有后台任务的 id、会话范围和输出环。本地注册表是单独的提供者包。

## 下一章

第 12 章回到日志离开进程之后的样子：Session V4、相邻迁移、写入句柄、压缩和遥测。
