/**
 * payload.js — 把 Markdown 解析成可注入 X 编辑器的 payload
 * 单一数据源：xarticle-server.js（扩展模式）与 auto-publish.js（全自动模式）共用
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const shared = require('./shared.js');

// ── 截图友好的图片压缩（macOS 自带 sips，零 npm 依赖）──
// 只处理明显偏大的 PNG/JPEG；中小截图保留原图，避免把文字 UI 压糊。
// 可用环境变量覆盖：XARTICLE_IMG_MAX_EDGE / XARTICLE_IMG_JPEG_QUALITY /
// XARTICLE_IMG_COMPRESS_MIN_BYTES / XARTICLE_IMG_COMPRESS_MIN_OUTPUT_BYTES。
const IMG_MAX_LONG_EDGE = parseInt(process.env.XARTICLE_IMG_MAX_EDGE || '1280', 10);
const IMG_JPEG_QUALITY = parseInt(process.env.XARTICLE_IMG_JPEG_QUALITY || '82', 10);
const IMG_COMPRESS_MIN_BYTES = parseInt(process.env.XARTICLE_IMG_COMPRESS_MIN_BYTES || String(500 * 1024), 10);
const IMG_COMPRESS_MIN_OUTPUT_BYTES = parseInt(process.env.XARTICLE_IMG_COMPRESS_MIN_OUTPUT_BYTES || String(180 * 1024), 10);

function sipsLongEdge(srcPath) {
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', srcPath], { encoding: 'utf8' });
    const w = /pixelWidth:\s*(\d+)/.exec(out);
    const h = /pixelHeight:\s*(\d+)/.exec(out);
    if (w && h) return Math.max(parseInt(w[1], 10), parseInt(h[1], 10));
  } catch (e) { /* ignore */ }
  return 0;
}

// 返回压缩后的 Buffer；不适用/失败/没变小则返回 null（调用方回退原图）
function compressWithSips(buf, ext, srcPath) {
  if (process.platform !== 'darwin') return null;            // 只在 macOS 走 sips
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null; // gif(动图)/webp 跳过
  if (buf.length < IMG_COMPRESS_MIN_BYTES) return null;       // 小图不压

  const longEdge = sipsLongEdge(srcPath);
  const target = Math.min(IMG_MAX_LONG_EDGE, longEdge || IMG_MAX_LONG_EDGE); // 只缩不放
  const tmpOut = path.join(os.tmpdir(), `xarticle-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  try {
    execFileSync('sips', ['-Z', String(target), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(IMG_JPEG_QUALITY), srcPath, '--out', tmpOut], { stdio: 'ignore' });
    const out = fs.readFileSync(tmpOut);
    fs.unlinkSync(tmpOut);
    if (buf.length < 1024 * 1024 && out.length < IMG_COMPRESS_MIN_OUTPUT_BYTES) return null;
    return (out.length && out.length < buf.length) ? out : null;
  } catch (e) {
    try { fs.unlinkSync(tmpOut); } catch (_) { /* ignore */ }
    return null;
  }
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
};
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

function normalizeImageResult(result, source) {
  if (!result?.ok) return result;
  const valid = shared.isSupportedImageMime(result.mime)
    ? { ok: true }
    : { ok: false, error: `Unsupported image type: ${result.mime || 'unknown'}` };
  if (!valid.ok) return { ...valid, source };
  if (Number(result.bytes) > MAX_IMAGE_BYTES) {
    return { ok: false, error: `Image is too large (${result.bytes} bytes)`, source };
  }
  return { ...result, source };
}

function safeDecodeLocalPath(value) {
  const unescaped = String(value || '').replace(/\\([\\`*_[\]{}()#+\-.! ])/g, '$1');
  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped.replace(/%20/gi, ' ');
  }
}

function normalizePlatformLocalPath(value) {
  let localPath = safeDecodeLocalPath(value);
  if (process.platform === 'win32') {
    localPath = localPath.replace(/\//g, '\\');
    localPath = localPath.replace(/^\\([A-Za-z]:\\)/, '$1');
  }
  return localPath;
}

function localImagePath(source, mdDir) {
  const clean = String(source || '').split(/[?#]/)[0];
  if (/^file:\/\//i.test(clean)) {
    try {
      return normalizePlatformLocalPath(new URL(clean).pathname);
    } catch {
      return normalizePlatformLocalPath(clean.replace(/^file:\/+/i, '/'));
    }
  }
  const localPath = normalizePlatformLocalPath(clean);
  return path.isAbsolute(localPath) ? localPath : path.resolve(mdDir, localPath);
}

function localImageResult(fullPath, source) {
  if (!fs.existsSync(fullPath)) return { ok: false, error: 'Not found: ' + fullPath, source };
  const buf = fs.readFileSync(fullPath);
  const ext = path.extname(fullPath).toLowerCase();
  let finalBuf = buf;
  let finalMime = MIME_BY_EXT[ext] || shared.extensionMime(fullPath);
  let finalName = path.basename(fullPath);
  const compressed = compressWithSips(buf, ext, fullPath);
  if (compressed) {
    finalBuf = compressed;
    finalMime = 'image/jpeg';
    finalName = finalName.replace(/\.(png|jpg|jpeg)$/i, '') + '.jpg';
    console.error(`[compress] ${path.basename(fullPath)}: ${(buf.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB`);
  }
  return normalizeImageResult({
    ok: true,
    base64: finalBuf.toString('base64'),
    mime: finalMime,
    fileName: finalName,
    bytes: finalBuf.length
  }, source);
}

async function remoteImageResult(source) {
  if (!shared.isRemoteHttpImageSource(source)) {
    return { ok: false, error: 'Remote image host is private or invalid', source };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch(source, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'accept': 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp,*/*;q=0.8',
        'user-agent': 'X-Article-MD-Publisher/4.1'
      }
    });
    if (!resp.ok) return { ok: false, error: `Remote image HTTP ${resp.status}`, source };
    const buffer = Buffer.from(await resp.arrayBuffer());
    const contentType = String(resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const guessedName = shared.guessFileName(source);
    const mime = contentType.startsWith('image/') ? contentType : shared.extensionMime(guessedName);
    return normalizeImageResult({
      ok: true,
      base64: buffer.toString('base64'),
      mime,
      fileName: guessedName,
      bytes: buffer.length
    }, source);
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Remote image download timed out' : e.message, source };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveImageSource(source, mdDir) {
  const src = String(source || '').trim();
  if (!src) return { ok: false, error: 'Image source is empty', source };
  try {
    if (src.startsWith('data:')) {
      const uri = shared.parseDataUri(src);
      return uri.ok ? normalizeImageResult({ ...uri, fileName: shared.guessFileName(src) }, src) : { ...uri, source: src };
    }
    if (/^https?:\/\//i.test(src)) return remoteImageResult(src);
    return localImageResult(localImagePath(src, mdDir), src);
  } catch (e) {
    return { ok: false, error: e.message, source: src };
  }
}

async function buildPayloadFromMarkdown(markdown, options = {}) {
  const mdPath = options.sourcePath ? path.resolve(options.sourcePath) : null;
  const mdDir = mdPath ? path.dirname(mdPath) : path.resolve(options.sourceDir || process.cwd());
  const parseOptions = {
    extractTitle: true,
    extractCover: true,
    firstImageAsCover: options.firstImageAsCover === true,
    sourceFileName: options.sourceFileName || (mdPath ? path.basename(mdPath) : '')
  };
  const parsed = shared.parseMarkdown(markdown, parseOptions);
  const coverOverride = options.coverOverride?.result?.ok ? options.coverOverride : null;
  const effectiveCover = coverOverride?.source || parsed.cover || '';
  const coverMode = coverOverride ? 'manual' : (parsed.coverSource || (parsed.cover ? 'frontmatter' : 'none'));

  const imageResults = new Map();
  const imageSegments = parsed.segments.filter((seg) => seg.type === 'image');
  const prioritizedImageSegments = imageSegments
    .map((seg, index) => ({
      seg,
      index,
      isCover: Boolean(effectiveCover && shared.imageSourcesMatch(seg.source, effectiveCover))
    }))
    .sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.index - b.index)
    .map((item) => item.seg);
  for (const seg of prioritizedImageSegments) {
    imageResults.set(seg, await resolveImageSource(seg.source, mdDir));
  }

  let coverResult = null;
  if (coverOverride) {
    coverResult = coverOverride.result;
  } else if (parsed.cover) {
    const coverSegment = parsed.segments.find((seg) => seg.type === 'image' && shared.imageSourcesMatch(seg.source, parsed.cover));
    coverResult = coverSegment ? imageResults.get(coverSegment) : await resolveImageSource(parsed.cover, mdDir);
  }

  const planOptions = { coverSource: effectiveCover, coverResult };
  const pastePlan = shared.buildPastePlan(parsed.segments, imageResults, new Map(), planOptions);

  const imagePayloads = [];
  for (const op of pastePlan.plan) {
    if (op.op.type === 'image' && op.op.file?.base64) {
      imagePayloads.push({
        marker: op.marker, base64: op.op.file.base64, fileName: op.op.file.fileName,
        mime: op.op.file.mime, alt: op.op.file.alt || '', coverOnly: !!op.op.coverOnly,
        fallbackText: op.op.fallbackText || '', source: op.op.source || null
      });
    }
  }
  imagePayloads.sort((a, b) => Number(b.coverOnly) - Number(a.coverOnly));

  return {
    title: parsed.title || '', cover: effectiveCover || '',
    coverMode,
    metadata: {
      titleSource: parsed.titleSource || '',
      coverSource: coverMode
    },
    html: pastePlan.html, plain: pastePlan.plain,
    blocks: pastePlan.blocks, plan: pastePlan.plan,
    markerPrefix: pastePlan.markerPrefix,
    images: imagePayloads, articleId: null
  };
}

async function buildPayload(mdPath, options = {}) {
  const resolved = path.resolve(mdPath);
  const markdown = fs.readFileSync(resolved, 'utf-8');
  return buildPayloadFromMarkdown(markdown, {
    sourcePath: resolved,
    sourceFileName: path.basename(resolved),
    coverOverride: options.coverOverride || null
  });
}

module.exports = { buildPayload, buildPayloadFromMarkdown };
