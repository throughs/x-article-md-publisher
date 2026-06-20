# X Article Markdown Publisher

中文 | [English](README.en.md)

一个面向 X Articles 的 Markdown 文章导入工具：本地 Node.js 服务负责解析文章和图片，Chrome 扩展负责把内容写入 X 文章编辑器。

适合把带本地图片、图床图片、封面图、代码块、表格和长文结构的 Markdown 草稿导入到 X Articles。工具只负责载入草稿，不会自动点击 X 的 Publish 按钮。

本项目为独立项目，不隶属于、未获得 X Corp.、Twitter 或 xAI 背书，也不代表这些平台的官方工具。

## 项目名称

推荐公开仓库名：

```text
x-article-md-publisher
```

公开发布时建议使用 `X Article Markdown Publisher` 作为产品名。这个名字直接描述产品能力，避免让用户误解为官方平台集成，也方便后续扩展 CLI、dashboard 或自动化导入能力。

## 致谢

核心思路和部分实现技术来自或参考了 MIT 协议项目 [xPoster](https://github.com/nevertoday/xposter)。

如果你发布 fork 或二次开发版本，请保留 `LICENSE`、`NOTICE` 和 README 中的 xPoster 致谢，并避免使用会让人误解为 X/Twitter/xAI 官方背书的表述。

## 环境要求

- Node.js 18+
- Google Chrome 或 Chromium
- 具备 X Articles 权限的 X 账号
- Chrome 扩展开发者模式

可选能力：

- macOS 会使用系统自带 `sips` 压缩较大的 PNG/JPEG 图片。
- Windows/Linux 默认上传原图；如需压缩，可后续接入跨平台图片压缩工具。

## 安装

```bash
git clone https://github.com/throughs/x-article-md-publisher.git
cd x-article-md-publisher
```

安装 Chrome 扩展：

1. 打开 `chrome://extensions`。
2. 启用右上角 Developer mode / 开发者模式。
3. 点击 Load unpacked / 加载已解压的扩展程序。
4. 选择项目里的 `extension/` 目录。

服务端只使用 Node.js 内置模块。只有使用可选的 Playwright 自动化脚本时，才需要运行 `npm install`。

## 启动本地服务

Markdown 文件参数不是必须的。你可以先只启动服务，再在网页里用“本地路径 / 拖拽文件 / 粘贴文本”载入文章。

macOS / Linux：

```bash
./scripts/xarticle-server.sh start
./scripts/xarticle-server.sh start "/path/to/article.md"
./scripts/xarticle-server.sh status
./scripts/xarticle-server.sh stop
```

Windows PowerShell：

```powershell
.\scripts\xarticle-server.ps1 start
.\scripts\xarticle-server.ps1 start "C:\Users\you\article.md"
.\scripts\xarticle-server.ps1 status
.\scripts\xarticle-server.ps1 stop
```

任意平台也可以直接用 Node 启动：

```bash
node xarticle-server.js 8765
node xarticle-server.js "/path/to/article.md" 8765
```

启动后打开：

```text
http://localhost:8765
```

## 图文与视频教程

截图和录屏建议放在 `docs/assets/`，README 会直接引用这些相对路径，方便 GitHub 渲染。

推荐文件名：

```text
docs/assets/01-load-extension.png
docs/assets/02-start-server.png
docs/assets/03-load-markdown.png
docs/assets/04-open-x-editor.png
docs/assets/05-import-progress.png
docs/assets/xarticle-workflow.mp4
```

完整流程视频：

<video src="docs/assets/xarticle-workflow.mp4" controls width="100%"></video>

如果 GitHub 不渲染本地 `.mp4`，可以把视频上传到 GitHub Issue、Release 或 Discussion，然后把上面的 `src` 替换为 GitHub 生成的资源链接。

### 1. 加载 Chrome 扩展

打开 `chrome://extensions`，启用开发者模式，点击“加载已解压的扩展程序”，选择项目中的 `extension/` 目录。

![加载 Chrome 扩展](docs/assets/01-load-extension.png)

### 2. 启动本地服务

不带 Markdown 参数也可以启动。启动后到 dashboard 里载入文章。

macOS / Linux：

```bash
./scripts/xarticle-server.sh start
./scripts/xarticle-server.sh start "/path/to/article.md"
```

Windows PowerShell：

```powershell
.\scripts\xarticle-server.ps1 start
.\scripts\xarticle-server.ps1 start "C:\Users\you\article.md"
```

然后打开 `http://localhost:8765`。

![启动本地服务](docs/assets/02-start-server.png)

### 3. 在服务页面载入 Markdown

服务页面支持三种来源：

- 本地路径：最适合本地 Markdown，并且正文里引用了相对路径图片。浏览器拿不到拖拽文件的完整本机路径，所以相对本机图片需要用这种方式。
- 拖拽文件：适合拖入或选择 `.md` 文件，尤其是正文使用图床链接或 data 图片时；文件会自动读取并载入。
- 粘贴文本：适合直接复制 Markdown 文本到服务页面。

如果需要封面，可以在服务页面手动上传封面图，或在 Markdown frontmatter 中写 `cover`。没有显式封面时，正文首图会保留为正文图片，不会自动变成封面。

![载入 Markdown 文章](docs/assets/03-load-markdown.png)

### 4. 打开 X Articles 编辑器

可以点击服务页面里的“打开 X 并自动导入”，也可以手动打开：

```text
https://x.com/compose/articles/new
```

服务会准备一次导入触发，Chrome 扩展会从 `http://localhost:8765` 读取当前文章 payload。

![打开 X 编辑器](docs/assets/04-open-x-editor.png)

### 5. 点击扩展按钮导入文章

在 X 文章编辑器页面点击右上角浮动的“载入文章”按钮。导入期间请保持页面打开，工具会依次写入标题、正文、封面和图片。

图片较多时需要等待。进度面板会展示当前图片数量、成功数量、失败数量和重试状态。

![导入进度](docs/assets/05-import-progress.png)

### 6. 检查草稿并手动发布

导入完成后，请检查标题、代码块、表格、图片、封面和段落结构。确认无误后，再手动点击 X 编辑器里的 Publish 按钮。

## 服务页面工作流

常规流程：

1. 启动本地服务。
2. 在 dashboard 载入 Markdown。
3. 可选：上传或清除手动封面。
4. 打开 X Articles 编辑器。
5. 点击扩展里的“载入文章”。
6. 等待图片上传进度完成。
7. 检查草稿并手动发布。

三种文章来源：

- 本地路径：支持相对本地图片，适合 Obsidian、Typora、本地笔记目录。
- 拖拽文件：适合图床链接、data 图片或不依赖本地相对路径的 Markdown。
- 粘贴文本：适合直接复制带图床链接的 Markdown 文章。

## Markdown 元数据

支持 YAML frontmatter：

```md
---
title: Article title
cover: ./assets/cover.jpg
---
```

标题优先级：

```text
frontmatter title > 第一个 H1 > 文件名
```

封面优先级：

```text
服务页面手动封面 > frontmatter cover > 无封面
```

如果封面图也出现在正文中，工具会把它作为文章封面上传，并从正文图片列表中移除。若封面是单独图片，则只作为封面上传。没有设置 `cover` 时，正文图片只按正文图片处理。

## 图片与路径

支持的图片来源：

- 本地绝对路径。
- 相对 Markdown 文件目录的图片路径。
- `file://` URL。
- `http://` / `https://` 图床链接。
- `data:image/...;base64,...` 图片。

macOS 示例：

```md
![image](./assets/a.jpg)
![image](/Users/me/Notes/assets/a%20b.jpg)
![image](file:///Users/me/Notes/assets/a%20b.jpg)
```

Windows 示例：

```md
![image](C:/Users/me/Notes/assets/a%20b.jpg)
![image](file:///C:/Users/me/Notes/assets/a%20b.jpg)
```

Windows 下建议优先使用正斜杠或 `file:///C:/...`。原始反斜杠路径在部分 Markdown 场景中容易被转义破坏。

## 平台差异

| 平台 | 说明 |
| --- | --- |
| macOS | 使用 `scripts/xarticle-server.sh` 管理服务；打开 X 时优先调用 Google Chrome；较大的 PNG/JPEG 会用 `sips` 压缩。 |
| Windows | 使用 `scripts/xarticle-server.ps1` 管理服务；支持盘符路径和 `file:///C:/...`；默认不压缩图片。 |
| Linux | 可使用 `scripts/xarticle-server.sh`；打开 X 时使用 `xdg-open`；默认不压缩图片。 |

## API 端点

| 端点 | 用途 |
| --- | --- |
| `GET /` | 服务页面 |
| `GET /status` | 当前文章状态、图片数量和导入进度 |
| `GET /payload` | 完整文章 payload |
| `GET /engine` | 注入到 X 页面里的执行引擎 |
| `GET /inject-script` | 执行引擎和当前文章 payload |
| `POST /progress` | X 页面回传导入进度 |
| `POST /cover` | 设置手动封面 |
| `POST /cover/clear` | 清除手动封面 |

## GitHub 发布检查清单

- 如果发布到其他账号或组织，请替换安装命令中的 GitHub 仓库地址。
- 保留 `LICENSE` 和 `NOTICE`。
- 保留 README 中对 xPoster 的致谢。
- 不使用会让人误解为 X、Twitter 或 xAI 官方背书的品牌描述。
- 添加截图或短视频，建议放在 `docs/assets/`。
- 在当前 Chrome 版本和自己的 X 账号环境里完整跑一次导入流程。

## 故障排查

| 现象 | 处理方式 |
| --- | --- |
| X 页面没有出现“载入文章”按钮 | 刷新 X 编辑器页面，并在 `chrome://extensions` 重新加载扩展。 |
| 按钮提示无法连接本地服务 | 确认 `http://localhost:8765` 正在运行。 |
| 服务页面显示未载入文章 | 先用本地路径、拖拽文件或粘贴文本载入 Markdown。 |
| 本地图片没有解析出来 | 优先使用本地路径；浏览器拖拽/选择文件无法提供完整本机路径；也可改用绝对路径或 `file:///`。 |
| Windows 带空格路径失败 | 优先写成 `C:/.../a%20b.jpg` 或 `file:///C:/.../a%20b.jpg`。 |
| 图片很多时看起来导入很慢 | 保持 X 页面打开，观察进度面板；图片上传是最耗时的步骤。 |
| 导入进度不显示 | 刷新 X 编辑器页面并重试；注入脚本也会直接向 `/progress` 回报状态。 |
| 端口被占用 | 使用对应平台脚本的 `status` 和 `stop` 检查并停止旧服务。 |

## License

MIT. See `LICENSE` and `NOTICE`.
