#!/usr/bin/env node
/**
 * xarticle-server.js v4 — Hermes X Publisher Server
 * Usage: node xarticle-server.js <markdown.md> [port]
 * 
 * Endpoints:
 *   GET /              — Dashboard with Copy + Publish buttons
 *   GET /payload       — Article JSON payload
 *   GET /engine        — xpage.js (React Fiber injection engine)
 *   GET /inject-script — Full injection script (external file, CSP-friendly)
 *   GET /trigger       — Check/clear trigger state
 *   GET /publish       — Activate trigger (extension picks it up)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const mdPath = process.argv[2] || 'test_article.md';
const PORT = parseInt(process.argv[3] || '8765');

const shared = require('./shared.js');
const XPAGE_JS = fs.readFileSync(path.join(__dirname, 'xpage.js'), 'utf-8');

// ── Build payload ──
function buildPayload(mdPath) {
  const markdown = fs.readFileSync(mdPath, 'utf-8');
  const mdDir = path.dirname(path.resolve(mdPath));
  const options = { extractTitle: true, extractCover: true };
  const parsed = shared.parseMarkdown(markdown, options);
  
  const imageResults = new Map();
  for (const seg of parsed.segments) {
    if (seg.type !== 'image') continue;
    const src = seg.source;
    try {
      if (src.startsWith('data:')) {
        const uri = shared.parseDataUri(src);
        if (uri.ok) imageResults.set(seg, { ok: true, ...uri, fileName: shared.guessFileName(src) });
      } else if (src.startsWith('http')) {
        imageResults.set(seg, { ok: false, error: 'Remote images unsupported' });
      } else {
        const fullPath = src.startsWith('/') ? src : path.resolve(mdDir, src);
        if (fs.existsSync(fullPath)) {
          const buf = fs.readFileSync(fullPath);
          const ext = path.extname(fullPath).toLowerCase();
          const mimeMap = { '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp' };
          imageResults.set(seg, { ok: true, base64: buf.toString('base64'), mime: mimeMap[ext]||'image/png', fileName: path.basename(fullPath), bytes: buf.length });
        } else { imageResults.set(seg, { ok: false, error: 'Not found: ' + fullPath }); }
      }
    } catch (e) { imageResults.set(seg, { ok: false, error: e.message }); }
  }
  
  const planOptions = { coverSource: parsed.cover, coverResult: null };
  const pastePlan = shared.buildPastePlan(parsed.segments, imageResults, new Map(), planOptions);
  
  const imagePayloads = [];
  for (const op of pastePlan.plan) {
    if (op.op.type === 'image' && op.op.file?.base64) {
      imagePayloads.push({
        marker: op.marker, base64: op.op.file.base64, fileName: op.op.file.fileName,
        mime: op.op.file.mime, alt: op.op.file.alt||'', coverOnly: !!op.op.coverOnly,
        fallbackText: op.op.fallbackText||'', source: op.op.source||null
      });
    }
  }
  
  return {
    title: parsed.title || '', cover: parsed.cover || '',
    html: pastePlan.html, plain: pastePlan.plain,
    blocks: pastePlan.blocks, plan: pastePlan.plan,
    markerPrefix: pastePlan.markerPrefix,
    images: imagePayloads, articleId: null
  };
}

const payload = buildPayload(mdPath);

// ── Manual console script ──
const MANUAL_SCRIPT = `(async function __hermesInject(){"use strict";${XPAGE_JS};const payload=${JSON.stringify(payload)};console.log('[Hermes] Injecting: '+payload.title);const result=await window.__xArticleWrite(payload);console.log('[Hermes]',JSON.stringify(result,null,2));if(result.ok)console.log('[Hermes] ✅ Done! Click Publish on X.');else console.error('[Hermes] ❌',result.error);return result;})();`;

// ── Extension auto-inject script (loaded as external file, script-src: localhost:* is in CSP!) ──
const AUTO_INJECT = `(async function __hermesMainInject(){"use strict";${XPAGE_JS};const payload=${JSON.stringify(payload)};console.log('[Hermes:MAIN] Injecting: '+payload.title);const result=await window.__xArticleWrite(payload);console.log('[Hermes:MAIN]',JSON.stringify(result,null,2));const el=document.createElement('meta');el.setAttribute('data-hermes-result',JSON.stringify(result));document.head.appendChild(el);return result;})();`;

// ── Trigger state ──
let trigger = { active: false };

const scriptSize = (MANUAL_SCRIPT.length / 1024).toFixed(1);

// ── Dashboard HTML ──
function dashboardHTML() {
  const modeClass = trigger.active ? 'mode-auto' : 'mode-manual';
  const modeLabel = trigger.active ? '⚡ AUTO' : '📋 MANUAL';
  const autoSection = trigger.active
    ? `<div class="card" style="border:1px solid #00ba7c"><h2>⚡ Auto-Inject Active</h2><p>Extension will inject when you open X Articles editor.</p><p><strong>Open</strong> <a href="https://x.com/compose/articles/new" target="_blank">x.com/compose/articles/new</a> → Click New Article</p><p style="color:#71767b;font-size:12px">The extension handles everything else.</p><button class="publish-btn" style="background:#f4212e" onclick="fetch('/trigger?disable=1');location.reload()">🔌 Disable Trigger</button></div>`
    : `<div class="card"><h2>🤖 Auto (Chrome Extension)</h2><p>Hermes Publisher extension installed?</p><button class="publish-btn" onclick="fetch('/publish').then(()=>location.reload())">🚀 Publish via Extension</button></div>`;
  
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>X Article Injector</title>
<style>
  *{box-sizing:border-box}body{font-family:-apple-system,sans-serif;max-width:760px;margin:20px auto;padding:16px;background:#15202b;color:#e1e8ed}
  h1{color:#1d9bf0;font-size:20px;margin-bottom:4px}
  .sub{color:#71767b;font-size:13px;margin-bottom:16px}
  .card{background:#1e2732;border-radius:12px;padding:16px 20px;margin:12px 0}
  .card h2{color:#1d9bf0;font-size:16px;margin:0 0 8px}.card p{color:#e1e8ed;font-size:14px;margin:6px 0}
  .steps .step{margin:10px 0;padding-left:12px;border-left:3px solid #1d9bf0;color:#e1e8ed;font-size:14px}
  kbd{background:#38444d;color:#e1e8ed;padding:2px 6px;border-radius:4px;font-size:12px}
  .script-area{position:relative;margin:16px 0}
  .script-area textarea{width:100%;height:180px;background:#0f1419;color:#00ba7c;border:1px solid #38444d;border-radius:8px;padding:12px;font-family:'SF Mono',Monaco,monospace;font-size:11px;resize:vertical}
  .copy-btn{position:absolute;top:8px;right:12px;background:#1d9bf0;color:#fff;border:none;padding:6px 14px;border-radius:16px;font-size:12px;cursor:pointer;font-weight:600}
  .copy-btn:hover{background:#1a8cd8}.copy-btn.copied{background:#00ba7c}
  .publish-btn{display:block;width:100%;background:#00ba7c;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;margin:12px 0}
  .publish-btn:hover{background:#00a36d}
  .warn{background:#ffd70015;border:1px solid #ffd70033;border-radius:8px;padding:10px 14px;margin:16px 0;color:#ffd700;font-size:13px}
  a{color:#1d9bf0}
  .mode-indicator{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600}
  .mode-auto{background:#00ba7c20;color:#00ba7c}.mode-manual{background:#1d9bf020;color:#1d9bf0}
</style></head><body>
<h1>🚀 X Article Injector <span class="mode-indicator ${modeClass}">${modeLabel}</span></h1>
<div class="sub">Dual-mode: Extension auto-inject + Manual console paste</div>

<div class="card"><h2>📄 ${payload.title || '(untitled)'}</h2>
<p style="color:#71767b">text: ${payload.blocks?.filter(b=>b.type==='text').length||0} | images: ${payload.images.length} | script: ${scriptSize} KB</p></div>

${autoSection}

<div class="card"><h2>📋 Manual (Console Paste)</h2>
<div class="steps">
  <div class="step"><strong>1.</strong> <a href="https://x.com/compose/articles/new" target="_blank">Open x.com/compose/articles/new</a></div>
  <div class="step"><strong>2.</strong> Click New Article</div>
  <div class="step"><strong>3.</strong> DevTools: <kbd>Cmd+Option+J</kbd> → <kbd>allow pasting</kbd></div>
  <div class="step"><strong>4.</strong> Copy script → paste → Enter</div>
</div>
<div class="script-area">
  <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('script').value);this.textContent='✅ Copied!';this.classList.add('copied');setTimeout(()=>{this.textContent='📋 Copy';this.classList.remove('copied')},2000)">📋 Copy</button>
  <textarea id="script" readonly>${MANUAL_SCRIPT}</textarea>
</div></div>

<p style="color:#71767b;font-size:12px;margin-top:8px">⚡ Port ${PORT} | ${path.basename(mdPath)} | ${new Date().toLocaleTimeString()}</p>
</body></html>`;
}

// ── HTTP Server ──
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // 动态接口（引擎/数据）每次发布都会变，禁止浏览器缓存，否则点导入跑的还是上次缓存的旧引擎
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  const reqUrl = url.parse(req.url, true);
  const p = reqUrl.pathname;
  
  if (p === '/payload') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  } else if (p === '/status') {
    const preview = (payload.plain || '').substring(0, 200).replace(/\\n/g, ' ');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ready: true,
      title: payload.title || '',
      cover: payload.cover || null,
      textBlocks: (payload.blocks || []).filter(b => b.type === 'text').length,
      imageCount: (payload.images || []).length,
      preview: preview,
      port: PORT
    }));
  } else if (p === '/engine') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(XPAGE_JS);
  } else if (p === '/inject-script') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(AUTO_INJECT);
  } else if (p === '/trigger') {
    if (reqUrl.query.disable === '1') { trigger.active = false; console.log('🔌 Trigger disabled'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(trigger));
  } else if (p === '/publish') {
    trigger.active = true;
    console.log('🚀 Publish triggered!');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Trigger activated. Open x.com/compose/articles/new', title: payload.title }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardHTML());
  }
});

server.listen(PORT, () => {
  const auto = process.argv.includes('--auto');
  if (auto) trigger.active = true;
  
  console.log('═'.repeat(60));
  console.log(`🚀 Hermes X Publisher Server v4`);
  console.log(`   Port:    ${PORT}`);
  console.log(`   Article: ${path.basename(mdPath)}`);
  console.log(`   Title:   ${payload.title || '(untitled)'}`);
  console.log(`   Script:  ${scriptSize}KB`);
  if (auto) console.log(`   Mode:    ⚡ AUTO-TRIGGER (extension will inject immediately)`);
  console.log('═'.repeat(60));
  console.log('');
  console.log(`📋 Manual:  Open http://localhost:${PORT} → Copy → Console paste`);
  if (!auto) {
    console.log(`🤖 Auto:    Open http://localhost:${PORT} → Publish via Extension`);
    console.log(`            Then open x.com/compose/articles/new → Click New Article`);
  } else {
    console.log(`⚡ AUTO mode: Trigger already active. Just open x.com/compose/articles/new → New Article`);
  }
});
