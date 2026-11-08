// Ô chọn giọng đọc + nút nghe thử, dùng chung cho popup và trang cài đặt.

function bsubVietVoices() {
  return (window.speechSynthesis ? speechSynthesis.getVoices() : [])
    .filter(v => v.lang.toLowerCase().startsWith('vi'));
}

// Giọng của máy ứng với lựa chọn (null = phải tạo giọng qua mạng).
function bsubLocalFor(voice) {
  const vi = bsubVietVoices();
  if (BSUB_MS_VOICES[voice]) return vi.find(v => BSUB_MS_VOICES[voice].match.test(v.name)) || null;
  if (voice.startsWith('browser:')) return vi.find(v => v.name === voice.slice(8)) || null;
  if (voice === 'auto') return vi.find(v => /natural|online/i.test(v.name)) || vi[0] || null;
  return null;
}

// Điền danh sách giọng vào <select>. Giọng của máy nạp không đồng bộ nên gọi lại khi có voiceschanged.
function bsubFillVoices(select, current, hasAzure) {
  const keep = current || select.value || 'auto';
  select.textContent = '';
  const group = (label) => { const g = document.createElement('optgroup'); g.label = label; select.appendChild(g); return g; };
  const add = (parent, value, text) => parent.appendChild(new Option(text, value));

  const vi = bsubVietVoices();
  const basic = group('Cơ bản');
  add(basic, 'auto', vi.length ? 'Tự động (giọng tốt nhất trên máy)' : 'Tự động (máy không có giọng Việt → Google)');
  add(basic, 'google', 'Google Dịch');

  // Giọng không có trên máy và không có key Azure: khoá lại, vì chọn vào cũng chỉ ra giọng Google.
  const ms = group('Giọng Microsoft tự nhiên');
  for (const [id, v] of Object.entries(BSUB_MS_VOICES)) {
    const local = vi.some(x => v.match.test(x.name));
    const o = add(ms, id, v.label + (local ? ' ★ có sẵn' : hasAzure ? ' (qua Azure)' : ' — cần Edge hoặc key Azure'));
    o.disabled = !local && !hasAzure;
  }

  const others = vi.filter(x => !Object.values(BSUB_MS_VOICES).some(v => v.match.test(x.name)));
  if (others.length) {
    const g = group('Giọng tiếng Việt khác trên máy');
    for (const v of others) add(g, 'browser:' + v.name, v.name);
  }

  if (![...select.options].some(o => o.value === keep)) add(select, keep, keep.replace(/^\w+:/, '') + ' (không có trên máy này)');
  select.value = keep;
}

// Giọng thật sự sẽ được dùng cho lựa chọn hiện tại (để không ai bị nhầm "đổi giọng mà nghe y hệt").
function bsubVoiceSummary(voice, hasAzure) {
  const local = bsubLocalFor(voice);
  if (local) return 'Đang dùng: ' + local.name;
  if (BSUB_MS_VOICES[voice] && hasAzure) return 'Đang dùng: ' + BSUB_MS_VOICES[voice].label + ' qua Azure';
  if (BSUB_MS_VOICES[voice]) return 'Máy không có giọng này và chưa có key Azure → đang đọc bằng giọng Google';
  return bsubVietVoices().length ? 'Đang dùng: giọng Google' : 'Đang dùng: giọng Google (Chrome không có giọng Việt; mở bằng Edge để có Nam Minh / Hoài My miễn phí)';
}

function bsubWatchVoices(select, getHasAzure) {
  if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', () => bsubFillVoices(select, select.value, getHasAzure()));
}

let bsubPreviewAudio = null;
// Nghe thử một câu bằng giọng đang chọn. Trả về chuỗi lỗi/cảnh báo hoặc ''.
async function bsubPreview(voice, volume) {
  const text = 'Xin chào, đây là giọng đọc tiếng Việt bạn vừa chọn.';
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (bsubPreviewAudio) { bsubPreviewAudio.pause(); bsubPreviewAudio = null; }
  const local = bsubLocalFor(voice);
  if (local) {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = local; u.lang = local.lang; u.volume = volume;
    speechSynthesis.speak(u);
    return '';
  }
  const r = await chrome.runtime.sendMessage({ type: 'tts', text, voice: BSUB_MS_VOICES[voice] ? voice : 'google' });
  if (!r || !r.ok) return 'Lỗi: ' + (r ? r.error : 'không phản hồi');
  const bin = atob(r.audio), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  bsubPreviewAudio = new Audio(URL.createObjectURL(new Blob([bytes], { type: r.mime || 'audio/mpeg' })));
  bsubPreviewAudio.volume = volume;
  await bsubPreviewAudio.play();
  return r.warn || '';
}