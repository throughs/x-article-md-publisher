/**
 * xpage.js — Injected into X Articles page via page.evaluate()
 * Ported from xPoster's main-world.js (MIT licensed)
 *
 * This code runs INSIDE the X page context and has full access to:
 *   - DOM / contenteditable editor
 *   - React Fiber internals (__reactFiber$ keys)
 *   - Draft.js editor state
 *   - X's internal GraphQL endpoints
 *   - X's image upload handler (onFilesAdded)
 */

window.__xArticleWrite = async function(payload) {
  const LOG = '[xArticle]';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function articleIdFromUrl() {
    return location.href.match(/\/articles\/edit\/(\d+)/)?.[1] || null;
  }

  // ── Editor Discovery ──────────────────────────────────
  function findEditorElement() {
    const sel = '[data-contents="true"] [contenteditable="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"].public-DraftEditor-content, [contenteditable="true"]';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 200 && r.height > 80) return el;
    }
    return null;
  }

  function findDraftStateNode() {
    const editor = findEditorElement();
    if (!editor) return null;
    const fiberKey = Object.keys(editor).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (!fiberKey) return null;
    let fiber = editor[fiberKey];
    for (let d = 0; d < 80 && fiber; d++) {
      if (fiber.stateNode?.props?.editorState && typeof fiber.stateNode.props.onChange === 'function') {
        return fiber.stateNode;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function findOnFilesAdded() {
    const editor = findEditorElement();
    if (!editor) return null;
    const fiberKey = Object.keys(editor).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (!fiberKey) return null;
    let fiber = editor[fiberKey];
    for (let d = 0; d < 160 && fiber; d++) {
      const props = fiber.memoizedProps || fiber.stateNode?.props;
      if (typeof props?.onFilesAdded === 'function') return props.onFilesAdded;
      // Search children
      let child = fiber.child;
      for (let cd = 0; cd < 8 && child; cd++) {
        const cp = child.memoizedProps || child.stateNode?.props;
        if (typeof cp?.onFilesAdded === 'function') return cp.onFilesAdded;
        child = child.child;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function findDraftSampleBlock(draftNode) {
    const blockMap = draftNode?.props?.editorState?.getCurrentContent?.()?.getBlockMap?.();
    if (!blockMap?.find) return null;
    return blockMap.find(b => {
      const cl = b.getCharacterList?.();
      if (!cl) return false;
      const size = typeof cl.size === 'number' ? cl.size : cl.count?.() || 0;
      for (let i = 0; i < size; i++) {
        const ch = cl.get?.(i);
        if (ch?.set) return true;
      }
      return false;
    }) || null;
  }

  // When editor is empty, bootstrap by inserting a space so we have a character sample
  async function ensureSampleBlock(draftNode) {
    let sb = findDraftSampleBlock(draftNode);
    if (sb) return { draftNode, sampleBlock: sb };
    // Empty editor — insert a space, wait for React to re-render
    const editor = findEditorElement();
    if (editor) {
      editor.focus();
      document.execCommand('insertText', false, ' ');
    }
    const deadline = Date.now() + 1600;
    while (Date.now() < deadline) {
      await sleep(80);
      const latestNode = findDraftStateNode() || draftNode;
      sb = findDraftSampleBlock(latestNode);
      if (sb) return { draftNode: latestNode, sampleBlock: sb };
    }
    const fallback = findDraftStateNode() || draftNode;
    return { draftNode: fallback, sampleBlock: findDraftSampleBlock(fallback) };
  }

  // ── Draft.js Content Writing ──────────────────────────
  function draftInlineStyleName(style) {
    return { Bold: 'BOLD', Italic: 'ITALIC', Strikethrough: 'STRIKETHROUGH', Code: 'CODE' }[style] || style;
  }

  async function writeDraftBlocks(draftNode, blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return { ok: false, error: 'No blocks' };
    const ensured = await ensureSampleBlock(draftNode);
    draftNode = ensured.draftNode;
    const sampleBlock = ensured.sampleBlock;
    if (!sampleBlock) return { ok: false, error: 'No Draft.js sample block' };

    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    let contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    const CharacterList = sampleBlock.getCharacterList().constructor;
    let nextBlockMap = blockMap.constructor();
    const createdKeys = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i] || {};
      const text = String(block.text || '');
      const key = Math.random().toString(36).slice(2, 7) + i.toString(36);
      let charList = CharacterList();
      const entityRanges = new Map();

      // Create link entities
      for (const link of block.links || []) {
        const off = Number(link.offset) || 0;
        const len = Math.max(0, Number(link.length) || 0);
        if (!len || !link.url) continue;
        contentState = contentState.createEntity('LINK', 'MUTABLE', { url: String(link.url) });
        entityRanges.set(`${off}:${off + len}`, contentState.getLastCreatedEntityKey());
      }

      // Build character list with styles and entities
      const sampleChars = sampleBlock.getCharacterList();
      const sampleChar = sampleChars.first?.() || sampleChars.get?.(0);
      if (!sampleChar?.set) return { ok: false, error: 'No character sample' };

      for (let ci = 0; ci < text.length; ci++) {
        const styleNames = (block.inlineStyleRanges || [])
          .filter(r => ci >= r.offset && ci < r.offset + r.length)
          .map(r => draftInlineStyleName(r.style))
          .filter(Boolean);
        let entity = null;
        for (const [range, ek] of entityRanges) {
          const [s, e] = range.split(':').map(Number);
          if (ci >= s && ci < e) { entity = ek; break; }
        }
        let style = sampleChar.getStyle().clear();
        for (const sn of styleNames) style = style.add(sn);
        charList = charList.push(sampleChar.set('style', style).set('entity', entity));
      }

      const draftType = ({
        'header-one': 'header-one', 'header-two': 'header-two', 'header-three': 'header-three',
        'header-four': 'header-four', 'header-five': 'header-five', 'header-six': 'header-six',
        blockquote: 'blockquote', 'unordered-list-item': 'unordered-list-item',
        'ordered-list-item': 'ordered-list-item', unstyled: 'unstyled', 'code-block': 'code-block'
      })[block.type] || 'unstyled';

      const nextBlock = sampleBlock.merge({
        key, type: draftType, text, characterList: charList, depth: 0,
        data: sampleBlock.getData?.()?.clear?.() || sampleBlock.getData?.()
      });
      nextBlockMap = nextBlockMap.set(key, nextBlock);
      createdKeys.push(key);
    }

    if (!createdKeys.length) return { ok: false, error: 'No blocks created' };
    const lastKey = createdKeys[createdKeys.length - 1];
    const selection = SelectionState.createEmpty(lastKey);
    const nextContent = contentState
      .set('blockMap', nextBlockMap)
      .set('selectionBefore', selection)
      .set('selectionAfter', selection);
    let nextState = EditorState.push(editorState, nextContent, 'insert-fragment');
    nextState = EditorState.moveSelectionToEnd(nextState);
    draftNode.props.onChange(nextState);
    return { ok: true, blocks: createdKeys.length };
  }

  // ── Markers ───────────────────────────────────────────
  function markerTokenPattern(prefix) {
    const p = String(prefix || '__XPOSTER_').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(p + '[A-Z]+_\\d+__', 'g');
  }

  function findMarkerLocation(contentState, marker) {
    const needle = String(marker || '');
    if (!needle) return null;
    let best = null;
    contentState.getBlockMap().forEach((block, key) => {
      if (block.getType() === 'atomic') return;
      const text = block.getText() || '';
      const off = text.indexOf(needle);
      if (off < 0) return;
      const candidate = { blockKey: key, offset: off, length: needle.length, exact: text.trim() === needle };
      if (candidate.exact && !best) best = candidate;
      else if (!best) best = candidate;
    });
    return best;
  }

  function replaceMarkerText(draftNode, marker, text) {
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    const loc = findMarkerLocation(contentState, marker);
    if (!loc) return false;
    const block = blockMap.get(loc.blockKey);
    const replacement = String(text || '');
    const curText = block.getText() || '';
    const nextText = loc.exact ? replacement :
      curText.slice(0, loc.offset) + replacement + curText.slice(loc.offset + loc.length);
    if (!nextText.trim()) {
      // Delete block
      const nextBM = blockMap.delete(loc.blockKey);
      const lastKey = nextBM.last()?.getKey?.();
      const sel = lastKey ? SelectionState.createEmpty(lastKey) : editorState.getSelection();
      const nc = contentState.set('blockMap', nextBM).set('selectionBefore', sel).set('selectionAfter', sel);
      let ns = EditorState.push(editorState, nc, 'remove-range');
      ns = EditorState.moveSelectionToEnd(ns);
      draftNode.props.onChange(ns);
      return true;
    }
    const sampleChar = block.getCharacterList().first?.() || block.getCharacterList().get?.(0);
    const ch = sampleChar?.constructor ? sampleChar.constructor.create({}) : null;
    const chList = block.getCharacterList().clear().concat(Array(nextText.length).fill(ch));
    const nb = block.merge({ text: nextText, characterList: chList });
    const sel = SelectionState.createEmpty(loc.blockKey);
    const nc = contentState.set('blockMap', blockMap.set(loc.blockKey, nb))
      .set('selectionBefore', sel).set('selectionAfter', sel);
    draftNode.props.onChange(EditorState.push(editorState, nc, 'change-block-data'));
    return true;
  }

  function replaceMarkerWithAtomic(draftNode, marker, entityType, data, mutability) {
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const contentState = editorState.getCurrentContent();
    const sampleBlock = findDraftSampleBlock(draftNode);
    const blockKey = findMarkerLocation(contentState, marker)?.blockKey;
    if (!blockKey) return { ok: false, error: `Marker not found: ${marker}`, contentState };

    const block = contentState.getBlockMap().get(blockKey) || sampleBlock;
    const sampleChars = block.getCharacterList();
    const sampleChar = sampleChars.first?.() || sampleChars.get?.(0);
    if (!sampleChar?.set) return { ok: false, error: 'No character sample', contentState };

    const withEntity = contentState.createEntity(entityType, mutability || 'IMMUTABLE', data || {});
    const entityKey = withEntity.getLastCreatedEntityKey();
    const character = sampleChar.set('entity', entityKey);
    const CharacterList = sampleChars.constructor;
    const atomicBlock = block.merge({
      key: blockKey, type: 'atomic', text: ' ',
      characterList: CharacterList([character]), depth: 0
    });
    const blockMap = withEntity.getBlockMap().set(blockKey, atomicBlock);
    return { ok: true, entityKey, contentState: withEntity.set('blockMap', blockMap) };
  }

  function insertAtomicBatch(draftNode, operations) {
    if (!operations.length) return { ok: 0, fail: 0 };
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    let contentState = editorState.getCurrentContent();
    let ok = 0, errors = [];

    for (const item of operations) {
      const r = replaceMarkerWithAtomic(draftNode, item.marker, item.op.entityType, item.op.data || {}, item.op.mutability || 'IMMUTABLE');
      if (r.ok) { contentState = r.contentState; ok++; }
      else errors.push(r.error);
    }

    if (ok > 0) {
      const lastKey = contentState.getBlockMap().last().getKey();
      const sel = SelectionState.createEmpty(lastKey);
      const nc = contentState.set('selectionBefore', sel).set('selectionAfter', sel);
      let ns = EditorState.push(editorState, nc, 'insert-fragment');
      ns = EditorState.moveSelectionToEnd(ns);
      draftNode.props.onChange(ns);
    }
    return { ok, fail: errors.length, errors };
  }

  function cleanupMarkers(draftNode, markerPrefix) {
    const prefix = String(markerPrefix || '__XPOSTER_');
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    let blockMap = contentState.getBlockMap();
    const toDelete = [];
    const replacements = [];
    const mp = markerTokenPattern(prefix);

    blockMap.forEach((block, key) => {
      if (block.getType() === 'atomic') return;
      const text = block.getText() || '';
      const cleaned = text.replace(mp, '').replace(/\s{2,}/g, ' ').trim();
      if (!cleaned) toDelete.push(key);
      else if (cleaned !== text) replacements.push({ key, text: cleaned });
    });

    if (!toDelete.length && !replacements.length) return 0;

    for (const r of replacements) {
      const block = blockMap.get(r.key);
      if (!block) continue;
      const sampleChar = block.getCharacterList().first?.() || block.getCharacterList().get?.(0);
      const ch = sampleChar?.constructor ? sampleChar.constructor.create({}) : null;
      const chList = block.getCharacterList().clear().concat(Array(r.text.length).fill(ch));
      blockMap = blockMap.set(r.key, block.merge({ text: r.text, characterList: chList }));
    }
    for (const key of toDelete) blockMap = blockMap.delete(key);

    const lastKey = blockMap.last()?.getKey?.();
    const sel = lastKey ? SelectionState.createEmpty(lastKey) : editorState.getSelection();
    const nc = contentState.set('blockMap', blockMap).set('selectionBefore', sel).set('selectionAfter', sel);
    let ns = EditorState.push(editorState, nc, 'remove-range');
    ns = EditorState.moveSelectionToEnd(ns);
    draftNode.props.onChange(ns);
    return toDelete.length + replacements.length;
  }

  // ── Image Upload ──────────────────────────────────────
  function base64ToFile(b64, fileName, mime) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName, { type: mime });
  }

  // ── Place cursor at marker before upload (xPoster technique) ──
  function placeSelectionAtMarker(draftNode, marker) {
    const editorState = draftNode.props.editorState;
    const SelectionState = editorState.getSelection().constructor;
    const EditorState = editorState.constructor;
    const contentState = editorState.getCurrentContent();
    const location = findMarkerLocation(contentState, marker);
    if (!location) return null;
    const selection = SelectionState.createEmpty(location.blockKey).merge({
      anchorOffset: location.offset,
      focusOffset: location.offset
    });
    draftNode.props.onChange(EditorState.forceSelection(editorState, selection));
    return location;
  }

  async function uploadSingleImage(draftNode, imagePayload, marker, index, total) {
    const onFilesAdded = findOnFilesAdded();
    if (!onFilesAdded) return { ok: false, error: 'X upload handler not found' };

    const markerLoc = placeSelectionAtMarker(draftNode, marker);
    if (!markerLoc) return { ok: false, error: 'Marker not found in editor' };
    await sleep(80);

    // Track EXISTING media ENTITIES (not block keys — block keys change on React re-render)
    const beforeEntities = new Set();
    {
      const cs = draftNode.props.editorState.getCurrentContent();
      cs.getBlockMap().forEach((block) => {
        if (block.getType() !== 'atomic') return;
        block.findEntityRanges(
          (ch) => Boolean(ch.getEntity()),
          (start) => {
            const ek = block.getCharacterList().get(start)?.getEntity?.();
            if (!ek) return;
            try { if (cs.getEntity(ek).getType() === 'MEDIA') beforeEntities.add(ek); } catch {}
          }
        );
      });
    }

    let file;
    try { file = base64ToFile(imagePayload.base64, imagePayload.fileName, imagePayload.mime); }
    catch (e) { return { ok: false, error: `Invalid base64: ${e.message}` }; }

    try { onFilesAdded([file]); } catch (e) {
      return { ok: false, error: `Upload call failed: ${e.message}` };
    }

    // Wait for NEW media entity to appear (entity-key based, like xPoster)
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await sleep(350);
      draftNode = findDraftStateNode() || draftNode;
      if (!draftNode) continue;
      const cs = draftNode.props.editorState.getCurrentContent();
      let found = null;
      cs.getBlockMap().forEach((block, blockKey) => {
        if (found || block.getType() !== 'atomic') return;
        block.findEntityRanges(
          (ch) => Boolean(ch.getEntity()),
          (start) => {
            if (found) return;
            const ek = block.getCharacterList().get(start)?.getEntity?.();
            if (!ek || beforeEntities.has(ek)) return;
            try {
              if (cs.getEntity(ek).getType() !== 'MEDIA') return;
              const data = cs.getEntity(ek).getData();
              const mediaId = mediaIdFromData(data);
              found = { entityKey: ek, blockKey, mediaId };
            } catch {}
          }
        );
      });
      if (found?.mediaId) {
        return {
          ok: true,
          blockKey: found.blockKey,
          entityKey: found.entityKey,
          mediaId: found.mediaId,
          markerBlock: markerLoc.blockKey,
          markerOffset: markerLoc.offset,
          markerLength: markerLoc.length,
          markerExact: markerLoc.exact
        };
      }
    }
    return { ok: false, error: 'Upload timed out waiting for media entity' };
  }

  function mediaIdFromData(data) {
    const search = (d, depth) => {
      if (depth > 5 || d == null) return null;
      if (typeof d === 'string' && /^\d+$/.test(d.trim())) return d.trim();
      if (typeof d !== 'object') return null;
      const keys = ['mediaId', 'mediaID', 'media_id', 'media_id_string', 'mediaIdString', 'mediaKey', 'id_str', 'id', 'rest_id'];
      for (const k of keys) { if (d[k] && /^\d+/.test(String(d[k]))) return String(d[k]); }
      for (const v of Object.values(d)) { const r = search(v, depth + 1); if (r) return r; }
      return null;
    };
    return search(data, 0);
  }

  // ── Image Relocation ──────────────────────────────────
  function relocateImages(draftNode, uploads) {
    if (!uploads.length) return { moved: 0, missing: 0 };
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    const moves = new Map();
    let missing = 0;

    // Find marker locations
    for (const upload of uploads) {
      const loc = findMarkerLocation(contentState, upload.marker);
      console.log(LOG, 'relocateImages: marker', upload.marker, 'found:', !!loc, loc ? `block=${loc.blockKey} off=${loc.offset}` : 'NOT FOUND');
      if (loc) {
        upload.markerBlock = loc.blockKey;
      }
    }

    // Find all media atomic blocks with entity mapping
    const entityToBlock = new Map();
    const mediaBlocks = [];
    blockMap.forEach((block, key) => {
      if (block.getType() !== 'atomic') return;
      try {
        let firstEntity = null;
        block.findEntityRanges(
          (ch) => Boolean(ch.getEntity()),
          (start) => {
            const ek = block.getCharacterList().get(start)?.getEntity?.();
            if (ek) {
              firstEntity = firstEntity || ek;
              entityToBlock.set(ek, key);
            }
          }
        );
        if (firstEntity) {
          try {
            if (contentState.getEntity(firstEntity).getType() === 'MEDIA') {
              mediaBlocks.push({ blockKey: key, entityKey: firstEntity });
            }
          } catch {}
        }
      } catch {}
    });

    // Match markers to media blocks
    let fb = 0;
    for (const upload of uploads) {
      if (!upload.markerBlock || !blockMap.has(upload.markerBlock)) { 
        console.log(LOG, 'relocateImages: SKIP upload, markerBlock invalid', upload.markerBlock, 'has:', blockMap.has(upload.markerBlock));
        missing++; continue; 
      }
      let imgBlock = upload.blockKey && blockMap.has(upload.blockKey) ? upload.blockKey : null;
      if (!imgBlock && upload.entityKey) imgBlock = entityToBlock.get(upload.entityKey) || null;
      if (!imgBlock) {
        while (fb < mediaBlocks.length && Array.from(moves.values()).some(m => m.imageBlock === mediaBlocks[fb].blockKey)) fb++;
        if (fb < mediaBlocks.length) imgBlock = mediaBlocks[fb++].blockKey;
      }
      console.log(LOG, 'relocateImages: upload blockKey=', upload.blockKey, 'entityKey=', upload.entityKey, 'imgBlock=', imgBlock, 'markerBlock=', upload.markerBlock, 'same:', imgBlock === upload.markerBlock, 'mediaBlocks count:', mediaBlocks.length);
      if (!imgBlock) { missing++; continue; }
      if (imgBlock !== upload.markerBlock) {
        moves.set(upload.markerBlock, { imageBlock: imgBlock, markerExact: true });
      }
    }

    console.log(LOG, 'relocateImages: moves.size=', moves.size, 'missing=', missing);

    if (!moves.size) return { moved: 0, missing };

    // Reorder blocks
    const destBlocks = new Set(Array.from(moves.values()).map(m => m.imageBlock));
    const ordered = [];
    blockMap.forEach((block, key) => {
      if (moves.has(key)) {
        const m = moves.get(key);
        ordered.push(m.imageBlock);
        if (!m.markerExact) ordered.push(key);
      } else if (!destBlocks.has(key)) ordered.push(key);
    });

    let nextBM = blockMap.constructor();
    for (const k of ordered) nextBM = nextBM.set(k, blockMap.get(k));
    const sel = SelectionState.createEmpty(ordered[ordered.length - 1]);
    const nc = contentState.set('blockMap', nextBM).set('selectionBefore', sel).set('selectionAfter', sel);
    let ns = EditorState.push(editorState, nc, 'remove-range');
    ns = EditorState.moveSelectionToEnd(ns);
    draftNode.props.onChange(ns);
    return { moved: moves.size, missing };
  }

  // ── Title & Cover ─────────────────────────────────────
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function csrfToken() {
    return document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1] || '';
  }

  async function xGraphql(queryId, operationName, body) {
    const resp = await fetch(`https://x.com/i/api/graphql/${queryId}/${operationName}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'x-csrf-token': csrfToken(),
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session'
      },
      body: JSON.stringify(body)
    });
    let text = '';
    try { text = await resp.text(); } catch {}
    return { ok: resp.ok, status: resp.status, body: text.slice(0, 300) };
  }

  async function setTitleViaUi(title) {
    if (!title) return { ok: true, skipped: true };
    const editor = findEditorElement();
    const candidates = Array.from(document.querySelectorAll("input[type='text'], textarea, [contenteditable='true']"))
      .filter(el => el !== editor && isVisible(el));
    const titleWords = ['title', '标题', 'add title', '输入标题'];
    let best = null, score = -1;
    for (const el of candidates) {
      const haystack = [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('data-testid')]
        .filter(Boolean).join(' ').toLowerCase();
      const rect = el.getBoundingClientRect();
      let s = 0;
      if (titleWords.some(w => haystack.includes(w))) s += 10;
      if (rect.top < 420) s += 3;
      if (rect.width > 240) s += 2;
      if (s > score) { score = s; best = el; }
    }
    if (!best || score <= 0) return { ok: false, error: 'Title field not found' };

    if (best instanceof HTMLInputElement || best instanceof HTMLTextAreaElement) {
      const proto = best instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(best, String(title));
      best.dispatchEvent(new Event('input', { bubbles: true }));
      best.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      best.focus();
      await sleep(80);
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, String(title));
      best.dispatchEvent(new Event('input', { bubbles: true }));
      best.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true };
  }

  async function updateTitleGraphql(articleId, title) {
    return xGraphql('x75E2ABzm8_mGTg1bz8hcA', 'ArticleEntityUpdateTitle', {
      variables: { articleEntityId: articleId, title: String(title) },
      features: {
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true
      },
      queryId: 'x75E2ABzm8_mGTg1bz8hcA'
    });
  }

  async function updateCoverGraphql(articleId, mediaId) {
    return xGraphql('Es8InPh7mEkK9PxclxFAVQ', 'ArticleEntityUpdateCoverMedia', {
      variables: {
        articleEntityId: articleId,
        coverMedia: { media_id: String(mediaId), media_category: 'DraftTweetImage' }
      },
      features: {
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true
      },
      queryId: 'Es8InPh7mEkK9PxclxFAVQ'
    });
  }

  // ── Main Flow ─────────────────────────────────────────
  async function runFlow(p) {
    let draftNode = findDraftStateNode();
    if (!draftNode) return { ok: false, error: 'Draft.js editor not found. Are you on an X Article edit page?' };

    let articleId = p.articleId || articleIdFromUrl();
    const summary = {
      atomicOk: 0, atomicFail: 0,
      imgOk: 0, imgFail: 0,
      markersCleaned: 0,
      title: { requested: !!p.title, value: p.title || null, ui: null, graphql: null },
      cover: { requested: !!p.cover, source: p.cover || null, graphql: null }
    };

    try {
      // ── Title ──
      if (p.title) {
        console.log(LOG, 'Setting title...');
        const tr = await setTitleViaUi(p.title);
        summary.title.ui = tr;
        if (articleId) {
          const gr = await updateTitleGraphql(articleId, p.title);
          summary.title.graphql = gr;
        }
      }

      // ── Write blocks ──
      console.log(LOG, 'Writing content blocks...');
      const wr = await writeDraftBlocks(draftNode, p.blocks);
      if (!wr.ok) {
        // Fallback: paste HTML
        console.log(LOG, 'Block write failed, trying HTML paste...');
        const editor = findEditorElement();
        if (editor) {
          editor.focus();
          const dt = new DataTransfer();
          dt.setData('text/html', p.html);
          dt.setData('text/plain', p.plain);
          const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
          if (ev.clipboardData !== dt) Object.defineProperty(ev, 'clipboardData', { value: dt });
          editor.dispatchEvent(ev);
        }
      }
      await sleep(500);
      draftNode = findDraftStateNode() || draftNode;

      // ── Atomic blocks (tweets, code, dividers) ──
      const atomicOps = (p.plan || []).filter(item => item.op.type === 'atomic');
      if (atomicOps.length) {
        console.log(LOG, `Inserting ${atomicOps.length} atomic blocks...`);
        draftNode = findDraftStateNode() || draftNode;
        const ar = insertAtomicBatch(draftNode, atomicOps);
        summary.atomicOk = ar.ok;
        summary.atomicFail = ar.fail;
        await sleep(300);
      }

      // ── Images ──
      const imageOps = (p.plan || []).filter(item => item.op.type === 'image');
      const uploads = [];
      let coverUpload = null;

      for (let i = 0; i < imageOps.length; i++) {
        const op = imageOps[i];
        const imgPayload = (p.images || []).find(ip => ip.marker === op.marker);
        if (!imgPayload) {
          summary.imgFail++;
          replaceMarkerText(draftNode, op.marker, op.op.fallbackText || '[image unavailable]');
          continue;
        }

        console.log(LOG, `Uploading image ${i + 1}/${imageOps.length}...`);
        draftNode = findDraftStateNode() || draftNode;
        const ur = await uploadSingleImage(draftNode, imgPayload, op.marker, i + 1, imageOps.length);
        
        if (ur.ok) {
          summary.imgOk++;
          const upload = {
            marker: op.marker,
            blockKey: ur.blockKey,
            entityKey: ur.entityKey,
            markerBlock: ur.markerBlock,
            mediaId: ur.mediaId,
            source: imgPayload.source,
            coverOnly: !!imgPayload.coverOnly,
            settled: false
          };

          if (!upload.coverOnly) {
            // Relocate image to marker position
            await sleep(300);
            draftNode = findDraftStateNode() || draftNode;
            const relResult = relocateImages(draftNode, [upload]);
            // Refresh draftNode BEFORE marker cleanup (so it sees relocated state)
            if (relResult.moved) {
              await sleep(150);
              draftNode = findDraftStateNode() || draftNode;
            }
            if (!relResult.missing) replaceMarkerText(draftNode, op.marker, '');
            upload.settled = !relResult.missing;
          }

          uploads.push(upload);

          if (imgPayload.coverOnly && !coverUpload) coverUpload = upload;
          
          // Set cover if this image matches the cover
          if (p.cover && upload.source && imageSourcesMatch(upload.source, p.cover) && upload.mediaId && articleId) {
            coverUpload = upload;
            const cr = await updateCoverGraphql(articleId, upload.mediaId);
            summary.cover.graphql = cr;
          }
        } else {
          summary.imgFail++;
          replaceMarkerText(draftNode, op.marker, imgPayload.fallbackText || '[image upload failed]');
        }
        draftNode = findDraftStateNode() || draftNode;
      }

      // ── Cover-only block cleanup ──

      // ── Clean up cover-only block ──
      if (coverUpload?.coverOnly && coverUpload.blockKey) {
        await sleep(300);
        draftNode = findDraftStateNode() || draftNode;
        const editorState = draftNode.props.editorState;
        const EditorState = editorState.constructor;
        const contentState = editorState.getCurrentContent();
        if (contentState.getBlockMap().has(coverUpload.blockKey)) {
          const nextBM = contentState.getBlockMap().delete(coverUpload.blockKey);
          const lastKey = nextBM.last()?.getKey?.();
          const sel = lastKey ? editorState.getSelection().constructor.createEmpty(lastKey) : editorState.getSelection();
          const nc = contentState.set('blockMap', nextBM).set('selectionBefore', sel).set('selectionAfter', sel);
          let ns = EditorState.push(editorState, nc, 'remove-range');
          ns = EditorState.moveSelectionToEnd(ns);
          draftNode.props.onChange(ns);
        }
      }

      // ── Cleanup markers ──
      console.log(LOG, 'Cleaning markers...');
      draftNode = findDraftStateNode() || draftNode;
      summary.markersCleaned = cleanupMarkers(draftNode, p.markerPrefix);

      return { ok: true, summary };

    } catch (error) {
      console.error(LOG, error);
      // Try to cleanup markers even on error
      try {
        draftNode = findDraftStateNode();
        if (draftNode) cleanupMarkers(draftNode, p.markerPrefix);
      } catch {}
      return { ok: false, error: error.message, stack: error.stack, summary };
    }
  }

  function imageSourcesMatch(left, right) {
    const l = String(left || '').trim(), r = String(right || '').trim();
    if (!l || !r) return false;
    if (l === r) return true;
    try {
      const lu = new URL(l, location.href), ru = new URL(r, location.href);
      lu.hash = ''; ru.hash = '';
      return decodeURIComponent(lu.href) === decodeURIComponent(ru.href);
    } catch { return l.split('#')[0] === r.split('#')[0]; }
  }

  console.log(LOG, 'Engine loaded');
  return await runFlow(payload);
};

console.log('[xArticle] Injection complete — window.__xArticleWrite ready');
