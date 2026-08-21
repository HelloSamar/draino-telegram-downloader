/**
 * inject.js — Draino v7.1 (MAIN world)
 * Fetches run here so Telegram's service worker intercepts them.
 *
 * Parallel slices, each with an inner loop to handle Telegram's SW
 * returning fewer bytes than requested per fetch.
 *
 * CORRECTNESS FIX (v7.1): previously, if a response carried neither a
 * Content-Range nor a Content-Length header, the code assumed exactly
 * the requested number of bytes came back. If the underlying fetch
 * ever ignored the Range header and returned MORE data than asked for
 * (e.g. the whole remaining file), the next loop iteration would
 * re-request already-received bytes, corrupting the final file with
 * duplicated data. We now always measure the actual blob size and
 * clamp/trim it to the slice we asked for.
 *
 * SECURITY FIX (v7.1): filenames sourced from the page (Telegram
 * message DOM, this runs in the isolated-world content script) are
 * sanitized before being used as a download filename.
 */
(function () {
  if (window.__drainoV7) return;
  window.__drainoV7 = true;

  const RANGE_RE   = /bytes (\d+)-(\d+)\/(\d+)/;
  const CONCURRENT = 6;
  const MIN_CHUNK  = 1 * 1024 * 1024;

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function sanitizeFilename(name) {
    return String(name)
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
      .trim()
      .slice(0, 150);
  }

  // Fetch bytes [sliceStart..sliceEnd] fully, looping as needed
  async function fetchSlice(url, sliceStart, sliceEnd, index) {
    const parts  = [];
    let   cursor = sliceStart;

    while (cursor <= sliceEnd) {
      let res, attempt = 0;
      while (true) {
        try {
          res = await fetch(url, { headers: { Range: `bytes=${cursor}-${sliceEnd}` } });
          if (res.status !== 206 && res.status !== 200) throw new Error('HTTP ' + res.status);
          break;
        } catch (err) {
          if (++attempt > 6) throw err;
          await new Promise(r => setTimeout(r, 400 * attempt));
        }
      }

      const blob = await res.blob();
      const expectedBytes = sliceEnd - cursor + 1;

      // Determine how many bytes the SW actually returned, preferring
      // headers but falling back to (and cross-checking against) the
      // real blob size so we never trust a header that undercounts.
      let actualEnd;
      const cr = res.headers.get('Content-Range');
      const cl = res.headers.get('Content-Length');
      if (cr) {
        const m = cr.match(RANGE_RE);
        actualEnd = m ? parseInt(m[2]) : cursor + blob.size - 1;
      } else if (cl) {
        actualEnd = cursor + parseInt(cl) - 1;
      } else {
        actualEnd = cursor + blob.size - 1;
      }

      if (actualEnd > sliceEnd || blob.size > expectedBytes) {
        // The response overshot our slice boundary (e.g. Range was
        // ignored and the whole remainder of the file came back).
        // Trim to exactly what this slice needs so slices never overlap.
        parts.push(blob.slice(0, expectedBytes));
        cursor = sliceEnd + 1;
      } else {
        parts.push(blob);
        cursor = actualEnd + 1;
      }
    }

    return { index, blob: new Blob(parts) };
  }

  window.addEventListener('__draino_start', async (e) => {
    const { url, id, domFilename } = e.detail;
    console.log('[Draino] Start:', url);

    // Priority: DOM name > URL JSON name > timestamp fallback
    let filename = null;
    let mimeType = 'video/mp4';

    // 1. Try URL JSON
    try {
      const meta = JSON.parse(decodeURIComponent(url.split('/stream/')[1] || ''));
      if (meta.mimeType) mimeType = meta.mimeType;
      if (meta.fileName && meta.fileName !== 'video.mp4' && meta.fileName !== 'video') {
        filename = sanitizeFilename(meta.fileName);
      }
    } catch (_) {}

    // 2. DOM name overrides URL JSON (more accurate)
    if (domFilename) {
      const clean = sanitizeFilename(domFilename);
      // Ensure it has a video extension
      const hasExt = /\.\w{2,4}$/.test(clean);
      filename = hasExt ? clean : clean + '.' + (mimeType.split('/')[1] || 'mp4');
    }

    // 3. Timestamp fallback
    if (!filename) {
      filename = 'draino-' + Date.now() + '.' + (mimeType.split('/')[1] || 'mp4');
    }

    console.log('[Draino] Filename:', filename, '(dom:', domFilename, ')');
    emit('__draino_init', { id, filename });

    try {
      // Probe for total size
      let totalSize = null;
      const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      const cr = probe.headers.get('Content-Range');
      if (cr) { const m = cr.match(RANGE_RE); if (m) totalSize = parseInt(m[3]); }
      const ct = probe.headers.get('Content-Type') || '';
      if (ct.includes('video/')) mimeType = ct.split(';')[0].trim();
      await probe.blob();

      console.log('[Draino] Total:', totalSize, 'bytes');

      if (!totalSize) {
        // Fallback: single fetch
        const res  = await fetch(url);
        const blob = await res.blob();
        emit('__draino_progress', { id, pct: 100, label: (blob.size/1048576).toFixed(1) + ' MB' });
        trigger(blob, filename);
        emit('__draino_done', { id, ok: true, filename, size: blob.size });
        return;
      }

      // Build slices
      const chunkSize = Math.max(MIN_CHUNK, Math.ceil(totalSize / CONCURRENT));
      const slices = [];
      for (let s = 0; s < totalSize; s += chunkSize) {
        slices.push({ start: s, end: Math.min(s + chunkSize - 1, totalSize - 1), index: slices.length });
      }

      // Parallel fetch with progress
      const received = new Array(slices.length).fill(0);
      const results = await Promise.all(
        slices.map(({ start, end, index }) =>
          fetchSlice(url, start, end, index).then(r => {
            received[index] = r.blob.size;
            const done  = received.reduce((a, b) => a + b, 0);
            emit('__draino_progress', {
              id,
              pct:   (done / totalSize) * 100,
              label: `${(done/1048576).toFixed(1)} / ${(totalSize/1048576).toFixed(1)} MB`
            });
            return r;
          })
        )
      );

      results.sort((a, b) => a.index - b.index);
      const full = new Blob(results.map(r => r.blob), { type: mimeType });
      console.log('[Draino] Final:', full.size, '/', totalSize, 'bytes');

      if (full.size < totalSize * 0.99) throw new Error(`Incomplete: ${full.size}/${totalSize}`);

      trigger(full, filename);
      emit('__draino_done', { id, ok: true, filename, size: full.size });

    } catch (ex) {
      console.error('[Draino] Error:', ex);
      emit('__draino_done', { id, ok: false, error: String(ex) });
    }
  });

  function trigger(blob, filename) {
    const u = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: u, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 15000);
  }
})();
