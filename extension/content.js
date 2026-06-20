/**
 * content.js v8 — X Article Markdown Publisher
 * 右上角浮动「载入文章」按钮，点击直接载入（无预览弹窗）。
 * 仅在文章编辑器页面（检测到 Draft.js 编辑器）显示，其他 X 页面一律不显示。
 */
(async function () {
  'use strict';

  const LOG = '[XArticleMD]';
  const SERVER = 'http://localhost:8765';
  let injecting = false;
  let latestProgress = null;
  let progressHideTimer = null;

  // ── Banner notification ──
  function showBanner(text, color = '#1d9bf0', duration = 6000) {
    const b = document.createElement('div');
    b.style.cssText = `position:fixed;top:54px;right:12px;background:${color};color:#fff;padding:10px 18px;border-radius:8px;font-family:-apple-system,sans-serif;font-size:14px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;max-width:380px;word-wrap:break-word`;
    b.textContent = text;
    document.body.appendChild(b);
    setTimeout(() => { b.style.opacity = '0'; setTimeout(() => b.remove(), 300); }, duration);
  }

  function phaseLabel(phase) {
    return ({
      starting: '准备导入',
      preparing: '准备文章',
      title: '写入标题',
      writing_text: '写入正文',
      atomic: '插入嵌入块',
      uploading_images: '上传图片',
      cover: '设置封面',
      reordering: '整理图片位置',
      cleanup: '清理占位符',
      unconfirmed: '未确认完成状态',
      done: '导入完成',
      error: '导入失败'
    })[phase] || '导入中';
  }

  function ensureProgressPanel() {
    let panel = document.getElementById('xarticle-progress-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'xarticle-progress-panel';
    panel.style.cssText = `
      position: fixed; top: 58px; right: 12px; z-index: 99997;
      width: min(320px, calc(100vw - 24px)); background: rgba(255,255,255,0.96); color: #0f1419;
      border: 1px solid rgba(15,20,25,0.10); border-radius: 10px;
      box-shadow: 0 10px 26px rgba(15,20,25,0.16);
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
      overflow: hidden;
      backdrop-filter: blur(10px);
      transition: opacity .25s ease;
    `;
    panel.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 12px 7px">
        <div style="min-width:0">
          <div id="xarticle-progress-title" style="font-size:13px;font-weight:760;line-height:1.25">导入中</div>
          <div id="xarticle-progress-detail" style="margin-top:2px;font-size:11px;color:#536471;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">正在准备...</div>
        </div>
        <div id="xarticle-progress-count" style="font:760 12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#0f766e;white-space:nowrap">0/0</div>
      </div>
      <div style="height:4px;background:#eff3f4;margin:0 12px 9px;border-radius:999px;overflow:hidden">
        <div id="xarticle-progress-bar" style="height:100%;width:0%;background:#0f766e;border-radius:999px;transition:width .25s ease,background .2s ease"></div>
      </div>
      <div id="xarticle-progress-note" style="padding:0 12px 10px;font-size:11px;color:#536471;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">保持页面打开。</div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  function updateProgressPanel(progress = {}) {
    latestProgress = { ...(latestProgress || {}), ...progress };
    const p = latestProgress;
    const panel = ensureProgressPanel();
    const total = Math.max(0, Number(p.imageTotal) || 0);
    const ok = Math.max(0, Number(p.imageOk) || 0);
    const fail = Math.max(0, Number(p.imageFail) || 0);
    const current = Math.max(0, Math.min(total, Number(p.imageIndex) || ok + fail));
    const completed = Math.max(current, Math.min(total, ok + fail));
    const percent = total ? Math.round((completed / total) * 100) : (p.phase === 'done' ? 100 : 8);
    const isError = p.status === 'error';
    const isWarning = p.status === 'warning';
    const isDone = p.status === 'done' || p.phase === 'done';
    const title = phaseLabel(p.phase);
    const message = p.message || '';
    const file = p.currentFileName ? `当前图片：${p.currentFileName}` : '';
    const keepOpenText = '请保持页面打开';

    panel.querySelector('#xarticle-progress-title').textContent = title;
    panel.querySelector('#xarticle-progress-detail').textContent = /^retrying/i.test(message)
      ? message
      : (file || message || '正在处理文章...');
    panel.querySelector('#xarticle-progress-count').textContent = total ? `${completed}/${total}` : '--';
    panel.querySelector('#xarticle-progress-count').style.color = isError ? '#b91c1c' : isDone ? '#0f766e' : isWarning ? '#b45309' : '#1d4ed8';
    const bar = panel.querySelector('#xarticle-progress-bar');
    const width = total ? ((p.status === 'running' && completed === 0) ? 5 : percent) : (isDone ? 100 : 0);
    bar.style.width = `${Math.max(0, Math.min(100, width))}%`;
    bar.style.background = isError ? '#dc2626' : isDone ? '#0f766e' : isWarning ? '#f59e0b' : '#1d9bf0';
    panel.querySelector('#xarticle-progress-note').textContent = total
      ? `成功 ${ok}，失败 ${fail}。${isDone ? '可检查后发布' : keepOpenText}`
      : (isDone ? '可检查后发布' : '正在写入正文');

    if (progressHideTimer) clearTimeout(progressHideTimer);
    if (isDone || isError || isWarning) {
      progressHideTimer = setTimeout(() => {
        panel.style.opacity = '0';
        setTimeout(() => panel.remove(), 300);
      }, isDone ? 12000 : 18000);
    } else {
      panel.style.opacity = '1';
    }
  }

  function reportProgress(progress) {
    if (!progress || typeof progress !== 'object') return;
    updateProgressPanel(progress);
    fetch(SERVER + '/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progress)
    }).catch(() => {});
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.source !== 'xarticle-md' || data.type !== 'progress') return;
    reportProgress(data.progress);
  });

  // ── 编辑器是否就绪（用于判断"是否在新建/编辑文章页"）──
  function editorReady() {
    const sels = [
      '[data-contents="true"] [contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"].public-DraftEditor-content'
    ];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 200 && r.height > 80) return true;
      }
    }
    return false;
  }

  // ── 创建右上角浮动按钮 ──
  function makeButton() {
    const btn = document.createElement('div');
    btn.id = 'xarticle-import-btn';
    btn.textContent = '载入文章';
    btn.setAttribute('role', 'button');
    btn.style.cssText = `
      position: fixed; top: 12px; right: 12px; z-index: 99998;
      background: #1d9bf0;
      color: #fff; padding: 7px 13px; border-radius: 999px;
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
      font-size: 12px; font-weight: 760;
      cursor: pointer; box-shadow: 0 6px 18px rgba(29,155,240,0.26);
      transition: transform 0.15s, box-shadow 0.15s; user-select: none;
    `;
    btn.onmouseenter = () => { btn.style.transform = 'scale(1.05)'; btn.style.boxShadow = '0 4px 12px rgba(29,155,240,0.5)'; };
    btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; btn.style.boxShadow = '0 2px 8px rgba(29,155,240,0.4)'; };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log(LOG, '🖱 「载入文章」被点击');
      handleImport();
    }, true);
    return btn;
  }

  // ── 仅在编辑器页显示按钮，其他页面移除 ──
  function syncButton() {
    const btn = document.getElementById('xarticle-import-btn');
    if (editorReady()) {
      if (!btn) {
        document.body.appendChild(makeButton());
        console.log(LOG, '✅ 载入按钮已显示（编辑器页）');
      }
    } else if (btn) {
      btn.remove();
    }
  }

  // ── 点击：检查服务 → 直接载入（无弹窗）──
  async function handleImport() {
    if (injecting) { updateProgressPanel(latestProgress || { status: 'running', phase: 'starting', message: '正在载入中...' }); return; }
    injecting = true;
    try {
      let status;
      try {
        const resp = await fetch(SERVER + '/status');
        status = await resp.json();
      } catch (e) {
        showBanner('❌ 无法连接本地发布服务 (localhost:8765) — 请先启动 server', '#f4212e');
        return;
      }
      if (!status || !status.ready) {
        showBanner('❌ 本地发布服务未就绪 — 请先载入文章', '#f4212e');
        return;
      }
      if (!editorReady()) {
        showBanner('❌ 未检测到编辑器 — 请在文章编辑页使用', '#f4212e');
        return;
      }
      await doInject();
    } catch (e) {
      console.error(LOG, 'handleImport error:', e && e.message);
      showBanner('❌ 载入出错: ' + (e && e.message), '#f4212e', 6000);
    } finally {
      injecting = false;
    }
  }

  async function doInject() {
    let status = null;
    try {
      const resp = await fetch(SERVER + '/status');
      status = await resp.json();
    } catch (e) {
      status = null;
    }
    const imageCount = Math.max(0, Number(status?.imageCount) || 0);
    latestProgress = null;
    await fetch(SERVER + '/progress/reset', { method: 'POST' }).catch(() => {});
    reportProgress({
      status: 'running',
      phase: 'starting',
      imageIndex: 0,
      imageTotal: imageCount,
      imageOk: 0,
      imageFail: 0,
      message: imageCount ? `准备上传 ${imageCount} 张图片` : '准备写入文章'
    });

    // 通过外部脚本注入（X 的 CSP 允许 localhost:*），加时间戳绕过缓存
    const script = document.createElement('script');
    script.src = SERVER + '/inject-script?t=' + Date.now();
    (document.head || document.documentElement).appendChild(script);

    const timeoutMs = Math.min(12 * 60 * 1000, Math.max(20000, 15000 + imageCount * 30000));
    const resultEl = await waitForResult(timeoutMs);
    if (resultEl) {
      try {
        const result = JSON.parse(resultEl.getAttribute('data-xarticle-result'));
        if (result.ok) {
          reportProgress({
            status: result.summary?.imgFail ? 'warning' : 'done',
            phase: 'done',
            imageIndex: imageCount,
            imageTotal: imageCount,
            imageOk: result.summary?.imgOk ?? latestProgress?.imageOk ?? 0,
            imageFail: result.summary?.imgFail ?? latestProgress?.imageFail ?? 0,
            message: result.summary?.imgFail ? '文章已载入，但有图片失败' : '文章已载入完成'
          });
          showBanner('✅ 文章已载入！检查内容后点 Publish 发布', '#00ba7c', 8000);
        } else {
          reportProgress({
            status: 'error',
            phase: 'error',
            imageTotal: imageCount,
            imageOk: result.summary?.imgOk ?? latestProgress?.imageOk ?? 0,
            imageFail: result.summary?.imgFail ?? latestProgress?.imageFail ?? 0,
            message: result.error || '未知错误'
          });
          showBanner('❌ 载入失败: ' + (result.error || '未知错误'), '#f4212e', 6000);
        }
      } catch (e) {
        showBanner('⚠️ 载入可能成功，请检查编辑器', '#ffa500', 5000);
      }
      resultEl.remove();
    } else {
      const serverProgress = await fetchServerProgress();
      const p = serverProgress || latestProgress || {};
      if (p.status === 'done' || p.phase === 'done') {
        reportProgress({
          ...p,
          status: 'done',
          phase: 'done',
          imageIndex: imageCount,
          imageTotal: imageCount,
          imageOk: p.imageOk ?? latestProgress?.imageOk ?? 0,
          imageFail: p.imageFail ?? latestProgress?.imageFail ?? 0,
          message: p.message || '文章已载入完成'
        });
        showBanner('✅ 文章已载入！检查内容后点 Publish 发布', '#00ba7c', 8000);
        return;
      }
      reportProgress({
        status: 'warning',
        phase: 'unconfirmed',
        imageIndex: p.imageIndex ?? latestProgress?.imageIndex ?? 0,
        imageTotal: imageCount,
        imageOk: p.imageOk ?? latestProgress?.imageOk ?? 0,
        imageFail: p.imageFail ?? latestProgress?.imageFail ?? 0,
        message: '未收到确认信号，请检查编辑器内容'
      });
      showBanner('⚠️ 未收到确认信号，请检查编辑器内容', '#ffa500', 5000);
    }
  }

  async function fetchServerProgress() {
    try {
      const resp = await fetch(SERVER + '/progress');
      const data = await resp.json();
      return data.progress || data;
    } catch {
      return null;
    }
  }

  async function waitForResult(timeoutMs) {
    const start = Date.now();
    let lastNoticeAt = 0;
    while (Date.now() - start < timeoutMs) {
      const resultEl = document.querySelector('[data-xarticle-result]');
      if (resultEl) return resultEl;
      if (Date.now() - lastNoticeAt > 45000) {
        lastNoticeAt = Date.now();
        updateProgressPanel(latestProgress || { status: 'running', phase: 'uploading_images', message: '正在写入文章/上传图片' });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  }

  // ── Lifecycle：持续根据是否在编辑器页来显示/隐藏按钮 ──
  setTimeout(syncButton, 1000);
  setInterval(syncButton, 800);

  console.log(LOG, '✅ Content script v8 ready — 仅编辑器页显示载入按钮');
})();
