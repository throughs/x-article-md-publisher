#!/bin/bash
# X Article Markdown Publisher — One-time setup script
# Run once on a new machine:
#   bash setup.sh
#
# Does:
#   1. Checks prerequisites (Node.js, Chrome)
#   2. No npm deps needed (pure Node.js!)
#   3. Opens Chrome extension install page

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "═══════════════════════════════════════════"
echo "  🚀 X Article Markdown Publisher — Setup"
echo "═══════════════════════════════════════════"
echo ""

# 1. Check Node.js
if command -v node &>/dev/null; then
  echo -e "${GREEN}✅ Node.js${NC} $(node -v)"
else
  echo -e "${RED}❌ Node.js not found. Install from https://nodejs.org${NC}"
  exit 1
fi

# 2. Check Chrome
CHROME="/Applications/Google Chrome.app"
if [ -d "$CHROME" ]; then
  echo -e "${GREEN}✅ Chrome${NC} found"
else
  echo -e "${RED}❌ Chrome not found at $CHROME${NC}"
  echo "   Install from https://google.com/chrome"
  exit 1
fi

# 3. No npm install needed — pure Node.js, no external deps!
echo -e "${GREEN}✅${NC} No npm dependencies (pure Node.js stdlib)"

# 4. Chrome Extension
EXT_DIR="$(cd "$(dirname "$0")" && pwd)/extension"
echo ""
echo "───────────────────────────────────────────"
echo "  🔌 Chrome Extension Setup"
echo "───────────────────────────────────────────"
echo ""
echo "  1. Open: ${BLUE}chrome://extensions${NC}"
echo "  2. Turn on ${BLUE}Developer mode${NC} (top right)"
echo "  3. Click ${BLUE}Load unpacked${NC}"
echo "  4. Select: ${BLUE}$EXT_DIR${NC}"
echo ""
echo "  💡 After any code update, click 🔄 on the extension card."

# 5. Open extensions page
echo ""
read -p "  Open chrome://extensions now? [Y/n] " yn
if [ "$yn" != "n" ] && [ "$yn" != "N" ]; then
  open -a "Google Chrome" "chrome://extensions"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo ""
echo "  📋 Usage:"
echo "     bash publish-to-x.sh <article.md>"
echo ""
echo "  📄 Full docs: README.md"
echo "═══════════════════════════════════════════"
