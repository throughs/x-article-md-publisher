# GitHub 推送流程

这份文档记录本项目后续更新、提交和推送到 GitHub 的常用流程。

当前仓库配置：

```bash
origin   https://github.com/throughs/x-article-md-publisher.git
upstream https://github.com/punk2898/x-article-publisher
branch   main
```

`origin` 是你自己的公开仓库，用来推送你的改动。`upstream` 是原项目地址，只作为参考来源保留。

## 1. 首次环境确认

本机已经配置过 GitHub CLI 和 Git 身份。后面如果换电脑，可以按下面检查：

```bash
git config --global user.name
git config --global user.email
gh auth status
```

如果 `gh auth status` 显示未登录：

```bash
gh auth login --hostname github.com --git-protocol ssh --web --scopes repo,admin:public_key --skip-ssh-key
gh auth setup-git
```

登录过程会给一个 GitHub 设备验证码，按提示在浏览器完成授权。不要把 token、密码或私钥发到聊天窗口。

## 2. 每次更新前先看状态

进入项目目录：

```bash
cd /Users/wxglen/CodeSpace/codexSpace/X_Poster/x-article-publisher
```

确认当前分支、远程仓库和是否有未提交改动：

```bash
git status --short --branch
git remote -v
```

正常情况应该看到：

```text
## main...origin/main
```

如果你准备开始新一轮修改，建议先拉取远程最新代码：

```bash
git pull --ff-only
```

## 3. 修改后检查改动

查看改了哪些文件：

```bash
git status --short
git diff --stat
```

查看具体内容：

```bash
git diff
```

如果已经暂存过文件，查看暂存区：

```bash
git diff --cached
```

提交前重点确认：

- 不要提交 `.env`、私钥、token、cookie、浏览器 profile、日志和 PID 文件。
- 不要把本地测试文章或个人草稿误提交，除非就是要作为示例公开。
- README 里的链接、截图、命令要能对应当前仓库。

## 4. 运行必要检查

本项目常用检查命令：

```bash
node --check xarticle-server.js
node --check extension/content.js
node --check extension/background.js
node --check xpage.js
node --check shared.js
node --check payload.js
node --check auto-publish.js
bash -n scripts/xarticle-server.sh
bash -n setup.sh
bash -n publish-to-x.sh
```

如果只改 README，可以不跑完整 JS 检查，但至少确认链接和命令没有明显错误。

## 5. 暂存、提交、推送

暂存指定文件：

```bash
git add README.md README.en.md
```

暂存全部当前改动：

```bash
git add -A
```

提交：

```bash
git commit -m "Update README"
```

推送到 GitHub：

```bash
git push
```

推送成功后确认：

```bash
git status --short --branch
git log --oneline --decorate -3
```

正常状态：

```text
## main...origin/main
```

## 6. 新增文件时的推荐流程

例如新增文档：

```bash
git status --short
git add docs/new-file.md
git diff --cached
git commit -m "Add new documentation"
git push
```

例如新增功能代码：

```bash
git status --short
git add xarticle-server.js xpage.js extension/content.js
git diff --cached
node --check xarticle-server.js
node --check xpage.js
node --check extension/content.js
git commit -m "Improve article import flow"
git push
```

## 7. 常见问题

### push 提示未登录

```bash
gh auth status
gh auth login --hostname github.com --git-protocol ssh --web --scopes repo,admin:public_key --skip-ssh-key
gh auth setup-git
git push
```

### push 被拒绝，提示远程有新提交

先拉取远程更新：

```bash
git pull --ff-only
```

如果 `--ff-only` 失败，说明本地和远程都有新提交，需要先看冲突，不要直接强推：

```bash
git status
git log --oneline --decorate --graph --all -10
```

### 不小心暂存了不该提交的文件

从暂存区移除，但保留本地文件：

```bash
git restore --staged path/to/file
```

如果文件本来就不该被 Git 跟踪，把它加入 `.gitignore`，再检查：

```bash
git status --short
```

### 想确认 GitHub 仓库地址

```bash
gh repo view throughs/x-article-md-publisher --web
```

或直接打开：

```text
https://github.com/throughs/x-article-md-publisher
```

