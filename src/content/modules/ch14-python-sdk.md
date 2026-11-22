---
order: 14
title: "第14章：Python SDK —— 显式 home 与 sdk profile"
summary: "Python 通过 stdio 上的 JSON-RPC 驱动捆绑的 dsh。每次启动都要显式 Harness home；默认 profile 是 sdk，最小示例选择 sdk-minimal。"
status: published
words: 939
codeLines: 33
minutes: 5
updated: "2026-11-22"
---

# 第14章：Python SDK —— 显式 home 与 sdk profile

**一句话定义：Python SDK 启动同版本的捆绑 `dsh` 子进程，用换行分隔的 JSON-RPC 对话；默认 profile 是 `sdk`，并且拒绝悄悄使用 `~/.dsh`。**

[`python/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/python/README.md) 把两个包和这条契约放在一起：

```md
The SDK starts the matching bundled `dsh --profile sdk` runtime unless the caller selects another `dsh` executable or profile. The runnable minimal example selects the shipped standalone `sdk-minimal` profile; the same runtime also packages `dsh web` and its frontend assets for separate CLI use. Every launch requires an explicitly selected Harness home; Python never silently reads `~/.dsh`.
```

`python/sdk` 发布为 `deepseek-harness-sdk`，模块名 `deepseek_harness`。`python/sdk-runtime` 发布为 `deepseek-harness-runtime-bin`，里面是捆绑的 `dsh` 可执行文件。安装 SDK 时会装上同一版本、当前平台的 runtime wheel。运行 SDK 不要求系统里另有 Node.js。

## 默认参数就是 sdk

[`python/sdk/src/deepseek_harness/client.py`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/python/sdk/src/deepseek_harness/client.py) 的 `HarnessConfig` 把 profile 默认成 `sdk`：

```py
class HarnessConfig:
    """Configuration for launching the local DeepSeek Harness SDK runtime."""

    dsh_bin: str | None = None
    profile: str = "sdk"
    patches: tuple[str, ...] = ()
    dsh_home: str | None = None
```

真正拼命令行时，home 要么来自 `dsh_home`，要么来自已经放进子进程环境的非空 `DSH_HOME`。两者都没有就拒绝启动。补丁文件先变成绝对路径，再按顺序接在 `--profile` 后面：

```py
        if self.config.dsh_home is not None:
            if not self.config.dsh_home.strip():
                raise ValueError("HarnessConfig requires a non-empty dsh_home")
            env["DSH_HOME"] = str(Path(self.config.dsh_home).expanduser().resolve())
        elif not env.get("DSH_HOME", "").strip():
            raise ValueError(
                "HarnessConfig requires an explicit dsh_home or non-empty DSH_HOME; "
                "the Python SDK never uses ~/.dsh implicitly"
            )

        patches = tuple(
            argument
            for patch in self.config.patches
            for argument in ("--patch", str(Path(patch).expanduser().resolve()))
        )
        return (*base, "--profile", self.config.profile, *patches)
```

[`python/sdk-runtime/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/python/sdk-runtime/README.md) 对 wheel 里的 `dsh` 命令重复同一条 home 规则：它把参数转给捆绑可执行文件，并且要求非空 `DSH_HOME`，不会退回 `~/.dsh`。生产可执行文件的名字是 `deepseek-harness-sdk-runtime-<platform>-<arch>`。这和架构文档里的说法一致：Python 客户端默认以显式 Harness home 启动 `dsh --profile sdk`。

`profile` 可以换成别的已有 profile，但那份组合必须仍保留 `@deepseek-ai/dsh-sdk-app` 或另一行 `@deepseek-ai/dsh-sdk-jsonrpc-server`。配错了会在 CLI 启动或 SDK 初始化时失败，没有一份完整配置的回退。`dsh_bin` 可以指向另一个 `dsh` 可执行文件，profile 语法不变。任意替换 argv 只属于内部假运行时测试，不是公开 API。

## 最小示例选择 sdk-minimal

第 3 章的 `PROFILE_TEMPLATES` 里，`sdk-minimal` 只有 `@deepseek-ai/dsh-sdk-minimal`，不叠 `dsh-base`。可运行的最小示例把这个名字写成默认值。[`python/sdk/examples/minimal.py`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/python/sdk/examples/minimal.py)：

```py
    parser.add_argument(
        "--dsh-home",
        type=Path,
        default=Path(configured_home) if configured_home.strip() else None,
    )
    parser.add_argument("--profile", default="sdk-minimal")
    parser.add_argument("--session-id")
    parser.add_argument("--provider", default="deepseek-official")
    parser.add_argument("--model", default=os.environ.get("DSH_MODEL", "deepseek-v4-flash"))
```

没有 `--dsh-home`，也没有非空的 `DSH_HOME` 时，示例在启动前直接报错。SDK 参考写明：`sdk-minimal` 是独立的显式树，普通 `model` 参数就是唯一的运行时模型选择。它提供平台选定的持久 shell、`read_image`、本地执行、JSONL 会话和自动压缩。文本文件工具、设置、受管凭据、遥测、Web 工具和完整默认工具名单留在完整的 `sdk` 与 `web` profile。`sdk-minimal` 上不支持的斜杠输入仍走普通提示词路径。标准 `sdk` 的权限预设有 `read-only`、`workspace-write`、`danger-full-access`；没有这套服务的 profile，例如 `sdk-minimal`，会拒绝显式的权限覆盖。

[`python/sdk/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/python/sdk/README.md) 里的最短启动把 home、工作目录和模型一起交给 `DeepSeekHarness`。`initialize_timeout_seconds` 默认 30 秒，只包住最初的 profile 握手。持久插件仍通过 `dsh plugin --profile sdk add ...` 写进 profile，而不是塞进一次 Python 调用的私有配置树。

## 不变量

- Python 没有单独的应用入口。它启动捆绑的 `dsh`，默认 `--profile sdk`。
- 每次启动都要显式 Harness home：`dsh_home` 或非空 `DSH_HOME`。SDK 不会读 `~/.dsh`。
- 最小示例的默认 profile 是 `sdk-minimal`。它不套 `dsh-base`。
- 换 profile 时，组合里仍要有 JSON-RPC 服务器那一行。没有完整配置回退。
- 调用期补丁是有序的 `--patch` 文件。持久插件用 `dsh plugin` 写进 profile。

## 下一章

第 15 章看外部工具怎样变成 harness 里的普通工具：一个 `mcp-client` 实例连一台 MCP 服务器，并把工具登记成 `mcp__<serverName>__<rawName>`。
