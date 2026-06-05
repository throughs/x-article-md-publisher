#!/bin/bash
# publish-to-x.sh — Hermes one-click X Article publisher
# Usage: publish-to-x.sh <markdown_file.md>
#
# 1. Kills old server
# 2. Starts new server with article loaded
# 3. Opens X Articles in Chrome
#
# User then: sees [📥 导入 Hermes 文章] button → clicks → preview → confirm → inject → Publish

set -e

MD_FILE="$1"
PORT="${2:-8765}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$MD_FILE" ]; then
  echo "Usage: publish-to-x.sh <markdown_file.md> [port]"
  exit 1
fi

if [ ! -f "$MD_FILE" ]; then
  echo "❌ File not found: $MD_FILE"
  exit 1
fi

# Kill existing server
pkill -f "xarticle-server" 2>/dev/null || true
sleep 0.5

# Start server
cd "$SCRIPT_DIR"
node xarticle-server.js "$MD_FILE" "$PORT" &
SERVER_PID=$!
sleep 1

# Verify server started
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "❌ Server failed to start"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 文章加载完成！"
echo ""
echo "   📄 文件: $(basename "$MD_FILE")"
echo "   🔌 端口: $PORT"
echo ""
echo "   👉 Chrome 已打开 X Articles 页面"
echo "   👉 在右上角找 [📥 导入文章] 按钮"
echo "   👉 点击 → 预览 → 确认导入 → 点 Publish"
echo ""
echo "   💡 手动备选: http://localhost:$PORT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Open X Articles in Chrome
open -a "Google Chrome" "https://x.com/compose/articles/new"
