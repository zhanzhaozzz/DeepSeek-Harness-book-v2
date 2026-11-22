---
order: 1
title: "第1章：开篇 —— 钉住的仓库地图"
summary: "DeepSeek Harness 在 dsh-v0.2.3-alpha.2 上是什么：开发者预览、55 个分组、核心 ctx 键，以及这一钉怎么跑起来。"
status: published
words: 1010
codeLines: 43
minutes: 5
updated: "2026-11-22"
---

# 第1章：开篇 —— 钉住的仓库地图

**一句话定义：DeepSeek Harness（`dsh`）是 DeepSeek 开源的 Agent Harness，一切皆插件，由 Cordis 驱动；本书只读标签 `dsh-v0.2.3-alpha.2`。**

摘录逐字来自 [deepseek-ai/deepseek-harness@4b399c39](https://github.com/deepseek-ai/deepseek-harness/tree/4b399c39a6d1479cd84ca591b4d7c88e24d38a96)，MIT License，Copyright (c) 2026 DeepSeek。链接指向该 SHA 的 blob。

## 这一钉

根 [`package.json`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/package.json) 同时给出包名、版本、许可证、包管理器和 Node 引擎：

```json
{
  "name": "@deepseek-ai/dsh-root",
  "version": "0.2.3-alpha.2",
  "license": "MIT",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.28.5",
  "engines": {
    "node": "^24.22.3 || >=26.13.1"
  },
```

官方 [`README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/README.md) 把阶段说死在 Developer preview 一节：

```md
## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**
```

[`AGENTS.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/AGENTS.md) 对公共 API 的说法与「稳定产品 API」无关：

```md
## Pre-stable APIs and released Session data

Public APIs are pre-stable; update every consumer.
```

[`packages/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/README.md) 的 Release expectations 把同一句话写进分组约定：

```md
Product groups have maintained product roles, while their public APIs remain pre-stable.
```

所以读代码时默认：行为以这一钉的源码和 `docs/` 为准，下一颗标签可以改接口。升级时走官方 [`docs/upgrade-guide/`](https://github.com/deepseek-ai/deepseek-harness/tree/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/upgrade-guide)，而不是把旧笔记里的行号继续当成事实。

| 事实 | 本钉 |
|---|---|
| 根包 | `@deepseek-ai/dsh-root@0.2.3-alpha.2` |
| Node | `^24.22.3 \|\| >=26.13.1` |
| 包管理器 | `pnpm@11.28.5` |
| 许可证 | MIT，Copyright (c) 2026 DeepSeek |
| 阶段 | developer preview，公共 API pre-stable |
| `packages/` 分组目录 | 55 个 |

旧笔记写于官方提交 `3a46bd67985136d0ba90dd9225f5ce65140cf71c` 一带，包版本 `0.1.0-rc.6`。那份档案留在 [旧书站点](https://deep-seek-harness-book.vercel.app/)。本钉的分组表已经换过一批名字：目录里能看到 `telemetry`、`ssh`、`ptc-runtime`、`computer-use`、`browser-use`、`deliverables`、`connector`、`team`、`experimental`、`document`、`mcp`、`account`。`e2b`、`examples`、`hooks`、`code-runtime` 这些分组目录在本钉不存在。

## 方位图与分组表

[`AGENTS.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/AGENTS.md) 的 Repository layout 是较短的方位图。下面是它的原文开头，后面还有一长串分组名，直到 `website/`：

```text
vendor/      Vendored Cordis (vendor/README.md)
packages/    @deepseek-ai/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  core/                 agent/session API
  api/                  remote BFF
  typert/               type graphs
  llm/                  model providers
  shell/                command execution
  subprocess/           child-process management
  ssh/                  SSH execution providers
  terminal/             persistent terminals
  ptc-runtime/          PTC execution
```

这张图帮助你进门，它没有逐行列出全部分组。权威清单是 [`packages/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/README.md) 的 Package groups 表，和 `packages/` 下 55 个分组目录一致。表的开头是：

```md
| Group | Role |
|---|---|
| [`core/`](core/README.md) | Product API spine: sessions, prompts, tools, agent services, and the concrete loop |
| [`api/`](api/README.md) | Remote BFF assembly and Typert RPC gateway |
| [`typert/`](typert/README.md) | Type graph generation, artifact loading, and runtime registry |
```

同一张表在靠后的位置把本钉新增或改名的家族放进地图，例如 `telemetry/`（共享 Cordis OTel 通道）、`ptc-runtime/`（PTC 执行）、`computer-use/`、`browser-use/`、`document/`、`mcp/`、`team/`、`account/`。读到第 11 章时，workflow 那一行已经是「PTC process engine」，对应目录是 `packages/workflow/workflow-ptc/`。

包名规则在同一文件的 Summary 里：每个包的 scope 都是 `@deepseek-ai/dsh-*`，并且只属于一个分组。

## 核心包与 ctx 键

[`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 的 Core packages 表是后面各章的索引：

```md
| Package | Owns | `ctx` key |
|---|---|---|
| [`core/session`](subsystems/session.md) | The append-only `SessionEvent` log and in-memory store | `ctx.sessions` |
| [`core/system-prompt`](subsystems/system-prompt.md) | Prompt-section and tool-schema assembly | `ctx.systemPrompt` |
| [`core/tools`](subsystems/tools.md) | The scoped tool registry and guarded execution pipeline | `ctx.tools` |
| [`core/agent`](subsystems/core.md) | The `Agent` interface, live registry, and `agent/*` events | `ctx.agents` |
| [`core/agent-loop`](subsystems/core.md) | The default driver implementing that interface | `ctx.agentLoop` |
| [`core/scope`](subsystems/scope.md) | The per-agent scoped-registration primitive | library, no key |
| [`llm/llm`](subsystems/llm-streaming.md) | Message and stream vocabulary plus the adapter seam | `ctx.llm` |
```

`core/scope` 没有 `ctx` 键，它是库。`core/agent-loop` 是接口的默认驱动，接口本身在 `core/agent`。替换循环时改的是实现插件，服务键仍是调用方已经注入的那些名字。

## 怎么跑起来

官方 README 的 npm 入口仍是一条命令，默认 Web UI 在 `http://127.0.0.1:3080`：

```sh
npx @deepseek-ai/dsh web
```

从源码跑时，README 写的是 `pnpm install`、`pnpm run build`、`pnpm dsh web`。Node 必须满足上面的 engines。随安装启动的 profile 在架构文档里写明是 `web`、`headless`、`sdk`、`sdk-minimal`、`acp`。Desktop 的壳、Host 和发布器在第 13 章。Python SDK 的显式 Harness home 与 `sdk` / `sdk-minimal` 在第 14 章。

## 不变量

- 本书的事实边界是 SHA `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`。默认分支 `master` 会继续走，笔记里的 blob 不跟着走。
- 没有特权核心。架构文档的原话是：模型适配器、工具注册表、会话日志和 agent loop 本身都是插件。
- 分组数以 `packages/` 目录和 `packages/README.md` 的表为准，本钉是 55。`AGENTS.md` 的 layout 是方位图。
- 公共 API 保持 pre-stable。Session 数据另有发布格式义务，第 12 章写 Session V4 的持久化，第 17 章写相邻迁移。

## 下一章

第 2 章看 Cordis 怎样把「插件」做成可逆注册：`apply(ctx)`、`inject`，以及 effect 在卸载时怎样收回。
