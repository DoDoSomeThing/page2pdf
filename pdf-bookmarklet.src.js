(async () => {
  if (window.__pdfbm) { alert('PDF 書籤已在執行中'); return; }
  window.__pdfbm = true;
  const TEST = window.__pdfbmTest || false;
  // 參數：window.__pdfbmOpt 有設定就覆蓋預設值
  const OPT = Object.assign({
    minPx: 300, scrollWait: 500, imgWait: 3000, stableWait: 300,
    flipWait: 800, flipKey: 'ArrowRight', maxFlip: 2000
  }, window.__pdfbmOpt || {});
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#111;color:#fff;' +
    'font:14px/1.5 system-ui,sans-serif;padding:10px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:320px;pointer-events:none';
  document.body.appendChild(ui);
  const say = t => { ui.textContent = t; console.log('[PDF書籤]', t); };

  // 使用者按真正的 Esc → 停止捲動／翻頁，用目前收到的頁面往下走
  let aborted = false;
  const onKey = e => {
    if (e.isTrusted && e.key === 'Escape' && !aborted) { aborted = true; say('已中止，用目前收到的頁面繼續…'); }
  };
  addEventListener('keydown', onKey, true);
  const finish = (msg, keep) => {
    removeEventListener('keydown', onKey, true);
    if (msg) say(msg);
    setTimeout(() => ui.remove(), keep ? 8000 : 3000);
    delete window.__pdfbm;
  };

  const findScroller = () => {
    let best = document.scrollingElement || document.documentElement;
    let bestSpan = best.scrollHeight - best.clientHeight;
    for (const el of document.querySelectorAll('body *')) {
      if (el.clientHeight < innerHeight * 0.4) continue;
      const span = el.scrollHeight - el.clientHeight;
      if (span <= bestSpan + 50) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') { best = el; bestSpan = span; }
    }
    return best;
  };

  // FNV-1a 內容雜湊；資料大時抽樣約 4096 點，最後串上長度
  const fnv = b => {
    let h = 0x811c9dc5;
    const step = Math.max(1, Math.floor(b.length / 4096));
    for (let i = 0; i < b.length; i += step) h = Math.imul(h ^ b[i], 16777619);
    return (h >>> 0).toString(16) + ':' + b.length;
  };

  // 畫到 canvas → JPEG 位元組；同時做空白偵測（被污染的來源在 getImageData / toBlob 會丟例外）
  const encode = async (src, w, h) => {
    const t = document.createElement('canvas');
    t.width = t.height = 24;
    const tg = t.getContext('2d');
    tg.imageSmoothingQuality = 'high';
    tg.fillStyle = '#fff'; tg.fillRect(0, 0, 24, 24);
    tg.drawImage(src, 0, 0, 24, 24);
    const px = tg.getImageData(0, 0, 24, 24).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < px.length; i += 4) {
      const v = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.drawImage(src, 0, 0, w, h);
    const blob = await new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('toBlob 失敗')), 'image/jpeg', 0.92));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { bytes, w, h, hash: fnv(bytes), blank: hi - lo < 8 };
  };

  const snap = async el => {
    try { return await encode(el, el.naturalWidth || el.width, el.naturalHeight || el.height); } catch (e) { /* 跨網域圖片會污染 canvas */ }
    if (el.tagName === 'IMG') {
      try {
        const blob = await (await fetch(el.currentSrc || el.src, { credentials: 'include' })).blob();
        const bm = await createImageBitmap(blob);
        try { return await encode(bm, bm.width, bm.height); } finally { bm.close(); }
      } catch (e) { /* CORS 擋住 */ }
    }
    return null;
  };

  const pages = new Map();     // key → 頁面
  const seen = new Set();      // 已收過的內容雜湊（非空白頁）
  const done = new Set();      // 捲動模式：已判定不用再抓的 key
  const last = new WeakMap();  // 元素 → 上次收進來的雜湊（翻頁模式判斷內容有沒有換）
  const taintedEls = new WeakSet();
  let seq = 0, tainted = 0, flip = false;

  const add = (key, p) => { pages.set(key, p); if (p.hash && !p.blank) seen.add(p.hash); };

  const collect = async (scroller, final) => {
    const base = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    const st = scroller.scrollTop;
    const cands = [];
    for (const el of document.querySelectorAll('img,canvas')) {
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 150) continue;
      const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
      if (w < OPT.minPx || h < OPT.minPx) continue;
      const isImg = el.tagName === 'IMG';
      if (isImg && !el.complete) continue;
      if (!isImg && taintedEls.has(el)) continue;
      const src = isImg ? (el.currentSrc || el.src) : null;
      const y = Math.round(r.top - base + st), x = Math.round(r.left);
      const key = isImg ? 'i:' + src : 'c:' + y + ':' + x;
      if (!flip && (pages.has(key) || done.has(key))) continue;
      cands.push({ el, isImg, src, y, x, w, h, key, s: await snap(el) });
    }
    // canvas 要等畫完：統一等一下再拍第二次，雜湊不同代表還在畫
    if (cands.some(c => !c.isImg && c.s)) {
      await sleep(OPT.stableWait);
      for (const c of cands) {
        if (c.isImg || !c.s) continue;
        const s2 = await snap(c.el);
        if (!s2 || s2.hash !== c.s.hash) c.busy = true;
        else c.s = s2;
      }
    }
    for (const c of cands) {
      const s = c.s;
      if (c.busy) continue;                                                 // 還在畫，下一輪再試
      if (!s && !c.isImg) { taintedEls.add(c.el); tainted++; continue; }   // 被污染的 canvas：無法擷取
      if (s && s.blank && !c.isImg && !final) continue;                     // 空白 canvas 可能還沒畫，最後一輪才收
      if (flip && s && last.get(c.el) === s.hash) continue;                 // 翻頁模式：這個元素內容沒換
      if (s && !s.blank && seen.has(s.hash)) { if (!flip) done.add(c.key); continue; }  // 版面位移造成的重複頁
      const key = flip ? 'f:' + (s ? s.hash + (s.blank ? '#' + seq : '') : c.src) : c.key;
      if (pages.has(key)) continue;
      if (s) last.set(c.el, s.hash);
      const p = {
        y: c.y, x: c.x, w: s ? s.w : c.w, h: s ? s.h : c.h, src: c.src,
        bytes: s ? s.bytes : null, hash: s ? s.hash : null, blank: !!(s && s.blank), seq: seq++
      };
      // srcset：同位置（y、x 差 <4px）不同 src 的 img = 同一頁不同解析度，留大的
      if (c.isImg && !flip) {
        let dupKey = null;
        for (const [k, q] of pages) {
          if (k.startsWith('i:') && q.src !== c.src && Math.abs(q.y - c.y) < 4 && Math.abs(q.x - c.x) < 4) { dupKey = k; break; }
        }
        if (dupKey) {
          const q = pages.get(dupKey);
          done.add(c.key);
          if (p.w * p.h > q.w * q.h) { p.seq = q.seq; pages.delete(dupKey); done.add(dupKey); add(c.key, p); }
          continue;
        }
      }
      add(key, p);
    }
  };

  const waitImages = async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < OPT.imgWait) {
      const pending = [...document.images].some(img => {
        const r = img.getBoundingClientRect();
        return !img.complete && r.bottom > 0 && r.top < innerHeight;
      });
      if (!pending) return;
      await sleep(200);
    }
  };

  // 翻頁：在焦點元素上送 keydown / keyup
  const KC = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, PageUp: 33, PageDown: 34, ' ': 32, Enter: 13 }[OPT.flipKey] || 0;
  const press = () => {
    const t = document.activeElement || document.body;
    for (const type of ['keydown', 'keyup']) {
      const e = new KeyboardEvent(type, {
        key: OPT.flipKey, code: OPT.flipKey === ' ' ? 'Space' : OPT.flipKey,
        keyCode: KC, which: KC, bubbles: true, cancelable: true
      });
      if (e.keyCode !== KC) {
        Object.defineProperty(e, 'keyCode', { get: () => KC });
        Object.defineProperty(e, 'which', { get: () => KC });
      }
      t.dispatchEvent(e);
    }
  };

  // 內建最小 PDF 產生器：每頁一張 JPEG，不需外部程式庫（不怕網站 CSP / Trusted Types）
  const makePdf = async list => {
    const enc = new TextEncoder(), parts = [], offs = [];
    let len = 0;
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (id, ...chunks) => { offs[id] = len; push(id + ' 0 obj\n'); chunks.forEach(push); push('\nendobj\n'); };
    push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]));
    const n = list.length;
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + list.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] /Count ' + n + ' >>');
    for (let i = 0; i < n; i++) {
      const p = list[i], id = 3 + i * 3;
      const w = (p.w * 0.75).toFixed(2), h = (p.h * 0.75).toFixed(2);
      const jpg = p.bytes;
      const cs = 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im0 Do Q';
      obj(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] /Resources << /XObject << /Im0 ' + (id + 2) + ' 0 R >> >> /Contents ' + (id + 1) + ' 0 R >>');
      obj(id + 1, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
      obj(id + 2, '<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n', jpg, '\nendstream');
      say(`PDF 製作進度：${i + 1} / ${n}`);
      await sleep(0);
    }
    const total = 3 + n * 3, xref = len;
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let id = 1; id < total; id++) x += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
    push(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  };

  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  };

  // 退路：用瀏覽器列印「另存為 PDF」（全用 DOM API 建，不用 document.write）
  const printFallback = async (list, name) => {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(fr);
    const d = fr.contentDocument;
    d.title = name;
    const st = d.createElement('style');
    // 直式圖用直式紙、橫式圖用橫式紙；每張圖按比例整張縮進一頁、置中
    st.textContent =
      '@page{margin:0}@page port{size:portrait;margin:0}@page land{size:landscape;margin:0}' +
      'html,body{margin:0;padding:0}' +
      '.pg{display:flex;align-items:center;justify-content:center;overflow:hidden;' +
      'break-after:page;page-break-after:always}' +
      '.pg:last-child{break-after:auto;page-break-after:auto}' +
      // 列印時 vw/vh 取自第一頁；用 min/max 換算出直式與橫式紙的長短邊，減 2px 防溢出成空白頁
      '.pg.p{page:port;width:min(100vw,100vh);height:calc(max(100vw,100vh) - 2px)}' +
      '.pg.l{page:land;width:max(100vw,100vh);height:calc(min(100vw,100vh) - 2px)}' +
      '.pg img{display:block;max-width:100%;max-height:100%;object-fit:contain}';
    d.head.appendChild(st);
    const urls = [];
    for (const p of list) {
      const box = d.createElement('div');
      box.className = 'pg ' + (p.w > p.h ? 'l' : 'p');
      const img = d.createElement('img');
      if (p.bytes) {
        const u = URL.createObjectURL(new Blob([p.bytes], { type: 'image/jpeg' }));
        urls.push(u);
        img.src = u;
      } else img.src = p.src;
      box.appendChild(img);
      d.body.appendChild(box);
    }
    await Promise.all([...d.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    const cleanup = () => { urls.forEach(u => URL.revokeObjectURL(u)); fr.remove(); };
    fr.contentWindow.addEventListener('afterprint', cleanup, { once: true });
    return { fr, cleanup };
  };

  try {
    const sc = findScroller();
    const startTop = sc.scrollTop;
    sc.scrollTop = 0;
    await sleep(600);
    let stuck = 0;
    while (stuck < 3 && !aborted) {
      await waitImages();
      await collect(sc, false);
      say(`偵測中… 已找到 ${pages.size} 頁（按 Esc 停止）`);
      const before = sc.scrollTop;
      sc.scrollTop = before + sc.clientHeight * 0.8;
      (sc === document.scrollingElement ? window : sc).dispatchEvent(new Event('scroll'));
      await sleep(OPT.scrollWait);
      stuck = sc.scrollTop === before ? stuck + 1 : 0;
    }
    if (!aborted) { await waitImages(); await collect(sc, true); }
    sc.scrollTop = startTop;

    // 不能捲、又只抓到 ≤2 頁 → 可能是翻頁式閱讀器
    if (!aborted && sc.scrollHeight - sc.clientHeight < 50 && pages.size <= 2 &&
        (TEST || confirm('這頁無法捲動，看起來是翻頁式閱讀器。要自動按 → 翻頁來抓取嗎？'))) {
      flip = true;
      let idle = 0, flips = 0;
      while (idle < 3 && flips < OPT.maxFlip && !aborted) {
        press();
        flips++;
        await sleep(OPT.flipWait);
        await waitImages();
        const n0 = pages.size;
        await collect(sc, false);
        if (pages.size === n0 && !aborted) { await sleep(OPT.flipWait); await collect(sc, true); }
        idle = pages.size === n0 ? idle + 1 : 0;
        say(`翻頁中… 已找到 ${pages.size} 頁（按 Esc 停止）`);
      }
    }

    const list = [...pages.values()].sort(flip
      ? (a, b) => a.seq - b.seq
      : (a, b) => a.y - b.y || a.x - b.x || a.seq - b.seq);
    const skipNote = tainted ? `另有 ${tainted} 個 canvas 無法擷取，已略過` : '';
    if (!list.length) { finish('沒偵測到頁面（找不到夠大的圖片或 canvas）' + (skipNote ? '；' + skipNote : ''), true); return; }
    if (!TEST && !confirm(`偵測到 ${list.length} 頁，要做成 PDF 嗎？`)) { finish('已取消'); return; }

    const name = (document.title || 'pages').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + '.pdf';
    const okList = list.filter(p => p.bytes);
    const blocked = list.length - okList.length;

    // 有頁面被跨網域擋住：一頁都抓不到 → 直接列印；部分被擋 → 讓使用者選
    let usePrint = TEST === 'print' || !okList.length;
    if (!usePrint && blocked) {
      usePrint = TEST ? TEST !== 'pdf' : confirm(
        `${blocked} 頁圖片被跨網域擋住，無法直接做成 PDF。\n\n` +
        `確定：改用列印視窗另存 PDF（包含全部 ${list.length} 頁）\n` +
        `取消：只把抓得到的 ${okList.length} 頁直接做成 PDF 下載`);
    }

    if (!usePrint) {
      const blob = await makePdf(okList);
      const extra = [blocked ? `略過 ${blocked} 頁被擋的圖片` : '', skipNote].filter(Boolean).join('；');
      if (TEST) {
        window.__pdfbmBlob = blob;
        window.__pdfbmList = okList;
        window.__pdfbmResult = { pages: okList.length, bytes: blob.size, mode: 'pdf', flip, tainted, skipped: blocked };
      } else download(blob, name);
      finish(`完成！共 ${okList.length} 頁 → ${name}` + (extra ? `（${extra}）` : ''), true);
      return;
    }

    say(blocked ? `${blocked} 頁圖片被跨網域擋住，改用列印另存 PDF` : '改用列印另存 PDF');
    const { fr, cleanup } = await printFallback(list, name);
    if (TEST) {
      const imgs = [...fr.contentDocument.images];
      window.__pdfbmResult = { pages: list.length, mode: 'print', imgs: imgs.length, broken: imgs.filter(i => !i.naturalWidth).length, flip, tainted };
      cleanup();
    } else fr.contentWindow.print();
    finish(`列印視窗選「另存為 PDF」即可（共 ${list.length} 頁）` + (skipNote ? `；${skipNote}` : ''), true);
  } catch (e) {
    console.error(e);
    finish('出錯了：' + e.message, true);
  }
})();
