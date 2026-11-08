const BSUB_DEFAULTS = {
  enabled: true,
  geminiKey: '',
  geminiModel: 'gemini-flash-latest',   // bí danh luôn trỏ tới bản flash mới nhất
  // Giọng đọc: 'auto' | 'google' | 'namminh' | 'hoaimy' | 'browser:<tên giọng của máy>'
  // auto = giọng tiếng Việt của máy nếu có, không thì Google.
  voice: 'auto',
  // Key Azure Speech (tuỳ chọn): để có giọng Nam Minh / Hoài My trên Chrome (Edge có sẵn, không cần key).
  azureKey: '',
  azureRegion: 'southeastasia',
  duck: 0.2,           // âm lượng video khi đang đọc (0–1)
  voiceVolume: 1       // âm lượng giọng đọc (0–1)
};

// Giọng Microsoft tiếng Việt: tìm giọng có sẵn trên máy (Edge) theo mẫu tên, không có thì gọi Azure bằng tên neural.
const BSUB_MS_VOICES = {
  namminh: { label: 'Nam Minh (giọng nam)', match: /NamMinh/i, azure: 'vi-VN-NamMinhNeural' },
  hoaimy: { label: 'Hoài My (giọng nữ)', match: /HoaiMy/i, azure: 'vi-VN-HoaiMyNeural' }
};

// Chỉ lồng tiếng video có phụ đề tiếng Anh, tiếng Trung, tiếng Hindi.
const BSUB_SOURCE_LANGS = { en: 'tiếng Anh', zh: 'tiếng Trung', hi: 'tiếng Hindi' };

function bsubSourceLang(code) {
  const base = String(code || '').toLowerCase().split(/[-_]/)[0];
  return base in BSUB_SOURCE_LANGS ? base : null;
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

function bsubGet() {
  return new Promise(resolve => chrome.storage.local.get(BSUB_DEFAULTS, resolve));
}