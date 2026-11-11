// Phiên bản prompt dịch (background.js geminiTranslate) + cách ghép câu + cấu trúc cache.
// Sửa prompt thì tăng số này để cache bản dịch cũ tự bị bỏ. (7 = prompt lồng tiếng + câu nói nhanh dịch gọn, 2026-11-11.)
const BSUB_PROMPT_VERSION = 7;

const BSUB_DEFAULTS = {
  enabled: true,
  geminiKey: '',
  geminiModel: 'gemini-flash-latest',   // bí danh luôn trỏ tới bản flash mới nhất
  // Key thuê Vilao (API tương thích OpenAI): địa chỉ + model cố định, người dùng chỉ dán key trong Cài đặt.
  // Có key thì dùng, ưu tiên hơn key Gemini.
  apiBase: 'https://api.vilao.ai/v1',
  apiModel: 'chib/gemini-3.8-flash',
  apiKey: '',
  // Giọng đọc: 'auto' | 'google' | 'namminh' | 'hoaimy' | 'browser:<tên giọng của máy>'
  // auto = giọng tiếng Việt của máy nếu có, không thì Google.
  voice: 'auto',
  // Key Azure Speech (tuỳ chọn): để có giọng Nam Minh / Hoài My trên Chrome (Edge có sẵn, không cần key).
  azureKey: '',
  azureRegion: 'southeastasia',
  voiceVolume: 1,      // âm lượng giọng đọc (0–1)
  // Chế độ đọc: 'auto' = câu nói nhanh dịch gọn để khớp hình; 'full' = đủ ý cả bài (không dịch gọn, không bỏ câu,
  // giọng đọc nhanh tới 2,5 lần; có thể chạy sau hình vài giây ở đoạn nói nhanh).
  readMode: 'auto',
  // Nút "Lồng tiếng" trên video: mặc định mỗi video đều tắt, bấm nút mới dịch/đọc.
  autoDub: false,      // true = tự bật cho mọi video (trừ video đã bấm tắt)
  dubVideos: {}        // video đã bấm: { 'yt:<id>' | 'pg:<host><đường dẫn>': 1 (bật) | 0 (tắt) }, tối đa 300
};

// Giọng Microsoft tiếng Việt: tìm giọng có sẵn trên máy (Edge) theo mẫu tên, không có thì gọi Azure bằng tên neural.
const BSUB_MS_VOICES = {
  namminh: { label: 'Nam Minh (giọng nam)', match: /NamMinh/i, azure: 'vi-VN-NamMinhNeural' },
  hoaimy: { label: 'Hoài My (giọng nữ)', match: /HoaiMy/i, azure: 'vi-VN-HoaiMyNeural' }
};

// Ngôn ngữ phụ đề gốc: nhận mọi ngôn ngữ (mã 2–3 chữ cái); tiếng Việt thì đọc thẳng, không dịch.
const BSUB_SOURCE_LANGS = { en: 'tiếng Anh', zh: 'tiếng Trung', hi: 'tiếng Hindi' };   // tên quen dùng; ngôn ngữ khác lấy từ trình duyệt

function bsubSourceLang(code) {
  const base = String(code || '').toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(base) ? base : null;
}

function bsubIsVi(code) {
  return bsubSourceLang(code) === 'vi';
}

// Tên ngôn ngữ bằng tiếng Việt ("es" -> "tiếng Tây Ban Nha").
function bsubLangName(code) {
  const base = bsubSourceLang(code);
  if (!base) return String(code || '');
  if (BSUB_SOURCE_LANGS[base]) return BSUB_SOURCE_LANGS[base];
  try { return new Intl.DisplayNames(['vi'], { type: 'language' }).of(base) || base; } catch (e) { return base; }
}

// Nhãn phụ đề do máy làm (tự tạo hoặc máy dịch): Udemy "[Auto]" / "[Tự động]" (giao diện tiếng Việt),
// Coursera "(auto)", "(tự động)", "(자동)", "(オート)", "(自动)"...
const BSUB_AUTO_WORDS = 'auto|automatic|automatique|automático|automatico|automatisch|automatyczne|otomatik|tự động|自動|自动|자동|オート|автоматически';
function bsubIsAutoLabel(label) {
  return new RegExp('[\\[(]\\s*(' + BSUB_AUTO_WORDS + ')\\s*[\\])]', 'i').test(String(label || ''));
}

// Chọn phụ đề tốt nhất trong danh sách [{ label, lang, ... }]:
// tiếng Việt do người làm (đọc thẳng) > tiếng Anh do người làm > bản do người làm khác. Bỏ bản máy dịch và "Off".
// Nhãn không phải phụ đề: "Off"/"Tắt", tốc độ phát "0.5x", "1,25×", nhãn không có chữ cái.
function bsubIsNotCaption(label) {
  const l = String(label || '').trim();
  return !l || /^(off|tắt)$/i.test(l) || /^\d+([.,]\d+)?\s*[x×]$/i.test(l) || !/\p{L}/u.test(l);
}

// Trong các menu đang có trên trang ([[nhãn, ...], ...]), menu phụ đề là menu có mục "Off"/"Tắt"
// (menu tốc độ phát, chất lượng... không có). Trả về vị trí, -1 nếu không có.
function bsubFindCaptionMenu(menus) {
  return (menus || []).findIndex(items => (items || []).some(l => /^(off|tắt)$/i.test(String(l || '').trim())));
}

function bsubPickCaption(list) {
  const usable = (list || []).filter(t => t && bsubSourceLang(t.lang) && !bsubIsNotCaption(t.label));
  const human = usable.filter(t => !bsubIsAutoLabel(t.label));
  const vi = human.find(t => bsubIsVi(t.lang));
  if (vi) return { ...vi, vi: true };
  const pick = human.find(t => bsubSourceLang(t.lang) === 'en') || human[0];
  if (pick) return { ...pick, vi: false };
  // Không có bản người làm: dùng bản tự động (tiếng Anh trước) làm nguồn để dịch.
  // Tuyệt đối không đọc thẳng tiếng Việt do máy làm.
  const auto = usable.filter(t => !bsubIsVi(t.lang));
  const fb = auto.find(t => bsubSourceLang(t.lang) === 'en') || auto[0];
  return fb ? { ...fb, vi: false, auto: true } : null;
}

// ---- HLS (.m3u8), vd learn.deeplearning.ai: phụ đề là các track WebVTT khai trong danh sách chính ----
// Đường dẫn tương đối trong .m3u8 -> đường dẫn đầy đủ (không dùng URL() để chạy được ở mọi nơi).
function bsubResolveUrl(rel, base) {
  rel = String(rel || '').trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) return rel;
  const b = String(base || '').split(/[?#]/)[0];
  const origin = (/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(b) || [''])[0];
  if (rel.startsWith('//')) return b.split(':')[0] + ':' + rel;
  if (rel.startsWith('/')) return origin + rel;
  const parts = b.slice(origin.length, b.lastIndexOf('/') + 1).split('/').filter(Boolean);
  for (const p of rel.split('/')) {
    if (p === '..') parts.pop(); else if (p !== '.') parts.push(p);
  }
  return origin + '/' + parts.join('/');
}

// Danh sách chính -> [{ label, lang, src }] các track phụ đề (#EXT-X-MEDIA:TYPE=SUBTITLES).
function bsubParseHlsSubs(text, baseUrl) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/^#EXT-X-MEDIA:/i.test(line) || !/TYPE=SUBTITLES/i.test(line)) continue;
    const attr = k => { const m = new RegExp('(?:^|[:,])' + k + '=(?:"([^"]*)"|([^,]*))', 'i').exec(line); return m ? (m[1] !== undefined ? m[1] : m[2]) : ''; };
    const uri = attr('URI');
    if (uri) out.push({ label: attr('NAME'), lang: attr('LANGUAGE'), src: bsubResolveUrl(uri, baseUrl) });
  }
  return out;
}

// Playlist của một track -> các đường dẫn đoạn .vtt (theo thứ tự).
function bsubHlsSegments(text, baseUrl) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => bsubResolveUrl(l, baseUrl));
}

// Đọc tệp WebVTT -> [{ start, end, text }] (thời gian giây; "mm:ss.mmm" hoặc "hh:mm:ss.mmm").
function bsubParseVtt(text) {
  const toSec = s => s.trim().split(':').reduce((a, p) => a * 60 + parseFloat(p.replace(',', '.')), 0);
  const out = [];
  for (const block of String(text || '').replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = toSec(a), end = toSec(b.trim().split(/\s+/)[0]);
    const body = lines.slice(i + 1).join(' ').replace(/\s+/g, ' ').trim();
    if (body && isFinite(start) && isFinite(end)) out.push({ start, end, text: body });
  }
  return out;
}

// Chỉ giữ chữ (mọi ngôn ngữ, kể cả dấu tiếng Việt), số và dấu câu thường.
// Mọi ký hiệu khác (> < ≫ ＞ ‹ › » ♪ # * …) bị bỏ, vì giọng đọc sẽ đọc thành "dấu lớn", "dấu bé"...
function bsubStripSymbols(t) {
  return String(t)
    .replace(/&(gt|lt|amp|quot|#\d+|#x[0-9a-f]+);?/gi, ' ')     // thực thể HTML còn sót
    .replace(/&\s+(gt|lt)\s*;/gi, ' ')                           // dạng "& gt;" do máy dịch tách ra
    .replace(/\[[^\]]*\]|［[^］]*］|\([^)]*\)|（[^）]*）/g, ' ') // nhãn âm thanh [Music] (laughs)
    .replace(/[^\p{L}\p{M}\p{N}\s.,!?;:'’%…。，！？、।]/gu, ' ')
    .replace(/(^|\s)[.,!?;:…]+(?=\s|$)/g, ' ')                    // dấu câu đứng một mình
    .replace(/\s+/g, ' ')
    .trim();
}

// Câu gốc trước khi dịch: chỉ bỏ "rác" của phụ đề (>> đổi người nói, [Music], (laughs), ♪).
// GIỮ $ % & + @ # và số, vì chúng mang nghĩa ("$0" = "0 đô la"); máy dịch cần thấy chúng.
function bsubCleanSource(t) {
  return String(t)
    .replace(/<\/?[a-z][^<>]*>/gi, ' ')                        // thẻ định dạng của phụ đề: <i>, </i>, <b>, <font ...>
    .replace(/&(gt|lt);?/gi, ' ')
    .replace(/\[[^\]]*\]|［[^］]*］|\([^)]*\)|（[^）]*）/g, ' ')
    .replace(/>{2,}|<{2,}|[≫≪»«♪♫]/g, ' ')
    .replace(/^\s*-\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Câu đem đọc: đổi ký hiệu có nghĩa thành chữ, rồi bỏ mọi ký hiệu còn lại.
function bsubSpeakable(t) {
  return bsubStripSymbols(String(t)
    .replace(/<\/?[a-z][^<>]*>/gi, ' ')
    .replace(/(?:US)?\$\s?(\d[\d.,]*)/g, '$1 đô la')
    .replace(/(\d[\d.,]*)\s?\$/g, '$1 đô la')
    .replace(/€\s?(\d[\d.,]*)|(\d[\d.,]*)\s?€/g, (m, a, b) => (a || b) + ' euro')
    .replace(/\s*&\s*/g, ' và ')
    .replace(/\s\+\s/g, ' cộng ')
    .replace(/#\s?(\d+)/g, 'số $1')
    .replace(/@/g, ' a còng '));
}

// ---- Ghép câu ----
// Phụ đề hay bị cắt vụn: một câu trải qua nhiều dòng, một dòng chứa cuối câu này + đầu câu sau.
// Dịch/đọc từng mảnh thì sai nghĩa, nên ghép lại thành câu trọn vẹn:
//  1. chia thành "đoạn nói liền" (ngừng lâu thì sang đoạn mới),
//  2. nối chữ cả đoạn rồi tách câu bằng Intl.Segmenter (không có thì theo dấu . ! ?),
//  3. câu quá dài / quá lâu thì chia lại theo ranh giới dòng, mảnh quá ngắn gộp vào câu kế.
// Thời điểm bắt đầu câu nằm giữa dòng được nội suy theo vị trí chữ trong dòng.
const BSUB_CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;

function bsubSentenceSplitter(lang) {
  let s = null;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try { s = new Intl.Segmenter(lang && lang !== 'und' ? lang : 'en', { granularity: 'sentence' }); }
    catch (e) { try { s = new Intl.Segmenter('en', { granularity: 'sentence' }); } catch (e2) { s = null; } }
  }
  return text => {
    const r = [];
    const push = (a, b) => {
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (b > a) r.push([a, b]);
    };
    if (s) {
      for (const x of s.segment(text)) push(x.index, x.index + x.segment.length);
    } else {
      const re = /[^.!?…。！？]*[.!?…。！？]+["'”’)\]」』]*\s*|[^.!?…。！？]+$/g;
      let m;
      while ((m = re.exec(text)) && m[0]) push(m.index, m.index + m[0].length);
    }
    return r;
  };
}

function bsubWordCount(t) {
  return BSUB_CJK.test(t) ? t.replace(/\s/g, '').length / 2 : (t.match(/\S+/g) || []).length;
}

// Câu nói nhanh: số từ gốc / thời lượng câu >= BSUB_FAST_WPS (2,8 từ/giây ≈ 170 từ/phút; nói thường 2,3–2,7).
// Câu nói nhanh dịch gọn để khớp hình; câu nói chậm dịch đủ ý (người dùng chọn đo từng đoạn, 2026-11-11).
const BSUB_FAST_WPS = 2.8;
function bsubIsFastCue(c) {
  const d = (c && c.end) - (c && c.start);
  return d > 0.3 && bsubWordCount(String(c.text || '')) / d >= BSUB_FAST_WPS;
}

// list: [{start, end, text}] theo thời gian. opt: {lang, asr}. Trả về [{start, end, text, tr: null}].
function bsubSegmentSentences(list, opt) {
  opt = opt || {};
  const asr = !!opt.asr;
  const maxGap = asr ? 0.8 : 1.5, maxDur = asr ? 12 : 20, maxLen = asr ? 220 : 300, minWords = 4;
  const split = bsubSentenceSplitter(opt.lang);
  const out = [];

  const doRun = run => {
    // Nối chữ của cả đoạn, nhớ vị trí từng dòng.
    let full = '';
    const spans = [];
    for (const c of run) {
      const t = String(c.text).replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (full) {
        const glue = (/\d\.$/.test(full) && /^\d/.test(t)) || (BSUB_CJK.test(full[full.length - 1]) && BSUB_CJK.test(t[0])) ? '' : ' ';
        full += glue;
      }
      spans.push({ a: full.length, b: full.length + t.length, start: c.start, end: c.end });
      full += t;
    }
    if (!spans.length) return;
    const timeAt = (o, isEnd) => {
      let sp = spans.find(s => o >= s.a && (isEnd ? o <= s.b : o < s.b));
      if (!sp) sp = spans.find(s => s.a >= o) || spans[spans.length - 1];
      const k = sp.b > sp.a ? Math.min(1, Math.max(0, (o - sp.a) / (sp.b - sp.a))) : 0;
      return Math.round((sp.start + k * (sp.end - sp.start)) * 1000) / 1000;
    };
    // Mỗi câu = các mảnh (phần câu nằm trong từng dòng).
    const groups = [];
    for (const [a, b] of split(full)) {
      let cur = null;
      for (const s of spans) {
        const pa = Math.max(a, s.a), pb = Math.min(b, s.b);
        if (pb <= pa || !full.slice(pa, pb).trim()) continue;
        // Câu quá dài / quá lâu: chia theo ranh giới dòng.
        if (cur && (timeAt(pb, true) - timeAt(cur.a) > maxDur || pb - cur.a > maxLen)) { groups.push(cur); cur = null; }
        if (!cur) cur = { a: pa, b: pb }; else cur.b = pb;
      }
      if (cur) groups.push(cur);
    }
    // Mảnh quá ngắn gộp vào câu kế (cuối đoạn thì gộp vào câu trước).
    const merged = [];
    for (let i = 0; i < groups.length; i++) {
      const g = { ...groups[i] };
      while (bsubWordCount(full.slice(g.a, g.b)) < minWords && i + 1 < groups.length) g.b = groups[++i].b;
      const last = merged[merged.length - 1];
      if (last && bsubWordCount(full.slice(g.a, g.b)) < minWords) last.b = g.b;
      else merged.push(g);
    }
    for (const g of merged) {
      out.push({ start: timeAt(g.a), end: timeAt(g.b, true), text: full.slice(g.a, g.b).trim(), tr: null });
    }
  };

  let run = [];
  for (const c of list || []) {
    if (!c || !c.text || !isFinite(c.start)) continue;
    const p = run[run.length - 1];
    if (p && c.start - p.end >= maxGap) { doRun(run); run = []; }
    run.push(c);
  }
  if (run.length) doRun(run);
  return out;
}

// ---- Nguồn dịch AI ----
// Key thuê dùng được khi có đủ địa chỉ + model + key.
function bsubUseRented(cfg) {
  return !!(cfg && String(cfg.apiKey || '').trim() && String(cfg.apiBase || '').trim() && String(cfg.apiModel || '').trim());
}
// Có dịch bằng AI không (key thuê hoặc key Gemini); không thì chỉ Google Dịch.
function bsubAiOn(cfg) {
  return bsubUseRented(cfg) || !!(cfg && cfg.geminiKey);
}
// Mã nhận diện nguồn dịch: đổi nguồn thì bản dịch lưu (cache) cũng tách riêng.
function bsubAiId(cfg) {
  if (bsubUseRented(cfg)) return 'oa:' + String(cfg.apiBase).trim().replace(/\/+$/, '') + '|' + String(cfg.apiModel).trim();
  return cfg && cfg.geminiKey ? (cfg.geminiModel || BSUB_DEFAULTS.geminiModel) : 'google';
}

// Các địa chỉ extension cần gọi (theo key đang có). Chrome có thể chặn quyền ("Truy cập trang web" bị hạn chế):
// Cài đặt dùng danh sách này để xin lại, Chẩn đoán dùng để báo quyền nào đang thiếu.
function bsubNeededOrigins(cfg) {
  const o = ['https://translate.googleapis.com/*', 'https://translate.google.com/*'];
  if (cfg && cfg.geminiKey) o.push('https://generativelanguage.googleapis.com/*');
  if (cfg && cfg.azureKey) o.push('https://*.tts.speech.microsoft.com/*');
  if (cfg && String(cfg.apiKey || '').trim()) {
    const m = /^(https:\/\/[^/?#]+)/i.exec(String(cfg.apiBase || BSUB_DEFAULTS.apiBase).trim());
    if (m) o.push(m[1].toLowerCase() + '/*');
  }
  return o;
}

function bsubGet() {
  return new Promise(resolve => chrome.storage.local.get(BSUB_DEFAULTS, resolve));
}