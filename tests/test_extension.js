// Bộ test cho extension TransVid. Chạy: node tests/test_extension.js
// Chạy mã thật của extension trong môi trường giả (vm), không cần Chrome.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = process.argv[2] || path.join(__dirname, '..');   // thư mục extension (cha của tests/)
let pass = 0, fail = 0;
const check = (name, ok, got) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (got !== undefined ? '  -> ' + JSON.stringify(got) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadShared() {
  const ctx = { console, chrome: { storage: { local: { get() {} } } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DIR, 'lib/shared.js'), 'utf8') + '\n;this.S = {}; for (const n of ["bsubCleanSource", "bsubSpeakable", "bsubSourceLang", "bsubIsVi", "bsubIsAutoLabel", "bsubPickCaption", "bsubParseVtt", "bsubLangName", "bsubSegmentSentences", "bsubAiOn", "bsubAiId", "bsubNeededOrigins", "bsubParseHlsSubs", "bsubHlsSegments", "bsubIsFastCue"]) { try { this.S[n] = eval(n); } catch (e) { this.S[n] = null; } }', ctx);
  return ctx.S;
}

// Trang YouTube giả: video, nút CC, chrome.* giả; chạy shared.js + content.js thật.
function fakePage({ pageV = 'MAIN', ccPressed = 'false', voice = 'auto', geminiKey = '', cache = null, viaFn = () => 'google', site = 'youtube', tracks = [], files = {}, autoDub = true, store = {}, hiddenTab = false, videoSrc = '', bar = '' } = {}) {
  let msgListener = null; const winL = {}; const changeL = [];
  const trackEls = tracks.map(t => ({ srclang: t.lang, label: t.label, getAttribute: k => (k === 'src' ? t.src : null) }));
  // Phần tử DOM giả tối thiểu (cho nút bật lồng tiếng trên video).
  const mkEl = () => {
    const set = new Set();
    const e = {
      style: { setProperty(k, v) { this[k] = v; } }, children: [], attrs: {}, listeners: {}, textContent: '', title: '', parentNode: null, isBtn: false,
      get parentElement() { return this.parentNode; },
      querySelectorAll() { return this.children.flatMap(c => [c, ...(c.querySelectorAll ? c.querySelectorAll() : [])]).filter(c => c.isBtn); },
      classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), toggle: (c, f) => ((f === undefined ? !set.has(c) : f) ? set.add(c) : set.delete(c)) },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      appendChild(c) { if (c.parentNode) c.remove(); this.children.push(c); c.parentNode = this; return c; },
      get firstChild() { return this.children[0] || null; },
      insertBefore(c, ref) { if (c.parentNode) c.remove(); const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); c.parentNode = this; return c; },
      remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(x => x !== this); this.parentNode = null; } },
      contains(c) { return c === this || this.children.some(x => x === c || (x.contains && x.contains(c))); },
      fire(t) { (this.listeners[t] || []).forEach(f => f({ stopPropagation() {}, preventDefault() {}, stopImmediatePropagation() {} })); },
    };
    return e;
  };
  const player = mkEl();
  // bar: 'yt' = nhóm nút phải YouTube (.ytp-right-controls); 'generic' = trình phát kiểu Udemy: dãy nút trái (Play) + dãy nút phải
  // (barEl > [wrapA > Settings, wrapB > Fullscreen]); logo phải đứng đầu barEl.
  const barEl = mkEl(), playBtn = mkEl(), wrapA = mkEl(), setBtn = mkEl(), leftBar = mkEl(), leftBtn = mkEl();
  const asBtn = (b, label, left) => { b.isBtn = true; b.offsetWidth = 40; b.offsetHeight = 40; b.setAttribute('aria-label', label); b.getBoundingClientRect = () => ({ left, right: left + 40, top: 315, bottom: 355, width: 40, height: 40 }); return b; };
  if (bar === 'yt') { barEl.appendChild(playBtn); player.appendChild(barEl); player.querySelector = s => (/ytp-right-controls/.test(s) ? barEl : null); }
  if (bar === 'vds') {
    // Vidstack (DeepLearning.AI): MỌI nút trái lẫn phải chung một nhóm; logo phải đứng ngay trước nút Captions.
    const sp = mkEl(); sp.getBoundingClientRect = () => ({ left: 100, right: 400, top: 320, bottom: 340, width: 300, height: 20 });
    const zero = mkEl(); zero.getBoundingClientRect = () => ({ left: -300, right: -300, top: 0, bottom: 0, width: 0, height: 0 });
    // Tên chương (SPAN) bắt đầu ở nửa phải nhưng không phải nút: logo không được chèn trước nó.
    const chap = mkEl(); chap.getBoundingClientRect = () => ({ left: 330, right: 490, top: 320, bottom: 340, width: 160, height: 20 });
    barEl.appendChild(asBtn(leftBtn, 'Play', 10)); barEl.appendChild(sp); barEl.appendChild(zero); barEl.appendChild(chap);
    barEl.appendChild(asBtn(playBtn, 'Captions', 500)); barEl.appendChild(asBtn(setBtn, 'Settings', 560));
    player.appendChild(barEl);
    player.querySelector = s => (/vds-caption-button/.test(s) ? playBtn : null);
  }
  if (bar === 'udemy') {
    const wrap = (b, label, left) => { const w = mkEl(); w.getBoundingClientRect = () => ({ left, right: left + 40, top: 315, bottom: 355, width: 40, height: 40 }); w.appendChild(asBtn(b, label, left)); return w; };
    const spacer = mkEl(); spacer.getBoundingClientRect = () => ({ left: 200, right: 500, top: 320, bottom: 340, width: 300, height: 20 });
    barEl.appendChild(wrap(leftBtn, 'Play', 10)); barEl.appendChild(spacer);
    barEl.appendChild(wrap(playBtn, 'Mute', 520));
    const popper = mkEl(); popper.getBoundingClientRect = () => ({ left: 560, right: 600, top: 315, bottom: 355, width: 40, height: 40 });
    popper.appendChild(asBtn(setBtn, 'Captions', 560)); barEl.appendChild(popper);
    player.appendChild(barEl);
  }
  if (bar === 'generic') {
    leftBar.appendChild(asBtn(leftBtn, 'Play', 10)); player.appendChild(leftBar);
    wrapA.appendChild(asBtn(setBtn, 'Settings', 560)); barEl.appendChild(wrapA);
    const wrapB = mkEl(); wrapB.appendChild(asBtn(playBtn, 'Fullscreen', 600)); barEl.appendChild(wrapB);
    player.appendChild(barEl);
  }
  const video = { currentTime: 0, currentSrc: videoSrc, paused: false, volume: 1, muted: false, vl: {}, addEventListener(t, f) { (this.vl[t] = this.vl[t] || []).push(f); }, fire(t) { (this.vl[t] || []).forEach(f => f({ target: this })); }, querySelectorAll: s => (s === 'track' ? trackEls : []), getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 }), parentElement: player, closest: () => player };
  const fetched = [];
  const HOST = { youtube: 'www.youtube.com', udemy: 'www.udemy.com', coursera: 'www.coursera.org', dlai: 'learn.deeplearning.ai' }[site];
  const loc = site === 'youtube' ? { href: 'https://www.youtube.com/watch?v=' + pageV, search: '?v=' + pageV, pathname: '/watch' }
    : { href: 'https://' + HOST + '/learn/x/lecture/' + pageV, search: '', pathname: '/learn/x/lecture/' + pageV };
  // autoDub = true trong test: video này đã được bật từ lần trước (extension chỉ nhớ video đã bật).
  if (autoDub && !store.dubVideos) store.dubVideos = { [site === 'youtube' ? 'yt:' + pageV : 'pg:' + HOST + loc.pathname]: 1 };
  const ccBtn = { clicks: 0, attrs: { 'aria-pressed': ccPressed }, getAttribute(k) { return this.attrs[k]; }, click() { this.clicks++; this.attrs['aria-pressed'] = this.attrs['aria-pressed'] === 'true' ? 'false' : 'true'; } };
  const sent = [];
  const audios = [];   // các Audio giọng đọc đã tạo (test tự gọi onended để giả lập đọc xong)
  const ctx = {
    // hiddenTab: mô phỏng tab ẩn bị Chrome hãm — hẹn giờ ≥ 50ms không bao giờ chạy (chỉ còn sự kiện của video).
    console, setTimeout: hiddenTab ? (f, ms, ...a) => (ms >= 50 ? 0 : setTimeout(f, ms, ...a)) : setTimeout, clearTimeout, URL, URLSearchParams, JSON, Math, Promise, Error, String, Number, isFinite, Map, WeakSet, Object, Array, atob, btoa, Uint8Array,
    Blob: class {}, performance: { getEntriesByType: () => [] },
    location: { ...loc, origin: 'https://' + HOST, hostname: HOST },
    fetch: async url => { fetched.push(url); return { ok: url in files, status: url in files ? 200 : 404, text: async () => files[url] || '' }; },
    getComputedStyle: () => ({ position: 'relative' }),
    document: { title: 'T - YouTube', documentElement: { classList: { toggle() {} } }, addEventListener() {}, createElement: mkEl,
      querySelectorAll: s => (s === 'video' ? [video] : []),
      querySelector: s => (s.includes('subtitles-button') ? (site === 'youtube' ? ccBtn : null) : s.includes('video') ? video : (site === 'youtube' ? { classList: { contains: () => false } } : null)) },
    chrome: {
      runtime: { getManifest: () => ({ version: 'test' }), onMessage: { addListener(f) { msgListener = f; } }, lastError: null,
        sendMessage(m, cb) { sent.push(m); setTimeout(() => cb(m.type === 'translate' ? { ok: true, via: viaFn(m), translations: m.lines.map(l => (viaFn(m) === 'gemini' ? 'GEM ' : 'VI ') + l) } : { ok: true, engine: 'google', audio: btoa('x'), mime: 'audio/mpeg' }), 2); } },
      storage: { local: { get(d, cb) { if (typeof d === 'string') return Promise.resolve(cache && d.startsWith('cache:') ? { [d]: cache } : (d in store ? { [d]: store[d] } : {})); const o = { ...d, voice, geminiKey, ...store }; if (cb) cb(o); else return Promise.resolve(o); }, set: o => { Object.assign(store, o); return Promise.resolve(); }, remove: k => { [].concat(k).forEach(x => delete store[x]); return Promise.resolve(); } }, onChanged: { addListener(f) { changeL.push(f); } } }
    },
    Audio: function () { const a = { play() { return Promise.resolve(); }, pause() {} }; audios.push(a); return a; }
  };
  ctx.URL.createObjectURL = () => 'blob:x';
  ctx.window = ctx; ctx.addEventListener = (t, f) => { (winL[t] = winL[t] || []).push(f); };   // trình duyệt gọi MỌI bộ nghe
  vm.createContext(ctx);
  for (const f of ['lib/shared.js', 'content/content.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
  const win = vm.runInContext('window', ctx);
  const posted = [];
  const realPost = win.postMessage;
  win.postMessage = (d) => posted.push(d);
  const fireMsg = ev => (winL.message || []).forEach(f => f(ev));
  const postCaptions = (v, lines, extra = '&lang=en') => fireMsg({ source: win, data: { __bsub: 'timedtext', url: '/api/timedtext?v=' + v + extra, text: JSON.stringify({ events: lines.map((t, i) => ({ tStartMs: i * 3000, dDurationMs: 3000, segs: [{ utf8: t }] })) }) } });
  const postVtt = (url, text) => fireMsg({ source: win, data: { __bsub: 'vtt', url, text } });
  const diag = () => new Promise(r => msgListener({ type: 'diag' }, {}, r));
  const fireChange = ch => changeL.forEach(f => f(ch, 'local'));
  const status = () => new Promise(r => msgListener({ type: 'status' }, {}, r));
  const btn = () => [player, barEl].flatMap(e => e.children).find(c => c.classList && c.classList.contains('bsub-btn')) || null;
  return { audios, barEl, playBtn, leftBtn, ctx, video, ccBtn, sent, postCaptions, postVtt, posted, fetched, diag, fireChange, status, btn, player, store };
}

(async () => {
  console.log('1. Làm sạch câu gốc trước khi dịch (giữ $ % &, bỏ >> [Music] ♪)');
  const S = loadShared();
  check('có hàm bsubCleanSource', !!S.bsubCleanSource);
  if (S.bsubCleanSource) {
    const c = S.bsubCleanSource('>> make it for $0, 70% & R&D [Music] ♪');
    check('giữ "$0"', c.includes('$0'), c);
    check('giữ "70%"', c.includes('70%'), c);
    check('giữ "R&D"', c.includes('R&D'), c);
    check('bỏ ">>", "[Music]", "♪"', !/>>|\[Music\]|♪/.test(c), c);
  }

  console.log('2. Câu đem đọc: đổi ký hiệu thành chữ, không đọc ký hiệu lạ');
  check('có hàm bsubSpeakable', !!S.bsubSpeakable);
  if (S.bsubSpeakable) {
    const sp = S.bsubSpeakable('Giá chỉ $5 & 70% >> «ok» ≫ ＞ #1');
    check('"$5" -> "5 đô la"', sp.includes('5 đô la'), sp);
    check('"&" -> "và"', / và /.test(sp), sp);
    check('giữ "70%"', sp.includes('70%'), sp);
    check('không còn ký hiệu lạ', !/[$&<>«»≫＞#]/.test(sp), sp);
  }

  console.log('3. Bỏ phụ đề của video khác (quảng cáo, video xem trước)');
  {
    const P = fakePage({ pageV: 'MAIN', ccPressed: 'true' });
    await sleep(20);
    P.postCaptions('AD123', ['Buy now.', 'Limited offer.']);
    await sleep(50);
    const d = await P.diag();
    check('không dùng phụ đề v=AD123', d.cueKey === '', d.cueKey);
    P.postCaptions('MAIN', ['Hello.', 'World.']);
    await sleep(50);
    const d2 = await P.diag();
    check('vẫn dùng phụ đề đúng video', d2.cueKey.startsWith('yt|MAIN|'), d2.cueKey);
  }

  console.log('4. Tự bật CC khi đang lồng tiếng mà CC tắt');
  {
    const P = fakePage({ pageV: 'MAIN', ccPressed: 'false' });
    await sleep(2500);
    check('đã bấm nút CC', P.ccBtn.clicks >= 1, P.ccBtn.clicks);
    check('CC đang bật', P.ccBtn.getAttribute('aria-pressed') === 'true', P.ccBtn.getAttribute('aria-pressed'));
    const P2 = fakePage({ pageV: 'MAIN', ccPressed: 'true' });
    await sleep(2500);
    check('CC đã bật sẵn thì không bấm', P2.ccBtn.clicks === 0, P2.ccBtn.clicks);
  }

  console.log('5. Chọn giọng: không cho chọn giọng sẽ bị thay bằng Google, nói rõ giọng đang dùng');
  {
    const mk = (voices) => {
      const el = (tag) => ({ tag, children: [], label: '', appendChild(c) { this.children.push(c); return c; } });
      const select = { ...el('select'), set textContent(v) { this.children = []; },
        get options() { return this.children.flatMap(c => (c.tag === 'optgroup' ? c.children : [c])); }, value: '' };
      const ctx = { console, document: { createElement: el }, window: {}, chrome: { storage: { local: { get() {} } } },
        Option: function (text, value) { return { tag: 'option', text, value, disabled: false }; } };
      ctx.window.speechSynthesis = { getVoices: () => voices, addEventListener() {} };
      ctx.speechSynthesis = ctx.window.speechSynthesis;
      vm.createContext(ctx);
      for (const f of ['lib/shared.js', 'lib/voices.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
      return { ctx, select };
    };
    const chrome = mk([]);
    vm.runInContext('bsubFillVoices', chrome.ctx)(chrome.select, 'auto', false);
    const nm = chrome.select.options.find(o => o.value === 'namminh');
    check('Chrome không key Azure: Nam Minh bị khoá', nm && nm.disabled, nm);
    const sum = vm.runInContext('bsubVoiceSummary', chrome.ctx)('namminh', false);
    check('báo rõ đang đọc bằng Google', /Google/.test(sum), sum);
    const edge = mk([{ name: 'Microsoft NamMinh Online (Natural) - Vietnamese (Vietnam)', lang: 'vi-VN' }]);
    vm.runInContext('bsubFillVoices', edge.ctx)(edge.select, 'namminh', false);
    const nm2 = edge.select.options.find(o => o.value === 'namminh');
    check('Edge có giọng: Nam Minh chọn được', nm2 && !nm2.disabled, nm2);
    check('Edge: báo dùng đúng giọng NamMinh', /NamMinh/.test(vm.runInContext('bsubVoiceSummary', edge.ctx)('namminh', false)));
  }

  console.log('6. Bỏ thẻ HTML trong phụ đề (<i>…</i>), không để lọt chữ "i"');
  {
    const c = S.bsubCleanSource('<i>Peek. All the answers.</i> <b>Mo</b> waves.');
    check('bỏ thẻ <i> <b>, giữ chữ', c === 'Peek. All the answers. Mo waves.', c);
    const sp = S.bsubSpeakable('<i>Điều gì sẽ xảy ra</i>');
    check('câu đọc không còn "i" lạc', sp === 'Điều gì sẽ xảy ra', sp);
  }

  console.log('7–8. Gemini: hết quota (429) thì tạm ngừng gọi; treo thì hết giờ và dùng Google');
  {
    const mkBg = (geminiMode) => {
      const calls = { gemini: 0, google: 0 };
      const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
      const fetchMock = (url, init = {}) => {
        if (url.includes('/chat/completions')) {
          calls.gemini++;
          if (geminiMode === 'quota') return Promise.resolve(resp(429, { error: { code: 429, message: 'You exceeded your current quota' } }));
          // treo: chỉ kết thúc khi bị huỷ (AbortController)
          return new Promise((_, rej) => { if (init.signal) init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
        }
        calls.google++;
        const q = decodeURIComponent(url.split('&q=')[1] || '');
        return Promise.resolve(resp(200, [[[q.split('\n').map(l => 'VI ' + l).join('\n')]]]));
      };
      const ctx = { console, fetch: fetchMock, setTimeout, clearTimeout, AbortController, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, __bsubGeminiTimeoutMs: 300 };
      ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
        storage: { local: { get(d, cb) { cb({ ...d, geminiKey: 'K' }); }, set: () => Promise.resolve() } } };
      ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
      vm.createContext(ctx);
      vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
      const call = m => new Promise(r => ctx.handler(m, {}, r));
      return { calls, call };
    };
    const Q = mkBg('quota');
    const r1 = await Q.call({ type: 'translate', lang: 'en', lines: ['Hello.'] });
    const g1 = Q.calls.gemini;
    const r2 = await Q.call({ type: 'translate', lang: 'en', lines: ['World.'] });
    check('429: lô đầu vẫn dịch được (Google)', r1.ok && r1.translations[0] === 'VI Hello.', r1);
    check('429: lô sau KHÔNG gọi Gemini nữa', Q.calls.gemini === g1, { before: g1, after: Q.calls.gemini });
    check('429: lô sau vẫn dịch được', r2.ok && r2.translations[0] === 'VI World.', r2);
    const H = mkBg('hang');
    const t0 = Date.now();
    const r3 = await Promise.race([H.call({ type: 'translate', lang: 'en', lines: ['Hi.'] }), sleep(5000).then(() => null)]);
    check('Gemini treo: không kẹt, dùng Google', r3 && r3.ok && r3.translations[0] === 'VI Hi.', r3);
    check('Gemini treo: trả về nhanh (< 3 giây)', Date.now() - t0 < 3000, Date.now() - t0);
  }

  console.log('9. Gemini: model mặc định hết quota (429) thì chuyển sang model flash khác còn lượt');
  {
    const calls = [];
    const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    const fetchMock = async (url, init = {}) => {
      if (url.includes('/models?')) return resp(200, { models: ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-3.5-flash-image']
        .map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) });
      if (url.includes('/chat/completions')) {
        const m = JSON.parse(init.body).model; calls.push(m);
        if (m === 'gemini-flash-latest') return resp(429, { error: { code: 429, message: 'You exceeded your current quota' } });
        if (m === 'gemini-2.5-flash') return resp(404, { error: { code: 404, message: 'no longer available' } });
        return resp(200, { choices: [{ message: { content: '{"lines":{"1":"Xin chào (' + m + ')"}}' } }] });
      }
      const q = decodeURIComponent(url.split('&q=')[1] || '');
      return resp(200, [[['GOOGLE ' + q]]]);
    };
    const ctx = { console, fetch: fetchMock, setTimeout, clearTimeout, AbortController, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, parseFloat };
    ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
      storage: { local: { get(d, cb) { cb({ ...d, geminiKey: 'K' }); }, set: () => Promise.resolve() } } };
    ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
    const call = m => new Promise(r => ctx.handler(m, {}, r));
    const r1 = await call({ type: 'translate', lang: 'en', lines: ['Hello.'] });
    check('vẫn dịch bằng Gemini (model khác)', r1.ok && r1.via === 'gemini' && r1.model === 'gemini-3.5-flash', r1);
    const n = calls.length;
    const r2 = await call({ type: 'translate', lang: 'en', lines: ['Hi.'] });
    check('lô sau không gọi lại model đã hết quota', !calls.slice(n).includes('gemini-flash-latest'), calls.slice(n));
    check('lô sau vẫn dùng Gemini', r2.ok && r2.via === 'gemini', r2);
  }

  console.log('10. Gemini: gửi reasoning_effort "low" (bớt thinking cho nhanh); model không nhận thì gửi lại không có');
  {
    const bodies = [];
    const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    const fetchMock = async (url, init = {}) => {
      if (url.includes('/models?')) return resp(200, { models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] });
      const b = JSON.parse(init.body); bodies.push(b);
      if (b.reasoning_effort) return resp(400, { error: { code: 400, message: 'Request contains an invalid argument.' } });
      return resp(200, { choices: [{ message: { content: '{"lines":{"1":"Xin chào"}}' } }] });
    };
    const ctx = { console, fetch: fetchMock, setTimeout, clearTimeout, AbortController, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, parseFloat };
    ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
      storage: { local: { get(d, cb) { cb({ ...d, geminiKey: 'K' }); }, set: () => Promise.resolve() } } };
    ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
    const r = await new Promise(res => ctx.handler({ type: 'translate', lang: 'en', lines: ['Hello.'] }, {}, res));
    check('lần đầu gửi reasoning_effort=low', bodies[0] && bodies[0].reasoning_effort === 'low', bodies[0]);
    check('bị 400 thì gửi lại không có reasoning_effort, vẫn dùng Gemini', r.ok && r.via === 'gemini' && bodies.length === 2 && !('reasoning_effort' in bodies[1]), { r, n: bodies.length });
  }

  console.log('11. Lô dịch đầu tiên nhỏ (≤ 8 câu) để giọng đọc bắt đầu sớm');
  {
    const P = fakePage({ pageV: 'MAIN', ccPressed: 'true' });
    await sleep(20);
    P.postCaptions('MAIN', Array.from({ length: 60 }, (_, i) => 'This is line number ' + i + '.'));
    await sleep(300);
    const tr = P.sent.filter(m => m.type === 'translate');
    check('lô đầu ≤ 8 câu', tr.length && tr[0].lines.length <= 8, tr.map(m => m.lines.length));
    check('các lô sau vẫn lớn (40 câu)', tr.some(m => m.lines.length === 40), tr.map(m => m.lines.length));
  }

  console.log('12. Cache: bản dịch Google (dự phòng) không được chặn Gemini dịch lại');
  {
    const N = 10, lines = Array.from({ length: N }, (_, i) => 'This is line number ' + i + '.');
    const mkCache = via => lines.map((l, i) => ({ t: 'CACHE ' + i, via }));
    const run = async opts => { const P = fakePage({ pageV: 'MAIN', ccPressed: 'true', ...opts }); await sleep(20); P.postCaptions('MAIN', lines); await sleep(300); return P.sent.filter(m => m.type === 'translate').length; };
    check('có key Gemini + cache của Google -> dịch lại bằng Gemini', (await run({ geminiKey: 'K', cache: mkCache('google') })) > 0);
    check('có key Gemini + cache của Gemini -> dùng cache', (await run({ geminiKey: 'K', cache: mkCache('gemini') })) === 0);
    check('không có key + cache của Google -> dùng cache', (await run({ geminiKey: '', cache: mkCache('google') })) === 0);
  }

  console.log('13. Gemini 503 (model quá tải tạm thời) thì thử model khác trước khi dùng Google');
  {
    const calls = [];
    const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    const fetchMock = async (url, init = {}) => {
      if (url.includes('/models?')) return resp(200, { models: ['gemini-3.6-flash', 'gemini-flash-lite-latest'].map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) });
      if (url.includes('/chat/completions')) {
        const m = JSON.parse(init.body).model; calls.push(m);
        if (m === 'gemini-3.6-flash') return resp(503, { error: { code: 503, message: 'This model is currently experiencing high demand.' } });
        return resp(200, { choices: [{ message: { content: '{"lines":{"1":"Xin chào"}}' } }] });
      }
      return resp(200, [[['GOOGLE']]]);
    };
    const ctx = { console, fetch: fetchMock, setTimeout, clearTimeout, AbortController, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, parseFloat };
    ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
      storage: { local: { get(d, cb) { cb({ ...d, geminiKey: 'K', geminiModel: 'gemini-3.6-flash' }); }, set: () => Promise.resolve() } } };
    ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
    const r = await new Promise(res => ctx.handler({ type: 'translate', lang: 'en', lines: ['Hello.'] }, {}, res));
    check('503: vẫn dịch bằng Gemini (model khác)', r.ok && r.via === 'gemini' && r.model === 'gemini-flash-lite-latest', r);
    const n = calls.length;
    await new Promise(res => ctx.handler({ type: 'translate', lang: 'en', lines: ['Hi.'] }, {}, res));
    check('503: lô sau tạm bỏ qua model quá tải', !calls.slice(n).includes('gemini-3.6-flash'), calls.slice(n));
  }

  console.log('14. Lưu cài đặt mà giá trị không đổi thì KHÔNG dịch lại từ đầu');
  {
    const P = fakePage({ pageV: 'MAIN', ccPressed: 'true', geminiKey: 'K' });
    await sleep(20);
    P.postCaptions('MAIN', ['A.', 'B.', 'C.']);
    await sleep(200);
    const before = P.sent.filter(m => m.type === 'translate').length;
    P.fireChange({ geminiModel: { oldValue: 'gemini-3.6-flash', newValue: 'gemini-3.6-flash' }, geminiKey: { oldValue: 'K', newValue: 'K' }, duck: { oldValue: 0.2, newValue: 0 } });
    await sleep(200);
    check('không gửi dịch lại', P.sent.filter(m => m.type === 'translate').length === before, P.sent.filter(m => m.type === 'translate').length - before);
    P.fireChange({ geminiModel: { oldValue: 'gemini-3.6-flash', newValue: 'gemini-flash-lite-latest' } });
    await sleep(200);
    check('đổi model thật thì vẫn dịch lại', P.sent.filter(m => m.type === 'translate').length > before);
  }

  console.log('15. Câu bị dịch tạm bằng Google (Gemini lỗi) được Gemini dịch lại sau');
  {
    let geminiOk = false;
    const P = fakePage({ pageV: 'MAIN', ccPressed: 'true', geminiKey: 'K', viaFn: () => (geminiOk ? 'gemini' : 'google') });
    globalThis.__bsubUpgradeDelayMs = 0;
    P.ctx.__bsubUpgradeDelayMs = 300;
    await sleep(20);
    P.postCaptions('MAIN', ['A.', 'B.', 'C.']);
    await sleep(150);
    geminiOk = true;
    await sleep(1200);
    const d = await P.diag();
    check('sau đó cả 3 câu là bản Gemini', d.sample.every(x => /^GEM /.test(x.vi)), d.sample.map(x => x.vi));
  }

  console.log('16. Gemini quá giờ thì thử model khác (nhanh hơn) trước khi dùng Google');
  {
    const calls = [];
    const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    const fetchMock = (url, init = {}) => {
      if (url.includes('/models?')) return Promise.resolve(resp(200, { models: ['gemini-3.6-flash', 'gemini-flash-lite-latest'].map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }));
      if (url.includes('/chat/completions')) {
        const m = JSON.parse(init.body).model; calls.push(m);
        if (m === 'gemini-3.6-flash') return new Promise((_, rej) => init.signal && init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        return Promise.resolve(resp(200, { choices: [{ message: { content: '{"lines":{"1":"Xin chào"}}' } }] }));
      }
      return Promise.resolve(resp(200, [[['GOOGLE']]]));
    };
    const ctx = { console, fetch: fetchMock, setTimeout, clearTimeout, AbortController, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, parseFloat, __bsubGeminiTimeoutMs: 200 };
    ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
      storage: { local: { get(d, cb) { cb({ ...d, geminiKey: 'K', geminiModel: 'gemini-3.6-flash' }); }, set: () => Promise.resolve() } } };
    ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
    const r = await new Promise(res => ctx.handler({ type: 'translate', lang: 'en', lines: ['Hello.'] }, {}, res));
    check('quá giờ: dịch bằng model Gemini khác', r.ok && r.via === 'gemini' && r.model === 'gemini-flash-lite-latest', r);
  }

  console.log('17. Ngôn ngữ: dịch được mọi ngôn ngữ, nhận ra phụ đề máy dịch, chọn phụ đề tốt nhất, đọc VTT');
  {
    check('nhận tiếng Tây Ban Nha / Nhật / Pháp', S.bsubSourceLang && S.bsubSourceLang('es') === 'es' && S.bsubSourceLang('ja') === 'ja' && S.bsubSourceLang('fr-FR') === 'fr');
    check('nhận ra tiếng Việt', S.bsubIsVi && S.bsubIsVi('vi') && S.bsubIsVi('vi_VN') && !S.bsubIsVi('en'));
    check('nhận ra nhãn máy dịch', S.bsubIsAutoLabel && ['Vietnamese [Auto]', 'Español (auto)', '한국어 (자동)', '日本語 (オート)'].every(l => S.bsubIsAutoLabel(l)) && !S.bsubIsAutoLabel('English (US) [CC]') && !S.bsubIsAutoLabel('Deutsch'));
    const pick = S.bsubPickCaption || (() => null);
    const a = pick([{ label: 'Tiếng Việt', lang: 'vi' }, { label: 'English', lang: 'en' }]);
    check('có Việt do người làm -> chọn Việt, đọc thẳng', a && a.lang === 'vi' && a.vi === true, a);
    const b = pick([{ label: 'Vietnamese [Auto]', lang: 'vi' }, { label: 'Deutsch', lang: 'de' }, { label: 'English (US) [CC]', lang: 'en' }]);
    check('Việt máy dịch -> bỏ, chọn tiếng Anh do người làm', b && b.lang === 'en' && !b.vi, b);
    const c = pick([{ label: 'Español (auto)', lang: 'es' }, { label: '日本語', lang: 'ja' }]);
    check('không có Anh -> chọn bản người làm còn lại', c && c.lang === 'ja', c);
    const vtt = 'WEBVTT\n\n1\n00:00:08.070 --> 00:00:09.660\n- Think about <v Bob>the feeling</v>\n\n2\n00:01.500 --> 00:03.000\nsecond line\nwraps here\n';
    const cues = S.bsubParseVtt ? S.bsubParseVtt(vtt) : [];
    check('đọc VTT: 2 câu, thời gian đúng', cues.length === 2 && Math.abs(cues[0].start - 8.07) < 0.01 && Math.abs(cues[1].end - 3) < 0.01, cues);
    check('đọc VTT: ghép dòng, giữ chữ', cues[1] && cues[1].text.includes('second line') && cues[1].text.includes('wraps here'), cues[1]);
  }

  console.log('18–19. YouTube: phụ đề Việt do người làm thì đọc thẳng; video nói tiếng Việt thì không lồng tiếng');
  {
    const P = fakePage({ pageV: 'MAIN', ccPressed: 'true' });
    await sleep(20);
    P.postCaptions('MAIN', ['Xin chào các bạn.', 'Hôm nay học AI.'], '&lang=vi');
    await sleep(300);
    const d = await P.diag();
    check('không gửi dịch', P.sent.filter(m => m.type === 'translate').length === 0, P.sent.filter(m => m.type === 'translate').length);
    check('đọc đúng chữ của phụ đề Việt', d.sample[0] && d.sample[0].vi === 'Xin chào các bạn.', d.sample[0]);
    const P2 = fakePage({ pageV: 'MAIN', ccPressed: 'true' });
    await sleep(20);
    P2.postCaptions('MAIN', ['xin chào'], '&lang=vi&kind=asr');
    await sleep(200);
    check('video tiếng Việt (phụ đề tự động tiếng Việt): không lồng tiếng', (await P2.diag()).total === 0);
    const P3 = fakePage({ pageV: 'MAIN', ccPressed: 'true' });
    await sleep(20);
    P3.postCaptions('MAIN', ['Hola.'], '&lang=es');
    await sleep(200);
    check('YouTube tiếng Tây Ban Nha: dịch', P3.sent.some(m => m.type === 'translate' && m.lang === 'es'));
    check('YouTube: nhờ trình phát chuyển sang phụ đề Việt nếu có', P3.posted.some(m => m && m.__bsub === 'preferVi'), P3.posted);
  }

  console.log('20–21. Coursera: đọc thẻ <track>, tải VTT, ưu tiên Việt do người làm');
  {
    const vttEn = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello learners.\n';
    const vttVi = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nChào các bạn học viên.\n';
    const P = fakePage({ site: 'coursera', pageV: 'L1', tracks: [{ label: 'Tiếng Việt (auto)', lang: 'vi', src: '/sub/vi-auto' }, { label: 'English', lang: 'en', src: '/sub/en' }], files: { '/sub/en': vttEn } });
    await sleep(2500);
    check('Coursera: tải phụ đề tiếng Anh (bỏ Việt máy dịch)', P.fetched.includes('/sub/en') && !P.fetched.includes('/sub/vi-auto'), P.fetched);
    check('Coursera: gửi dịch từ tiếng Anh', P.sent.some(m => m.type === 'translate' && m.lang === 'en'), P.sent.map(m => m.type + ':' + m.lang));
    const P2 = fakePage({ site: 'coursera', pageV: 'L2', tracks: [{ label: 'English', lang: 'en', src: '/sub/en' }, { label: 'Tiếng Việt', lang: 'vi', src: '/sub/vi' }], files: { '/sub/en': vttEn, '/sub/vi': vttVi } });
    await sleep(2500);
    const d2 = await P2.diag();
    check('Coursera có Việt do người làm: đọc thẳng, không dịch', P2.sent.filter(m => m.type === 'translate').length === 0 && d2.sample[0] && d2.sample[0].vi === 'Chào các bạn học viên.', { sent: P2.sent.length, s: d2.sample[0] });
  }

  console.log('22. Udemy: bắt tệp VTT trình phát tải về');
  {
    const P = fakePage({ site: 'udemy', pageV: 'U1' });
    await sleep(20);
    P.postVtt('https://vtt-cf.udemycdn.com/123/en_US/2026-a.vtt?Expires=1', 'WEBVTT\n\n1\n00:00.720 --> 00:03.990\n<v Man>Will AI take my job?</v>\n');
    await sleep(3800);   // trang giả không có menu Captions -> sau 3 giây mới dùng tệp đang có
    check('Udemy: dịch từ en_US', P.sent.some(m => m.type === 'translate' && /^en/.test(m.lang) && m.lines[0] === 'Will AI take my job?'), P.sent.map(m => m.lines));
  }

  console.log('23. hook.js: bắt VTT của Udemy; YouTube chuyển sang phụ đề Việt do người làm');
  {
    const mkHook = (tracks) => {
      const posted = [], listeners = [];
      const player = { set: null, getPlayerResponse: () => ({ captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } }), setOption(a, b, c) { this.set = [a, b, c]; } };
      const ctx = { console, Promise, String, JSON, Error, setTimeout,
        location: { origin: 'https://www.youtube.com' },
        document: { getElementById: id => (id === 'movie_player' ? player : null) },
        fetch: async url => ({ clone: () => ({ text: async () => 'WEBVTT\n\n1\n00:00.000 --> 00:01.000\nHi\n' }) }),
        XMLHttpRequest: function () {} };
      ctx.XMLHttpRequest.prototype.open = function () {};
      ctx.window = ctx;
      ctx.postMessage = d => posted.push(d);
      ctx.addEventListener = (t, f) => { if (t === 'message') listeners.push(f); };
      vm.createContext(ctx);
      vm.runInContext(fs.readFileSync(path.join(DIR, 'content/hook.js'), 'utf8'), ctx);
      const win = vm.runInContext('window', ctx);
      return { ctx, posted, player, send: d => listeners.forEach(f => f({ source: win, data: d })) };
    };
    const H = mkHook([]);
    await H.ctx.fetch('https://vtt-cf.udemycdn.com/123/en_US/x.vtt?Expires=1');
    await sleep(20);
    check('bắt VTT Udemy', H.posted.some(d => d.__bsub === 'vtt' && /en_US/.test(d.url) && /Hi/.test(d.text)), H.posted.map(d => d.__bsub));
    await H.ctx.fetch('https://mp4-c.udemycdn.com/123/thumb-sprites.vtt');
    await sleep(20);
    check('bỏ VTT ảnh thu nhỏ', !H.posted.some(d => d.__bsub === 'vtt' && /thumb/.test(d.url)));
    const Y = mkHook([{ languageCode: 'en', kind: '' }, { languageCode: 'vi', kind: 'asr' }, { languageCode: 'vi', kind: '' }]);
    Y.send({ __bsub: 'preferVi' });
    check('có Việt do người làm -> chuyển trình phát sang vi', Y.player.set && Y.player.set[1] === 'track' && Y.player.set[2].languageCode === 'vi', Y.player.set);
    const N = mkHook([{ languageCode: 'en', kind: '' }, { languageCode: 'vi', kind: 'asr' }]);
    N.send({ __bsub: 'preferVi' });
    check('chỉ có Việt tự động -> không chuyển', N.player.set === null, N.player.set);
  }

  console.log('24. Udemy: tệp Việt về TRƯỚC khi đọc được menu -> chưa được đọc thẳng (có thể là bản [Auto])');
  {
    const P = fakePage({ site: 'udemy', pageV: 'U2' });
    await sleep(20);
    P.postVtt('https://vtt-cf.udemycdn.com/9/vi_VN/a.vtt?x=1', 'WEBVTT\n\n1\n00:00.720 --> 00:03.990\nTrí tuệ nhân tạo\n');
    await sleep(300);
    check('chưa đọc bản Việt khi chưa biết nó là người làm hay máy dịch', (await P.diag()).total === 0);
    P.postVtt('https://vtt-cf.udemycdn.com/9/en_US/b.vtt?x=1', 'WEBVTT\r\n\r\n1\r\n00:00:00.720 --> 00:00:03.990\r\n<v Man Typing>Is AI gonna take my job?\r\n');
    await sleep(3800);   // trang giả không có menu Captions -> sau 3 giây mới dùng tệp đang có
    check('bản tiếng Anh (CRLF) vẫn được dịch', P.sent.some(m => m.type === 'translate' && m.lines[0] === 'Is AI gonna take my job?'), P.sent.map(m => m.lines));
  }

  console.log('25. Giao diện tiếng Việt: nhận ra "[Tự động]"; không có bản người làm thì dùng bản tự động của tiếng gốc');
  {
    check('nhận "[Tự động]" / "(tự động)" là máy làm', S.bsubIsAutoLabel('Tiếng Việt [Tự động]') && S.bsubIsAutoLabel('Tiếng Anh [Tự động]') && S.bsubIsAutoLabel('Tiếng Việt (tự động)'));
    const a = S.bsubPickCaption([{ label: 'Tiếng Việt [Tự động]', lang: 'vi' }, { label: 'Tiếng Anh [Tự động]', lang: 'en' }, { label: 'Tiếng Hy Lạp [Tự động]', lang: 'und' }]);
    check('chỉ có bản tự động -> chọn tiếng Anh tự động, KHÔNG đọc Việt máy dịch', a && a.lang === 'en' && !a.vi, a);
    const b = S.bsubPickCaption([{ label: 'Tiếng Việt [Tự động]', lang: 'vi' }]);
    check('chỉ có Việt máy dịch -> không chọn gì', b === null, b);
  }

  console.log('26. Udemy: giữ mọi tệp phụ đề cho tới khi đọc được menu (không dịch bản Hy Lạp Udemy tự tải)');
  {
    const P = fakePage({ site: 'udemy', pageV: 'U3' });
    await sleep(20);
    P.postVtt('https://vtt-cf.udemycdn.com/9/el_GR/a.vtt?x=1', 'WEBVTT\n\n1\n00:00.720 --> 00:03.990\nΚαλώς ήρθατε\n');
    await sleep(300);
    check('chưa dịch bản Hy Lạp khi chưa đọc menu', !P.sent.some(m => m.type === 'translate'), P.sent.map(m => m.lang));
  }

  console.log('27. Đổi phụ đề liên tiếp: không dịch lại câu vừa dịch (lời gọi cache cũ không được kích hoạt dịch lại)');
  {
    const P = fakePage({ pageV: 'MAIN', ccPressed: 'true' });
    await sleep(20);
    P.postCaptions('MAIN', ['Un deux trois quatre.', 'Cinq six sept huit.'], '&lang=fr');
    P.postCaptions('MAIN', ['Hello there my friend.', 'The world is big.'], '&lang=en');
    await sleep(500);
    const en = P.sent.filter(m => m.type === 'translate' && m.lang === 'en');
    const lines = en.flatMap(m => m.lines);
    check('mỗi câu tiếng Anh chỉ gửi dịch 1 lần', lines.length === 2, lines);
  }

  console.log('28. Udemy: không bao giờ chọn nhầm menu tốc độ phát (0.5x)');
  {
    const find = (() => { try { return vm.runInContext('bsubFindCaptionMenu', vm.createContext({})); } catch (e) { return null; } })();
    const ctx = { console, chrome: { storage: { local: { get() {} } } } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'lib/shared.js'), 'utf8'), ctx);
    const fm = (() => { try { return vm.runInContext('bsubFindCaptionMenu', ctx); } catch (e) { return null; } })();
    const menus = [['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x'], ['Tắt', 'Tiếng Anh [Tự động]', 'Tiếng Việt [Tự động]', 'Tiếng Hy Lạp [Tự động]']];
    check('tìm đúng menu phụ đề (menu có "Tắt"/"Off")', fm && fm(menus) === 1, fm && fm(menus));
    check('không có menu nào có "Off" -> không chọn menu nào', fm && fm([['0.5x', '1x']]) === -1);
    const p = S.bsubPickCaption([{ label: '0.5x', lang: 'und' }, { label: '1.25x', lang: 'und' }]);
    check('nhãn tốc độ không bao giờ được chọn làm phụ đề', p === null, p);
  }

  console.log('29. Ghép câu: tách đúng câu dù dòng phụ đề cắt giữa câu, gộp mảnh ngắn, giữ đủ chữ');
  {
    const seg = S.bsubSegmentSentences;
    check('có hàm bsubSegmentSentences', typeof seg === 'function');
    if (typeof seg === 'function') {
      const words = arr => arr.map(c => c.text).join(' ').split(/\s+/).filter(Boolean).join(' ');
      // Một dòng chứa cuối câu này + đầu câu sau.
      const a = seg([
        { start: 0, end: 2, text: 'We start with the basics today. Then we' },
        { start: 2, end: 4, text: 'will learn Python loops.' },
      ], { lang: 'en' });
      check('tách thành 2 câu', a.length === 2, a.map(c => c.text));
      check('câu 2 trọn vẹn', a[1] && a[1].text === 'Then we will learn Python loops.', a[1] && a[1].text);
      check('câu 2 bắt đầu giữa dòng 1 (không phải 0s)', a[1] && a[1].start > 1 && a[1].start < 2, a[1] && a[1].start);
      check('câu 1 bắt đầu 0s, câu 2 kết thúc 4s', a[0] && a[0].start === 0 && a[1] && a[1].end === 4);
      check('kết quả có tr = null', a.every(c => c.tr === null));
      // Mảnh ngắn (< 4 từ) gộp vào câu kế.
      const b = seg([
        { start: 0, end: 0.5, text: 'Okay.' },
        { start: 0.6, end: 3, text: "Let's open the terminal now." },
      ], { lang: 'en' });
      check('mảnh ngắn "Okay." gộp vào câu kế', b.length === 1 && b[0].text === "Okay. Let's open the terminal now." && b[0].start === 0, b.map(c => c.text));
      // Ngừng lâu: không nối dù chưa có dấu chấm.
      const c = seg([
        { start: 0, end: 1, text: 'this is the first part of it' },
        { start: 5, end: 6, text: 'and this is a second part here' },
      ], { lang: 'en' });
      check('ngừng 4s -> 2 câu', c.length === 2, c.map(x => x.text));
      // Số thập phân bị cắt đôi "3." + "5".
      const d = seg([
        { start: 0, end: 1, text: 'the growth rate is 3.' },
        { start: 1, end: 2, text: '5 percent every single year.' },
      ], { lang: 'en' });
      check('nối lại số thập phân 3.5', d.length === 1 && /3\.5 percent/.test(d[0].text), d.map(x => x.text));
      // Phụ đề tự động không dấu câu: chia theo độ dài/thời lượng, không mất chữ.
      const asrIn = Array.from({ length: 30 }, (_, i) => ({ start: i, end: i + 1, text: 'word' + i + ' alpha beta' }));
      const e = seg(asrIn, { lang: 'en', asr: true });
      check('phụ đề tự động dài -> chia nhiều đoạn', e.length >= 2, e.length);
      check('mỗi đoạn ≤ 12s', e.every(x => x.end - x.start <= 12.001), e.map(x => x.end - x.start));
      check('không mất chữ nào', words(e) === words(asrIn));
      check('thứ tự thời gian tăng dần', e.every((x, i) => x.end > x.start && (i === 0 || x.start >= e[i - 1].end - 1e-9)));
      // Câu có dấu quá dài (> 20s) cũng bị chia.
      const longIn = Array.from({ length: 12 }, (_, i) => ({ start: i * 3, end: i * 3 + 3, text: 'and then we keep talking about it' }));
      const f = seg(longIn, { lang: 'en' });
      check('câu dài 36s -> chia, mỗi đoạn ≤ 20s', f.length >= 2 && f.every(x => x.end - x.start <= 20.001), f.map(x => x.end - x.start));
      check('câu dài: không mất chữ', words(f) === words(longIn));
      // Không có Intl.Segmenter (trình duyệt cũ): vẫn tách câu bằng dấu chấm.
      const ctx2 = { console };
      vm.createContext(ctx2);
      vm.runInContext('Intl.Segmenter = undefined;' + fs.readFileSync(path.join(DIR, 'lib/shared.js'), 'utf8'), ctx2);
      const g = vm.runInContext('bsubSegmentSentences', ctx2)([
        { start: 0, end: 2, text: 'We start with the basics today. Then we' },
        { start: 2, end: 4, text: 'will learn Python loops.' },
      ], { lang: 'en' });
      check('không có Segmenter -> vẫn tách 2 câu', g.length === 2 && g[1].text === 'Then we will learn Python loops.', g.map(x => x.text));
      // Ngôn ngữ lạ / 'und' không làm hỏng.
      check('lang "und" không lỗi', seg([{ start: 0, end: 1, text: 'Hello there my friend.' }], { lang: 'und' }).length === 1);
      // Tiếng Trung (không có dấu cách).
      const h = seg([
        { start: 0, end: 2, text: '今天我们学习编程。然后' },
        { start: 2, end: 4, text: '我们写第一个程序。' },
      ], { lang: 'zh' });
      check('tiếng Trung: 2 câu, không chèn dấu cách', h.length === 2 && h[1].text === '然后我们写第一个程序。', h.map(x => x.text));
    }
  }

  console.log('30. Nút bật lồng tiếng trên video: mặc định tắt, không tự dịch bừa');
  {
    const tr = P => P.sent.filter(m => m.type === 'translate').length;
    // Tắt: không tự bật CC.
    const A = fakePage({ autoDub: false, ccPressed: 'false' });
    await sleep(2300);
    check('tắt: không tự bật CC', A.ccBtn.clicks === 0, A.ccBtn.clicks);
    check('có nút trên video', !!A.btn());
    check('nút ghi trạng thái tắt', A.btn() && /tắt/i.test(A.btn().textContent), A.btn() && A.btn().textContent);
    check('nút có class bsub-host ở khung video', A.player.classList.contains('bsub-host'));
    // Tắt: phụ đề đến cũng không dịch, không đổi phụ đề trình phát.
    const B = fakePage({ autoDub: false, ccPressed: 'true' });
    await sleep(20);
    B.postCaptions('MAIN', ['This is the first line.', 'This is the second line.']);
    await sleep(400);
    check('tắt: không gửi dịch', tr(B) === 0, tr(B));
    check('tắt: không chuyển phụ đề (preferVi)', !B.posted.some(d => d && d.__bsub === 'preferVi'));
    check('status báo on=false', (await B.status()).on === false);
    // Bấm nút: bật, dịch ngay phụ đề đã có.
    B.btn().fire('click');
    await sleep(700);
    check('bấm nút -> gửi dịch', tr(B) > 0, tr(B));
    check('bấm nút -> thử chuyển sang phụ đề Việt', B.posted.some(d => d && d.__bsub === 'preferVi'));
    check('status báo on=true', (await B.status()).on === true);
    check('nút không còn ghi "tắt"', !/tắt/i.test(B.btn().textContent), B.btn().textContent);
    check('nhớ video đã bật', B.store.dubVideos && B.store.dubVideos['yt:MAIN'] === 1, B.store.dubVideos);
    // Bấm lại: tắt.
    B.btn().fire('click');
    await sleep(300);
    check('bấm lại -> tắt', (await B.status()).on === false);
    check('bấm lại -> chỉ tắt lần xem này, vẫn còn trong lịch sử', B.store.dubVideos && B.store.dubVideos['yt:MAIN'] === 1, B.store.dubVideos);
    // Video đã bật lần trước: tự bật.
    const C = fakePage({ autoDub: false, ccPressed: 'true', store: { dubVideos: { 'yt:MAIN': 1 } } });
    await sleep(20);
    C.postCaptions('MAIN', ['This is the first line.', 'This is the second line.']);
    await sleep(400);
    check('video đã bật lần trước -> tự dịch', tr(C) > 0, tr(C));
    // Dữ liệu cũ (bản trước) nhớ video là tắt (0): coi như mặc định tắt, bấm một lần là bật.
    const E = fakePage({ autoDub: false, ccPressed: 'true', store: { dubVideos: { 'yt:MAIN': 0 }, autoDub: true } });
    await sleep(20);
    E.postCaptions('MAIN', ['This is the first line.', 'This is the second line.']);
    await sleep(400);
    check('không còn "tự bật mọi video": video chưa bật -> không dịch', tr(E) === 0, tr(E));
    E.btn().fire('click');
    await sleep(700);
    check('video bị nhớ tắt (dữ liệu cũ) -> bấm một lần là bật', (await E.status()).on === true && tr(E) > 0, tr(E));
    // Coursera tắt: không tải phụ đề; bấm nút mới tải.
    const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nHello there my good friend.\n';
    const F = fakePage({ site: 'coursera', autoDub: false, tracks: [{ lang: 'en', label: 'English', src: '/sub/en.vtt' }], files: { '/sub/en.vtt': vtt } });
    await sleep(1600);
    check('Coursera tắt: không tải phụ đề', F.fetched.length === 0, F.fetched);
    F.btn().fire('click');
    await sleep(1600);
    check('Coursera bấm nút -> tải phụ đề và dịch', F.fetched.length === 1 && tr(F) > 0, [F.fetched, tr(F)]);
    // Tắt công tắc tổng: ẩn nút.
    const G = fakePage({ autoDub: false });
    await sleep(700);
    G.fireChange({ enabled: { oldValue: true, newValue: false } });
    await sleep(700);
    check('tắt công tắc tổng -> ẩn nút', !G.btn() || G.btn().style.display === 'none', G.btn() && G.btn().style.display);
  }

  console.log('31. Đang lồng tiếng: tắt hẳn tiếng video gốc, tắt lồng tiếng thì bật lại');
  {
    const A = fakePage({ autoDub: false });
    await sleep(700);
    check('chưa bật: video gốc còn tiếng', A.video.muted === false);
    A.btn().fire('click');
    await sleep(700);
    check('bật nhưng chưa có phụ đề: GIỮ tiếng gốc (không im lặng)', A.video.muted === false);
    A.postCaptions('MAIN', ['This is the first line here.']);
    await sleep(700);
    check('có phụ đề để đọc: tắt hẳn tiếng video gốc', A.video.muted === true);
    A.btn().fire('click');
    await sleep(700);
    check('bấm tắt: bật lại tiếng video gốc', A.video.muted === false);
    // Đang lồng tiếng mà loa bị bật lại (trình phát / người dùng): tắt hẳn lại.
    A.btn().fire('click');
    await sleep(700);
    A.video.muted = false; A.video.fire('volumechange');
    await sleep(700);
    check('đang lồng tiếng, loa bị bật lại -> tắt tiếng gốc lại', A.video.muted === true);
    A.btn().fire('click');
    await sleep(700);
    check('tắt lồng tiếng -> bật lại tiếng gốc', A.video.muted === false);
    // Video đã bị người dùng tắt tiếng từ trước: tắt lồng tiếng không tự bật loa.
    const B = fakePage({ autoDub: false });
    B.video.muted = true;
    await sleep(700);
    B.postCaptions('MAIN', ['This is the first line here.']);
    B.btn().fire('click'); await sleep(700);
    B.btn().fire('click'); await sleep(700);
    check('video tự tắt tiếng từ trước -> vẫn giữ tắt tiếng', B.video.muted === true);
    // Tắt công tắc tổng: bật lại tiếng gốc.
    const E = fakePage({ autoDub: true });
    await sleep(700);
    E.postCaptions('MAIN', ['This is the first line here.']);
    await sleep(700);
    check('tự bật + có phụ đề: tắt tiếng gốc', E.video.muted === true);
    E.fireChange({ enabled: { oldValue: true, newValue: false } });
    await sleep(700);
    check('tắt công tắc tổng -> bật lại tiếng gốc', E.video.muted === false);
  }

  console.log('32. Key thuê (API tương thích OpenAI, vd Vilao): gọi đúng địa chỉ, model, key; lỗi thì dùng Google');
  {
    const mk = (store, fetchMock) => {
      const ctx = { console, fetch: fetchMock, setTimeout, clearTimeout, AbortController, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, parseFloat };
      ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
        storage: { local: { get(d, cb) { cb({ ...d, ...store }); }, set: () => Promise.resolve() } } };
      ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
      vm.createContext(ctx);
      vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
      return m => new Promise(r => ctx.handler(m, {}, r));
    };
    const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    const google = url => { const q = decodeURIComponent(url.split('&q=')[1] || ''); return resp(200, [[['GOOGLE ' + q]]]); };
    const VILAO = { apiBase: 'https://api.vilao.ai/v1/', apiModel: 'chib/gemini-3.8-flash', apiKey: 'SK' };
    const seen = [];
    const call = mk(VILAO, async (url, init = {}) => {
      seen.push({ url, auth: init.headers && init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null });
      if (url.includes('/chat/completions')) return resp(200, { choices: [{ message: { content: '{"lines":{"1":"Xin chào"}}' } }] });
      return google(url);
    });
    const r = await call({ type: 'translate', lang: 'en', lines: ['Hello.'] });
    const c = seen.find(s => s.url.includes('/chat/completions'));
    check('gọi đúng địa chỉ (bỏ dấu / thừa)', c && c.url === 'https://api.vilao.ai/v1/chat/completions', c && c.url);
    check('gửi đúng key', c && c.auth === 'Bearer SK', c && c.auth);
    check('gửi đúng model', c && c.body.model === 'chib/gemini-3.8-flash', c && c.body.model);
    check('không gọi Gemini của Google', !seen.some(s => s.url.includes('generativelanguage')));
    check('dịch bằng AI, báo đúng model', r.ok && r.via === 'gemini' && r.model === 'chib/gemini-3.8-flash' && r.translations[0] === 'Xin chào', r);
    // Có cả key thuê lẫn key Gemini: ưu tiên key thuê.
    const seenB = [];
    const callB = mk({ ...VILAO, geminiKey: 'AIzaX' }, async (url, init = {}) => { seenB.push(url); return url.includes('/chat/completions') ? resp(200, { choices: [{ message: { content: '{"lines":{"1":"A"}}' } }] }) : google(url); });
    await callB({ type: 'translate', lang: 'en', lines: ['Hello.'] });
    check('có cả hai key -> dùng key thuê', seenB.some(u => u.includes('vilao')) && !seenB.some(u => u.includes('generativelanguage')), seenB);
    // Lỗi (hết tiền / key sai): dùng Google, có cảnh báo.
    const call2 = mk(VILAO, async url => (url.includes('/chat/completions') ? resp(401, { error: { message: 'Invalid token' } }) : google(url)));
    const r2 = await call2({ type: 'translate', lang: 'en', lines: ['Hello.'] });
    check('nhà cung cấp lỗi -> Google Dịch + cảnh báo', r2.ok && r2.via === 'google' && /401/.test(r2.warn || ''), r2);
    // Thiếu key thuê: không gọi Vilao, dùng Google.
    const seen3 = [];
    const call3 = mk({ ...VILAO, apiKey: '' }, async url => { seen3.push(url); return google(url); });
    const r3 = await call3({ type: 'translate', lang: 'en', lines: ['Hello.'] });
    check('chưa có key thuê -> Google, không gọi nhà cung cấp', r3.via === 'google' && !seen3.some(u => u.includes('vilao')), [r3.via, seen3]);
    // Nút thử dịch trong Cài đặt dùng key thuê.
    const call4 = mk(VILAO, async url => (url.includes('/chat/completions') ? resp(200, { choices: [{ message: { content: '{"lines":{"1":"Xin chào, bạn khoẻ không?"}}' } }] }) : google(url)));
    const r4 = await call4({ type: 'test' });
    check('nút thử dịch dùng key thuê', r4.ok && /chib\/gemini-3.8-flash/.test(r4.reply || ''), r4);
    // shared.js
    check('bsubAiOn: có key thuê = có AI', S.bsubAiOn && S.bsubAiOn({ ...VILAO, geminiKey: '' }) === true);
    check('bsubAiOn: không key nào = không', S.bsubAiOn && S.bsubAiOn({ ...VILAO, apiKey: '', geminiKey: '' }) === false);
    check('bsubAiId khác nhau theo nguồn dịch', S.bsubAiId && S.bsubAiId(VILAO) !== S.bsubAiId({ geminiKey: 'K', geminiModel: 'gemini-flash-latest' }) && S.bsubAiId({ geminiKey: '' }) === 'google');
  }

  console.log('33. Vilao: địa chỉ API + model cố định trong mã; key chỉ lấy từ Cài đặt');
  {
    const c = { console }; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(DIR, 'lib/shared.js'), 'utf8'), c);
    check('mặc định địa chỉ API = Vilao', vm.runInContext('BSUB_DEFAULTS.apiBase', c) === 'https://api.vilao.ai/v1');
    check('mặc định model = chib/gemini-3.8-flash', vm.runInContext('BSUB_DEFAULTS.apiModel', c) === 'chib/gemini-3.8-flash');
    check('mặc định không có key', vm.runInContext('BSUB_DEFAULTS.apiKey', c) === '');
    check('background không nạp key từ file', !/local\.js|BSUB_LOCAL/.test(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8')));
    check('Cài đặt không còn ô địa chỉ / model', !/id="apiBase"|id="apiModel"/.test(fs.readFileSync(path.join(DIR, 'options/options.html'), 'utf8')));
  }

  console.log('34. Đang đọc: không đổi âm lượng video (tiếng gốc đã tắt hẳn, không cần giảm âm lượng)');
  {
    const P = fakePage({ ccPressed: 'true' });
    await sleep(20);
    P.postCaptions('MAIN', ['This is the first line here.', 'This is the second line here.']);
    await sleep(400);
    P.video.currentTime = 0.1;
    await sleep(400);
    check('âm lượng video giữ nguyên khi đọc', P.video.volume === 1, P.video.volume);
    check('bỏ cài đặt duck', !/\bduck\b/.test(fs.readFileSync(path.join(DIR, 'lib/shared.js'), 'utf8')));
  }

  console.log('38. Tab ẩn: trình duyệt / YouTube dừng video đang tắt tiếng -> tự chạy lại (người dùng tự dừng thì không)');
  {
    const P = fakePage({ ccPressed: 'true' });
    let plays = 0;
    P.video.play = () => { plays++; P.video.paused = false; return Promise.resolve(); };
    await sleep(100);
    P.postCaptions('MAIN', ['This is the first line here.']);   // chỉ tắt tiếng gốc khi đã có câu
    await sleep(700);
    check('đang lồng tiếng: video bị tắt tiếng', P.video.muted === true);
    // Người dùng tự dừng khi tab đang hiện: không tự chạy lại.
    P.ctx.document.hidden = false;
    P.video.paused = true; P.video.fire('pause');
    await sleep(100);
    check('tab đang hiện, người dùng dừng -> không tự chạy lại', plays === 0, plays);
    // Tab ẩn: bị dừng -> tự chạy lại.
    P.ctx.document.hidden = true;
    P.video.paused = true; P.video.fire('pause');
    await sleep(100);
    check('tab ẩn, video bị dừng -> tự chạy lại', plays === 1 && P.video.paused === false, plays);
    // Bị dừng liên tục: chỉ thử tối đa 3 lần (không lặp vô hạn).
    for (let i = 0; i < 5; i++) { P.video.paused = true; P.video.fire('pause'); await sleep(30); }
    check('chỉ tự chạy lại tối đa 3 lần mỗi lần ẩn tab', plays === 3, plays);
    // Tắt lồng tiếng: không can thiệp nữa.
    const Q = fakePage({ autoDub: false });
    let qp = 0;
    Q.video.play = () => { qp++; return Promise.resolve(); };
    await sleep(700);
    Q.ctx.document.hidden = true;
    Q.video.paused = true; Q.video.fire('pause');
    await sleep(100);
    check('không lồng tiếng -> không can thiệp', qp === 0, qp);
  }

  console.log('37. Giọng Google: gọi không kèm cookie (cookie đăng nhập Google làm bị chuyển hướng -> Failed to fetch); có phép dò');
  {
    const inits = [];
    const resp = (status, body) => ({ ok: status < 300, status, type: 'basic', json: async () => body, text: async () => '', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    const ctx = { console, fetch: async (url, init = {}) => { inits.push({ url, init }); return resp(200, {}); }, setTimeout, clearTimeout, AbortController, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, parseFloat };
    ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
      storage: { local: { get(d, cb) { cb({ ...d }); }, set: () => Promise.resolve() } } };
    ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
    const call = m => new Promise(r => ctx.handler(m, {}, r));
    const r = await call({ type: 'tts', text: 'Xin chào', voice: 'google' });
    const tts = inits.find(x => x.url.includes('translate_tts'));
    check('tạo giọng Google ok', r.ok && r.engine === 'google', r);
    check('gọi giọng Google không kèm cookie', tts && tts.init.credentials === 'omit', tts && tts.init);
    const p = await Promise.race([call({ type: 'probeTts' }), sleep(1000).then(() => ({ ok: false, error: 'không trả lời' }))]);
    check('có phép dò giọng Google (có cookie / không cookie)', p.ok && typeof p.withCookies === 'string' && typeof p.noCookies === 'string', p);
  }

  console.log('36. Quyền truy cập cần có (để Cài đặt xin lại khi Chrome chặn, Chẩn đoán báo rõ)');
  {
    const f = S.bsubNeededOrigins;
    check('có hàm bsubNeededOrigins', typeof f === 'function');
    if (typeof f === 'function') {
      const base = f({ apiKey: '', geminiKey: '', azureKey: '', apiBase: 'https://api.vilao.ai/v1' });
      check('luôn cần Google Dịch + giọng Google', base.includes('https://translate.googleapis.com/*') && base.includes('https://translate.google.com/*'), base);
      check('không key -> không xin Vilao / Gemini / Azure', !base.some(o => /vilao|generativelanguage|microsoft/.test(o)), base);
      const all = f({ apiKey: 'SK', geminiKey: 'G', azureKey: 'A', apiBase: 'https://api.vilao.ai/v1' });
      check('có key -> xin đúng địa chỉ của key', ['https://api.vilao.ai/*', 'https://generativelanguage.googleapis.com/*', 'https://*.tts.speech.microsoft.com/*'].every(o => all.includes(o)), all);
    }
  }

  console.log('35. Chuyển sang tab khác (Chrome hãm hẹn giờ): vẫn đọc tiếp nhờ sự kiện timeupdate của video');
  {
    const P = fakePage({ ccPressed: 'true', hiddenTab: true });
    await sleep(20);
    P.postCaptions('MAIN', ['This is the first line here.', 'This is the second line here.']);
    await sleep(300);
    const said = () => P.sent.filter(m => m.type === 'tts').map(m => m.text || '');
    P.video.currentTime = 0.2; P.video.fire('timeupdate');
    await sleep(300);
    check('tab ẩn: video chạy tới câu đầu -> vẫn đọc', said().some(t => /first/.test(t)), said());
    P.video.currentTime = 3.2; P.video.fire('timeupdate');
    await sleep(300);
    check('tab ẩn: tới câu thứ hai -> đọc tiếp', said().some(t => /second/.test(t)), said());
  }

  console.log('39. Hết giờ phải phủ cả lúc đọc body (header về rồi body treo)');
  {
    const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    const ctx = { console, setTimeout, clearTimeout, AbortController, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, parseFloat, __bsubGeminiTimeoutMs: 300 };
    ctx.fetch = (url, init = {}) => {
      if (url.includes('/chat/completions')) {
        // header về ngay, nhưng body chỉ kết thúc khi bị huỷ
        return Promise.resolve({ ok: true, status: 200, text: async () => '',
          json: () => new Promise((_, rej) => { if (init.signal) init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) });
      }
      const q = decodeURIComponent(url.split('&q=')[1] || '');
      return Promise.resolve(resp(200, [[[q.split('\n').map(l => 'VI ' + l).join('\n')]]]));
    };
    ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
      storage: { local: { get(d, cb) { cb({ ...d, geminiKey: 'K' }); }, set: () => Promise.resolve() } } };
    ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
    const t0 = Date.now();
    const r = await Promise.race([new Promise(res => ctx.handler({ type: 'translate', lang: 'en', lines: ['Hi.'] }, {}, res)), sleep(5000).then(() => null)]);
    check('body treo: không kẹt, dùng Google', r && r.ok && r.translations[0] === 'VI Hi.', r);
    check('body treo: trả về nhanh (< 3 giây)', Date.now() - t0 < 3000, Date.now() - t0);
  }

  console.log('40. Lỗi 400 chỉ khoá Gemini khi nói về key; 400 khác chỉ ảnh hưởng lô đó');
  {
    const mk = errMsg => {
      const calls = { gemini: 0 };
      const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
      const ctx = { console, setTimeout, clearTimeout, AbortController, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, parseFloat };
      ctx.fetch = async url => {
        if (url.includes('/chat/completions')) { calls.gemini++; return resp(400, { error: { code: 400, message: errMsg } }); }
        const q = decodeURIComponent(url.split('&q=')[1] || '');
        return resp(200, [[[q.split('\n').map(l => 'VI ' + l).join('\n')]]]);
      };
      ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
        storage: { local: { get(d, cb) { cb({ ...d, geminiKey: 'K' }); }, set: () => Promise.resolve() } } };
      ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
      vm.createContext(ctx);
      vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
      return { calls, call: m => new Promise(r => ctx.handler(m, {}, r)) };
    };
    const A = mk('Request contains an invalid argument.');
    await A.call({ type: 'translate', lang: 'en', lines: ['Hello.'] });
    const a1 = A.calls.gemini;
    const ra = await A.call({ type: 'translate', lang: 'en', lines: ['World.'] });
    check('400 không liên quan key: lô sau vẫn thử Gemini', A.calls.gemini > a1, { before: a1, after: A.calls.gemini });
    check('400 không liên quan key: vẫn dịch được (Google)', ra.ok && ra.translations[0] === 'VI World.', ra);
    const B = mk('API key not valid. Please pass a valid API key.');
    await B.call({ type: 'translate', lang: 'en', lines: ['Hello.'] });
    const b1 = B.calls.gemini;
    await B.call({ type: 'translate', lang: 'en', lines: ['World.'] });
    check('400 do key sai: lô sau KHÔNG gọi Gemini nữa', B.calls.gemini === b1, { before: b1, after: B.calls.gemini });
    const C = mk('max_tokens is too large: 99999. This model supports at most 8192 completion tokens.');
    await C.call({ type: 'translate', lang: 'en', lines: ['Hello.'] });
    const c1 = C.calls.gemini;
    await C.call({ type: 'translate', lang: 'en', lines: ['World.'] });
    check('400 nhắc "tokens" (không phải key): không khoá', C.calls.gemini > c1, { before: c1, after: C.calls.gemini });
  }

  console.log('41. Cache dịch gắn phiên bản prompt');
  {
    check('shared.js có BSUB_PROMPT_VERSION', /BSUB_PROMPT_VERSION\s*=\s*\d+/.test(fs.readFileSync(path.join(DIR, 'lib/shared.js'), 'utf8')));
    const P = fakePage({ pageV: 'MAIN', ccPressed: 'true', geminiKey: 'K', viaFn: () => 'gemini' });
    await sleep(20);
    P.postCaptions('MAIN', ['This is the first line here.']);
    await sleep(1900);
    const ids1 = Object.keys(P.store).filter(k => k.startsWith('cache:'));
    check('có ghi cache', ids1.length === 1, ids1);
    const code = fs.readFileSync(path.join(DIR, 'content/content.js'), 'utf8');
    check('khoá cache dùng BSUB_PROMPT_VERSION', /cacheId\s*=.*BSUB_PROMPT_VERSION/.test(code));
    // Khoá cũ là hash('v5|' + cueKey + ...): bản này không được làm mất cache đã có.
    // Khoá cache = 'v' + BSUB_PROMPT_VERSION (5 = khoá 'v5|' cũ; tăng lên khi đổi prompt để dịch lại).
    check('khoá cache theo BSUB_PROMPT_VERSION (định dạng v<số>|)', vm.runInContext('typeof BSUB_PROMPT_VERSION !== "undefined" && BSUB_PROMPT_VERSION', P.ctx) >= 5 && /hash\('v' \+ BSUB_PROMPT_VERSION \+ '\|' \+ (\(fullMode\(\) \? 'full\|' : ''\) \+ )?cueKey/.test(code));
  }

  console.log('42. Dọn cache: quá hạn (TTL) và vượt giới hạn (LRU)');
  {
    const DAY = 864e5, now = Date.now(), store = { cacheIndex: {} };
    const put = (id, age) => { store['cache:' + id] = [{ t: 'x', via: 'google' }]; if (age !== null) store.cacheIndex['cache:' + id] = now - age; };
    put('old', 40 * DAY);            // quá 30 ngày
    put('legacy', null);             // bản cũ chưa có chỉ mục -> coi như vừa dùng
    for (let i = 0; i < 205; i++) put('l' + i, (i + 1) * 60000);   // trong hạn, i nhỏ = mới hơn
    const P = fakePage({ pageV: 'MAIN', ccPressed: 'true', store });
    await sleep(20);
    P.postCaptions('MAIN', ['This is the first line here.']);
    await sleep(2400);
    const ids = Object.keys(store).filter(k => k.startsWith('cache:'));
    check('bản quá 30 ngày bị xoá', !('cache:old' in store));
    check('tổng số cache <= 200', ids.length <= 200, ids.length);
    check('bản mới dùng gần đây còn', 'cache:l0' in store);
    check('bản lâu chưa dùng nhất bị xoá (LRU)', !('cache:l204' in store));
    check('bản cũ chưa có chỉ mục không bị xoá oan', 'cache:legacy' in store);
    check('cache của video đang xem còn', ids.some(k => !/^cache:(l\d+|old|legacy)$/.test(k)), ids.length);
  }

  console.log('43. Nút trên video dùng logo của extension');
  {
    const mf = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
    const css = fs.readFileSync(path.join(DIR, 'content/content.css'), 'utf8');
    const m = /url\(["']?chrome-extension:\/\/__MSG_@@extension_id__\/(icons\/[\w.]+)["']?\)/.exec(css);
    check('CSS nút dùng ảnh logo trong icons/', !!m, m);
    check('logo được khai trong web_accessible_resources', !!m && (mf.web_accessible_resources || []).some(w => w.resources.includes(m[1]) && w.matches.some(x => /youtube/.test(x)) && w.matches.some(x => /udemy/.test(x)) && w.matches.some(x => /coursera/.test(x))), mf.web_accessible_resources);
    check('file logo có thật', !!m && fs.existsSync(path.join(DIR, m[1])));
    check('không còn chữ "VI" làm biểu tượng', !/content:\s*"VI"/.test(css));
    const P = fakePage({ ccPressed: 'false', autoDub: false });
    await sleep(700);
    check('nút vẫn ghi trạng thái (cho trình đọc màn hình)', P.btn() && /tắt/i.test(P.btn().textContent), P.btn() && P.btn().textContent);
    check('rê chuột (tắt): gợi ý "Bật lồng tiếng"', P.btn() && P.btn().getAttribute('data-tip') === 'Bật lồng tiếng', P.btn() && P.btn().attrs);
    check('không dùng title (tránh hiện 2 gợi ý)', P.btn() && !P.btn().title, P.btn() && P.btn().title);
    P.btn().fire('click');
    await sleep(700);
    check('rê chuột (bật): gợi ý "Tắt lồng tiếng"', P.btn().getAttribute('data-tip') === 'Tắt lồng tiếng', P.btn().attrs);
    check('CSS: logo không mở rộng khi rê chuột', !/\.bsub-btn:hover\s*\{[^}]*font-size:\s*13px/.test(css));
    // Gợi ý là phần tử riêng gắn vào trình phát (thanh điều khiển YouTube có overflow:hidden, ::after bị cắt).
    P.btn().fire('mouseenter');
    const tipEl = () => P.player.children.find(c => c.classList && c.classList.contains('bsub-tip'));
    check('rê chuột: hiện gợi ý trong trình phát', tipEl() && tipEl().classList.contains('bsub-tip-on') && tipEl().textContent === 'Tắt lồng tiếng', tipEl() && tipEl().textContent);
    P.btn().fire('mouseleave');
    check('rời chuột: ẩn gợi ý', tipEl() && !tipEl().classList.contains('bsub-tip-on'));
    check('CSS: không dùng ::after cho gợi ý (bị cắt trong thanh điều khiển)', !/bsub-btn[^{]*::after/.test(css) && /\.bsub-tip\s*\{/.test(css));
    const btnRules = (css.match(/\.bsub-btn(\.bsub-on)?(:hover)?\s*\{[^}]*\}/g) || []).join('\n');
    check('CSS: chỉ có logo, không khung / nền / viền', !/rgba\(|box-shadow:\s*0|border-radius:\s*1\dpx|padding:\s*[1-9]/.test(btnRules), btnRules);
  }

  console.log('45. Logo là nút đầu tiên của nhóm nút bên phải trong thanh điều khiển (giống YouTube Dubbing)');
  {
    const Y = fakePage({ ccPressed: 'false', autoDub: false, bar: 'yt' });
    await sleep(700);
    const yi = Y.barEl.children.indexOf(Y.btn());
    check('YouTube: logo đứng đầu .ytp-right-controls', yi === 0 && Y.barEl.children[1] === Y.playBtn, Y.barEl.children.length);
    check('YouTube: logo có lớp bsub-inbar', Y.btn() && Y.btn().classList.contains('bsub-inbar'));
    await sleep(700);
    check('YouTube: không chèn lặp mỗi nhịp', Y.barEl.children.filter(c => c.classList && c.classList.contains('bsub-btn')).length === 1);
    const U = fakePage({ site: 'udemy', ccPressed: 'false', autoDub: false, bar: 'generic' });
    await sleep(700);
    const ui = U.barEl.children.indexOf(U.btn());
    check('Udemy/Coursera/DLAI: logo đứng ngoài cùng trái của cả dãy nút phải', ui === 0 && U.barEl.children.length === 3, [ui, U.barEl.children.length]);
    check('Udemy/Coursera/DLAI: logo cùng cỡ nút bên cạnh', U.btn().style['--bsub-w'] === '40px' && U.btn().style['--bsub-h'] === '40px', U.btn().style);
    check('Udemy/Coursera/DLAI: không nhảy sang dãy nút trái', !U.player.children[0].children.includes(U.btn()));
    const V = fakePage({ site: 'dlai', ccPressed: 'false', autoDub: false, bar: 'vds' });
    await sleep(700);
    const vi = V.barEl.children.indexOf(V.btn());
    check('Vidstack (DeepLearning.AI): logo ngay trước nút Captions, sau nút Play', vi > 0 && V.barEl.children[vi + 1] === V.playBtn && V.barEl.children.indexOf(V.leftBtn) < vi, V.barEl.children.map(c => c.attrs['aria-label'] || (c.classList.contains('bsub-btn') ? 'LOGO' : '-')));
    await sleep(700);
    check('Vidstack: không chèn lại mỗi nhịp', V.barEl.children.filter(c => c.classList && c.classList.contains('bsub-btn')).length === 1);
    // Vidstack dựng lại thanh nút: gỡ nút Captions rồi gắn lại ở chỗ khác -> logo phải tự về lại ngay trước Captions.
    V.barEl.children = V.barEl.children.filter(c => c !== V.playBtn); V.playBtn.parentNode = null; V.barEl.appendChild(V.playBtn);
    await sleep(1600);
    const vi2 = V.barEl.children.indexOf(V.btn());
    check('Vidstack dựng lại: logo tự về trước Captions', vi2 >= 0 && V.barEl.children[vi2 + 1] === V.playBtn, V.barEl.children.map(c => c.attrs['aria-label'] || (c.classList.contains('bsub-btn') ? 'LOGO' : '-')));
    const U2 = fakePage({ site: 'udemy', ccPressed: 'false', autoDub: false, bar: 'udemy' });
    await sleep(1500);
    const kids = U2.barEl.children, ui2 = kids.indexOf(U2.btn());
    check('Udemy: logo cùng hàng, ngay trước khung nút loa (đầu dãy phải), không lọt vào khung popper của CC', ui2 > 0 && kids[ui2 + 1] && kids[ui2 + 1].children[0] === U2.playBtn, kids.map(c => (c.classList && c.classList.contains('bsub-btn')) ? 'LOGO' : ((c.children[0] && c.children[0].attrs['aria-label']) || '-')));
    const N = fakePage({ ccPressed: 'false', autoDub: false });
    await sleep(700);
    check('không thấy thanh điều khiển: vẫn có nút (nổi trên video)', N.btn() && !N.btn().classList.contains('bsub-inbar'));
    const css = fs.readFileSync(path.join(DIR, 'content/content.css'), 'utf8');
    check('CSS có kiểu cho logo trong thanh điều khiển', /\.bsub-btn\.bsub-inbar\s*\{[^}]*position:\s*relative/.test(css));
    const logoRule = (/\.bsub-btn\.bsub-inbar::before\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
    check('CSS: logo bo góc + cắt vành sáng của ảnh (phóng >100%)', /border-radius/.test(logoRule) && /\/\s*1[1-4]\d%/.test(logoRule), logoRule);
    check('CSS: cỡ nút theo nút bên cạnh (biến --bsub-w/--bsub-h)', /var\(--bsub-w/.test(css) && /var\(--bsub-h/.test(css));
    check('gợi ý căn giữa trên logo', /r\.width\s*\/\s*2/.test(fs.readFileSync(path.join(DIR, 'content/content.js'), 'utf8')));
  }

  console.log('44. learn.deeplearning.ai: lấy phụ đề WebVTT từ danh sách HLS (.m3u8) của video');
  {
    const BASE = 'https://video.deeplearning.ai/upv2/course-x/L0/';
    const MASTER = BASE + 'abc-master.m3u8?v=1';
    const master = '#EXTM3U\n#EXT-X-VERSION:6\n\n'
      + '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Deutsch",LANGUAGE="de-DE",URI="subtitle/deu/abc-deu.m3u8"\n\n'
      + '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en-Us",URI="subtitle/eng/abc-eng.m3u8"\n\n'
      + '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="简体中文",LANGUAGE="zh-CN",URI="subtitle/zhs/abc-zhs.m3u8"\n\n'
      + '#EXT-X-STREAM-INF:BANDWIDTH=5605600,RESOLUTION=1920x1080,SUBTITLES="subs"\nabc/video/1080/abc.m3u8\n';
    const S3 = loadShared();
    const subs = S3.bsubParseHlsSubs ? S3.bsubParseHlsSubs(master, MASTER) : [];
    check('có hàm bsubParseHlsSubs', !!S3.bsubParseHlsSubs);
    check('đọc đủ 3 track phụ đề', subs.length === 3, subs);
    const en = subs.find(t => t.label === 'English');
    check('track English: đúng ngôn ngữ + đường dẫn đầy đủ', en && en.lang === 'en-Us' && en.src === BASE + 'subtitle/eng/abc-eng.m3u8', en);
    const pl = '#EXTM3U\n#EXT-X-TARGETDURATION:185\n#EXTINF:185.0,\nabc-eng.vtt\n#EXT-X-ENDLIST';
    const segs = S3.bsubHlsSegments ? S3.bsubHlsSegments(pl, BASE + 'subtitle/eng/abc-eng.m3u8') : [];
    check('playlist -> đường dẫn tệp .vtt', segs.length === 1 && segs[0] === BASE + 'subtitle/eng/abc-eng.vtt', segs);

    const vtt = 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:127826\n\n1\n00:00:00.133 --> 00:00:03.136\nWelcome to AI Python for Beginners.\n\n2\n00:00:03.169 --> 00:00:06.139\nWhatever your job role is, I am glad you are here.\n';
    const files = { [MASTER]: master, [BASE + 'subtitle/eng/abc-eng.m3u8']: pl, [BASE + 'subtitle/eng/abc-eng.vtt']: vtt };
    const P = fakePage({ site: 'dlai', pageV: 'courses/x/lesson/1', videoSrc: MASTER, files });
    await sleep(1500);
    const tr = P.sent.filter(m => m.type === 'translate');
    check('dịch phụ đề tiếng Anh', tr.length && /Welcome to AI Python/.test(tr[0].lines.join(' ')) && /^en/.test(tr[0].lang), tr.map(m => [m.lang, m.lines]));
    check('chỉ tải track English, không tải track khác', !P.fetched.some(u => /deu|zhs/.test(u)), P.fetched);
    const dg = await P.diag();
    check('Chẩn đoán: có thông tin trình phát (src, tệp m3u8/vtt, nút điều khiển)', dg.player && /m3u8/.test(dg.player.src) && Array.isArray(dg.player.media) && Array.isArray(dg.player.controls), dg.player);
    // currentSrc là blob: (hls.js) -> ghi nhật ký rõ ràng thay vì lặng lẽ bỏ qua.
    const B = fakePage({ site: 'dlai', pageV: 'courses/x/lesson/3', videoSrc: 'blob:https://learn.deeplearning.ai/abc' });
    await sleep(1500);
    const bl = (await B.diag()).log.join('\n');
    check('Chẩn đoán: currentSrc không phải .m3u8 thì ghi nhật ký', /blob:/.test(bl) && /m3u8/.test(bl), bl);

    // Playlist chia nhiều đoạn .vtt: ghép đủ cả các đoạn.
    const pl2 = '#EXTM3U\n#EXTINF:10.0,\nseg0.vtt\n#EXTINF:10.0,\nseg1.vtt\n#EXT-X-ENDLIST';
    const M2 = BASE + 'two-master.m3u8';
    const files2 = {
      [M2]: master.replace(/abc-eng\.m3u8/, 'two-eng.m3u8'),
      [BASE + 'subtitle/eng/two-eng.m3u8']: pl2,
      [BASE + 'subtitle/eng/seg0.vtt']: 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nThis is the first segment here.\n',
      [BASE + 'subtitle/eng/seg1.vtt']: 'WEBVTT\n\n00:00:11.000 --> 00:00:14.000\nThis is the second segment here.\n'
    };
    const Q = fakePage({ site: 'dlai', pageV: 'courses/x/lesson/2', videoSrc: M2, files: files2 });
    await sleep(1500);
    const all = Q.sent.filter(m => m.type === 'translate').flatMap(m => m.lines).join(' ');
    check('playlist nhiều đoạn: có cả 2 đoạn', /first segment/.test(all) && /second segment/.test(all), all);

    const mf = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
    check('manifest chạy content script trên learn.deeplearning.ai', mf.content_scripts.some(c => c.js.includes('content/content.js') && c.matches.some(x => /deeplearning\.ai/.test(x))));
    // Không có host_permissions thì popup không đọc được URL tab (Chẩn đoán báo "noaccess").
    check('host_permissions có learn.deeplearning.ai (popup + Chẩn đoán đọc được tab)', mf.host_permissions.some(x => /learn\.deeplearning\.ai/.test(x)), mf.host_permissions);
    check('logo dùng được trên learn.deeplearning.ai', mf.web_accessible_resources.some(w => w.matches.some(x => /deeplearning\.ai/.test(x))));
    check('popup nhận trang learn.deeplearning.ai', /deeplearning/.test(fs.readFileSync(path.join(DIR, 'popup/popup.js'), 'utf8')));
  }

  console.log('46. DeepLearning.AI (trình phát blob/hls.js): hook.js bắt tệp phụ đề .vtt qua XHR');
  {
    const posted = [];
    const ctx = { console, Promise, String, JSON, Error, setTimeout, TextDecoder, location: { origin: 'https://learn.deeplearning.ai' }, document: { getElementById: () => null },
      fetch: async () => ({ clone: () => ({ text: async () => 'WEBVTT' }) }) };
    ctx.XMLHttpRequest = function () { this.l = {}; this.responseType = ''; };
    ctx.XMLHttpRequest.prototype.open = function (m, u) { this.u = u; };
    ctx.XMLHttpRequest.prototype.addEventListener = function (t, f) { this.l[t] = f; };
    ctx.window = ctx; ctx.postMessage = d => posted.push(d); ctx.addEventListener = () => {};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'content/hook.js'), 'utf8'), ctx);
    const load = (u, text) => { const x = new ctx.XMLHttpRequest(); x.open('GET', u); x.responseText = text; if (x.l.load) x.l.load(); };
    const B = 'https://video.deeplearning.ai/upv2/course-x/L0/';
    load(B + 'subtitle/eng/abc-eng-6e0.vtt', 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello there.\n');
    load(B + 'thumbnails/thumbnail-1.vtt', 'WEBVTT thumbs');
    load(B + 'chapters/chapter-1.vtt', 'WEBVTT chapters');
    // hls.js tải phụ đề dạng arraybuffer: phải giải mã ra chữ, không JSON.stringify ra "{}".
    const xb = new ctx.XMLHttpRequest(); xb.open('GET', B + 'subtitle/eng/buf-eng.vtt'); xb.responseType = 'arraybuffer';
    xb.response = new TextEncoder().encode('WEBVTT\n\n00:00.000 --> 00:02.000\nFrom a buffer.\n').buffer; if (xb.l.load) xb.l.load();
    const vb = posted.find(d => d.__bsub === 'vtt' && /buf-eng/.test(d.url));
    check('phụ đề dạng arraybuffer: giải mã ra WEBVTT', vb && /^WEBVTT/.test(vb.text) && /From a buffer/.test(vb.text), vb && vb.text);
    const v = posted.filter(d => d.__bsub === 'vtt' && !/buf-eng/.test(d.url));
    check('bắt phụ đề subtitle/eng/….vtt, bỏ thumbnails/chapters', v.length === 1 && /subtitle\/eng/.test(v[0].url) && /Hello there/.test(v[0].text), v.map(d => d.url));
    const mf = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
    check('hook.js chạy trên learn.deeplearning.ai (MAIN world)', mf.content_scripts.some(c => c.js.includes('content/hook.js') && c.world === 'MAIN' && c.matches.some(x => /learn\.deeplearning\.ai/.test(x))));
  }

  console.log('47. DeepLearning.AI: phụ đề hook bắt được -> dịch + đọc; đổi bài không làm mất phụ đề mới');
  {
    const B = 'https://video.deeplearning.ai/upv2/course-x/L0/';
    const P = fakePage({ site: 'dlai', pageV: 'courses/x/lesson/1', videoSrc: 'blob:https://learn.deeplearning.ai/aaa' });
    await sleep(100);
    P.postVtt(B + 'subtitle/eng/abc-eng.vtt', 'WEBVTT\n\n00:00:00.100 --> 00:00:03.000\nWelcome to AI Python for Beginners.\n\n00:00:03.100 --> 00:00:06.000\nI am glad you are here today.\n');
    await sleep(800);
    const tr = P.sent.filter(m => m.type === 'translate');
    check('dịch phụ đề tiếng Anh (lang en)', tr.length && /Welcome to AI Python/.test(tr[0].lines.join(' ')) && tr[0].lang === 'en', tr.map(m => [m.lang, m.lines]));
    check('có câu thì tắt tiếng gốc', P.video.muted === true);
    // Đổi bài: phụ đề bài mới đến TRƯỚC khi nguồn video (blob) đổi -> không được xoá mất.
    P.postVtt(B.replace('L0', 'L1') + 'subtitle/eng/def-eng.vtt', 'WEBVTT\n\n00:00:00.100 --> 00:00:03.000\nThis is the second lesson now.\n');
    await sleep(50);
    P.video.currentSrc = 'blob:https://learn.deeplearning.ai/bbb';
    await sleep(1200);
    const d = await P.diag();
    check('đổi bài: dùng phụ đề bài mới', /def-eng/.test(d.cueKey) && d.total === 1, [d.cueKey, d.total]);
    // Đã có English thì bản tiếng Đức tải sau (người dùng đổi ngôn ngữ CC) không thay thế.
    P.postVtt(B.replace('L0', 'L1') + 'subtitle/deu/def-deu.vtt', 'WEBVTT\n\n00:00:00.100 --> 00:00:03.000\nDas ist die zweite Lektion.\n');
    await sleep(300);
    check('đã có English: không thay bằng tiếng Đức', /def-eng/.test((await P.diag()).cueKey));
  }

  console.log('48. Prompt dịch lồng tiếng: thuật lại đầy đủ, không tóm tắt; giữ thuật ngữ; viết cho tai nghe');
  {
    const bodies = [];
    const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    const ctx = { console, setTimeout, clearTimeout, AbortController, TextDecoder, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, parseFloat };
    ctx.fetch = async (url, init = {}) => {
      if (url.includes('/chat/completions')) { bodies.push(JSON.parse(init.body)); return resp(200, { choices: [{ message: { content: '{"1":"Xin chào các bạn."}' } }] }); }
      return resp(200, [[['x']]]);
    };
    ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
      storage: { local: { get(d, cb) { cb({ ...d, apiKey: 'SK' }); }, set: () => Promise.resolve() } } };
    ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
    const r = await new Promise(res => ctx.handler({ type: 'translate', lang: 'en', title: 'AI for Everyone', lines: ['Hello everyone.'] }, {}, res));
    const sys = bodies[0] && bodies[0].messages[0].content || '';
    check('dịch được bằng prompt mới', r.ok && r.translations[0] === 'Xin chào các bạn.', r);
    check('prompt: cấm tóm tắt / rút gọn', /Never summarize/i.test(sys) && /never shorter/i.test(sys), sys.slice(0, 120));
    check('prompt: bỏ ràng buộc "dài ngang câu gốc"', !/about as long as the original/i.test(sys));
    check('prompt: giữ thuật ngữ tiếng Anh, dịch nhất quán', /TECHNICAL TERMS/.test(sys) && /same way every time/i.test(sys));
    check('prompt: viết cho giọng đọc (số, dấu phẩy ngắt hơi)', /WRITTEN FOR THE EAR/.test(sys) && /phần trăm/.test(sys));
    check('prompt: thay {nguon} và {tieude}', /from English/.test(sys) && /"AI for Everyone"/.test(sys) && !/\{nguon\}|\{tieude\}/.test(sys));
    check('prompt: vẫn yêu cầu JSON đúng các khoá', /exactly the same keys as "lines"/.test(sys));
    check('đổi prompt: tăng BSUB_PROMPT_VERSION (cache cũ tự dịch lại)', /BSUB_PROMPT_VERSION\s*=\s*7\b/.test(fs.readFileSync(path.join(DIR, 'lib/shared.js'), 'utf8')));
  }

  console.log('49. Câu đọc tràn sang giờ của 2 câu sau: câu ở giữa KHÔNG bị bỏ, đọc lần lượt');
  {
    const P = fakePage({ ccPressed: 'true' });
    await sleep(20);
    P.postCaptions('MAIN', ['This is the first line here.', 'This is the second line here.', 'This is the third line here.']);
    await sleep(400);
    const read = async () => (await P.diag()).log.filter(l => /ĐỌC câu/.test(l)).map(l => +/ĐỌC câu (\d+)/.exec(l)[1]);
    const endLast = async () => { const a = P.audios[P.audios.length - 1]; if (a && a.onended) a.onended(); await sleep(150); };
    P.video.currentTime = 0.2; P.video.fire('timeupdate'); await sleep(300);   // đọc câu 0 (chưa xong)
    P.video.currentTime = 3.2; P.video.fire('timeupdate'); await sleep(150);   // tới giờ câu 1: xếp hàng
    P.video.currentTime = 6.2; P.video.fire('timeupdate'); await sleep(150);   // tới giờ câu 2: xếp hàng
    await endLast();                                                            // câu 0 đọc xong
    await sleep(200);
    await endLast();                                                            // câu 1 đọc xong
    await sleep(200);
    const r = await read();
    check('đọc đủ 0, 1, 2 theo thứ tự (không bỏ câu 1)', r.join(',') === '0,1,2', r);
    // Câu chờ đã quá cũ (hết giờ hơn vài giây): bỏ để không trễ mãi.
    const Q = fakePage({ ccPressed: 'true' });
    await sleep(20);
    Q.postCaptions('MAIN', ['This is the first line here.', 'This is the second line here.', 'This is the third line here.']);
    await sleep(400);
    Q.video.currentTime = 0.2; Q.video.fire('timeupdate'); await sleep(300);
    Q.video.currentTime = 3.2; Q.video.fire('timeupdate'); await sleep(150);
    Q.video.currentTime = 6.2; Q.video.fire('timeupdate'); await sleep(150);
    Q.video.currentTime = 11.5;                                                 // câu 1 hết giờ (6s) từ lâu
    { const a = Q.audios[Q.audios.length - 1]; if (a && a.onended) a.onended(); }
    await sleep(300);
    const rq = (await Q.diag()).log.filter(l => /ĐỌC câu/.test(l)).map(l => +/ĐỌC câu (\d+)/.exec(l)[1]);
    check('câu chờ quá cũ thì bỏ, đọc câu còn kịp', rq.join(',') === '0,2', rq);
    // Câu 2 đã qua giờ 2,5 giây (trong 4 giây cho phép): khi âm thanh về phải PHÁT, không bị bỏ vì "về trễ".
    const ql = (await Q.diag()).log.join('\n');
    check('câu chờ trong 4 giây cho phép: vẫn phát, không bỏ vì về trễ', !/âm thanh về trễ/.test(ql), ql.split('\n').slice(-6));
  }

  console.log('50. Tốc độ nói từng đoạn: câu nói nhanh -> dịch gọn (khớp hình), câu nói chậm -> đủ ý');
  {
    const S4 = loadShared();
    check('có hàm bsubIsFastCue', !!S4.bsubIsFastCue);
    if (S4.bsubIsFastCue) {
      check('10 từ trong 3 giây (3,3 từ/giây) = nói nhanh', S4.bsubIsFastCue({ start: 0, end: 3, text: 'one two three four five six seven eight nine ten' }) === true);
      check('6 từ trong 3 giây (2 từ/giây) = nói chậm', S4.bsubIsFastCue({ start: 0, end: 3, text: 'one two three four five six' }) === false);
    }
    // content.js gửi kèm cờ nói nhanh cho từng câu của lô dịch.
    const P = fakePage({ ccPressed: 'true' });
    await sleep(20);
    P.postCaptions('MAIN', ['This is a slow and calm line.', 'So here we go really fast with many many words in this very short line now.']);
    await sleep(400);
    const m = P.sent.find(x => x.type === 'translate');
    check('lô dịch gửi cờ nói nhanh từng câu', m && Array.isArray(m.fast) && m.fast.length === m.lines.length && m.fast.includes(true) && m.fast.includes(false), m && m.fast);
    check('nhật ký ghi số câu nói nhanh', /nói nhanh/.test((await P.diag()).log.join('\n')));
    // background: đưa cờ vào dữ liệu gửi AI + prompt có hướng dẫn cho câu nói nhanh.
    const bodies = [];
    const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    const ctx = { console, setTimeout, clearTimeout, AbortController, TextDecoder, btoa, atob, URL, encodeURIComponent, decodeURIComponent, Uint8Array, DataView, String, JSON, Math, Promise, Error, Object, Array, Date, parseFloat };
    ctx.fetch = async (url, init = {}) => { bodies.push(JSON.parse(init.body)); return resp(200, { choices: [{ message: { content: '{"1":"A","2":"B"}' } }] }); };
    ctx.chrome = { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(f) { ctx.handler = f; } } },
      storage: { local: { get(d, cb) { cb({ ...d, apiKey: 'SK' }); }, set: () => Promise.resolve() } } };
    ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), ctx);
    await new Promise(res => ctx.handler({ type: 'translate', lang: 'en', lines: ['Slow line.', 'Fast line.'], fast: [false, true] }, {}, res));
    const input = bodies[0] ? JSON.parse(bodies[0].messages[1].content) : {};
    const sys = bodies[0] ? bodies[0].messages[0].content : '';
    check('gửi AI danh sách câu nói nhanh (khoá "2")', JSON.stringify(input.fast_speech_lines) === '["2"]', input.fast_speech_lines);
    check('prompt: câu nói nhanh dịch gọn nhưng không bỏ ý', /fast_speech_lines/.test(sys) && /concise/i.test(sys) && /never drop/i.test(sys), sys.slice(-600));
  }

  console.log('51. Chế độ đọc "Đủ ý cả bài": không dịch gọn, không bỏ câu, giọng được đọc nhanh hơn');
  {
    const sh = fs.readFileSync(path.join(DIR, 'lib/shared.js'), 'utf8');
    check('mặc định readMode = auto', /readMode:\s*'auto'/.test(sh));
    const html = fs.readFileSync(path.join(DIR, 'options/options.html'), 'utf8'), ojs = fs.readFileSync(path.join(DIR, 'options/options.js'), 'utf8');
    check('Cài đặt có mục Chế độ đọc (auto / full)', /id="readMode"/.test(html) && /value="full"/.test(html) && /'readMode'/.test(ojs));
    // Đủ ý cả bài: không gửi cờ nói nhanh (mọi câu dịch đầy đủ).
    const P = fakePage({ ccPressed: 'true', store: { readMode: 'full' } });
    await sleep(20);
    P.postCaptions('MAIN', ['This is a slow and calm line.', 'So here we go really fast with many many words in this very short line now.']);
    await sleep(400);
    const m = P.sent.find(x => x.type === 'translate');
    check('đủ ý cả bài: không câu nào bị đánh dấu dịch gọn', m && Array.isArray(m.fast) && !m.fast.includes(true), m && m.fast);
    // Đủ ý cả bài: câu chờ dù đã quá giờ lâu vẫn đọc (không bỏ câu).
    const Q = fakePage({ ccPressed: 'true', store: { readMode: 'full' } });
    await sleep(20);
    Q.postCaptions('MAIN', ['This is the first line here.', 'This is the second line here.', 'This is the third line here.']);
    await sleep(400);
    Q.video.currentTime = 0.2; Q.video.fire('timeupdate'); await sleep(300);
    Q.video.currentTime = 3.2; Q.video.fire('timeupdate'); await sleep(150);
    Q.video.currentTime = 6.2; Q.video.fire('timeupdate'); await sleep(150);
    Q.video.currentTime = 11.5;
    { const x = Q.audios[Q.audios.length - 1]; if (x && x.onended) x.onended(); }
    await sleep(300);
    const rq = (await Q.diag()).log.filter(l => /ĐỌC câu/.test(l)).map(l => +/ĐỌC câu (\d+)/.exec(l)[1]);
    check('đủ ý cả bài: câu chờ quá giờ vẫn đọc (0,1)', rq.join(',') === '0,1', rq);
    const cjs = fs.readFileSync(path.join(DIR, 'content/content.js'), 'utf8');
    check('đủ ý cả bài: tốc độ giọng tối đa 2,5 lần', /readMode === 'full' \? 2\.5 : 2/.test(cjs));
    check('đủ ý cả bài: cache riêng (khoá có "full|")', /cacheId = [^\n]*full\|/.test(cjs));
  }

  console.log('52. Nhớ video đã bấm bật/tắt sau khi tải lại trang (dubVideos phải có trong BSUB_DEFAULTS)');
  {
    // chrome.storage.local.get(BSUB_DEFAULTS) chỉ trả về các khoá có trong BSUB_DEFAULTS.
    const c = { console, chrome: { storage: { local: { get() {} } } } };
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'lib/shared.js'), 'utf8') + ';this.D = BSUB_DEFAULTS;', c);
    check('BSUB_DEFAULTS có dubVideos (mặc định {})', 'dubVideos' in c.D && c.D.dubVideos && typeof c.D.dubVideos === 'object' && !Object.keys(c.D.dubVideos).length, Object.keys(c.D));
    check('bỏ tuỳ chọn "Tự bật cho mọi video" (autoDub)', !('autoDub' in c.D) && !/autoDub/.test(fs.readFileSync(path.join(DIR, 'options/options.html'), 'utf8') + fs.readFileSync(path.join(DIR, 'options/options.js'), 'utf8') + fs.readFileSync(path.join(DIR, 'content/content.js'), 'utf8')));
  }

  console.log('53. Lịch sử video đã xem có lồng tiếng: xem lại thì lên mới nhất, quá 300 xoá video xem lâu nhất, dọn mục "tắt" cũ');
  {
    const hist = {};
    for (let i = 0; i < 300; i++) hist['yt:V' + i] = 1;   // V0 = xem lâu nhất
    hist['yt:OLD'] = 0;                                    // mục "tắt" của bản cũ
    const P = fakePage({ pageV: 'V0', autoDub: false, ccPressed: 'true', store: { dubVideos: { ...hist } } });
    await sleep(800);
    const keys = Object.keys(P.store.dubVideos);
    check('video trong lịch sử -> tự lồng tiếng', (await P.status()).on === true);
    check('xem lại -> lên mới nhất (cuối danh sách)', keys[keys.length - 1] === 'yt:V0', keys.slice(-3));
    check('dọn mục "tắt" cũ (giá trị 0)', !('yt:OLD' in P.store.dubVideos));
    check('vẫn đủ 300 video, chỉ toàn giá trị 1', keys.length === 300 && Object.values(P.store.dubVideos).every(v => v === 1), keys.length);
    // Video mới: bấm bật -> vào lịch sử, quá 300 thì bỏ video xem lâu nhất (V1, vì V0 vừa xem lại).
    const N = fakePage({ pageV: 'NEW', autoDub: false, ccPressed: 'true', store: { dubVideos: { ...P.store.dubVideos } } });
    await sleep(300);
    check('video mới chưa xem -> mặc định tắt', (await N.status()).on === false);
    N.btn().fire('click');
    await sleep(500);
    const k2 = Object.keys(N.store.dubVideos);
    check('bấm bật video mới -> vào lịch sử, mới nhất', k2[k2.length - 1] === 'yt:NEW' && k2.length === 300, [k2.length, k2.slice(-1)]);
    check('quá 300 -> xoá video xem lâu nhất (V1), giữ V0 vừa xem lại', !('yt:V1' in N.store.dubVideos) && 'yt:V0' in N.store.dubVideos);
  }

  console.log('\n' + pass + ' đạt, ' + fail + ' lỗi');
  process.exit(fail ? 1 : 0);
})();
