---
order: 8
title: "第8章：三个事件域"
summary: "会话事件、agent 事件、能力事件各管一类扩展。模式写在声明上，瀑布必须调用 next() 才会继续委托。"
status: published
words: 1065
codeLines: 9
minutes: 5
updated: "2026-11-22"
---

# 第8章：三个事件域

**一句话定义：扩展点分三个域——要活过重载的会话事实、飞行中的 agent 事件、以及不 import 循环就能挂上策略的能力事件。**

[`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 的 Events 节：

```md
Events provide extension points in three domains.

- **Session events** are durable facts appended to the log and broadcast through `session/event`. Use one when the fact must survive a reload.
- **Agent events** (`agent/*`) carry a live `Agent`: inbox, step, status, request, validation, continuation. Use one to observe or intercept work in flight.
- **Capability events** attach policy and adapters to a seam (`fs/*`, `tools/*`, `telemetry/*`) without importing the loop.
```

同一节补充：子代理的 Activation 拥有运行时树上的成员身份。AgentLoop 会回滚失败的初始化，并在排队的工作之前等待串行的 `agent/created`。关闭时，即使队列清理失败，也会取消并等待进行中的工作，然后才释放资源。

## 域决定事件落在哪里

会话域的代表是第 5 章的 `turn/start`、`user/message`、`tool/result`。它们先进日志，再经 `session/event` 广播。重载之后仍然在。

Agent 域的名字挂在活的 `Agent` 上。第 4 章已经走过 `agent/pre-step`、`agent/assistant-stream`、`agent/turn-stopping`、`agent/status`。这些事件携带这次飞行：inbox、step、状态、请求。它们的生产者在 [`docs/event-producer-consumer.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/event-producer-consumer.md) 的矩阵里大多记在 `agent-loop` 名下。矩阵开头说明：事件是多对多，所以用表而不是一张大图；表也覆盖有意绕过 `ctx.emit` 的内部派发。

能力域不把循环 import 进工具或文件系统。`tools/pre-execute` 声明在 `packages/core/tools`，`fs/write-intent` 一类声明在文件系统接缝上。监听器给接缝加审批、沙箱或观测，提供者实现读写真的字节。

## 模式是契约的一部分

第 2 章的五张模式表在这里变成阅读方法。矩阵的 Mode 列直接来自声明上的 `@mode`。抽几行本钉矩阵里的原文：

```md
| `agent/assistant-stream` | `emit` | [`packages/core/agent/src/runtime-types.ts:400`](../packages/core/agent/src/runtime-types.ts) | [`agent-loop`](../packages/core/agent-loop) (`emit`) | [`headless`](../packages/bundle/headless), `session-controller` |
```

```md
| `agent/pre-step` | `waterfall` | [`packages/core/agent/src/runtime-types.ts:351`](../packages/core/agent/src/runtime-types.ts) | [`agent-loop`](../packages/core/agent-loop) (`waterfall`) | [`action-cards`](../packages/interaction/action-cards), [`agent`](../packages/core/agent), [`agent-instructions`](../packages/context/agent-instructions), `claude-code-mods`, `client-ui-forge`, [`compaction-basic`](../packages/compaction/compaction-basic), [`cua`](../packages/experimental/cua), [`cua-macos`](../packages/experimental/cua-macos), [`goal-round-driver`](../packages/goal/goal-round-driver), [`hooks-claude-code`](../packages/experimental/hooks-claude-code), [`hooks-codex`](../packages/experimental/hooks-codex), `liveshare`, [`plan-mode`](../packages/plan/plan-mode), [`repeat-tool-reminder`](../packages/guard/repeat-tool-reminder), [`session-checkpoint-policy`](../packages/session/session-checkpoint-policy), `session-controller`, [`session-reference`](../packages/context/session-reference), [`subagent`](../packages/subagent/subagent), [`time-context`](../packages/context/time-context), [`tmux-context`](../packages/context/tmux-context), [`tool-skill`](../packages/skill/tool-skill) |
```

```md
| `agent/turn-stopping` | `serial` | [`packages/core/agent/src/runtime-types.ts:418`](../packages/core/agent/src/runtime-types.ts) | [`agent-loop`](../packages/core/agent-loop) (`serial`) | [`hooks-claude-code`](../packages/experimental/hooks-claude-code), [`hooks-codex`](../packages/experimental/hooks-codex), [`workspace-changes`](../packages/deliverables/workspace-changes) |
```

`agent/assistant-stream` 是 emit：监听者观察，没有返回值，循环不等待它们。`agent/pre-step` 是 waterfall：压缩、计划模式、时间上下文、子代理都可以改写或拒绝即将进入的消息，但必须按第 2 章的规则调用 `next()`，否则链条停在自己这里。`agent/turn-stopping` 是 serial：按注册顺序等待，声明里没有 `next()`。架构文档特意写了这一点。

[`AGENTS.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/AGENTS.md) 把 waterfall 的义务单独列成约定：

```md
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
```

同一文件还写：**Model-visible ⟺ logged**。任何进入模型请求的东西都必须能从会话日志重建。所以「只发一个 agent 事件」不够把新事实送给模型；要模型看见，就写 session 事件。

## 读矩阵的方法

矩阵每一行是：事件名、模式、声明文件、派发者、监听者。声明文件的行号会随标签移动，本书引用时同时给出路径，阅读时以你检出的这一钉为准。监听者列里的包名就是「谁已经在用这个扩展点」。给新策略找家时，先在矩阵里找同模式的邻居，再决定是听 `agent/pre-step`、听 `tools/pre-execute`，还是追加一种 session 事件。

Desktop Host 订阅 `plugin-manager/operation` 的说明写在矩阵导语里，那是应用监听者，不进这张包矩阵。它提醒你：三个域是 harness 包之间的词汇，壳层还可以在旁边听管理事件。

## 不变量

- 活过重载的事实是 session 事件，经 `session/event` 广播。
- 飞行中的观察和拦截用 `agent/*`。其中 waterfall 必须调用 `next()` 才继续委托，serial 的 `agent/turn-stopping` 没有 `next()`。
- 能力事件（`fs/*`、`tools/*`、`telemetry/*` 等）把策略挂到接缝上，监听器不需要 import 循环。
- 模型可见与已记录是同一件事。新的模型输入对应新的 session 事件。
- 生产者/消费者以 [`docs/event-producer-consumer.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/event-producer-consumer.md) 的生成表为准，事件是多对多。

## 下一章

第 9 章把「能力事件后面的那组包」拆成三种角色：Service Definition 声明接口，Service Provider 实现它，Consumer 使用它。一个角色单独存在还不构成接缝。
