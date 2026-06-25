#!/usr/bin/env node
/**
 * xarticle-server.js — X Article Markdown Publisher Server
 *
 * Usage:
 *   node xarticle-server.js [markdown.md] [port]
 *
 * The dashboard can now load articles from a local path, a selected .md file,
 * or pasted Markdown. The Chrome extension still injects the active payload.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { execFile } = require('child_process');

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help') || args.includes('help')) {
  console.log(`X Article Markdown Publisher local server

Usage:
  node xarticle-server.js
  node xarticle-server.js 8765
  node xarticle-server.js article.md
  node xarticle-server.js article.md 8765

Markdown is optional. Start without a file to load Markdown from the dashboard.

Dashboard:
  http://localhost:${process.env.PORT || '8765'}
`);
  process.exit(0);
}
const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
const firstArg = positionalArgs[0] || '';
const secondArg = positionalArgs[1] || '';
const firstArgIsPort = /^\d+$/.test(firstArg);
const mdPathArg = firstArg && !firstArgIsPort ? firstArg : '';
const portArg = firstArgIsPort ? firstArg : secondArg;
const PORT = parseInt(portArg || process.env.PORT || '8765', 10);

const XPAGE_JS = fs.readFileSync(path.join(__dirname, 'xpage.js'), 'utf-8');
const { buildPayload, buildPayloadFromMarkdown } = require('./payload.js');
const shared = require('./shared.js');

let currentPayload = null;
let currentSource = '';
let currentError = null;
let trigger = { active: false };
let importProgress = makeIdleProgress();
let currentArticleInput = null;
let manualCover = null;

function makeIdleProgress(overrides = {}) {
  return {
    status: 'idle',
    phase: 'idle',
    imageIndex: 0,
    imageTotal: 0,
    imageOk: 0,
    imageFail: 0,
    message: 'No import running',
    updatedAt: null,
    ...overrides
  };
}

function resetImportProgress(overrides = {}) {
  importProgress = makeIdleProgress({
    message: currentPayload ? 'Article ready' : 'No import running',
    ...overrides,
    updatedAt: new Date().toISOString()
  });
  return importProgress;
}

function updateImportProgress(update = {}) {
  if (
    importProgress.status === 'done' &&
    update.status === 'warning' &&
    update.phase === 'unconfirmed'
  ) {
    return importProgress;
  }
  const allowed = [
    'sessionId', 'status', 'phase', 'title', 'textBlocks', 'imageIndex', 'imageTotal',
    'imageOk', 'imageFail', 'currentFileName', 'coverOnly', 'mediaId', 'message', 'error', 'ts',
    'elapsedMs', 'timeoutMs', 'waitMs', 'lastUploadMs', 'attempt', 'maxAttempts', 'evidence'
  ];
  const next = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(update, key)) next[key] = update[key];
  }
  const transient = ['mediaId', 'error', 'elapsedMs', 'timeoutMs', 'waitMs', 'lastUploadMs', 'attempt', 'maxAttempts', 'evidence'];
  for (const key of transient) {
    if (!Object.prototype.hasOwnProperty.call(update, key)) next[key] = null;
  }
  importProgress = {
    ...importProgress,
    ...next,
    updatedAt: new Date().toISOString()
  };
  return importProgress;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function payloadStats(payload) {
  if (!payload) return { textBlocks: 0, imageCount: 0, scriptSize: '0.0' };
  const manualScript = makeManualScript(payload);
  const markerPattern = /^__XPOSTER_[A-Za-z0-9]+_[A-Z]+_\d+__$/;
  return {
    textBlocks: (payload.blocks || []).filter((b) => {
      const text = String(b?.text || '').trim();
      return text && !markerPattern.test(text);
    }).length,
    imageCount: (payload.images || []).length,
    scriptSize: (manualScript.length / 1024).toFixed(1)
  };
}

function makeManualScript(payload) {
  return `(async function __xArticleMdInject(){"use strict";${XPAGE_JS};const payload=${JSON.stringify(payload)};console.log('[XArticleMD] Injecting: '+payload.title);const result=await window.__xArticleWrite(payload);console.log('[XArticleMD]',JSON.stringify(result,null,2));if(result.ok)console.log('[XArticleMD] Done! Click Publish on X.');else console.error('[XArticleMD]',result.error);return result;})();`;
}

function makeAutoInject(payload) {
  return `(async function __xArticleMdMainInject(){"use strict";${XPAGE_JS};const payload=${JSON.stringify(payload)};console.log('[XArticleMD:MAIN] Injecting: '+payload.title);const result=await window.__xArticleWrite(payload);console.log('[XArticleMD:MAIN]',JSON.stringify(result,null,2));const el=document.createElement('meta');el.setAttribute('data-xarticle-result',JSON.stringify(result));document.head.appendChild(el);return result;})();`;
}

function makeInjectErrorScript(message) {
  return `(() => { const el=document.createElement('meta'); el.setAttribute('data-xarticle-result', ${JSON.stringify(JSON.stringify({ ok: false, error: message }))}); document.head.appendChild(el); })();`;
}

function coverOverride() {
  return manualCover ? { source: manualCover.source, result: manualCover.result } : null;
}

async function rebuildCurrentPayload() {
  if (!currentArticleInput) throw new Error('Load an article before setting cover');
  currentPayload = await buildPayloadFromMarkdown(currentArticleInput.markdown, {
    sourcePath: currentArticleInput.sourcePath || null,
    sourceDir: currentArticleInput.sourceDir || process.cwd(),
    sourceFileName: currentArticleInput.sourceFileName || 'pasted.md',
    coverOverride: coverOverride()
  });
  currentError = null;
  resetImportProgress({ phase: 'ready', status: 'idle' });
  return currentPayload;
}

async function loadFromPath(filePath) {
  const resolved = path.resolve(String(filePath || '').trim());
  if (!resolved || !fs.existsSync(resolved)) throw new Error('Markdown file not found: ' + resolved);
  const markdown = fs.readFileSync(resolved, 'utf-8');
  manualCover = null;
  currentArticleInput = {
    kind: 'path',
    markdown,
    sourcePath: resolved,
    sourceFileName: path.basename(resolved)
  };
  currentPayload = await buildPayloadFromMarkdown(markdown, {
    sourcePath: resolved,
    sourceFileName: path.basename(resolved)
  });
  currentSource = resolved;
  currentError = null;
  resetImportProgress({ phase: 'ready', status: 'idle' });
  return currentPayload;
}

async function loadFromMarkdown(markdown, sourceFileName = 'pasted.md') {
  if (!String(markdown || '').trim()) throw new Error('Markdown content is empty');
  manualCover = null;
  currentArticleInput = {
    kind: 'text',
    markdown: String(markdown),
    sourceFileName,
    sourceDir: process.cwd()
  };
  currentPayload = await buildPayloadFromMarkdown(String(markdown), {
    sourceFileName,
    sourceDir: process.cwd()
  });
  currentSource = sourceFileName || 'pasted.md';
  currentError = null;
  resetImportProgress({ phase: 'ready', status: 'idle' });
  return currentPayload;
}

function clearCurrentArticle() {
  currentPayload = null;
  currentSource = '';
  currentError = null;
  trigger.active = false;
  currentArticleInput = null;
  manualCover = null;
  resetImportProgress({ imageTotal: 0 });
}

function setManualCoverFromBody(body = {}) {
  if (!currentArticleInput) throw new Error('Load an article before setting cover');
  const mime = String(body.mime || '').trim().toLowerCase();
  const fileName = String(body.fileName || 'cover').trim() || 'cover';
  let base64 = String(body.base64 || '').trim();
  const dataUrl = /^data:([^;,]+);base64,(.+)$/i.exec(base64);
  const finalMime = dataUrl ? dataUrl[1].toLowerCase() : mime;
  if (dataUrl) base64 = dataUrl[2];
  if (!shared.isSupportedImageMime(finalMime)) throw new Error('Unsupported cover image type: ' + (finalMime || 'unknown'));
  const bytes = Buffer.byteLength(base64, 'base64');
  if (!bytes) throw new Error('Cover image is empty');
  if (bytes > 16 * 1024 * 1024) throw new Error('Cover image is too large');
  manualCover = {
    source: 'manual-cover:' + fileName,
    fileName,
    mime: finalMime,
    bytes,
    result: {
      ok: true,
      base64,
      mime: finalMime,
      fileName,
      bytes,
      source: 'manual-cover:' + fileName
    }
  };
  return manualCover;
}

function readJsonBody(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function openXEditor() {
  return new Promise((resolve) => {
    const target = 'https://x.com/compose/articles/new';
    const finish = (error) => resolve(error ? { ok: false, error: error.message } : { ok: true });
    if (process.platform === 'darwin') {
      execFile('open', ['-a', 'Google Chrome', target], (error) => {
        if (!error) return finish(null);
        execFile('open', [target], finish);
      });
      return;
    }
    if (process.platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', 'chrome', target], (error) => {
        if (!error) return finish(null);
        execFile('cmd', ['/c', 'start', '', target], finish);
      });
      return;
    }
    execFile('xdg-open', [target], finish);
  });
}

function dashboardHTML() {
  const ready = Boolean(currentPayload);
  const canClear = ready || Boolean(currentError) || trigger.active;
  const stats = payloadStats(currentPayload);
  const progress = importProgress || makeIdleProgress();
  const coverMode = currentPayload?.coverMode || 'none';
  const coverDisplay = manualCover
    ? `${manualCover.fileName} (${(manualCover.bytes / 1024).toFixed(0)} KB)`
    : (currentPayload?.cover || '');
  const lang = 'en';
  const modeKey = trigger.active ? 'statusAuto' : ready ? 'statusReady' : 'statusIdle';
  const modeLabel = trigger.active ? 'AUTO' : ready ? 'READY' : 'NO ARTICLE';
  const sourceLabel = currentSource ? escapeHtml(path.basename(currentSource)) : 'No article loaded';
  const title = ready ? escapeHtml(currentPayload.title || '(untitled)') : 'Load a Markdown article';
  const sourceDetail = currentSource ? escapeHtml(currentSource) : '';
  const errorHtml = currentError ? `<div class="toast error">${escapeHtml(currentError)}</div>` : '';
  const triggerBanner = trigger.active
    ? `<div class="toast warn"><span data-i18n="triggerPending">Auto import is armed. Open an X article editor to consume it.</span><button class="link-action" onclick="cancelTrigger()" data-i18n="cancelTrigger">Cancel</button></div>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>X Article Markdown Publisher</title>
<style>
  :root{--bg:#f6f3ee;--surface:#fffdf9;--surface-2:#f0ebe3;--line:#ded7cd;--text:#1f2428;--muted:#756f67;--soft:#9a9187;--accent:#2563eb;--accent-2:#0f766e;--danger:#dc2626;--warn:#b45309;--shadow:0 18px 48px rgba(64,52,38,.10)}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(circle at 10% -10%,#fff 0,#f7f3ec 38%,#efe9df 100%);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0}
  main{max-width:1240px;margin:0 auto;padding:16px 16px 16px}
  header{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:12px}
  h1{font-size:24px;line-height:1.1;margin:0 0 4px;font-weight:780}
  h2{font-size:16px;line-height:1.2;margin:0;color:var(--text)}
  h3{font-size:13px;margin:0 0 8px;color:var(--text)}
  p{margin:0;color:var(--muted);font-size:13px;line-height:1.42}
  button,.button{appearance:none;border:0;border-radius:7px;background:var(--accent);color:white;padding:8px 12px;font-size:13px;font-weight:720;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;transition:transform .16s ease,box-shadow .16s ease,background .16s ease}
  button:hover,.button:hover{transform:translateY(-1px);box-shadow:0 10px 22px rgba(37,99,235,.18)}
  button:active,.button:active{transform:translateY(0)}
  button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid rgba(37,99,235,.22);outline-offset:2px}
  button:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
  .secondary{background:#ebe6dd;color:#2f3438}.secondary:hover{box-shadow:0 8px 18px rgba(64,52,38,.12)}
  .ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}
  .success{background:var(--accent-2)}
  .danger-soft{background:#fee2e2;color:#991b1b}.danger-soft:hover{box-shadow:0 8px 18px rgba(153,27,27,.12)}
  .page-head{max-width:620px}
  .top-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end;flex-wrap:wrap}
  .lang{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface)}
  .lang button{border-radius:0;background:transparent;color:var(--muted);padding:6px 9px;min-height:30px}
  .lang button:hover{box-shadow:none}
  .lang button.active{background:var(--text);color:#fff}
  .status{display:inline-flex;align-items:center;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:760;background:#e8f4ee;color:#0f766e;border:1px solid #c8e4d9}
  .status[data-i18n="statusIdle"]{background:#f0ebe3;color:#776d62;border-color:#dfd7cc}
  .status[data-i18n="statusAuto"]{background:#e8f4ee;color:#0f766e;border-color:#c8e4d9}
  .hero{background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:12px 14px;box-shadow:0 10px 28px rgba(64,52,38,.08);margin-bottom:12px;display:grid;grid-template-columns:minmax(0,1fr) minmax(330px,520px) auto;gap:12px;align-items:center}
  .hero-top{min-width:0}
  .article-kicker{font-size:11px;font-weight:760;color:var(--accent-2);letter-spacing:0;margin-bottom:4px}
  .article-title{font-size:17px;font-weight:760;line-height:1.28;word-break:break-word}
  .source{margin-top:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--soft);word-break:break-all}
  .metrics{display:grid;grid-template-columns:repeat(3,minmax(96px,1fr));gap:8px;margin-top:0}
  .metric{background:#faf8f3;border:1px solid var(--line);border-radius:7px;padding:9px 10px;min-height:58px}
  .metric b{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:20px;line-height:1}
  .metric span{display:block;margin-top:4px;font-size:11px;color:var(--muted);line-height:1.25}
  .primary-flow{display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
  .primary-flow .button, .primary-flow button{white-space:nowrap}
  .workspace{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:12px;align-items:start}
  .panel{background:rgba(255,253,249,.86);border:1px solid var(--line);border-radius:9px;padding:14px}
  .panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
  .step-badge{width:24px;height:24px;border-radius:50%;background:var(--text);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;margin-right:8px}
  .tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;background:#ece6dc;border-radius:8px;padding:4px;margin-bottom:10px}
  .tab{background:transparent;color:var(--muted);border-radius:6px;min-height:32px;box-shadow:none}
  .tab:hover{box-shadow:none}
  .tab.active{background:var(--surface);color:var(--text);box-shadow:0 4px 14px rgba(64,52,38,.10)}
  label{display:block;font-size:12px;font-weight:700;color:#4a4641;margin:0 0 6px}
  .control-row{display:flex;gap:8px;align-items:center}
  input[type=text],textarea{width:100%;background:#fff;border:1px solid var(--line);border-radius:7px;color:var(--text);padding:9px 10px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
  textarea{height:190px;min-height:160px;resize:vertical;line-height:1.45}
  .hint{margin-top:7px;font-size:12px;color:var(--soft);line-height:1.35}
  .source-panel{min-height:154px;display:flex;flex-direction:column}
  .source-panel[data-source-panel="paste"]{min-height:260px}
  .source-panel[hidden]{display:none}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  .file-card{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;border:1px dashed #cfc5b8;border-radius:8px;padding:9px 12px;transition:border-color .16s ease,background .16s ease}
  .file-card.drag{border-color:var(--accent);background:#eff6ff}
  .file-card strong{font-size:13px}
  .file-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.25;color:var(--soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .action-line{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:auto;padding-top:10px}
  .toast{display:flex;align-items:center;justify-content:space-between;gap:12px;border-radius:9px;padding:11px 12px;margin-bottom:14px;font-size:13px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8}
  .toast.error{background:#fef2f2;color:#991b1b;border-color:#fecaca}
  .toast.warn{background:#fff7ed;color:#9a3412;border-color:#fed7aa}
  .link-action{background:transparent;color:inherit;border:1px solid currentColor;min-height:30px;padding:5px 9px;box-shadow:none}
  .link-action:hover{box-shadow:none}
  .side-stack{display:grid;gap:10px}
  .send-actions{display:grid;gap:8px;margin-top:12px}
  .send-actions button{width:100%}
  .checklist{display:grid;gap:6px;margin-top:10px}
  .check{display:grid;grid-template-columns:18px minmax(0,1fr);gap:7px;align-items:start;color:var(--muted);font-size:12px;line-height:1.35}
  .dot{width:18px;height:18px;border-radius:50%;background:#e8f4ee;color:#0f766e;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:900}
  .progress-card{margin-top:9px;background:#faf8f3;border:1px solid var(--line);border-radius:7px;padding:10px}
  .progress-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .progress-phase{font-weight:760;font-size:14px}
  .progress-count{font:760 13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent-2);white-space:nowrap}
  .progress-track{height:6px;background:#ebe6dd;border-radius:999px;overflow:hidden;margin-top:8px}
  .progress-bar{height:100%;width:0%;background:var(--accent);border-radius:999px;transition:width .25s ease,background .2s ease}
  .progress-message{margin-top:7px;font-size:12px;color:var(--muted);line-height:1.35;word-break:break-word}
  .cover-drop{margin-top:9px;border:1px dashed #cfc5b8;border-radius:7px;background:#fff;padding:10px;min-height:58px;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);font-size:12px;line-height:1.35;transition:border-color .16s ease,background .16s ease}
  .cover-drop.drag{border-color:var(--accent);background:#eff6ff;color:#1d4ed8}
  .cover-meta{margin-top:8px;font-size:11px;color:var(--muted);word-break:break-all;max-height:36px;overflow:hidden}
  .cover-inline{border-top:1px solid var(--line);margin-top:12px;padding-top:12px;display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:12px;align-items:start}
  .cover-inline .cover-drop{margin-top:0;min-height:66px}
  .cover-inline .advanced-actions{margin-top:8px}
  details{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}
  summary{cursor:pointer;font-weight:760;font-size:13px;color:var(--text);list-style:none}
  summary::-webkit-details-marker{display:none}
  .help{margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:12px;line-height:1.4}
  .script{height:82px;font-size:11px;margin-top:7px}
  .advanced-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .muted{color:var(--muted)}
  #result{display:none;margin-top:12px}
  @media (max-width:1040px){.hero{grid-template-columns:1fr}.workspace{grid-template-columns:1fr}.side-stack{grid-template-columns:repeat(2,minmax(0,1fr))}.side-stack .panel:first-child{grid-column:1/-1}.cover-inline{grid-template-columns:1fr}}
  @media (max-width:720px){main{padding:12px 10px 24px}header{display:block}.top-actions{justify-content:flex-start;margin-top:10px}.primary-flow{justify-content:flex-start}.metrics{grid-template-columns:1fr}.tabs{grid-template-columns:1fr}.control-row{display:grid}.side-stack{grid-template-columns:1fr}.source-panel,.source-panel[data-source-panel="paste"]{min-height:auto}}
</style></head><body><main>
<header>
  <div class="page-head">
    <h1>X Article Markdown Publisher</h1>
    <p data-i18n="subtitle">A focused workspace for preparing one Markdown article and sending it to X Articles.</p>
  </div>
  <div class="top-actions">
    <div class="lang" role="group" aria-label="Language">
      <button type="button" data-lang="zh">中文</button>
      <button type="button" data-lang="en">EN</button>
    </div>
    <span class="status" data-i18n="${modeKey}">${modeLabel}</span>
  </div>
</header>
${errorHtml}
${triggerBanner}
<section class="hero">
  <div class="hero-top">
    <div>
      <div class="article-kicker" data-i18n="currentArticle">Current article</div>
      <div class="article-title" data-ready-title="${escapeHtml(ready ? currentPayload.title || '(untitled)' : '')}" data-i18n="${ready ? '' : 'loadTitle'}">${title}</div>
      <p class="source" title="${sourceDetail}" ${currentSource ? '' : 'data-i18n="noSource"'}>${sourceLabel}</p>
    </div>
  </div>
  <div class="metrics">
    <div class="metric"><b>${stats.textBlocks}</b><span data-i18n="metricText">text blocks</span></div>
    <div class="metric"><b>${stats.imageCount}</b><span data-i18n="metricImages">X uploads</span></div>
    <div class="metric"><b>${stats.scriptSize} KB</b><span data-i18n="metricScript">inject script</span></div>
  </div>
  <div class="primary-flow">
    <button ${canClear ? '' : 'disabled'} class="danger-soft" data-i18n="clearArticle" onclick="clearArticle()">Clear article</button>
    <button class="ghost" data-i18n="refresh" onclick="location.reload()">Refresh</button>
  </div>
</section>

<div class="workspace">
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2><span class="step-badge">1</span><span data-i18n="loadArticle">Load article</span></h2>
        <p data-i18n="loadHelp">Choose one source. Local path is best for local images.</p>
      </div>
    </div>
    <div class="tabs" role="tablist" aria-label="Source type">
      <button class="tab active" type="button" data-source-tab="path" data-i18n="tabPath">Local path</button>
      <button class="tab" type="button" data-source-tab="file" data-i18n="tabFile">Drop file</button>
      <button class="tab" type="button" data-source-tab="paste" data-i18n="tabPaste">Paste text</button>
    </div>
    <div class="source-panel" data-source-panel="path">
      <label for="pathInput" data-i18n="pathLabel">Local Markdown path</label>
      <div class="control-row">
        <input id="pathInput" type="text" placeholder="/Users/you/article.md">
      </div>
      <p class="hint" data-i18n="pathHint">Use this when the article references local images relative to the Markdown file. Browsers cannot reveal the full path of a dragged file.</p>
      <div class="action-line"><button data-i18n="loadPath" onclick="loadPath()">Load from local path</button></div>
    </div>
    <div class="source-panel" data-source-panel="file" hidden>
      <label data-i18n="fileLabel">Markdown file</label>
      <input id="fileInput" class="sr-only" type="file" accept=".md,.markdown,.mdown,.mkd,.txt">
      <div id="fileDrop" class="file-card" tabindex="0">
        <div>
          <strong data-i18n="fileCardTitle">Drop or choose a Markdown file</strong>
          <div id="fileName" class="file-name" data-i18n="fileEmpty">No file selected</div>
        </div>
        <label for="fileInput" class="button secondary" data-i18n="chooseFileButton">Choose file</label>
      </div>
      <p class="hint" data-i18n="fileHint">Loads file content immediately. Remote image links and data images work here; relative local images need local path mode.</p>
    </div>
    <div class="source-panel" data-source-panel="paste" hidden>
      <label for="mdText" data-i18n="pasteLabel">Markdown text</label>
      <textarea id="mdText" data-placeholder-en="# Title&#10;&#10;Markdown with image links..." data-placeholder-zh="# 标题&#10;&#10;粘贴带图片链接的 Markdown..." placeholder="# Title&#10;&#10;Markdown with image links..."></textarea>
      <div class="action-line">
        <button data-i18n="loadText" onclick="loadText()">Load pasted text</button>
        <button class="secondary" data-i18n="clear" onclick="document.getElementById('mdText').value=''">Clear</button>
      </div>
    </div>
    <div class="cover-inline">
      <div>
        <h3 data-i18n="coverTitle">Cover</h3>
        <p data-i18n="coverHelp">Optional. Use manual upload or Markdown frontmatter to set a cover.</p>
        <div class="cover-meta">
          <strong data-i18n="coverModeLabel">Mode</strong>: <span id="coverMode">${escapeHtml(coverMode)}</span><br>
          <span id="coverValue">${escapeHtml(coverDisplay || 'No cover')}</span>
        </div>
      </div>
      <div>
        <input id="coverInput" class="sr-only" type="file" accept="image/*">
        <div id="coverDrop" class="cover-drop" tabindex="0">
          <span data-i18n="coverDrop">Drop, paste, or choose a cover image</span>
        </div>
        <div class="advanced-actions">
          <label for="coverInput" class="button secondary" data-i18n="chooseCover">Choose cover</label>
          <button ${manualCover ? '' : 'disabled'} class="secondary" data-i18n="clearCover" onclick="clearCover()">Clear cover</button>
        </div>
      </div>
    </div>
    <div id="result" class="notice" style="display:none"></div>
  </section>

  <aside class="side-stack">
    <section class="panel">
      <h2><span class="step-badge">2</span><span data-i18n="sendTitle">Send to X</span></h2>
      <div class="checklist">
        <div class="check"><span class="dot">✓</span><span data-i18n="checkLoad">Load one Markdown source.</span></div>
        <div class="check"><span class="dot">✓</span><span data-i18n="checkOpen">Open an X article editor.</span></div>
        <div class="check"><span class="dot">✓</span><span data-i18n="checkImport">Click the extension button, or use the primary action above.</span></div>
      </div>
      <div class="send-actions">
        <button ${ready ? '' : 'disabled'} class="success" data-i18n="primaryImport" onclick="runImportFlow()">Open X and import</button>
      </div>
      <p class="hint" style="margin-top:14px"><span data-i18n="portPrefix">Port</span> ${PORT}. <span data-i18n="keepServer">Keep this service running during import.</span></p>
      <div class="progress-card">
        <div class="progress-row">
          <div>
            <div id="progressPhase" class="progress-phase">Idle</div>
            <div id="progressUpdated" class="hint" style="margin-top:3px">--</div>
          </div>
          <div id="progressCount" class="progress-count">0/0</div>
        </div>
        <div class="progress-track"><div id="progressBar" class="progress-bar"></div></div>
        <div id="progressMessage" class="progress-message">${escapeHtml(progress.message || '')}</div>
      </div>
    </section>
    <section class="panel">
      <h2 data-i18n="diagnostics">Diagnostics</h2>
      <p data-i18n="diagnosticsHelp">Only use these when the normal flow fails.</p>
      <details>
        <summary data-i18n="advancedSummary">Advanced controls</summary>
      <ul class="help">
        <li data-i18n="copyHelp">Copy Script copies a full injection script for DevTools Console. Use it only when the extension button cannot inject.</li>
        <li data-i18n="disableHelp">Disable Trigger cancels pending auto-import after you clicked Enable Extension Trigger.</li>
      </ul>
      <label data-i18n="scriptLabel">Console fallback script</label>
      <textarea id="script" class="script" readonly data-i18n-placeholder="scriptLazy" placeholder="Script is fetched only when copied."></textarea>
      <div class="advanced-actions">
        <button ${ready ? '' : 'disabled'} data-i18n="copyScript" onclick="copyManualScript()">Copy Script</button>
        <button class="secondary" data-i18n="disableTrigger" onclick="fetch('/trigger?disable=1').then(()=>location.reload())">Disable Trigger</button>
      </div>
      </details>
    </section>
  </aside>
</div>
<script>
  const messages = {
    en: {
      subtitle: 'A focused workspace for preparing one Markdown article and sending it to X Articles.',
      currentArticle: 'Current article',
      loadTitle: 'Load a Markdown article',
      metricText: 'text blocks',
      metricImages: 'X uploads',
      metricScript: 'inject script',
      primaryImport: 'Open X and import',
      clearArticle: 'Clear article',
      clearArticleConfirm: 'Clear the current article from this server? This will not delete the Markdown file or change any X draft.',
      articleCleared: 'Current article cleared',
      refresh: 'Refresh',
      loadArticle: 'Load article',
      loadHelp: 'Choose one source. Local path is best for local images.',
      tabPath: 'Local path',
      tabFile: 'Drop file',
      tabPaste: 'Paste text',
      pathLabel: 'Local Markdown path',
      pathHint: 'Use this when the article references local images relative to the Markdown file. Browsers cannot reveal the full path of a dragged file.',
      fileLabel: 'Markdown file',
      fileCardTitle: 'Drop or choose a Markdown file',
      fileEmpty: 'No file selected',
      chooseFileButton: 'Choose file',
      fileHint: 'Loads file content immediately. Remote image links and data images work here; relative local images need local path mode.',
      pasteLabel: 'Markdown text',
      loadPath: 'Load from local path',
      loadFile: 'Load file',
      loadText: 'Load pasted text',
      clear: 'Clear',
      sendTitle: 'Send to X',
      checkLoad: 'Load one Markdown source.',
      checkOpen: 'Open an X article editor.',
      checkImport: 'Click the extension button, or use the primary action above.',
      coverTitle: 'Cover',
      coverHelp: 'Optional. Use manual upload or Markdown frontmatter to set a cover.',
      coverDrop: 'Drop, paste, or choose a cover image',
      chooseCover: 'Choose cover',
      clearCover: 'Clear cover',
      coverModeLabel: 'Mode',
      coverUploaded: 'Cover updated',
      coverCleared: 'Manual cover cleared',
      noCover: 'No cover',
      progressTitle: 'Import progress',
      progressHelp: 'Shows live status while the X editor is importing images.',
      progressIdle: 'No import running',
      progressReady: 'Article loaded. Import has not started.',
      progressNotStarted: 'Not started',
      progressUpdated: 'Updated ',
      progressNever: 'Not updated yet',
      phase_idle: 'Idle',
      phase_ready: 'Ready',
      phase_starting: 'Starting',
      phase_preparing: 'Preparing article',
      phase_title: 'Writing title',
      phase_writing_text: 'Writing text',
      phase_atomic: 'Inserting embeds',
      phase_uploading_images: 'Uploading images',
      phase_cover: 'Setting cover',
      phase_reordering: 'Reordering images',
      phase_cleanup: 'Cleaning placeholders',
      phase_unconfirmed: 'Import not confirmed',
      phase_done: 'Done',
      phase_error: 'Error',
      diagnostics: 'Diagnostics',
      diagnosticsHelp: 'Only use these when the normal flow fails.',
      advancedSummary: 'Advanced controls',
      copyHelp: 'Copy Script copies a full injection script for DevTools Console. Use it only when the extension button cannot inject.',
      disableHelp: 'Disable Trigger cancels pending auto-import after you clicked Enable Extension Trigger.',
      scriptLabel: 'Console fallback script',
      scriptLazy: 'Script is fetched only when copied.',
      copyScript: 'Copy Script',
      disableTrigger: 'Disable Trigger',
      portPrefix: 'Port',
      keepServer: 'Keep this service running during import.',
      done: 'Done',
      requestFailed: 'Request failed',
      loaded: 'Loaded: ',
      importArmed: 'Auto import is armed. X editor is opening.',
      untitled: '(untitled)',
      chooseFile: 'Choose a Markdown file first',
      scriptCopied: 'Script copied',
      scriptLoading: 'Preparing script...',
      noSource: 'No article loaded',
      statusAuto: 'AUTO',
      statusReady: 'READY',
      statusIdle: 'NO ARTICLE',
      triggerPending: 'Auto import is armed. Open an X article editor to consume it.',
      cancelTrigger: 'Cancel'
    },
    zh: {
      subtitle: '一个只处理一件事的工作台：准备 Markdown，然后发送到 X 文章。',
      currentArticle: '当前文章',
      loadTitle: '载入一篇 Markdown 文章',
      metricText: '文本块',
      metricImages: '将上传到 X 的图片',
      metricScript: '注入脚本',
      primaryImport: '打开 X 并自动导入',
      clearArticle: '清空文章',
      clearArticleConfirm: '清空当前 server 里的文章信息？这不会删除本地 Markdown 文件，也不会影响 X 里的草稿。',
      articleCleared: '当前文章信息已清空',
      refresh: '刷新',
      loadArticle: '载入文章',
      loadHelp: '三种来源任选一种。文章里有相对本机图片时优先用本地路径。',
      tabPath: '本地路径',
      tabFile: '拖拽文件',
      tabPaste: '粘贴文本',
      pathLabel: '本机 Markdown 路径',
      pathHint: '适合 Obsidian、Typora、本地笔记目录和相对本机图片。浏览器无法读取拖拽文件的完整本机路径。',
      fileLabel: 'Markdown 文件',
      fileCardTitle: '拖拽或选择 Markdown 文件',
      fileEmpty: '尚未选择文件',
      chooseFileButton: '选择文件',
      fileHint: '会立即读取文件内容。适合图床链接和 data 图片；相对本机图片请用本地路径。',
      pasteLabel: 'Markdown 文本',
      loadPath: '从本地路径载入',
      loadFile: '载入文件',
      loadText: '载入粘贴文本',
      clear: '清空',
      sendTitle: '发送到 X',
      checkLoad: '先载入一个 Markdown 来源。',
      checkOpen: '打开 X 文章编辑器。',
      checkImport: '点击扩展按钮，或使用上方主操作自动触发。',
      coverTitle: '封面',
      coverHelp: '可选。可通过手动上传或 Markdown frontmatter 指定封面；正文首图不会自动变成封面。',
      coverDrop: '拖拽、粘贴或选择封面图片',
      chooseCover: '选择封面',
      clearCover: '清除封面',
      coverModeLabel: '来源',
      coverUploaded: '封面已更新',
      coverCleared: '手动封面已清除',
      noCover: '无封面',
      progressTitle: '导入进度',
      progressHelp: 'X 编辑器导入图片时，这里会显示实时状态。',
      progressIdle: '暂无导入任务',
      progressReady: '文章已载入，尚未开始导入。',
      progressNotStarted: '未开始',
      progressUpdated: '更新于 ',
      progressNever: '尚未更新',
      phase_idle: '空闲',
      phase_ready: '已就绪',
      phase_starting: '开始导入',
      phase_preparing: '准备文章',
      phase_title: '写入标题',
      phase_writing_text: '写入正文',
      phase_atomic: '插入嵌入块',
      phase_uploading_images: '上传图片',
      phase_cover: '设置封面',
      phase_reordering: '整理图片位置',
      phase_cleanup: '清理占位符',
      phase_unconfirmed: '未确认完成状态',
      phase_done: '完成',
      phase_error: '错误',
      diagnostics: '诊断',
      diagnosticsHelp: '正常流程失败时再使用这里。',
      advancedSummary: '高级控制',
      copyHelp: 'Copy Script 会复制一段完整注入脚本，用于 DevTools Console 手动执行。只有扩展按钮无法导入时才需要。',
      disableHelp: 'Disable Trigger 会取消待执行的自动导入；它只影响你点过“启用扩展自动导入”后的待触发状态。',
      scriptLabel: '控制台兜底脚本',
      scriptLazy: '脚本只在复制时按需加载。',
      copyScript: '复制脚本',
      disableTrigger: '取消自动导入触发',
      portPrefix: '端口',
      keepServer: '导入期间请保持这个服务运行。',
      done: '已完成',
      requestFailed: '请求失败',
      loaded: '已载入：',
      importArmed: '已启用自动导入，正在打开 X 编辑器。',
      untitled: '（无标题）',
      chooseFile: '请先选择一个 Markdown 文件',
      scriptCopied: '脚本已复制',
      scriptLoading: '正在准备脚本...',
      noSource: '尚未载入文章',
      statusAuto: '自动导入已启用',
      statusReady: '已就绪',
      statusIdle: '未载入文章',
      triggerPending: '自动导入已启用。打开 X 文章编辑器后会消费这次触发。',
      cancelTrigger: '取消'
    }
  };
  let currentLang = localStorage.getItem('xarticle-lang') || ((navigator.language || '').startsWith('zh') ? 'zh' : '${lang}');
  let latestImportProgress = ${JSON.stringify(progress)};
  function t(key) { return (messages[currentLang] && messages[currentLang][key]) || messages.en[key] || key; }
  function setLang(next) {
    currentLang = next === 'zh' ? 'zh' : 'en';
    localStorage.setItem('xarticle-lang', currentLang);
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key);
    });
    const md = document.getElementById('mdText');
    if (md) md.placeholder = md.getAttribute(currentLang === 'zh' ? 'data-placeholder-zh' : 'data-placeholder-en');
    const script = document.getElementById('script');
    if (script) script.placeholder = t('scriptLazy');
    document.querySelectorAll('[data-lang]').forEach((btn) => btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLang));
    renderImportProgress(latestImportProgress);
  }
  document.querySelectorAll('[data-lang]').forEach((btn) => btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang'))));
  document.querySelectorAll('[data-source-tab]').forEach((btn) => btn.addEventListener('click', () => setSourceMode(btn.getAttribute('data-source-tab'))));
  document.getElementById('fileInput')?.addEventListener('change', () => {
    const file = document.getElementById('fileInput').files[0];
    const name = document.getElementById('fileName');
    if (name) name.textContent = file ? file.name : t('fileEmpty');
    if (file) loadFile(file);
  });
  const fileDrop = document.getElementById('fileDrop');
  if (fileDrop) {
    fileDrop.addEventListener('dragover', (e) => { e.preventDefault(); fileDrop.classList.add('drag'); });
    fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('drag'));
    fileDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      fileDrop.classList.remove('drag');
      const file = Array.from(e.dataTransfer?.files || []).find((f) => /\\.(md|markdown|mdown|mkd|txt)$/i.test(f.name || '') || String(f.type || '').startsWith('text/'));
      if (!file) return showMessage(t('chooseFile'), true);
      const name = document.getElementById('fileName');
      if (name) name.textContent = file.name || t('fileEmpty');
      loadFile(file);
    });
  }
  const coverInput = document.getElementById('coverInput');
  const coverDrop = document.getElementById('coverDrop');
  coverInput?.addEventListener('change', () => {
    const file = coverInput.files[0];
    if (file) uploadCoverFile(file);
    coverInput.value = '';
  });
  if (coverDrop) {
    coverDrop.addEventListener('dragover', (e) => { e.preventDefault(); coverDrop.classList.add('drag'); });
    coverDrop.addEventListener('dragleave', () => coverDrop.classList.remove('drag'));
    coverDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      coverDrop.classList.remove('drag');
      const file = Array.from(e.dataTransfer?.files || []).find((f) => f.type.startsWith('image/'));
      if (file) uploadCoverFile(file);
    });
    coverDrop.addEventListener('paste', (e) => {
      const file = Array.from(e.clipboardData?.files || []).find((f) => f.type.startsWith('image/'));
      if (file) uploadCoverFile(file);
    });
  }
  const result = document.getElementById('result');
  function showMessage(text, isError) {
    result.style.display = 'block';
    result.className = 'toast' + (isError ? ' error' : '');
    result.textContent = text;
  }
  function setSourceMode(mode) {
    const next = ['path', 'file', 'paste'].includes(mode) ? mode : 'path';
    localStorage.setItem('xarticle-source-mode', next);
    document.querySelectorAll('[data-source-tab]').forEach((btn) => btn.classList.toggle('active', btn.getAttribute('data-source-tab') === next));
    document.querySelectorAll('[data-source-panel]').forEach((panel) => { panel.hidden = panel.getAttribute('data-source-panel') !== next; });
  }
  async function postJSON(path, body) {
    const resp = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + resp.status));
    return data;
  }
  async function showResult(resp) {
    const data = await resp.json().catch(() => ({}));
    showMessage(data.ok ? t('done') : (data.error || t('requestFailed')), !data.ok);
  }
  async function runImportFlow() {
    try {
      await postJSON('/publish', {});
      await fetch('/open-x', { method: 'POST' }).then(showResult);
      showMessage(t('importArmed'));
      setTimeout(() => location.reload(), 650);
    } catch (e) { showMessage(e.message, true); }
  }
  async function cancelTrigger() {
    await fetch('/trigger?disable=1').catch(() => {});
    location.reload();
  }
  async function clearArticle() {
    if (!window.confirm(t('clearArticleConfirm'))) return;
    try {
      await postJSON('/clear', {});
      showMessage(t('articleCleared'));
      setTimeout(() => location.reload(), 350);
    } catch (e) { showMessage(e.message, true); }
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(reader.error || new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }
  async function uploadCoverFile(file) {
    try {
      if (!file || !file.type.startsWith('image/')) throw new Error('Choose an image file');
      const base64 = await fileToBase64(file);
      const data = await postJSON('/cover', { fileName: file.name || 'cover', mime: file.type, base64 });
      showMessage(t('coverUploaded'));
      setTimeout(() => location.reload(), 450);
    } catch (e) { showMessage(e.message, true); }
  }
  async function clearCover() {
    try {
      await postJSON('/cover/clear', {});
      showMessage(t('coverCleared'));
      setTimeout(() => location.reload(), 350);
    } catch (e) { showMessage(e.message, true); }
  }
  async function copyManualScript() {
    try {
      showMessage(t('scriptLoading'));
      const resp = await fetch('/manual-script');
      const scriptText = await resp.text();
      if (!resp.ok) throw new Error(scriptText || ('HTTP ' + resp.status));
      await navigator.clipboard.writeText(scriptText);
      const script = document.getElementById('script');
      if (script) script.value = scriptText.slice(0, 12000) + (scriptText.length > 12000 ? '\\n\\n/* Script copied. Preview truncated for dashboard performance. */' : '');
      showMessage(t('scriptCopied'));
    } catch (e) { showMessage(e.message, true); }
  }
  function phaseLabel(phase) {
    return t('phase_' + String(phase || 'idle')) || t('phase_idle');
  }
  function renderImportProgress(progress) {
    latestImportProgress = progress || {};
    const total = Math.max(0, Number(latestImportProgress.imageTotal) || 0);
    const ok = Math.max(0, Number(latestImportProgress.imageOk) || 0);
    const fail = Math.max(0, Number(latestImportProgress.imageFail) || 0);
    const current = Math.max(0, Math.min(total, Number(latestImportProgress.imageIndex) || ok + fail));
    const completed = Math.max(current, Math.min(total, ok + fail));
    const pct = total ? Math.round((completed / total) * 100) : (latestImportProgress.phase === 'done' ? 100 : 0);
    const status = String(latestImportProgress.status || 'idle');
    const phase = String(latestImportProgress.phase || 'idle');
    const isRunning = status === 'running';
    const isWarning = status === 'warning';
    const width = total
      ? (isRunning && completed === 0 ? 5 : pct)
      : (phase === 'done' ? 100 : 0);
    const phaseEl = document.getElementById('progressPhase');
    const countEl = document.getElementById('progressCount');
    const barEl = document.getElementById('progressBar');
    const msgEl = document.getElementById('progressMessage');
    const updatedEl = document.getElementById('progressUpdated');
    if (!phaseEl || !countEl || !barEl || !msgEl || !updatedEl) return;
    phaseEl.textContent = phaseLabel(phase);
    countEl.textContent = total ? completed + '/' + total : t('progressNotStarted');
    countEl.style.color = status === 'error' ? '#b91c1c' : status === 'done' ? '#0f766e' : isWarning ? '#b45309' : '#2563eb';
    barEl.style.width = Math.max(0, Math.min(100, width)) + '%';
    barEl.style.background = status === 'error' ? '#dc2626' : status === 'done' ? '#0f766e' : isWarning ? '#f59e0b' : '#2563eb';
    const rawMessage = String(latestImportProgress.message || '');
    msgEl.textContent = phase === 'ready' && (!rawMessage || rawMessage === 'Article ready')
      ? t('progressReady')
      : (rawMessage || t('progressIdle'));
    updatedEl.textContent = latestImportProgress.updatedAt
      ? t('progressUpdated') + new Date(latestImportProgress.updatedAt).toLocaleTimeString()
      : t('progressNever');
  }
  async function pollImportProgress() {
    try {
      const resp = await fetch('/progress');
      const data = await resp.json();
      renderImportProgress(data.progress || data);
    } catch {}
  }
  async function loadPath() {
    try {
      const filePath = document.getElementById('pathInput').value.trim();
      const data = await postJSON('/load-path', { path: filePath });
      showMessage(t('loaded') + (data.title || t('untitled')));
      setTimeout(() => location.reload(), 450);
    } catch (e) { showMessage(e.message, true); }
  }
  async function loadText() {
    try {
      const markdown = document.getElementById('mdText').value;
      const data = await postJSON('/load-text', { markdown, fileName: 'pasted.md' });
      showMessage(t('loaded') + (data.title || t('untitled')));
      setTimeout(() => location.reload(), 450);
    } catch (e) { showMessage(e.message, true); }
  }
  async function loadFile(fileArg) {
    try {
      const file = fileArg || document.getElementById('fileInput').files[0];
      if (!file) throw new Error(t('chooseFile'));
      const markdown = await file.text();
      const data = await postJSON('/load-text', { markdown, fileName: file.name });
      showMessage(t('loaded') + (data.title || t('untitled')));
      setTimeout(() => location.reload(), 450);
    } catch (e) { showMessage(e.message, true); }
  }
  setLang(currentLang);
  setSourceMode(localStorage.getItem('xarticle-source-mode') || 'path');
  pollImportProgress();
  setInterval(pollImportProgress, 2000);
</script>
</main></body></html>`;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = url.parse(req.url, true);
  const p = reqUrl.pathname;

  try {
    if (req.method === 'POST' && p === '/load-path') {
      const body = await readJsonBody(req);
      const payload = await loadFromPath(body.path);
      sendJson(res, 200, { ok: true, title: payload.title || '', source: currentSource, stats: payloadStats(payload) });
      return;
    }
    if (req.method === 'POST' && p === '/load-text') {
      const body = await readJsonBody(req);
      const payload = await loadFromMarkdown(body.markdown, body.fileName || 'pasted.md');
      sendJson(res, 200, { ok: true, title: payload.title || '', source: currentSource, stats: payloadStats(payload) });
      return;
    }
    if (req.method === 'POST' && p === '/open-x') {
      sendJson(res, 200, await openXEditor());
      return;
    }
    if (req.method === 'POST' && p === '/clear') {
      clearCurrentArticle();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && p === '/cover') {
      const body = await readJsonBody(req, 24 * 1024 * 1024);
      setManualCoverFromBody(body);
      const payload = await rebuildCurrentPayload();
      sendJson(res, 200, {
        ok: true,
        cover: payload.cover || '',
        coverMode: payload.coverMode || 'manual',
        stats: payloadStats(payload)
      });
      return;
    }
    if (req.method === 'POST' && p === '/cover/clear') {
      manualCover = null;
      const payload = await rebuildCurrentPayload();
      sendJson(res, 200, {
        ok: true,
        cover: payload.cover || '',
        coverMode: payload.coverMode || 'none',
        stats: payloadStats(payload)
      });
      return;
    }
    if (req.method === 'POST' && p === '/progress/reset') {
      sendJson(res, 200, { ok: true, progress: resetImportProgress() });
      return;
    }
    if (req.method === 'POST' && p === '/progress') {
      const body = await readJsonBody(req, 512 * 1024);
      sendJson(res, 200, { ok: true, progress: updateImportProgress(body) });
      return;
    }
    if (p === '/progress') {
      sendJson(res, 200, { ok: true, progress: importProgress });
      return;
    }
    if (p === '/payload') {
      if (!currentPayload) return sendJson(res, 409, { ok: false, ready: false, error: 'No article loaded' });
      sendJson(res, 200, currentPayload);
      return;
    }
    if (p === '/status') {
      const stats = payloadStats(currentPayload);
      const preview = (currentPayload?.plain || '').substring(0, 200).replace(/\n/g, ' ');
      sendJson(res, 200, {
        ok: true,
        ready: Boolean(currentPayload),
        error: currentError,
        title: currentPayload?.title || '',
        cover: currentPayload?.cover || null,
        coverMode: currentPayload?.coverMode || 'none',
        manualCover: manualCover ? { fileName: manualCover.fileName, mime: manualCover.mime, bytes: manualCover.bytes } : null,
        textBlocks: stats.textBlocks,
        imageCount: stats.imageCount,
        preview,
        source: currentSource,
        port: PORT,
        progress: importProgress
      });
      return;
    }
    if (p === '/engine') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(XPAGE_JS);
      return;
    }
    if (p === '/inject-script') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(currentPayload ? makeAutoInject(currentPayload) : makeInjectErrorScript('No article loaded in X Article Markdown Publisher server'));
      return;
    }
    if (p === '/manual-script') {
      if (!currentPayload) {
        res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('No article loaded');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(makeManualScript(currentPayload));
      return;
    }
    if (p === '/trigger') {
      if (reqUrl.query.disable === '1') trigger.active = false;
      sendJson(res, 200, trigger);
      return;
    }
    if (p === '/publish') {
      if (!currentPayload) return sendJson(res, 409, { ok: false, error: 'Load an article first' });
      trigger.active = true;
      sendJson(res, 200, { ok: true, message: 'Trigger activated. Open x.com/compose/articles/new', title: currentPayload.title });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardHTML());
  } catch (e) {
    currentError = e.message;
    sendJson(res, 500, { ok: false, error: e.message });
  }
});

(async () => {
  const auto = process.argv.includes('--auto');
  if (auto) trigger.active = true;

  if (mdPathArg) {
    try {
      await loadFromPath(mdPathArg);
    } catch (e) {
      currentError = e.message;
      console.error('Initial article load failed:', e.message);
    }
  }

  server.listen(PORT, () => {
    const stats = payloadStats(currentPayload);
    console.log('='.repeat(60));
    console.log('X Article Markdown Publisher Server');
    console.log(`   Port:    ${PORT}`);
    console.log(`   Article: ${currentSource ? path.basename(currentSource) : '(none loaded)'}`);
    console.log(`   Title:   ${currentPayload?.title || '(untitled)'}`);
    console.log(`   Images:  ${stats.imageCount}`);
    if (auto) console.log('   Mode:    AUTO-TRIGGER');
    console.log('='.repeat(60));
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`X editor:  https://x.com/compose/articles/new`);
  });
})();
