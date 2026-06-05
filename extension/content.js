/**
 * content.js v6 — Hermes X Publisher
 * "Import button" UX: user clicks → sees preview → confirms → injects.
 * Replaces polling-based auto-inject with user-initiated flow.
 */
(async function () {
  'use strict';
  
  const LOG = '[Hermes]';
  const SERVER = 'http://localhost:8765';
  let injecting = false;
  
  // ── 1. Banner notification ──
  function showBanner(text, color = '#1d9bf0', duration = 6000) {
    const b = document.createElement('div');
    b.style.cssText = `position:fixed;top:12px;right:12px;background:${color};color:#fff;padding:10px 18px;border-radius:8px;font-family:-apple-system,sans-serif;font-size:14px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;max-width:380px;word-wrap:break-word`;
    b.textContent = text;
    document.body.appendChild(b);
    setTimeout(() => { b.style.opacity = '0'; setTimeout(() => b.remove(), 300); }, duration);
  }
  
  // ── 2. Floating import button ──
  function injectButton() {
    if (document.getElementById('hermes-import-btn')) return;
    
    const btn = document.createElement('div');
    btn.id = 'hermes-import-btn';
    btn.innerHTML = '📥 导入文章';
    btn.style.cssText = `
      position: fixed; top: 12px; right: 12px; z-index: 99998;
      background: linear-gradient(135deg, #1d9bf0, #0d8bd8);
      color: #fff; padding: 8px 16px; border-radius: 20px;
      font-family: -apple-system, sans-serif; font-size: 13px; font-weight: 600;
      cursor: pointer; box-shadow: 0 2px 8px rgba(29,155,240,0.4);
      transition: transform 0.15s, box-shadow 0.15s;
      user-select: none;
    `;
    btn.onmouseenter = () => { btn.style.transform = 'scale(1.05)'; btn.style.boxShadow = '0 4px 12px rgba(29,155,240,0.5)'; };
    btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; btn.style.boxShadow = '0 2px 8px rgba(29,155,240,0.4)'; };
    btn.onclick = handleImport;
    document.body.appendChild(btn);
    console.log(LOG, '✅ Import button ready');
  }
  
  // ── 3. Preview modal ──
  function showModal(status) {
    // Remove existing modal
    closeModal();
    
    const coverHtml = status.cover 
      ? `<div style="margin:8px 0;color:#71767b;font-size:12px">🖼 封面: ${status.cover}</div>`
      : '';
    
    const overlay = document.createElement('div');
    overlay.id = 'hermes-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,0.6); display: flex;
      align-items: center; justify-content: center;
      font-family: -apple-system, sans-serif;
    `;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
    
    overlay.innerHTML = `
      <div id="hermes-modal" style="
        background: #15202b; border-radius: 16px; width: 480px;
        max-width: 90vw; max-height: 80vh; overflow-y: auto;
        box-shadow: 0 16px 48px rgba(0,0,0,0.5); border: 1px solid #38444d;
        padding: 24px;
      ">
        <h2 style="color:#e1e8ed;font-size:18px;margin:0 0 20px">📄 导入 Hermes 文章</h2>
        
        <div style="background:#1e2732;border-radius:12px;padding:16px;margin-bottom:16px">
          <div style="color:#71767b;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">标题</div>
          <div style="color:#e1e8ed;font-size:15px;font-weight:600;margin-bottom:12px">${esc(status.title)}</div>
          
          ${coverHtml}
          
          <div style="color:#71767b;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">预览</div>
          <div style="color:#8b98a5;font-size:13px;line-height:1.6;white-space:pre-wrap">${esc(status.preview)}${status.preview.length >= 200 ? '...' : ''}</div>
        </div>
        
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;color:#71767b;font-size:12px">
          <span>📝 ${status.textBlocks} 段文字</span>
          <span>·</span>
          <span>🖼 ${status.imageCount} 张图片</span>
        </div>
        
        <div style="display:flex;gap:10px">
          <button id="hermes-cancel" style="
            flex:1; padding:10px; border-radius:20px; border:1px solid #38444d;
            background:transparent; color:#e1e8ed; font-size:14px; font-weight:600;
            cursor:pointer;
          ">取消</button>
          <button id="hermes-confirm" style="
            flex:2; padding:10px; border-radius:20px; border:none;
            background:#1d9bf0; color:#fff; font-size:14px; font-weight:600;
            cursor:pointer;
          ">✅ 导入到编辑器</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    document.getElementById('hermes-cancel').onclick = closeModal;
    document.getElementById('hermes-confirm').onclick = () => {
      closeModal();
      doInject();
    };
  }
  
  function closeModal() {
    const el = document.getElementById('hermes-modal-overlay');
    if (el) el.remove();
  }
  
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  
  // ── 4. Wait for editor ──
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
  
  async function waitForEditor(maxWait = 30000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (editorReady()) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }
  
  // ── 5. Main import flow ──
  async function handleImport() {
    if (injecting) { showBanner('⏳ 正在导入中...', '#1d9bf0', 3000); return; }
    
    try {
      // Fetch status
      const resp = await fetch(SERVER + '/status');
      const status = await resp.json();
      
      if (!status.ready) {
        showBanner('❌ Hermes 服务器未启动 — 请先在终端运行 publish-to-x.sh', '#f4212e');
        return;
      }
      
      // Show preview
      showModal(status);
      
    } catch (e) {
      console.error(LOG, 'handleImport error:', e.message);
      showBanner('❌ 无法连接 Hermes 服务器 (localhost:8765) — 请确认已运行 publish-to-x.sh', '#f4212e');
    }
  }
  
  async function doInject() {
    injecting = true;
    
    try {
      // Wait for editor
      if (!editorReady()) {
        showBanner('⏳ 等待编辑器就绪... 请点「New Article」创建文章', '#1d9bf0', 5000);
        const ready = await waitForEditor();
        if (!ready) {
          showBanner('❌ 未检测到编辑器 — 请先点「New Article」进入编辑模式', '#f4212e');
          injecting = false;
          return;
        }
      }
      
      showBanner('⏳ 正在导入文章...', '#1d9bf0');
      
      // Inject via external script (localhost:* allowed in X CSP)
      const script = document.createElement('script');
      script.src = SERVER + '/inject-script';
      (document.head || document.documentElement).appendChild(script);
      
      // Wait for execution
      await new Promise(r => setTimeout(r, 5000));
      
      // Read result from MAIN world
      const resultEl = document.querySelector('[data-hermes-result]');
      if (resultEl) {
        try {
          const result = JSON.parse(resultEl.getAttribute('data-hermes-result'));
          if (result.ok) {
            showBanner('✅ 文章已导入！检查内容后点 Publish 发布', '#00ba7c', 8000);
          } else {
            showBanner('❌ 导入失败: ' + (result.error || '未知错误'), '#f4212e', 6000);
          }
        } catch (e) {
          showBanner('⚠️ 导入可能成功，请检查编辑器', '#ffa500', 5000);
        }
        resultEl.remove();
      } else {
        showBanner('⚠️ 未收到确认信号，请检查编辑器内容', '#ffa500', 5000);
      }
      
    } catch (e) {
      console.error(LOG, 'doInject error:', e.message);
      showBanner('❌ 导入出错: ' + e.message, '#f4212e', 6000);
    }
    
    injecting = false;
  }
  
  // ── 6. Lifecycle ──
  let lastUrl = window.location.href;
  
  // Inject button when DOM is stable (wait for potential SPA nav)
  setTimeout(() => {
    injectButton();
  }, 1000);
  
  // Re-inject button on URL change (SPA navigation)
  setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      console.log(LOG, 'URL changed → re-injecting button');
      lastUrl = currentUrl;
      injecting = false;
      // Remove old button if any
      const oldBtn = document.getElementById('hermes-import-btn');
      if (oldBtn) oldBtn.remove();
      setTimeout(() => injectButton(), 2000); // Wait for new page to load
    }
  }, 800);
  
  console.log(LOG, '✅ Content script ready — import button mode');
})();
