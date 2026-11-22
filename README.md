# DeepSeek Harness 源码精读笔记（v2）

静态学习站：用简体中文逐章精读 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。站点根目录就是 Astro 项目，没有 `dsh-book/` 子目录。

## 官方钉

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/deepseek-ai/deepseek-harness |
| 默认分支 | `master`（笔记链接不指向它） |
| 标签 | `dsh-v0.2.3-alpha.2` |
| SHA | `4b399c39a6d1479cd84ca591b4d7c88e24d38a96` |
| 根包 | `@deepseek-ai/dsh-root@0.2.3-alpha.2` |
| Node | `^24.22.3 \|\| >=26.13.1` |
| packageManager | `pnpm@11.28.5` |
| 许可证 | MIT（Copyright (c) 2026 DeepSeek） |

同一份记录写在仓库根的 [`VERSION`](VERSION)。上游仍是 **developer preview**：官方 README 写明会有破坏兼容性的变更。公共 API 是 pre-stable。本书跟随这一钉，以后对照官方 [`docs/upgrade-guide/`](https://github.com/deepseek-ai/deepseek-harness/tree/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/upgrade-guide) 再升级。本仓库不收录、不分叉官方 monorepo。

代码块与标成摘录的文档段落逐字来自该 SHA。引用官方源码时保留 MIT 归属。正文里的 GitHub 链接使用 `blob/<sha>/<file>`，其中 sha 就是上表那一颗，不使用 `master` 或 `main`。

## 和旧书的关系

[zhanzhaozzz/DeepSeek-Harness-book](https://github.com/zhanzhaozzz/DeepSeek-Harness-book)（线上 [deep-seek-harness-book.vercel.app](https://deep-seek-harness-book.vercel.app/)）是对照官方提交 `3a46bd67985136d0ba90dd9225f5ce65140cf71c`、包版本 `@deepseek-ai/dsh-root@0.1.0-rc.6` 的历史档案。那一版的章节文字只当作教学草稿。本仓库是独立重写，不覆盖、不推送旧仓库。

`astro.config.mjs` 的 `site` 是将来新建 Vercel 项目的占位：`https://deepseek-harness-book-v2.vercel.app`。本次不部署。在认领真实域名之前，不要把旧域名写成这个项目的站点地址。

## 本地开发

```sh
npm install
npm run dev          # http://localhost:4321
npm run meta         # 重算已发布章节的字数 / 代码行 / 分钟
npm run check:paths  # 核对文中官方路径在钉上存在
npm run build        # 产出 dist/
npm run preview
```

有官方检出时可以离线核对路径：

```sh
DSH_ROOT=/path/to/deepseek-harness npm run check:paths
```

`DSH_ROOT` 必须是标签 `dsh-v0.2.3-alpha.2` 的工作树。未设置时，脚本向 `raw.githubusercontent.com` 请求该 SHA。

## 章节

`src/content/modules/chNN-*.md`，frontmatter：`order` / `title` / `summary` / `status` / `words` / `codeLines` / `minutes` / `updated`。

十二章脊柱：

1. 仓库地图
2. Cordis 与插件
3. profile / bundle / 启动
4. Agent Loop：step 与 turn
5. 只追加的会话日志
6. llm 服务与流式适配器
7. 工具注册与执行管线
8. 三个事件域
9. Service Definition / Provider / Consumer
10. system-prompt 与 `agent.inject`
11. 子代理、workflow 与 jobs
12. 持久化、压缩与遥测

写法：一句话定义 → 逐字摘录 → 不变量 → 下一章预告。

## 以后再写的专章

Desktop、Python SDK、MCP、Teams，以及把 Session V4 迁移单独成章。这些表面在第 1、3、12 章里只做到地图不错位：Session V4 的格式事实写在第 12 章。

## 部署备忘

仓库根就是站点。Vercel 的 Root Directory 留空（仓库根），Build Command `npm run build`，Output Directory `dist`。`vercel.json` 只打开 `cleanUrls`。

## 目录

```
├── VERSION
├── astro.config.mjs
├── vercel.json
├── scripts/meta.mjs
├── scripts/check-official-paths.mjs
└── src/
    ├── content/modules/
    ├── styles/global.css
    ├── layouts/
    ├── components/
    └── pages/
```
