---
order: 3
title: "第3章：Profile、Bundle 与启动"
summary: "web、headless、sdk、sdk-minimal、acp 怎样从有序 bundle 叠出来；Plugin Manager 管当前 profile；Desktop 复用同一条启动路径。"
status: published
words: 1242
codeLines: 55
minutes: 6
updated: "2026-11-22"
---

# 第3章：Profile、Bundle 与启动

**一句话定义：一次运行中的 dsh 是启动时按层叠出来的插件树；profile 点名要叠哪些 bundle，bundle 用补丁文件把行插进这棵树。**

[`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 的 Profiles and bundles 开头：

```md
A running `dsh` is a plugin tree composed at boot from ordered layers.

A **profile** is a named composition stored in the Harness home. It lists the bundles it stacks, holds any out-of-tree plugins it installs, and keeps the user's own `cordis.patch.yml`. `web`, `headless`, `sdk`, `sdk-minimal`, and `acp` ship as templates.

A **bundle** is a distribution format for Cordis config rows and the code they mount, so whatever it inserts stays patchable by the layers above it.
```

旧笔记几乎只讲 web 与 headless，而且把 bundle 声明写成了 base 目录下的 package.js。本钉的声明在 [`packages/bundle/base/package.json`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/bundle/base/package.json)。

## 五个随安装的模板

模板常量在 [`packages/util/official-bundles/src/bundles.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/util/official-bundles/src/bundles.ts)：

```ts
export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = {
  acp: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'],
  },
  web: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
  },
  headless: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
  },
  sdk: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'],
  },
  'sdk-minimal': {
    bundles: ['@deepseek-ai/dsh-sdk-minimal'],
  },
}
```

架构文档把分工写清楚：`dsh-base` 是 web、headless、sdk、acp 的第一层，里面有模型适配器、工具、持久化、沙箱与审批、设置、凭据和遥测。`dsh-web-app` 加上浏览器应用，`dsh-headless` 加上没有服务器的一次性运行器，`dsh-sdk-app` 加上 SDK 的 JSON-RPC 服务器，`dsh-acp-app` 加上只供自动化使用的 ACP 服务器。`dsh-sdk-minimal` 是有意的例外：一个 bundle 拥有完整的显式 SDK 树，不套 `dsh-base`。

同一文件还保留一条安装自有的旧元组，用来把早先写进 headless profile 的三层列表归一：

```ts
export const INSTALLATION_OWNED_PROFILE_TUPLES: Readonly<Record<string, readonly string[]>> = {
  headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless'],
}
```

`dsh plugin` 给一个没有模板的名字初始化时，用的是 `DEFAULT_PROFILE_BUNDLES`，内容只有 `@deepseek-ai/dsh-base`。

## Bundle 怎样声明自己

`dsh-base` 的 `package.json` 用 `dsh.bundle.patch` 指向补丁，而不是指向一个 `package.js`：

```json
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
```

[`packages/bundle/web-app/package.json`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/bundle/web-app/package.json) 的同一字段是有序列表，标准、PTC、minimal 和 cordis 预设各占一份补丁：

```json
  "dsh": {
    "bundle": {
      "patch": [
        "./cordis.patch.yml",
        "./presets/standard.patch.yml",
        "./presets/ptc.patch.yml",
        "./presets/minimal.patch.yml",
        "./presets/cordis.patch.yml"
      ]
    }
  },
```

层的施加顺序写在架构文档里：从空的入口列表开始，先是 profile 里按顺序排列的 bundle，然后是它自己的 `cordis.patch.yml`，再是 home 级补丁，最后是命令行 `--patch`。补丁按 id 命中一行时替换整份 config，也可以插入新行。要看自己机器上的树：

```sh
dsh --profile web --dump-config
```

YAML 也决定 HMR：base 打开仅配置的 `dsh-hmr`；headless、SDK 和 ACP 关掉它；`sdk-minimal` 不包含它。Profile 补丁可以覆盖这些默认。

## 谁可以启动应用

Application launch 一节规定：受支持的 Node 应用通过具名 `dsh` profile 启动，用 `dsh --profile <name>` 或 `dsh <name>`。`plugin` 是管理命令的名字；如果真有一个叫 plugin 的 profile，必须写 `--profile plugin`。TypeScript SDK 解析同版本的 `dsh` 依赖并选择 `sdk`。自定义插件组合仍然是「一个 profile 加上有序补丁文件」。

同一节写明 Python SDK 跟随这套应用架构：运行时 wheel 把普通 `dsh` CLI 打成平台包，客户端默认以显式 Harness home 启动 `dsh --profile sdk`，最小示例选择 `sdk-minimal`。Python 暴露的是 profile 选择和有序补丁，持久的外部插件通过 `dsh plugin` 安装。第 14 章展开客户端怎样把这些参数交给子进程。这里先固定：它没有另一套私有启动器。

## Plugin Manager

架构文档写：base 带有 Plugin Manager，给 Web 和 agent 使用。类在 [`packages/boot/plugin-manager/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/boot/plugin-manager/src/index.ts)：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistent management of the current profile's composition and packages. */
    pluginManager: PluginManager
  }
}

/** Manage profile files and apply their declared reload lifecycle. */
export class PluginManager extends TypertRemoteService {
  static inject = ['loader', 'profileContext']
```

构造函数把服务键设为 `pluginManager`：

```ts
  constructor(ctx: Context, config: Config) {
    super(ctx, 'pluginManager')
```

它管的是当前 profile 的组合与包：安装、启用、版本兼容豁免。启动器本身仍由 [`packages/boot/app-boot/src/profile.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/boot/app-boot/src/profile.ts) 读取 `dsh.profile.bundles` 并解析补丁层。app-boot 的 README 写明：产品应用使用 `dsh` 启动器，而不是再发布单独的 bin。

## Desktop 只占地图上的一格

[`docs/architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/architecture.md) 的 Desktop application 节：

```md
The [Electron desktop application](../apps/desktop/README.md) ships its exact dsh production runtime in signed resources and owns the reserved `$DSH_HOME/profiles/desktop`. Shared helpers initialize profile files, reconcile bundles, and resolve installation and bundle dependencies without replacing pnpm-owned packages. Desktop and npm CLI share product data but keep packages, activation, and lockfiles separate.
```

Electron 启动私有 Desktop Host（[`apps/desktop-host/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/apps/desktop-host/src/index.ts)），Host 再调用共享的 CLI profile 运行器。发布相关代码在 [`apps/desktop-publisher/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/apps/desktop-publisher/README.md)。窗口加载打包好的 Web 资源，RPC 与流仍由 Web 拥有。第 13 章展开这条启动路径。这里先记住：它占有保留 profile 名 `desktop`，并且仍然走 profile。

## 不变量

- 随安装的 profile 模板是 `web`、`headless`、`sdk`、`sdk-minimal`、`acp`。前四个里，除 `sdk-minimal` 外都先叠 `@deepseek-ai/dsh-base`。
- Bundle 用 `package.json` 的 `dsh.bundle.patch` 指向一个补丁文件或一个有序列表。
- 层从空入口列表叠上去，上面的补丁可以整行替换下面的 config。
- 受支持的 Node 应用入口是 `dsh` profile。Plugin Manager 是 `ctx.pluginManager`，负责当前 profile 的组合与包。
- Desktop 拥有 `$DSH_HOME/profiles/desktop`，与 npm CLI 共享产品数据，包、激活和 lockfile 分开。

## 下一章

第 4 章进入这棵树里的默认驱动：一个 turn 在认领输入之前打开，一个 step 是一次模型请求加上它调用的工具。
