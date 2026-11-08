(() => {
  if (window.__bsubLoaded) return;
  window.__bsubLoaded = true;

  const END_PUNCT = /[.!?…。！？」』"”')\]♪।]$/;
  const MAX_TRIES = 3;
  const BUILD = chrome.runtime.getManifest().version; // để popup biết tab có đang chạy mã cũ không

  // Nhật ký chẩn đoán (150 dòng gần nhất), popup lấy qua tin nhắn 'diag'.
  const diag = [];
  const D = s => {
    const t = new Date().toTimeString().slice(0, 8);
    const vt = video ? ' [' + video.currentTime.toFixed(1) + 's]' : '';
    diag.push(t + vt + ' ' + s);
    if (diag.length > 150) diag.shift();
  };
  const pageVideoId = () => new URLSearchParams(location.search).get('v')
    || ((/^\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(location.pathname || '') || [])[1]) || '';

  let cfg = { ...BSUB_DEFAULTS };
  let cues = [];            // { start, end, text, tr, busy, failed, tries }
  let cueKey = '', cueLang = '';
  let unsupportedLang = '';
  let lastError = '', via = '';
  let gen = 0;              // tăng mỗi khi các yêu cầu dịch đang chạy trở nên lỗi thời
  let video = null;
  let dubbedIdx = -1, dubActive = false, dubToken = 0, duckedFrom = null, duckSet = null, audio = null;
  let pendingIdx = -1;      // câu chờ đọc khi câu trước chưa đọc xong
  let saveTimer = 0, retryTimer = 0, upgradeTimer = 0, upgradeWait = 0;
  const seenVideos = new WeakSet();
  const ttsCache = new Map();

  bsubGet().then(c => { cfg = c; loop(); });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    let clear = false, resume = false;
    for (const k of Object.keys(ch)) {
      if (!(k in BSUB_DEFAULTS)) continue;
      // Trang Cài đặt lưu lại cả những ô không đổi: chỉ coi là đổi khi giá trị khác thật,
      // nếu không sẽ xoá hết bản dịch và dịch lại từ đầu (tốn lượt Gemini).
      if (JSON.stringify(ch[k].oldValue) === JSON.stringify(ch[k].newValue)) continue;
      cfg[k] = ch[k].newValue;
      if (k === 'geminiModel') clear = true;
      if (k === 'geminiKey' || k === 'enabled') resume = true;
    }
    // Kéo thanh âm lượng trong popup: áp dụng ngay cho câu đang đọc.
    if ('voiceVolume' in ch && audio) audio.volume = voiceVol();
    if ('duck' in ch && duckedFrom != null && video) { video.volume = duckedFrom * Number(cfg.duck); duckSet = video.volume; }
    if (!cfg.enabled) stopDub();
    if (!cues.length) return;
    if (clear) {
      gen++;
      cues.forEach(c => { c.tr = null; });
      loadCache().then(translateAll);
    } else if (resume && cfg.enabled) {
      translateAll();
    }
  });

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (!m) return;
    if (m.type === 'status') {
      reply({
        total: cues.length,
        done: cues.filter(c => c.tr).length,
        failed: cues.filter(c => c.failed).length,
        lang: cueLang, unsupportedLang, error: lastError, via,
        build: BUILD
      });
    } else if (m.type === 'diag') {
      const vi = window.speechSynthesis ? speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('vi')).map(v => v.name) : [];
      const t = video ? video.currentTime : 0;
      const i = findIdx(t);
      reply({
        build: BUILD, url: location.href, pageVideoId: pageVideoId(), cueKey, total: cues.length,
        voiceSetting: cfg.voice, localVoice: (localVoice() || {}).name || null, viVoicesInTab: vi,
        video: video ? { t: +t.toFixed(1), paused: video.paused, volume: +video.volume.toFixed(2), muted: video.muted } : null,
        sample: cues.slice(0, 3).map(c => ({ src: c.text, vi: c.tr })),
        current: i >= 0 ? { src: cues[i].text, vi: cues[i].tr, start: cues[i].start, end: cues[i].end } : null,
        timedtextSeenByBrowser: performance.getEntriesByType('resource').filter(x => x.name.includes('/api/timedtext')).map(x => (new URL(x.name).searchParams.get('v') || '?') + '/' + (new URL(x.name).searchParams.get('lang') || '?')),
        lastError, log: diag.slice()
      });
    } else if (m.type === 'retranslate' && cues.length) {
      gen++;
      cues.forEach(c => { c.tr = null; });
      translateAll();
      reply({ ok: true });
    }
  });

  // ---- Lấy phụ đề YouTube (qua hook.js) làm nguồn để dịch ----
  D('content.js khởi động');
  window.addEventListener('message', e => {
    if (e.data && e.data.__bsub === 'hooklog') { D('HOOK: ' + e.data.msg + (e.source === window ? '' : ' (source khác window!)')); return; }
    if (e.data && e.data.__bsub === 'timedtext' && e.source !== window) D('Bỏ tin phụ đề vì e.source !== window');
    if (e.source !== window || !e.data || e.data.__bsub !== 'timedtext') return;
    let u;
    try { u = new URL(e.data.url, location.href); } catch (err) { return; }
    const p = u.searchParams;
    D('PHỤ ĐỀ đến: v=' + p.get('v') + ' (trang v=' + pageVideoId() + ') lang=' + p.get('lang') + ' kind=' + (p.get('kind') || '-') + (p.get('tlang') ? ' tlang=' + p.get('tlang') + ' -> bỏ' : ''));
    if (p.get('tlang')) return; // bản tự dịch của YouTube
    // Phụ đề của video khác (quảng cáo, video xem trước khi rê chuột): bỏ, nếu không sẽ đọc nhầm nội dung.
    const pv = pageVideoId();
    if (p.get('v') && pv && p.get('v') !== pv) { D('  -> bỏ: phụ đề của video khác'); return; }
    const lang = p.get('lang') || '';
    if (!bsubSourceLang(lang)) {
      // Chỉ hỗ trợ tiếng Anh / Trung / Hindi.
      unsupportedLang = lang;
      resetCues();
      return;
    }
    unsupportedLang = '';
    const key = 'yt|' + [p.get('v'), lang, p.get('kind') || '', p.get('name') || ''].join('|');
    if (key === cueKey) return;
    const list = mergeCues(parseTimedText(e.data.text), p.get('kind') === 'asr');
    D('  -> ' + list.length + ' câu' + (list.length ? ', câu đầu: "' + list[0].text.slice(0, 60) + '"' : ''));
    if (list.length) setCues(key, lang, list);
  });
  document.addEventListener('yt-navigate-start', () => { unsupportedLang = ''; resetCues(); });

  function attr(a, n) {
    const m = new RegExp('\\b' + n + '="([^"]*)"').exec(a);
    return m ? m[1] : null;
  }

  function decodeEntities(s) {
    return String(s).replace(/<[^>]+>/g, '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, g) => {
      const k = g.toLowerCase();
      if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
    });
  }

  // Bỏ ký hiệu phụ đề không nên dịch/đọc: ">>" (đổi người nói), nhãn âm thanh [Music] (Applause), ♪.
  // Trước khi dịch: chỉ bỏ rác phụ đề, giữ $ % & (shared.js). Trước khi đọc: đổi/bỏ mọi ký hiệu.
  function cleanCaption(t) {
    return bsubCleanSource(t);
  }

  function speakable(t) {
    return bsubSpeakable(t);
  }

  function parseTimedText(raw) {
    const text = String(raw || '').trim();
    const out = [];
    const add = (start, dur, t) => {
      t = cleanCaption(t);
      if (t && isFinite(start)) out.push({ start, end: start + (dur > 0 ? dur : 2), text: t });
    };
    if (text[0] === '{') {
      let j;
      try { j = JSON.parse(text); } catch (e) { return out; }
      for (const ev of j.events || []) {
        if (ev.segs) add(ev.tStartMs / 1000, (ev.dDurationMs || 0) / 1000, ev.segs.map(s => s.utf8 || '').join(''));
      }
    } else if (text[0] === '<') {
      let m;
      const reP = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
      while ((m = reP.exec(text))) add(+attr(m[1], 't') / 1000, +attr(m[1], 'd') / 1000, decodeEntities(decodeEntities(m[2])));
      if (!out.length) {
        const reT = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
        while ((m = reT.exec(text))) add(+attr(m[1], 'start'), +attr(m[1], 'dur'), decodeEntities(decodeEntities(m[2])));
      }
    }
    out.sort((a, b) => a.start - b.start);
    for (let i = 0; i + 1 < out.length; i++) {
      if (out[i].end > out[i + 1].start) out[i].end = Math.max(out[i].start + 0.3, out[i + 1].start);
    }
    return out;
  }

  // Gộp các mảnh câu (nhất là phụ đề tự động) thành câu ngắn để dịch và đọc tự nhiên hơn.
  // asr = phụ đề tự động (không có dấu câu): gộp dài hơn để mỗi đoạn là một ý trọn vẹn,
  // ngắt khi người nói ngừng (khoảng lặng) thay vì cắt giữa câu.
  function mergeCues(list, asr) {
    const maxGap = asr ? 0.8 : 1, maxDur = asr ? 12 : 8, maxLen = asr ? 220 : 160;
    const out = [];
    for (const c of list) {
      const p = out[out.length - 1];
      if (p && !END_PUNCT.test(p.text) && c.start - p.end < maxGap && c.end - p.start < maxDur && p.text.length + c.text.length < maxLen) {
        p.text += ' ' + c.text;
        p.end = c.end;
      } else {
        out.push({ start: c.start, end: c.end, text: c.text, tr: null });
      }
    }
    return out;
  }

  // ---- Dịch ----
  function setCues(key, lang, list) {
    gen++;
    cueKey = key;
    cueLang = lang;
    cues = list;
    dubbedIdx = -1;
    lastError = '';
    stopDub();
    loadCache().then(translateAll);
  }

  function resetCues() {
    gen++;
    cueKey = '';
    cueLang = '';
    cues = [];
    dubbedIdx = -1;
    stopDub();
  }

  function findIdx(t) {
    let lo = 0, hi = cues.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // Lấy lô kế tiếp bắt đầu từ vị trí đang xem, để đoạn sắp chiếu được dịch trước.
  function nextBatch() {
    const n = cues.length;
    if (!n) return null;
    const from = Math.max(0, findIdx(video ? video.currentTime : 0));
    // Câu đang chiếu chưa dịch: lô nhỏ (8 câu) để có giọng đọc ngay; còn lại lô lớn (40) cho đỡ tốn lượt gọi.
    const urgent = cues[from].tr == null && !cues[from].busy;
    const size = urgent ? 8 : 40;
    const batch = [];
    for (let k = 0; k < n && batch.length < size; k++) {
      const i = (from + k) % n, c = cues[i];
      if (c.tr == null && !c.busy && !c.failed) { c.busy = true; batch.push(i); }
      else if (batch.length) break;
    }
    return batch.length ? batch : null;
  }

  // reset=true: lần dịch mới (đổi video, đổi key, bấm Dịch lại) -> đếm lại số lần thử.
  // reset=false: tự thử lại các dòng lỗi, dòng nào lỗi đủ MAX_TRIES lần thì bỏ.
  async function translateAll(reset = true) {
    const my = ++gen;
    clearTimeout(retryTimer);
    for (const c of cues) {
      c.busy = false;
      if (reset) c.tries = 0;
      c.failed = (c.tries || 0) >= MAX_TRIES;
    }
    const worker = async () => {
      for (;;) {
        if (my !== gen || !cfg.enabled) return;
        const batch = nextBatch();
        if (!batch) return;
        // Ngữ cảnh: tên video + tối đa 8 câu ngay trước lô (kèm bản dịch nếu có) để dịch đúng mạch, xưng hô thống nhất.
        const before = cues.slice(Math.max(0, batch[0] - 8), batch[0]).map(c => ({ src: c.text, vi: c.tr || '' }));
        const title = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube\s*$/, '');
        D('GỬI DỊCH câu ' + batch[0] + '–' + batch[batch.length - 1]);
        const sentAt = Date.now();
        const r = await send({ type: 'translate', lang: cueLang, title, before, lines: batch.map(i => cues[i].text) });
        if (my !== gen) return;
        batch.forEach((i, k) => {
          const c = cues[i];
          c.busy = false;
          const t = r.ok && r.translations[k];
          if (t) { c.tr = t; c.via = r.via; }
          else { c.failed = true; c.tries = (c.tries || 0) + 1; }
        });
        D('DỊCH câu ' + batch[0] + '–' + batch[batch.length - 1] + ' (' + ((Date.now() - sentAt) / 1000).toFixed(1) + 's): ' + (r.ok ? 'ok via=' + r.via + (r.model ? '(' + r.model + ')' : '') + (r.warn ? ' CẢNH BÁO=' + r.warn : '') + ' | "' + cues[batch[0]].text.slice(0, 50) + '" => "' + String(r.translations[0] || '').slice(0, 50) + '"' : 'LỖI ' + r.error));
        if (!r.ok) { lastError = 'Lỗi dịch: ' + r.error; return; }
        via = r.via || '';
        lastError = r.warn || '';
        saveCacheSoon();
      }
    };
    await Promise.all([worker(), worker()]);
    if (my !== gen || !cfg.enabled) return;
    const left = cues.filter(c => c.tr == null && (c.tries || 0) < MAX_TRIES);
    if (left.length && left.some(c => c.failed)) {
      const n = Math.max(...left.map(c => c.tries || 0));
      retryTimer = setTimeout(() => { if (my === gen) translateAll(false); }, 3000 * 2 ** (n - 1));
    }
    upgradeWait = 0;
    scheduleUpgrade(my);
  }

  // Câu bị dịch tạm bằng Google lúc Gemini lỗi/chậm: chạy nền, nhờ Gemini dịch lại (gần chỗ đang xem trước).
  // Gemini vẫn chưa được thì chờ lâu dần (1, 2, 4… tối đa 10 phút) rồi thử lại.
  function scheduleUpgrade(my) {
    clearTimeout(upgradeTimer);
    if (!cfg.geminiKey || !cues.some(c => c.tr && c.via === 'google')) return;
    const base = window.__bsubUpgradeDelayMs != null ? window.__bsubUpgradeDelayMs : 60000;
    upgradeTimer = setTimeout(() => upgradeGoogle(my), Math.min(base * 2 ** upgradeWait, 600000));
  }

  async function upgradeGoogle(my) {
    if (my !== gen || !cfg.enabled || !cfg.geminiKey) return;
    const n = cues.length, from = Math.max(0, findIdx(video ? video.currentTime : 0));
    const idx = [];
    for (let k = 0; k < n && idx.length < 20; k++) {
      const i = (from + k) % n;
      if (cues[i].tr && cues[i].via === 'google') idx.push(i);
    }
    if (!idx.length) return;
    const before = cues.slice(Math.max(0, idx[0] - 8), idx[0]).map(c => ({ src: c.text, vi: c.tr || '' }));
    const title = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube\s*$/, '');
    const r = await send({ type: 'translate', lang: cueLang, title, before, lines: idx.map(i => cues[i].text) });
    if (my !== gen) return;
    if (r.ok && r.via === 'gemini') {
      idx.forEach((i, k) => { if (r.translations[k]) { cues[i].tr = r.translations[k]; cues[i].via = 'gemini'; } });
      D('NÂNG CẤP ' + idx.length + ' câu Google -> Gemini (' + r.model + ')');
      saveCacheSoon();
      upgradeWait = 0;
    } else {
      D('NÂNG CẤP chưa được (Gemini vẫn lỗi), thử lại sau');
      upgradeWait++;
    }
    scheduleUpgrade(my);
  }

  function send(msg) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(msg, r => {
          const err = chrome.runtime.lastError;
          resolve(r || { ok: false, error: err ? err.message : 'Không có phản hồi' });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e.message || e) });
      }
    });
  }

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + '_' + s.length;
  }
  // 'v4': cache ghi kèm engine đã dịch mỗi câu (bản v3 trộn lẫn câu Google dự phòng vào cache Gemini).
  const cacheId = () => 'cache:' + hash('v4|' + cueKey + '|vi|' + (cfg.geminiKey ? cfg.geminiModel : 'google'));

  async function loadCache() {
    if (!cueKey) return;
    const key = cueKey, id = cacheId();
    const o = await chrome.storage.local.get(id).catch(() => ({}));
    const arr = o[id];
    if (key !== cueKey || !Array.isArray(arr) || arr.length !== cues.length) return;
    // Mỗi câu lưu kèm engine đã dịch. Có key Gemini thì bỏ qua câu do Google dịch (dự phòng lúc Gemini lỗi)
    // để Gemini dịch lại, nếu không bản Google sẽ bị dùng mãi.
    let used = 0;
    arr.forEach((e, i) => {
      if (!e || typeof e !== 'object' || !e.t) return;
      if (cfg.geminiKey && e.via !== 'gemini') return;
      cues[i].tr = e.t; cues[i].via = e.via; used++;
    });
    D('CACHE: dùng ' + used + '/' + arr.length + ' câu đã dịch' + (used < arr.filter(Boolean).length ? ' (bỏ câu do Google dịch để Gemini dịch lại)' : ''));
  }

  function saveCacheSoon() {
    clearTimeout(saveTimer);
    const id = cacheId(), data = cues.map(c => (c.tr ? { t: c.tr, via: c.via || '' } : null));
    saveTimer = setTimeout(() => chrome.storage.local.set({ [id]: data }).catch(() => {}), 1500);
  }

  // ---- Vòng lặp theo dõi video ----
  function loop() {
    let delay = 1000;
    try { delay = tick(); } catch (e) { console.warn('[my-dual-subtitles]', e); }
    setTimeout(loop, delay);
  }

  function pickVideo() {
    return document.querySelector('#movie_player video, .html5-video-player video');
  }

  function adShowing() {
    const p = document.querySelector('#movie_player');
    return !!(p && p.classList.contains('ad-showing'));
  }

  // YouTube chỉ tải phụ đề khi CC bật. Đang lồng tiếng mà chưa có phụ đề và CC tắt:
  // bấm CC một lần cho mỗi video (không giành lại nếu người dùng tự tắt sau đó).
  let ccTriedFor = '', ccSeenAt = 0;
  function autoCaptions() {
    const id = pageVideoId();
    if (!id || !video || cues.length || unsupportedLang || adShowing() || ccTriedFor === id) { ccSeenAt = 0; return; }
    const btn = document.querySelector('.ytp-subtitles-button');
    if (!btn) return;
    if (btn.getAttribute('aria-pressed') !== 'false') return;  // đang bật, hoặc video không có phụ đề
    if (!ccSeenAt) { ccSeenAt = Date.now(); return; }       // chờ trình phát khởi động xong
    if (Date.now() - ccSeenAt < 1500) return;
    ccTriedFor = id;
    D('Tự bật CC để lấy phụ đề');
    btn.click();
  }

  function tick() {
    const active = cfg.enabled && cues.length > 0;
    // Đang lồng tiếng: ẩn phụ đề của YouTube (phụ đề chỉ dùng làm nguồn dịch).
    document.documentElement.classList.toggle('bsub-hide-native', active);
    if (!cfg.enabled) return 500;
    const v = pickVideo();
    if (v !== video) {
      stopDub();
      video = v;
      dubbedIdx = -1;
      if (v && !seenVideos.has(v)) {
        seenVideos.add(v);
        v.addEventListener('seeking', () => { dubbedIdx = -1; stopDub(); });
        v.addEventListener('volumechange', onVolumeChange);
      }
    }
    autoCaptions();
    if (!video || !active) return 500;

    const t = video.currentTime;
    let idx = -1;
    if (!adShowing()) {
      const i = findIdx(t);
      if (i >= 0 && t < cues[i].end) idx = i;
    }
    const c = idx >= 0 ? cues[idx] : null;

    if (video.paused) stopDub();
    else if (c && c.tr && dubbedIdx !== idx && t - c.start < Math.max(0.6, (c.end - c.start) / 2)) {
      dubbedIdx = idx;
      // Câu trước còn đang đọc: xếp hàng thay vì cắt ngang.
      if (dubActive) pendingIdx = idx;
      else dubCue(idx);
    }
    return 100;
  }

  // ---- Lồng tiếng ----
  function duck(on) {
    if (!video) return;
    if (on) {
      if (duckedFrom == null) {
        duckedFrom = video.volume;
        video.volume = duckedFrom * Number(cfg.duck);
        duckSet = video.volume;
      }
    } else if (duckedFrom != null) {
      video.volume = duckedFrom;
      duckedFrom = null;
      duckSet = null;
    }
  }

  // Người dùng tự chỉnh âm lượng lúc đang giảm tiếng: giữ mức của họ, không khôi phục mức cũ.
  function onVolumeChange(e) {
    const v = e.target;
    if (v === video && duckedFrom != null && duckSet != null && Math.abs(v.volume - duckSet) > 0.01) {
      duckedFrom = null;
      duckSet = null;
    }
  }

  function stopDub() {
    pendingIdx = -1;
    if (!dubActive) return;
    dubActive = false;
    dubToken++;
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (audio) { audio.pause(); audio = null; }
    duck(false);
  }

  function voiceVol() {
    const n = Number(cfg.voiceVolume);
    return isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
  }

  // Giọng của máy theo lựa chọn:
  //   'namminh' / 'hoaimy' = giọng Microsoft có sẵn trên Edge; 'browser:<tên>' = đúng giọng đó;
  //   'auto' = giọng Việt tốt nhất (ưu tiên Natural/Online).
  function localVoice() {
    if (!window.speechSynthesis) return null;
    const vi = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('vi'));
    const sel = String(cfg.voice || 'auto');
    if (BSUB_MS_VOICES[sel]) return vi.find(v => BSUB_MS_VOICES[sel].match.test(v.name)) || null;
    if (sel.startsWith('browser:')) return vi.find(v => v.name === sel.slice(8)) || null;
    if (sel === 'auto') return vi.find(v => /natural|online/i.test(v.name)) || vi[0] || null;
    return null;
  }

  // Máy không có giọng đã chọn: Nam Minh / Hoài My qua Azure (nếu có key), còn lại dùng Google.
  function remoteVoice() {
    const sel = String(cfg.voice || 'auto');
    return BSUB_MS_VOICES[sel] ? sel : 'google';
  }

  function dubCue(idx) {
    const c = cues[idx];
    stopDub();
    // Câu chỉ toàn ký hiệu (vd "[Âm nhạc]"): không có gì để đọc.
    if (!speakable(c.tr)) { duck(false); return; }
    dubActive = true;
    const token = dubToken;
    // Thời gian còn lại của câu (câu xếp hàng có thể bắt đầu muộn).
    const timeLeft = () => Math.max(0.8, c.end - Math.max(c.start, video ? video.currentTime : c.start));
    let finished = false;
    const done = () => {
      if (finished || token !== dubToken) return;
      finished = true;
      dubActive = false;
      const p = pendingIdx;
      pendingIdx = -1;
      // Còn câu đang chờ và vẫn trong khung thời gian của nó: đọc tiếp, giữ nguyên mức giảm tiếng.
      if (p >= 0 && cues[p] && cues[p].tr && cfg.enabled && video && !video.paused && video.currentTime < cues[p].end) dubCue(p);
      else duck(false);
    };

    const voice = localVoice();
    D('ĐỌC câu ' + idx + ' "' + speakable(c.tr).slice(0, 50) + '" bằng ' + (voice ? 'giọng máy "' + voice.name + '"' : 'mạng (' + remoteVoice() + ')'));

    if (!voice) {
      const rv = remoteVoice();
      getTts(idx, rv).then(url => {
        if (token !== dubToken) return;
        // Âm thanh về trễ, câu đã qua: bỏ, chuyển sang câu đang chờ.
        if (!url || !video || video.paused || video.currentTime >= c.end) {
          D('  bỏ qua: ' + (!url ? 'không có âm thanh' : !video ? 'không có video' : video.paused ? 'video dừng' : 'âm thanh về trễ, câu đã qua'));
          done(); return;
        }
        const a = new Audio(url);
        a.volume = voiceVol();
        audio = a;
        a.onloadedmetadata = () => { if (isFinite(a.duration)) a.playbackRate = Math.min(2, Math.max(1, a.duration / timeLeft())); };
        a.onplaying = () => D('  PHÁT âm thanh (vol giọng=' + a.volume.toFixed(2) + ', vol video=' + video.volume.toFixed(2) + (video.muted ? ' TAB VIDEO MUTED' : '') + ')');
        a.onended = () => { D('  xong'); done(); };
        a.onerror = () => { D('  LỖI phát mã ' + (a.error && a.error.code)); lastError = 'Lỗi phát giọng đọc (mã ' + (a.error && a.error.code) + ')'; done(); };
        duck(true);
        a.play().then(() => { if (/phát|bấm/.test(lastError)) lastError = ''; }).catch(e => {
          // NotAllowedError: Chrome chặn tự phát âm thanh khi chưa tương tác với trang.
          D('  play() BỊ TỪ CHỐI: ' + (e && e.name) + ' ' + (e && e.message));
          lastError = e && e.name === 'NotAllowedError'
            ? 'Chrome chặn âm thanh: bấm một lần vào trang YouTube rồi xem tiếp'
            : 'Không phát được giọng đọc: ' + ((e && e.message) || e);
          done();
        });
      });
      for (let k = 1; k <= 3; k++) if (cues[idx + k] && cues[idx + k].tr) getTts(idx + k, rv);
      return;
    }

    const u = new SpeechSynthesisUtterance(speakable(c.tr));
    u.voice = voice;
    u.lang = voice.lang;
    u.volume = voiceVol();
    u.rate = Math.min(2, Math.max(1, c.tr.length / 15 / timeLeft()));
    u.onstart = () => D('  giọng máy BẮT ĐẦU đọc');
    u.onend = () => { D('  giọng máy xong'); done(); };
    u.onerror = e => { D('  giọng máy LỖI: ' + (e && e.error)); done(); };
    duck(true);
    speechSynthesis.speak(u);
    // Chrome đôi khi không gọi onend: hết hạn thì coi như đọc xong để hàng đợi không bị kẹt.
    // Ước lượng rộng tay (6 ký tự/giây + 10 giây) để không cắt nhầm giọng đọc chậm.
    const limit = (c.tr.length / 6 / u.rate + 10) * 1000;
    setTimeout(() => { if (!finished && token === dubToken) { speechSynthesis.cancel(); done(); } }, limit);
  }

  function getTts(idx, rv) {
    const c = cues[idx];
    const k = rv + '|' + c.tr;
    if (!ttsCache.has(k)) {
      ttsCache.set(k, send({ type: 'tts', text: speakable(c.tr), voice: rv }).then(r => {
        D('TẠO GIỌNG ' + rv + ': ' + (r.ok ? 'ok engine=' + r.engine + ' ' + (r.audio ? r.audio.length : 0) + ' ký tự base64' + (r.warn ? ' CẢNH BÁO=' + r.warn : '') : 'LỖI ' + r.error));
        if (!r.ok) { lastError = 'Lỗi giọng đọc: ' + r.error; ttsCache.delete(k); return null; }
        if (r.warn) lastError = r.warn;
        const bin = atob(r.audio), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type: r.mime || 'audio/mpeg' }));
      }));
      if (ttsCache.size > 60) {
        const [oldKey, oldVal] = ttsCache.entries().next().value;
        ttsCache.delete(oldKey);
        oldVal.then(u => { if (u) URL.revokeObjectURL(u); });
      }
    }
    return ttsCache.get(k);
  }
})();