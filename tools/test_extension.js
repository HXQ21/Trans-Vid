// Bộ test cho extension my-dual-subtitles. Chạy: node tools/test_extension.js
// Chạy mã thật của extension trong môi trường giả (vm), không cần Chrome.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = process.argv[2] || path.join(__dirname, '..');   // thư mục extension (cha của tools/)
let pass = 0, fail = 0;
const check = (name, ok, got) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (got !== undefined ? '  -> ' + JSON.stringify(got) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadShared() {
  const ctx = { console, chrome: { storage: { local: { get() {} } } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DIR, 'shared.js'), 'utf8') + '\n;this.S = {}; for (const n of ["bsubCleanSource", "bsubSpeakable", "bsubSourceLang", "bsubIsVi", "bsubIsAutoLabel", "bsubPickCaption", "bsubParseVtt", "bsubLangName", "bsubSegmentSentences"]) { try { this.S[n] = eval(n); } catch (e) { this.S[n] = null; } }', ctx);
  return ctx.S;
}

// Trang YouTube giả: video, nút CC, chrome.* giả; chạy shared.js + content.js thật.
function fakePage({ pageV = 'MAIN', ccPressed = 'false', voice = 'auto', geminiKey = '', cache = null, viaFn = () => 'google', site = 'youtube', tracks = [], files = {}, autoDub = true, store = {} } = {}) {
  let msgListener = null; const winL = {}; const changeL = [];
  const trackEls = tracks.map(t => ({ srclang: t.lang, label: t.label, getAttribute: k => (k === 'src' ? t.src : null) }));
  // Phần tử DOM giả tối thiểu (cho nút bật lồng tiếng trên video).
  const mkEl = () => {
    const set = new Set();
    const e = {
      style: {}, children: [], attrs: {}, listeners: {}, textContent: '', title: '', parentNode: null,
      classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), toggle: (c, f) => ((f === undefined ? !set.has(c) : f) ? set.add(c) : set.delete(c)) },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      appendChild(c) { if (c.parentNode) c.remove(); this.children.push(c); c.parentNode = this; return c; },
      remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(x => x !== this); this.parentNode = null; } },
      contains(c) { return c === this || this.children.includes(c); },
      fire(t) { (this.listeners[t] || []).forEach(f => f({ stopPropagation() {}, preventDefault() {}, stopImmediatePropagation() {} })); },
    };
    return e;
  };
  const player = mkEl();
  const video = { currentTime: 0, paused: false, volume: 1, muted: false, vl: {}, addEventListener(t, f) { (this.vl[t] = this.vl[t] || []).push(f); }, fire(t) { (this.vl[t] || []).forEach(f => f({ target: this })); }, querySelectorAll: s => (s === 'track' ? trackEls : []), getBoundingClientRect: () => ({ width: 640, height: 360 }), parentElement: player, closest: () => player };
  const fetched = [];
  const HOST = { youtube: 'www.youtube.com', udemy: 'www.udemy.com', coursera: 'www.coursera.org' }[site];
  const loc = site === 'youtube' ? { href: 'https://www.youtube.com/watch?v=' + pageV, search: '?v=' + pageV, pathname: '/watch' }
    : { href: 'https://' + HOST + '/learn/x/lecture/' + pageV, search: '', pathname: '/learn/x/lecture/' + pageV };
  const ccBtn = { clicks: 0, attrs: { 'aria-pressed': ccPressed }, getAttribute(k) { return this.attrs[k]; }, click() { this.clicks++; this.attrs['aria-pressed'] = this.attrs['aria-pressed'] === 'true' ? 'false' : 'true'; } };
  const sent = [];
  const ctx = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, JSON, Math, Promise, Error, String, Number, isFinite, Map, WeakSet, Object, Array, atob, btoa, Uint8Array,
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
      storage: { local: { get(d, cb) { if (typeof d === 'string') return Promise.resolve(cache && d.startsWith('cache:') ? { [d]: cache } : {}); const o = { ...d, voice, geminiKey, autoDub, ...store }; if (cb) cb(o); else return Promise.resolve(o); }, set: o => { Object.assign(store, o); return Promise.resolve(); } }, onChanged: { addListener(f) { changeL.push(f); } } }
    },
    Audio: function () { const a = { play() { return Promise.resolve(); }, pause() {} }; return a; }
  };
  ctx.URL.createObjectURL = () => 'blob:x';
  ctx.window = ctx; ctx.addEventListener = (t, f) => { (winL[t] = winL[t] || []).push(f); };   // trình duyệt gọi MỌI bộ nghe
  vm.createContext(ctx);
  for (const f of ['shared.js', 'content.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
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
  const btn = () => player.children.find(c => c.classList.contains('bsub-btn')) || null;
  return { ctx, video, ccBtn, sent, postCaptions, postVtt, posted, fetched, diag, fireChange, status, btn, player, store };
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
      for (const f of ['shared.js', 'voices.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
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
      vm.runInContext(fs.readFileSync(path.join(DIR, 'hook.js'), 'utf8'), ctx);
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
    vm.runInContext(fs.readFileSync(path.join(DIR, 'shared.js'), 'utf8'), ctx);
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
      vm.runInContext('Intl.Segmenter = undefined;' + fs.readFileSync(path.join(DIR, 'shared.js'), 'utf8'), ctx2);
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
    check('bấm lại -> nhớ là đã tắt', B.store.dubVideos && B.store.dubVideos['yt:MAIN'] === 0, B.store.dubVideos);
    // Video đã bật lần trước: tự bật.
    const C = fakePage({ autoDub: false, ccPressed: 'true', store: { dubVideos: { 'yt:MAIN': 1 } } });
    await sleep(20);
    C.postCaptions('MAIN', ['This is the first line.', 'This is the second line.']);
    await sleep(400);
    check('video đã bật lần trước -> tự dịch', tr(C) > 0, tr(C));
    // Tự bật cho mọi video, nhưng video này đã tự tắt -> tôn trọng.
    const E = fakePage({ autoDub: true, ccPressed: 'true', store: { dubVideos: { 'yt:MAIN': 0 } } });
    await sleep(20);
    E.postCaptions('MAIN', ['This is the first line.', 'This is the second line.']);
    await sleep(400);
    check('tự bật mọi video + video này đã tắt -> không dịch', tr(E) === 0, tr(E));
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
    check('bấm bật: tắt hẳn tiếng video gốc', A.video.muted === true);
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
    B.btn().fire('click'); await sleep(700);
    B.btn().fire('click'); await sleep(700);
    check('video tự tắt tiếng từ trước -> vẫn giữ tắt tiếng', B.video.muted === true);
    // Tắt công tắc tổng: bật lại tiếng gốc.
    const E = fakePage({ autoDub: true });
    await sleep(700);
    E.fireChange({ enabled: { oldValue: true, newValue: false } });
    await sleep(700);
    check('tắt công tắc tổng -> bật lại tiếng gốc', E.video.muted === false);
  }

  console.log('\n' + pass + ' đạt, ' + fail + ' lỗi');
  process.exit(fail ? 1 : 0);
})();
