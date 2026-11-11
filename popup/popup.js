const $ = id => document.getElementById(id);
let engineName = '', modeName = '';

bsubGet().then(cfg => {
  $('enabled').checked = !!cfg.enabled;
  $('enabled').onchange = () => chrome.storage.local.set({ enabled: $('enabled').checked });
  // Thanh âm lượng (0–100%), lưu dạng 0–1; kéo tới đâu áp dụng tới đó.
  for (const id of ['voiceVolume']) {
    const show = () => { $(id + 'Val').textContent = $(id).value + '%'; };
    $(id).value = Math.round(Number(cfg[id]) * 100);
    show();
    $(id).oninput = () => { show(); chrome.storage.local.set({ [id]: Number($(id).value) / 100 }); };
  }
  // Chọn giọng: đổi là áp dụng ngay cho câu kế tiếp.
  const hasAzure = !!cfg.azureKey;
  const info = () => { $('voiceInfo').textContent = bsubVoiceSummary($('voice').value, hasAzure); };
  bsubFillVoices($('voice'), cfg.voice, hasAzure);
  bsubWatchVoices($('voice'), () => hasAzure);
  info();
  if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', info);
  $('voice').onchange = () => { info(); chrome.storage.local.set({ voice: $('voice').value }); };
  $('preview').onclick = async () => {
    const m = $('previewMsg');
    m.hidden = false;
    m.textContent = 'Đang tạo giọng…';
    const err = await bsubPreview($('voice').value, Number($('voiceVolume').value) / 100).catch(e => 'Lỗi: ' + e.message);
    m.textContent = err;
    m.hidden = !err;
  };
  engineName = bsubUseRented(cfg) ? 'Vilao' : cfg.geminiKey ? 'Gemini' : 'Google Dịch';
  modeName = cfg.readMode === 'full' ? 'đủ ý cả bài' : 'tự động';
});

$('options').onclick = () => chrome.runtime.openOptionsPage();
$('retranslate').onclick = () => toTab({ type: 'retranslate' });

// Trả về { r } nếu trang trả lời, hoặc { why } nếu không.
async function toTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { why: 'notab' };
  // Không đọc được URL = extension chưa được phép truy cập trang này.
  if (!tab.url) return { why: 'noaccess' };
  if (!/^https?:\/\/([^/]+\.)?(youtube\.com|udemy\.com|coursera\.org|learn\.deeplearning\.ai)\//.test(tab.url)) return { why: 'notyt' };
  try { return { r: await chrome.tabs.sendMessage(tab.id, msg) }; } catch (e) { return { why: 'noscript' }; }
}

const WHY = {
  notab: 'Mở một video YouTube, Udemy, Coursera hoặc DeepLearning.AI để dùng.',
  notyt: 'Mở một video YouTube, Udemy, Coursera hoặc DeepLearning.AI để dùng.',
  noaccess: 'Chưa được phép đọc trang này: chuột phải icon TransVid → "Có thể đọc và thay đổi dữ liệu trang web" → cho phép, rồi F5.',
  noscript: 'Extension chưa chạy trong tab này: bấm F5 để tải lại trang video.'
};

async function refresh() {
  const { r, why } = await toTab({ type: 'status' });
  const ver = chrome.runtime.getManifest().version;
  $('ver').textContent = 'v' + ver;
  // Trạng thái ngắn + thanh tiến độ dịch (mẫu A); dòng phụ: nguồn dịch · chế độ đọc.
  let text, pct = -1, sub = engineName + ' · ' + modeName;
  if (!r) { text = 'Chưa có video'; sub = WHY[why] || WHY.noscript; }
  else if (r.build !== ver) { text = 'Tab đang chạy mã cũ'; sub = 'Bấm F5 để tải lại trang (v' + (r.build || '?') + ').'; }
  else if (r.on === false) { text = 'Chưa bật cho video này'; sub = 'Bấm logo TransVid trên thanh điều khiển video.'; }
  else if (r.unsupportedLang === 'vi-video') text = 'Video đã là tiếng Việt';
  else if (r.unsupportedLang) text = 'Không đọc được phụ đề "' + r.unsupportedLang + '"';
  else if (!r.total) { text = 'Đang tìm phụ đề…'; sub = 'Phát video vài giây (video phải có phụ đề).'; }
  else if (r.viDirect) { text = 'Đọc phụ đề tiếng Việt'; pct = 100; sub = r.total + ' câu, không cần dịch'; }
  else {
    pct = Math.floor(r.done * 100 / r.total);
    text = pct >= 100 ? 'Đang lồng tiếng' : 'Đang dịch';
    sub = engineName + ' · ' + bsubLangName(r.lang) + ' → Việt · ' + modeName + (r.failed ? ' · lỗi ' + r.failed + ' câu' : '');
  }
  $('progress').textContent = text;
  $('pct').textContent = pct >= 0 ? pct + '%' : '';
  $('barWrap').hidden = pct < 0;
  $('bar').style.width = Math.max(0, pct) + '%';
  $('engine').textContent = sub;
  $('err').hidden = !(r && r.error);
  $('err').textContent = (r && r.error) || '';
}
refresh();
setInterval(refresh, 1000);
// ---- Chẩn đoán: gom trạng thái mọi thành phần, sao chép để gửi cho người hỗ trợ ----
const mask = k => (k ? k.slice(0, 4) + '…(' + k.length + ' ký tự)' : '(trống)');
$('diag').onclick = async () => {
  const out = $('diagOut');
  out.hidden = false;
  out.value = 'Đang chẩn đoán… (thử Gemini có thể mất vài giây)';
  const cfg = await bsubGet();
  const lines = [];
  lines.push('Extension v' + chrome.runtime.getManifest().version + ' | ' + navigator.userAgent.match(/(Edg|Chrome)\/[\d.]+/g).join(' '));
  lines.push('Cấu hình: bật=' + cfg.enabled + ' giọng=' + cfg.voice + ' volGiọng=' + cfg.voiceVolume
    + ' | geminiKey=' + mask(cfg.geminiKey) + ' model=' + cfg.geminiModel + ' | keyThuê=' + mask(cfg.apiKey) + ' ' + (cfg.apiBase || '-') + ' ' + (cfg.apiModel || '-') + ' | azureKey=' + mask(cfg.azureKey) + ' region=' + cfg.azureRegion);
  lines.push('Giọng tiếng Việt trong popup: ' + (bsubVietVoices().map(v => v.name).join(', ') || 'KHÔNG CÓ'));
  const t = await chrome.runtime.sendMessage({ type: 'test' }).catch(e => ({ ok: false, error: e.message }));
  lines.push('Thử dịch (background): ' + (t && t.ok ? t.reply : 'LỖI ' + (t ? t.error : 'không phản hồi')));
  const tts = await chrome.runtime.sendMessage({ type: 'tts', text: 'Xin chào', voice: BSUB_MS_VOICES[cfg.voice] ? cfg.voice : 'google' }).catch(e => ({ ok: false, error: e.message }));
  lines.push('Thử tạo giọng: ' + (tts && tts.ok ? 'ok engine=' + tts.engine + ' ' + tts.audio.length + ' ký tự' + (tts.warn ? ' CẢNH BÁO=' + tts.warn : '') : 'LỖI ' + (tts ? tts.error : 'không phản hồi')));
  const pr = await chrome.runtime.sendMessage({ type: 'probeTts' }).catch(e => ({ ok: false, error: e.message }));
  lines.push('Dò giọng Google: ' + (pr && pr.ok ? 'có cookie=' + pr.withCookies + ', không cookie=' + pr.noCookies : 'LỖI ' + (pr ? pr.error : 'không phản hồi')));
  const perms = [];
  for (const o of bsubNeededOrigins(cfg)) perms.push(o.replace(/^https:\/\/|\/\*$/g, '') + '=' + ((await chrome.permissions.contains({ origins: [o] }).catch(() => false)) ? 'có' : 'BỊ CHẶN'));
  lines.push('Quyền: ' + perms.join(', ') + (perms.some(p => p.endsWith('BỊ CHẶN')) ? '  -> chrome://extensions > TransVid > Chi tiết > Truy cập trang web, hoặc bấm Lưu trong Cài đặt' : ''));
  const { r, why } = await toTab({ type: 'diag' });
  if (!r) lines.push('Tab: KHÔNG liên lạc được (' + (why || 'không phản hồi') + ')');
  else {
    lines.push('Tab: mã v' + r.build + ' | ' + r.url);
    lines.push('Video trang=' + r.pageVideoId + ' | phụ đề đang dùng=' + r.cueKey + ' | ' + r.total + ' câu');
    lines.push('Video: ' + JSON.stringify(r.video));
    lines.push('Giọng trong tab: chọn=' + r.voiceSetting + ' giọng máy dùng=' + r.localVoice + ' | giọng Việt có: ' + (r.viVoicesInTab.join(', ') || 'KHÔNG CÓ'));
    if (r.player) {
      lines.push('Trình phát: src=' + (r.player.src || '(trống)') + ' | textTracks=' + (r.player.textTracks.join(', ') || 'KHÔNG CÓ'));
      lines.push('Tệp m3u8/vtt đã tải: ' + (r.player.media.join(', ') || 'KHÔNG CÓ'));
      lines.push('Nút ở đáy video (thẻ|role|aria|chữ|class|cha|trái|đáy):');
      lines.push(...(r.player.controls.length ? r.player.controls.map(c => '  ' + c) : ['  KHÔNG CÓ']));
    }
    lines.push('Trình duyệt đã tải timedtext: ' + (r.timedtextSeenByBrowser && r.timedtextSeenByBrowser.length ? r.timedtextSeenByBrowser.join(', ') : 'KHÔNG CÓ'));
    lines.push('Lỗi gần nhất: ' + (r.lastError || '(không)'));
    lines.push('Câu đầu: ' + JSON.stringify(r.sample));
    lines.push('Câu hiện tại: ' + JSON.stringify(r.current));
    lines.push('--- Nhật ký ---');
    lines.push(...r.log);
  }
  out.value = lines.join('\n');
  out.select();
  try { await navigator.clipboard.writeText(out.value); $('diag').title = 'Đã sao chép nhật ký ✓'; } catch (e) { $('diag').title = 'Bôi đen ô nhật ký rồi copy'; }
};