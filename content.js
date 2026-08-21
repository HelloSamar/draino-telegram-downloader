/**
 * content.js — Draino v7.1 (isolated world)
 *
 * RELIABILITY FIX: Don't rely on video.currentSrc at click time.
 * Watch ALL video elements from the moment they appear in the DOM.
 * Capture their stream URL the instant they start loading.
 * Store in a WeakMap so clicks always have a URL ready.
 *
 * SECURITY FIX (v7.1): filenames/captions extracted from the Telegram
 * message DOM are attacker-controlled (any chat participant can set
 * them). They are now sanitized and inserted via textContent instead
 * of innerHTML, closing an HTML-injection hole in the progress bar.
 */

// ── Helpers ─────────────────────────────────────────────────────────────
function sanitizeFilename(name) {
  return String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_') // strip characters unsafe in filenames / HTML-breaking chars
    .trim()
    .slice(0, 150);
}

// ── Video URL registry ────────────────────────────────────────────────────
const videoUrls = new WeakMap(); // video el → stream URL

function captureUrl(video) {
  const url = video.currentSrc || video.src || '';
  if (url && url.includes('/stream/')) {
    videoUrls.set(video, url);
  }
}

function watchVideo(video) {
  if (video._drainoWatched) return;
  video._drainoWatched = true;
  captureUrl(video);
  ['loadstart','loadedmetadata','canplay','play','playing'].forEach(ev =>
    video.addEventListener(ev, () => captureUrl(video), { passive: true })
  );
  new MutationObserver(() => captureUrl(video))
    .observe(video, { attributes: true, attributeFilter: ['src'] });
}

function scanVideos(root) {
  if (root.tagName === 'VIDEO') { watchVideo(root); return; }
  root.querySelectorAll?.('video').forEach(watchVideo);
}

const domObs = new MutationObserver(mutations => {
  for (const m of mutations)
    for (const node of m.addedNodes)
      if (node.nodeType === 1) scanVideos(node);
});

const init = () => {
  scanVideos(document.body);
  domObs.observe(document.body, { childList: true, subtree: true });
};
document.body ? init() : document.addEventListener('DOMContentLoaded', init);

// ── Progress bars ─────────────────────────────────────────────────────────
const ensureRoot = () => {
  if (!document.getElementById('draino-root')) {
    const el = document.createElement('div');
    el.id = 'draino-root';
    document.body.appendChild(el);
  }
};

function pbCreate(id, name) {
  ensureRoot();
  const w = document.createElement('div');
  w.id = 'dpb-' + id; w.className = 'dpb';
  // Build structure with static markup only — never interpolate
  // untrusted text (filenames) into innerHTML.
  w.innerHTML = `
    <div class="dpb-top">
      <span class="dpb-name"></span>
      <span class="dpb-x">✕</span>
    </div>
    <div class="dpb-bar"><div class="dpb-fill"></div><span class="dpb-txt">Starting…</span></div>`;

  const nameEl = w.querySelector('.dpb-name');
  nameEl.textContent = name;   // safe: text node, not parsed as HTML
  nameEl.title = name;         // safe: DOM property assignment, not attribute string concat

  w.querySelector('.dpb-x').addEventListener('click', () => w.remove());

  document.getElementById('draino-root').appendChild(w);
}

function pbUpdate(id, pct, label) {
  const w = document.getElementById('dpb-' + id); if (!w) return;
  w.querySelector('.dpb-fill').style.width = Math.min(pct, 100) + '%';
  w.querySelector('.dpb-txt').textContent  = label;
}

function pbDone(id, ok, extra) {
  const w = document.getElementById('dpb-' + id); if (!w) return;
  w.querySelector('.dpb-fill').style.cssText = 'width:100%;background:' + (ok ? '#22c55e' : '#ef4444');
  w.querySelector('.dpb-txt').textContent = (ok ? '✓ ' : '✗ ') + extra;
  setTimeout(() => w.remove(), 5000);
}

window.addEventListener('__draino_init',     e => pbCreate(e.detail.id, e.detail.filename));
window.addEventListener('__draino_progress', e => pbUpdate(e.detail.id, e.detail.pct, e.detail.label));
window.addEventListener('__draino_done',     e => {
  const { id, ok, filename, size, error } = e.detail;
  pbDone(id, ok, ok ? `${filename} (${(size/1048576).toFixed(1)} MB)` : error);
});

// ── Find video near hovered element ──────────────────────────────────────
function findVideo(el, depth = 12) {
  let node = el;
  for (let i = 0; i < depth; i++) {
    if (!node || node === document.body) break;
    if (node.tagName === 'VIDEO') return node;
    // Prefer a video we've already captured a URL for
    const vids = [...(node.querySelectorAll?.('video') || [])];
    const known = vids.find(v => videoUrls.has(v));
    if (known) return known;
    if (vids.length) return vids[0];
    node = node.parentElement;
  }
  return null;
}

// ── Floating button ───────────────────────────────────────────────────────
const btn = document.createElement('button');
btn.id = 'draino-fab';
btn.title = 'Draino — download video';
btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3v13"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>`;
document.body.appendChild(btn);

let activeVideo = null, hideTimer = null;

function showBtn(video) {
  clearTimeout(hideTimer);
  activeVideo = video;
  let ref = video, r = ref.getBoundingClientRect(), n = 0;
  while ((r.width < 20 || r.height < 20) && ref.parentElement && n++ < 16) {
    ref = ref.parentElement; r = ref.getBoundingClientRect();
  }
  Object.assign(btn.style, {
    top: `${r.bottom + scrollY - 52}px`,
    left: `${r.right  + scrollX - 52}px`,
    opacity: '1', transform: 'scale(1)', pointerEvents: 'all'
  });
}

function hideBtn(now = false) {
  clearTimeout(hideTimer);
  const go = () => Object.assign(btn.style, { opacity:'0', transform:'scale(0.75)', pointerEvents:'none' }) || (activeVideo = null);
  now ? go() : (hideTimer = setTimeout(go, 280));
}

document.addEventListener('mouseover', e => {
  if (e.target === btn || btn.contains(e.target)) return;
  const v = findVideo(e.target);
  if (v) showBtn(v);
}, true);

document.addEventListener('mouseout', e => {
  if (e.target === btn || btn.contains(e.target)) return;
  if (e.relatedTarget !== btn && !btn.contains(e.relatedTarget)) hideBtn();
}, true);

btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
btn.addEventListener('mouseleave', () => hideBtn());

// ── Extract filename from Telegram's message DOM near the video ───────────
function extractFilename(videoEl) {
  // Walk up to the message bubble container
  let node = videoEl;
  for (let i = 0; i < 20; i++) {
    if (!node || node === document.body) break;

    // Telegram Web K class names for filenames
    const selectors = [
      '.document-name',        // uploaded document/video file
      '.media-name',           // media filename
      '.file-name',            // generic file name
      '.document-message-filename',
      '[class*="filename"]',
      '[class*="file-name"]',
      '[class*="document-name"]',
    ];

    for (const sel of selectors) {
      const el = node.querySelector(sel);
      if (el) {
        const name = el.textContent.trim();
        if (name && name.length > 0 && name.length < 200) return sanitizeFilename(name);
      }
    }

    // Also check caption text which might be the video title
    const caption = node.querySelector('.caption, .message-text, [class*="caption"]');
    if (caption) {
      const text = caption.textContent.trim();
      // Only use caption as filename if it looks like a filename (has extension)
      if (text && /\.\w{2,4}$/.test(text) && text.length < 200) return sanitizeFilename(text);
    }

    node = node.parentElement;
  }
  return null;
}

btn.addEventListener('click', e => {
  e.stopPropagation(); e.preventDefault();
  if (!activeVideo) return;

  captureUrl(activeVideo);
  const url = videoUrls.get(activeVideo) || activeVideo.currentSrc || activeVideo.src || '';

  if (!url || !url.includes('/stream/')) {
    alert('[Draino] Stream not ready.\nClick the video to start playing it first, then try again.');
    return;
  }

  // Try to get real filename from DOM (already sanitized by extractFilename)
  const domFilename = extractFilename(activeVideo);

  const id = Math.random().toString(36).slice(2, 10);
  btn.classList.add('draino-go');
  setTimeout(() => btn.classList.remove('draino-go'), 750);
  window.dispatchEvent(new CustomEvent('__draino_start', { detail: { url, id, domFilename } }));
});
