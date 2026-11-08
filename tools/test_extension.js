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
  vm.runInContext(fs.readFileSync(path.join(DIR, 'shared.js'), 'utf8') + '\n;this.S = { bsubCleanSource: typeof bsubCleanSource === "function" ? bsubCleanSource : null, bsubSpeakable: typeof bsubSpeakable === "function" ? bsubSpeakable : null };', ctx);
  return ctx.S;
}

// Trang YouTube giả: video, nút CC, chrome.* giả; chạy shared.js + content.js thật.
function fakePage({ pageV = 'MAIN', ccPressed = 'false', voice = 'auto', geminiKey = '', cache = null, viaFn = () => 'google' } = {}) {
  let msgListener = null; const winL = {}; const changeL = [];
  const video = { currentTime: 0, paused: false, volume: 1, muted: false, addEventListener() {} };
  const ccBtn = { clicks: 0, attrs: { 'aria-pressed': ccPressed }, getAttribute(k) { return this.attrs[k]; }, click() { this.clicks++; this.attrs['aria-pressed'] = this.attrs['aria-pressed'] === 'true' ? 'false' : 'true'; } };
  const sent = [];
  const ctx = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, JSON, Math, Promise, Error, String, Number, isFinite, Map, WeakSet, Object, Array, atob, btoa, Uint8Array,
    Blob: class {}, performance: { getEntriesByType: () => [] },
    location: { href: 'https://www.youtube.com/watch?v=' + pageV, search: '?v=' + pageV, origin: 'https://www.youtube.com', hostname: 'www.youtube.com', pathname: '/watch' },
    document: { title: 'T - YouTube', documentElement: { classList: { toggle() {} } }, addEventListener() {},
      querySelector: s => (s.includes('subtitles-button') ? ccBtn : s.includes('video') ? video : { classList: { contains: () => false } }) },
    chrome: {
      runtime: { getManifest: () => ({ version: 'test' }), onMessage: { addListener(f) { msgListener = f; } }, lastError: null,
        sendMessage(m, cb) { sent.push(m); setTimeout(() => cb(m.type === 'translate' ? { ok: true, via: viaFn(m), translations: m.lines.map(l => (viaFn(m) === 'gemini' ? 'GEM ' : 'VI ') + l) } : { ok: true, engine: 'google', audio: btoa('x'), mime: 'audio/mpeg' }), 2); } },
      storage: { local: { get(d, cb) { if (typeof d === 'string') return Promise.resolve(cache && d.startsWith('cache:') ? { [d]: cache } : {}); const o = { ...d, voice, geminiKey }; if (cb) cb(o); else return Promise.resolve(o); }, set: () => Promise.resolve() }, onChanged: { addListener(f) { changeL.push(f); } } }
    },
    Audio: function () { const a = { play() { return Promise.resolve(); } }; return a; }
  };
  ctx.URL.createObjectURL = () => 'blob:x';
  ctx.window = ctx; ctx.addEventListener = (t, f) => { winL[t] = f; };
  vm.createContext(ctx);
  for (const f of ['shared.js', 'content.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
  const win = vm.runInContext('window', ctx);
  const postCaptions = (v, lines) => winL.message({ source: win, data: { __bsub: 'timedtext', url: '/api/timedtext?v=' + v + '&lang=en', text: JSON.stringify({ events: lines.map((t, i) => ({ tStartMs: i * 3000, dDurationMs: 3000, segs: [{ utf8: t }] })) }) } });
  const diag = () => new Promise(r => msgListener({ type: 'diag' }, {}, r));
  const fireChange = ch => changeL.forEach(f => f(ch, 'local'));
  return { ctx, video, ccBtn, sent, postCaptions, diag, fireChange };
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
    P.postCaptions('MAIN', Array.from({ length: 60 }, (_, i) => 'Line ' + i + '.'));
    await sleep(300);
    const tr = P.sent.filter(m => m.type === 'translate');
    check('lô đầu ≤ 8 câu', tr.length && tr[0].lines.length <= 8, tr.map(m => m.lines.length));
    check('các lô sau vẫn lớn (40 câu)', tr.some(m => m.lines.length === 40), tr.map(m => m.lines.length));
  }

  console.log('12. Cache: bản dịch Google (dự phòng) không được chặn Gemini dịch lại');
  {
    const N = 10, lines = Array.from({ length: N }, (_, i) => 'Line ' + i + '.');
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

  console.log('\n' + pass + ' đạt, ' + fail + ' lỗi');
  process.exit(fail ? 1 : 0);
})();
