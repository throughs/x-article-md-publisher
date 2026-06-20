# Changelog

> 按版本记录关键改动，最新在上。

## [Unreleased]

### 变更
- 公开项目名称与文档统一为 `X Article Markdown Publisher` / `x-article-md-publisher`。
- 新增 macOS/Linux 与 Windows 分开的 server 启停脚本，默认端口仍为 `8765`。
- 优化 Windows/macOS 本地图片路径兼容处理。

## [4.1.0] - 2026-06-05

### 新增
- **全自动无人值守模式 `auto-publish.js`**（Playwright + 系统 Chrome）：自动打开 X 文章编辑器、新建文章、注入正文 + 图片 + 封面，灌完停在草稿等你手动发布——**工具永不自动发布**。持久化登录态（`~/.x-article-md-profile`），首次登录一次后免登。
- **图片轻度压缩**（`payload.js`，调用 macOS 原生 `sips`，零依赖）：>150KB 的大图缩到长边 ≤1280px 并转 JPEG q82，体积常砍 5~10 倍（如 2.1MB → 228KB），上传更快、更不易触发 X 限流；只缩不放大。
- **Profile 占用自检**（`auto-publish.js`）：启动前检测并关闭上一个未关的发布浏览器（共用同一登录态），启动失败再清理锁文件重试，避免「现有会话」冲突。
- **`payload.js`**：把 `buildPayload` 抽成独立模块，扩展模式与全自动模式共用同一套解析逻辑（单一数据源）。
- `package.json` 新增 `npm run auto` 脚本。

### 修复
- **标题乱码 + 正文标题重复**：解码 frontmatter 里的 unicode 转义（如 `\U0001F680` → 🚀），让标题正常显示，同时修复因字符串不匹配导致的正文 H1 去重失效。
- **图片错位/丢失**：上传后改为按「块顺序里离 marker 最近」挑选新原子块，修复快速连续上传时 X 异步重排导致的图片落到文章最底部或丢失。
- **占位符残留**：`cleanupMarkers` 改为多轮兜底清理（每轮重新抓取 draftNode），并重删被异步插回的封面块，直到收敛——彻底清掉 `__..._IMAGE_n__` 之类残留标记。
- **行内代码里的示例图被误解析**：`shared.js` 新增行内代码区间识别，反引号包裹的 `![](...)` 不再被当成真实图片处理。

### 变更
- `xarticle-server.js`：改为引用 `payload.js`，不再内联 `buildPayload`。
- `package.json`：新增 `playwright-core` 依赖。

## [4.0.0]

- 基线：Chrome 扩展（MV3）一键把 Markdown 文章灌入 X Articles 编辑器，支持正文、图片按位插入、封面识别；载入按钮仅在文章编辑器页显示。
