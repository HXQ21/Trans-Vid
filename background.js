importScripts('lib/shared.js');

chrome.runtime.onInstalled.addListener(d => {
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handler = { translate: onTranslate, tts: onTts, test: onTest, probeTts: onProbeTts }[msg && msg.type];
  if (!handler) return false;
  handler(msg).then(
    r => reply({ ok: true, ...r }),
    e => reply({ ok: false, error: String((e && e.message) || e) })
  );
  return true;
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

// timeoutMs: quá hạn thì huỷ yêu cầu (AbortController) để không treo cả lô dịch.
// read: hàm đọc body (vd r => r.json()); có thì hẹn giờ phủ cả lúc đọc body, trả về kết quả của read.
async function request(url, init, tries = 3, timeoutMs = 0, read = null) {
  for (let i = 0; ; i++) {
    let res;
    const ac = timeoutMs ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : 0;
    try {
      res = await fetch(url, ac ? { ...init, signal: ac.signal } : init);
      if (res.ok && read) return await read(res);
    } catch (e) {
      if (ac && ac.signal.aborted) throw Object.assign(new Error('quá ' + Math.round(timeoutMs / 1000) + ' giây không phản hồi'), { status: 'timeout' });
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => '');
    if (i + 1 < tries && (res.status === 429 || res.status >= 500)) {
      await sleep(1500 * 2 ** i);
      continue;
    }
    const err = new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
}

// ---- Dịch bằng Gemini (cần API key miễn phí từ aistudio.google.com) ----

// Gemini chậm quá thì bỏ, dùng Google (lô đang xem không được phép chờ lâu).
// Key thuê (qua máy chủ trung gian) thường chậm hơn (vd Vilao ~12s): cho chờ lâu hơn.
const rentedTimeout = () => globalThis.__bsubRentedTimeoutMs || 45000;
const geminiTimeout = () => globalThis.__bsubGeminiTimeoutMs || 15000;

// Bị 429 (hết quota) / key sai: tạm ngừng gọi Gemini một lúc, dịch thẳng bằng Google
// thay vì lô nào cũng gọi Gemini rồi mới thất bại.
let geminiPausedUntil = 0, geminiPauseReason = '';
function pauseGemini(e) {
  const st = e && e.status;
  // 400 chỉ khoá khi lỗi nói về key; 400 khác (nội dung lô, tham số) chỉ hỏng lô đó, không khoá cả Gemini.
  const keyBad = st === 401 || st === 403 || (st === 400 && /api[ _-]?key|invalid[ _-]?(access[ _-]?|auth[ _-]?)?token|token\b[^.]{0,20}\b(invalid|expired)/i.test(String((e && e.message) || '')));
  const min = st === 429 ? 10 : keyBad ? 30 : 0;
  if (!min) return;
  geminiPausedUntil = Date.now() + min * 60000;
  geminiPauseReason = st === 429 ? 'hết lượt (429)' : 'bị từ chối (' + st + ')';
}

// ---- Chọn model Gemini ----
// Quota gói miễn phí tính RIÊNG cho từng model (vd gemini-flash-latest 20 lượt/ngày).
// Một model hết lượt (429) hoặc bị ngừng (404) thì đánh dấu và chuyển sang model flash khác của key này.
const modelBlockedUntil = {};          // model -> thời điểm được thử lại
let modelListCache = null, lastGeminiModel = '';
const noEffort = {};               // model không nhận reasoning_effort

async function listFlashModels(key) {
  if (modelListCache) return modelListCache;
  try {
    const data = await request('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { 'x-goog-api-key': key }
    }, 1, geminiTimeout(), r => r.json());
    const names = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(n => /^gemini-([\d.]+-)?flash(-lite)?(-latest|-preview(-[\d-]+)?)?$/.test(n));
    const ver = n => parseFloat((/gemini-([\d.]+)/.exec(n) || [])[1]) || 99;   // *-latest coi như mới nhất
    const rank = n => (n.includes('lite') ? 1 : 0) + (n.includes('preview') ? 2 : 0);
    // flash trước flash-lite, bản chính thức trước preview, phiên bản mới trước.
    names.sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a));
    modelListCache = names;
  } catch (e) {
    modelListCache = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
  }
  return modelListCache;
}

async function geminiChat(cfg, system, user) {
  const first = cfg.geminiModel || BSUB_DEFAULTS.geminiModel;
  const now = Date.now();
  const tryList = [first, ...(await listFlashModels(cfg.geminiKey)).filter(n => n !== first)]
    .filter(n => !(modelBlockedUntil[n] > now));
  let lastErr = Object.assign(new Error('mọi model Gemini của key này đều đang hết quota'), { status: 429 });
  for (const model of tryList) {
    let data;
    // Model flash mặc định "suy nghĩ" lâu (đo thực tế: 7.9s -> 1.7s với effort "low").
    // Model nào không nhận tham số này (400) thì gửi lại không có nó.
    const send = withEffort => request(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.geminiKey },
      body: JSON.stringify({
        model,
        ...(withEffort ? { reasoning_effort: 'low' } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      })
    }, 1, geminiTimeout(), r => r.json());
    try {
      try {
        data = await send(!noEffort[model]);
      } catch (e) {
        if (e.status !== 400 || noEffort[model]) throw e;
        noEffort[model] = true;
        data = await send(false);
      }
    } catch (e) {
      // Hết lượt / ngừng: chặn model này rồi thử model kế tiếp. Lỗi khác (quá giờ, key sai): dừng.
      if (e.status === 429) { modelBlockedUntil[model] = Date.now() + 60 * 60000; lastErr = e; continue; }
      if (e.status === 404) { modelBlockedUntil[model] = Date.now() + 24 * 3600000; lastErr = e; continue; }
      // 503 = model đang quá tải tạm thời: bỏ qua model này 2 phút, thử model khác.
      if (e.status === 503) { modelBlockedUntil[model] = Date.now() + 2 * 60000; lastErr = e; continue; }
      // Quá giờ (model đang chậm): bỏ qua model này 5 phút, thử model kế tiếp (thường là bản lite, nhanh hơn).
      if (e.status === 'timeout') { modelBlockedUntil[model] = Date.now() + 5 * 60000; lastErr = e; continue; }
      throw e;
    }
    lastGeminiModel = model;
    const m = data.choices && data.choices[0] && data.choices[0].message;
    return (m && m.content) || '';
  }
  throw lastErr;
}

// ---- Key thuê: API tương thích OpenAI (vd Vilao). Chỉ 1 model, không tự chuyển model. ----
async function rentedChat(cfg, system, user) {
  const url = String(cfg.apiBase).trim().replace(/\/+$/, '') + '/chat/completions';
  const model = String(cfg.apiModel).trim();
  const data = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(cfg.apiKey).trim() },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  }, 2, rentedTimeout(), r => r.json());
  lastGeminiModel = model;
  const m = data.choices && data.choices[0] && data.choices[0].message;
  return (m && m.content) || '';
}

// Gọi AI theo nguồn đang chọn: key thuê (nếu đủ) trước, không thì Gemini của Google.
const aiChat = (cfg, system, user) => (bsubUseRented(cfg) ? rentedChat : geminiChat)(cfg, system, user);
const aiName = cfg => (bsubUseRented(cfg) ? 'Key thuê (' + String(cfg.apiModel).trim() + ')' : 'Gemini');

function parseObject(text) {
  text = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('Gemini không trả về JSON');
  return JSON.parse(text.slice(s, e + 1));
}

// ctx: { title, before: [{ src, vi }] } — tên video và các câu ngay trước (đã dịch) để giữ mạch văn.
async function geminiTranslate(cfg, lines, srcName, ctx = {}) {
  const system = [
    'You are a professional Vietnamese dubbing translator. Translate YouTube subtitles from ' + srcName + ' into natural spoken Vietnamese that will be read aloud by a voice.',
    'Rules:',
    '- Translate the MEANING of the whole passage, not word by word. Lines are consecutive pieces of the same speech; a sentence may continue across lines, so read all lines (and the earlier context) before translating each one.',
    '- Subtitles may be auto-generated: fix obvious mis-heard words and missing punctuation from context.',
    '- Use the video title and earlier lines to understand the topic, the speaker and who is being addressed. Choose Vietnamese pronouns that fit (tôi/mình/chúng ta/các bạn/anh/em...) and keep them consistent with the earlier translations.',
    '- Keep names, brands and technical terms consistent with the earlier translations; keep well-known English tech terms when Vietnamese speakers normally do.',
    '- Sound like a native Vietnamese narrator: idiomatic, clear, no awkward literal phrasing, no added explanations.',
    '- Keep each translation about as long as the original so it fits the same time.',
    '- Write numbers so they read naturally. No symbols, no brackets, no notes.',
    '- Output ONLY a JSON object with exactly the same keys as "lines" and the Vietnamese translations as string values. Every key must have a translation.'
  ].join('\n');
  const lineObj = {};
  lines.forEach((l, i) => { lineObj[i + 1] = l; });
  const input = { video_title: ctx.title || '', earlier_lines_for_context_only: (ctx.before || []).slice(-8), lines: lineObj };
  const out = parseObject(await aiChat(cfg, system, JSON.stringify(input)));
  const obj = out.lines && typeof out.lines === 'object' ? out.lines : out;
  return lines.map((_, i) => (typeof obj[i + 1] === 'string' ? obj[i + 1].trim() : ''));
}

// ---- Dịch bằng Google Dịch (miễn phí, không cần key) ----
async function googleOne(text, sl) {
  const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&tl=vi&sl=' + sl + '&q=' + encodeURIComponent(text);
  const data = await (await request(u, { credentials: 'omit' })).json();   // không kèm cookie Google (xem googleTts)
  return (data[0] || []).map(s => s[0] || '').join('');
}

// before: các câu gốc ngay trước lô này. Gửi kèm (rồi bỏ phần dịch của chúng) để Google hiểu mạch văn.
async function googleTranslate(lines, sl, before = []) {
  const out = [];
  let lead = before.slice(-2).map(s => String(s).replace(/\n/g, ' ')).filter(Boolean);
  // Gộp nhiều dòng vào một lần gọi (ngăn bằng xuống dòng), giữ URL ngắn.
  let chunk = [];
  const flush = async () => {
    if (!chunk.length) return;
    const all = lead.concat(chunk);
    const parts = (await googleOne(all.join('\n'), sl)).split('\n').map(s => s.trim());
    if (parts.length === all.length) out.push(...parts.slice(lead.length));
    else for (const l of chunk) out.push((await googleOne(l, sl)).trim());
    // Câu cuối của lô này làm ngữ cảnh cho lô kế tiếp.
    lead = chunk.slice(-2);
    chunk = [];
  };
  for (const l of lines) {
    const t = l.replace(/\n/g, ' ');
    if (chunk.length && encodeURIComponent(lead.concat(chunk).join('\n') + '\n' + t).length > 1800) await flush();
    chunk.push(t);
  }
  await flush();
  return out;
}

async function onTranslate({ lines, lang, title, before }) {
  const cfg = await bsubGet();
  const src = bsubSourceLang(lang);
  // Bỏ ký hiệu ở cả câu gốc lẫn bản dịch để không lọt ">>" vào giọng đọc.
  const clean = lines.map(l => bsubCleanSource(l));
  const ctx = {
    title: bsubCleanSource(title || ''),
    before: (Array.isArray(before) ? before : []).map(b => ({ src: bsubCleanSource(b.src), vi: bsubCleanSource(b.vi || '') })).filter(b => b.src)
  };
  const r = await translateLines(cfg, clean.map(l => l || '...'), src, ctx);
  // Câu gốc chỉ toàn ký hiệu -> '…' (không đọc gì, cũng không bị coi là dịch lỗi).
  r.translations = r.translations.map((t, i) => (clean[i] ? bsubCleanSource(t) : '…'));
  return r;
}

const SRC_EN = { en: 'English', zh: 'Chinese', hi: 'Hindi' };
const srcName = code => { if (SRC_EN[code]) return SRC_EN[code]; try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || 'the source language'; } catch (e) { return 'the source language'; } };

async function translateLines(cfg, lines, src, ctx = {}) {
  const beforeSrc = (ctx.before || []).map(b => b.src);
  if (bsubAiOn(cfg) && Date.now() < geminiPausedUntil) {
    const mins = Math.ceil((geminiPausedUntil - Date.now()) / 60000);
    return { translations: await googleTranslate(lines, src || 'auto', beforeSrc), via: 'google',
      warn: 'Đang dùng Google Dịch: ' + aiName(cfg) + ' ' + geminiPauseReason + ', thử lại sau ' + mins + ' phút' };
  }
  if (bsubAiOn(cfg)) {
    try {
      const translations = await geminiTranslate(cfg, lines, srcName(src), ctx);
      return { translations, via: 'gemini', model: lastGeminiModel };
    } catch (e) {
      // Hết lượt miễn phí / key sai / quá giờ / mạng lỗi: chuyển sang Google Dịch.
      pauseGemini(e);
      const translations = await googleTranslate(lines, src || 'auto', beforeSrc);
      return { translations, via: 'google', warn: aiName(cfg) + ' lỗi, đang dùng Google Dịch: ' + String(e.message || e).replace(/\s+/g, ' ').slice(0, 160) };
    }
  }
  return { translations: await googleTranslate(lines, src || 'auto', beforeSrc), via: 'google' };
}

// ---- Giọng đọc Google (tiếng Việt, mp3) ----
function splitText(text, max = 180) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const parts = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > max) { parts.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) parts.push(cur);
  return parts;
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function googleTts(text) {
  const bufs = [];
  for (const p of splitText(text)) {
    const u = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=' + encodeURIComponent(p);
    // Không kèm cookie: đang đăng nhập Google thì có cookie làm Google chuyển hướng sang trang khác
    // (ngoài quyền của extension) -> "Failed to fetch". Giọng đọc không cần đăng nhập.
    bufs.push(new Uint8Array(await (await request(u, { credentials: 'omit' }, 2)).arrayBuffer()));
  }
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { bytes.set(b, off); off += b.length; }
  return { audio: toBase64(bytes), mime: 'audio/mpeg', engine: 'google' };
}

// Chẩn đoán: gọi thử giọng Google có cookie / không cookie, không theo chuyển hướng, để biết vì sao lỗi.
async function onProbeTts() {
  const u = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=' + encodeURIComponent('xin chào');
  const probe = async credentials => {
    try {
      const r = await fetch(u, { credentials, redirect: 'manual', cache: 'no-store' });
      return r.type === 'opaqueredirect' ? 'BỊ CHUYỂN HƯỚNG' : 'HTTP ' + r.status;
    } catch (e) {
      return 'LỖI ' + ((e && e.message) || e);
    }
  };
  return { withCookies: await probe('include'), noCookies: await probe('omit') };
}

// ---- Giọng Microsoft Nam Minh / Hoài My qua Azure Speech (API chính thức, cần key) ----
const xmlEscape = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

async function azureTts(cfg, text, voiceName) {
  const region = String(cfg.azureRegion || 'southeastasia').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ssml = "<speak version='1.0' xml:lang='vi-VN'><voice xml:lang='vi-VN' name='" + voiceName + "'>" + xmlEscape(text) + '</voice></speak>';
  const res = await request('https://' + region + '.tts.speech.microsoft.com/cognitiveservices/v1', {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': cfg.azureKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3'
    },
    body: ssml
  }, 2);
  return { audio: toBase64(new Uint8Array(await res.arrayBuffer())), mime: 'audio/mpeg', engine: 'azure:' + voiceName };
}

async function onTts({ text, voice }) {
  // Lọc lần cuối ngay trước khi tạo giọng (kể cả khi tab YouTube còn chạy mã cũ chưa lọc).
  text = bsubSpeakable(text);
  if (!text) throw new Error('câu không có chữ để đọc');
  const ms = BSUB_MS_VOICES[voice];
  if (ms) {
    const cfg = await bsubGet();
    if (!cfg.azureKey) {
      return { ...(await googleTts(text)), warn: 'Máy không có giọng ' + ms.label + ' (có sẵn trên Edge). Nhập key Azure hoặc dùng Edge; đang đọc bằng giọng Google' };
    }
    try {
      return await azureTts(cfg, text, ms.azure);
    } catch (e) {
      return { ...(await googleTts(text)), warn: 'Giọng Azure lỗi, đang đọc bằng giọng Google: ' + String(e.message || e).slice(0, 120) };
    }
  }
  return googleTts(text);
}

async function onTest() {
  const cfg = await bsubGet();
  if (!bsubAiOn(cfg)) {
    const [t] = await googleTranslate(['Hello, how are you?'], 'en');
    return { reply: 'Chưa có key Gemini — Google Dịch hoạt động: "' + t + '"' };
  }
  const [t] = await geminiTranslate(cfg, ['Hello, how are you?'], 'English');
  if (bsubUseRented(cfg)) return { reply: aiName(cfg) + ' hoạt động: "' + t + '"' };
  const changed = lastGeminiModel !== cfg.geminiModel ? ' (' + cfg.geminiModel + ' đang hết lượt hoặc không dùng được, tự chuyển)' : '';
  return { reply: 'Gemini ' + lastGeminiModel + changed + ' hoạt động: "' + t + '"' };
}