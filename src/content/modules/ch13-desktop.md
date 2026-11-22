---
order: 13
title: "第13章：Desktop —— Electron 壳与 desktop profile"
summary: "Desktop 是包住完整 Web 应用的 Electron 壳。Host 以保留 profile 名 desktop 启动，端口由系统分配；发布器只负责已打好的包。"
status: published
words: 819
codeLines: 12
minutes: 4
updated: "2026-11-22"
---

# 第13章：Desktop —— Electron 壳与 desktop profile

**一句话定义：Desktop 用 Electron 包住完整的 dsh Web 应用，并由一个 RunAsNode 子进程以保留 profile `desktop` 启动同一套插件树。**

摘录逐字来自 [deepseek-ai/deepseek-harness@4b399c39](https://github.com/deepseek-ai/deepseek-harness/tree/4b399c39a6d1479cd84ca591b4d7c88e24d38a96)，MIT License，Copyright (c) 2026 DeepSeek。

[`apps/desktop/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/apps/desktop/README.md) 把壳和 Host 的分工写成一段：

```md
The desktop application is an Electron shell around the complete dsh Web application. An Electron RunAsNode child starts the shared profile runner, and Electron immediately loads the packaged Web entry at `dsh-app://app/`.
```

窗口不等待浏览器那种 Token URL 换 Cookie。主进程为这次 Host 生成一次性凭据，经私有 IPC 送进去，再把它加到自己发出的 HTTP 和 WebSocket 上。渲染进程拿到的是启动注入，不是这枚凭据。

## 和 web、headless 的差别

`npx @deepseek-ai/dsh web` 把 Web UI 开在 `http://127.0.0.1:3080`。Desktop 故意避开这个端口。同一篇 README 写：

```md
Desktop listens on an OS-assigned port by default, so it cannot collide with Web’s `3080` or a reserved port; a `webserver.config.port` patch can override it.
```

[`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 里，`dsh-headless` 是没有服务器的一次性运行器，`dsh-web-app` 才是浏览器应用。Desktop 复用的是后者，再加一层 Electron：

```md
[`dsh-web-app`](../packages/bundle/web-app/README.md) adds the browser application, [`dsh-headless`](../packages/bundle/headless/README.md) adds a one-shot runner with no server
```

架构文档还规定 Desktop 拥有保留目录 `$DSH_HOME/profiles/desktop`。它和 npm CLI 共享产品数据，包、激活和 lockfile 分开。第 3 章的 profile 模板表里没有名为 `desktop` 的 `PROFILE_TEMPLATES` 项；这个名字由应用自己初始化，不从 `dsh web` 那五个随安装模板里挑。

## Host 怎样把 profile 跑起来

[`apps/desktop-host/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/apps/desktop-host/src/index.ts) 的文件头是：`Launch the Desktop profile through the Web application and report its URL to Electron.` 凭据到手之后，Host 加载已经初始化好的 profile 目录，再用共享的 `runProfile`：

```ts
  const profile = loadProfileDirectory('dsh', projectDir, installAnchor)
  reportSkippedBundles('dsh', profile)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolvedProfile: { profile, installAnchor },
    patchFiles: [],
    args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
```

`--no-open` 不让 CLI 再开系统浏览器。`--port 0` 交给操作系统分配端口。就绪之后，Host 用 `ctx.webServer` 的协议和端口拼出 URL，带上启动注入，经 IPC 发出 `ready`。Electron 立刻加载打包好的 `dsh-app://app/`，加载页等到这些注入，再在同一文档里启动客户端插件。Web 仍拥有 RPC 和流。

父进程断开、收到 `shutdown`，或认证通道中止时，Host 调用应用的 `shutdown`。启动失败的诊断走 `fatal` IPC，不和 stderr 抢第一份报告。

## 发布器不参与启动

[`apps/desktop-publisher/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/apps/desktop-publisher/README.md) 的职责停在已保留的安装包上：

```md
Publish retained Desktop packages, change an existing release's rollout percentage, and refresh website installers. The manual GitHub workflows select the original packaging machine and require the configured environment approvals. This private workspace shares the repository lockfile and runs TypeScript source directly with Node 24 and tsx.
```

构建和签名留在 `apps/desktop`。发布代码不 import Desktop 的实现。读启动路径时可以把它当成发行侧的邻居，而不是第四种 profile 运行器。

## 不变量

- Desktop 是 Electron 壳加完整 Web 应用。子进程以 `ELECTRON_RUN_AS_NODE` 跑共享 profile 启动器。
- 保留 profile 名是 `desktop`，目录是 `$DSH_HOME/profiles/desktop`。它不在 `PROFILE_TEMPLATES` 的 web / headless / sdk / sdk-minimal / acp 之中。
- 默认监听系统分配的端口，避免和 Web 的 `3080` 相撞。`--port 0` 写在 Host 的 `runProfile` 参数里。
- 凭据留在主进程。渲染进程收到启动注入。Web 拥有 RPC 与流。
- `apps/desktop-publisher` 发布已打好的包和调整放量，不启动 profile。

## 下一章

第 14 章看另一条进程外入口：Python SDK 不发现 `~/.dsh`，默认把捆绑的 `dsh` 以 `--profile sdk` 拉起来，最小示例改选 `sdk-minimal`。
