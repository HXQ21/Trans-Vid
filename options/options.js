const $ = id => document.getElementById(id);
const FIELDS = ['geminiKey', 'apiKey', 'voice', 'azureKey', 'azureRegion'];
const hasAzure = () => !!$('azureKey').value.trim();

bsubGet().then(cfg => {
  bsubFillVoices($('voice'), cfg.voice, !!cfg.azureKey);
  for (const k of FIELDS) $(k).value = cfg[k];
  $('autoDub').checked = !!cfg.autoDub;
});
$('autoDub').addEventListener('change', async () => {
  await chrome.storage.local.set({ autoDub: $('autoDub').checked });
  note('Đã tự lưu.');
});
bsubWatchVoices($('voice'), hasAzure);
// Nhập/xoá key Azure: cập nhật ghi chú của giọng Nam Minh / Hoài My.
$('azureKey').oninput = () => bsubFillVoices($('voice'), $('voice').value, hasAzure());

$('preview').onclick = async () => {
  await save();
  note('Đang tạo giọng…');
  const err = await bsubPreview($('voice').value, 1).catch(e => 'Lỗi: ' + e.message);
  note(err || 'Đang phát giọng ' + $('voice').selectedOptions[0].textContent, /^Lỗi/.test(err));
};

async function save() {
  const o = {};
  for (const k of FIELDS) {
    const el = $(k);
    o[k] = el.type === 'number' ? Number(el.value) : el.value.trim();
  }
  // Model Gemini chọn tự động (tự chuyển khi hết lượt): luôn bắt đầu từ bản flash mới nhất.
  o.geminiModel = BSUB_DEFAULTS.geminiModel;
  o.azureRegion = (o.azureRegion || BSUB_DEFAULTS.azureRegion).toLowerCase().replace(/[^a-z0-9]/g, '');
  // Địa chỉ + model Vilao cố định (không hiện trong Cài đặt).
  o.apiBase = BSUB_DEFAULTS.apiBase;
  o.apiModel = BSUB_DEFAULTS.apiModel;
  await chrome.storage.local.set(o);
  return o.apiKey ? grantApi(o.apiBase) : '';
}

// Key thuê: extension cần quyền gọi tới địa chỉ API đó (Chrome hỏi một lần). Trả về lời nhắc nếu chưa có quyền.
async function grantApi(base) {
  if (!base) return '';
  let origin;
  try { origin = new URL(base).origin + '/*'; } catch (e) { return 'Địa chỉ API không hợp lệ.'; }
  if (!/^https:/.test(origin)) return 'Địa chỉ API phải bắt đầu bằng https://';
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return '';
    return (await chrome.permissions.request({ origins: [origin] })) ? '' : 'Chưa cấp quyền gọi ' + origin + ': key thuê sẽ không chạy.';
  } catch (e) {
    return 'Bấm nút Lưu để cấp quyền gọi ' + origin + '.';
  }
}

function note(text, bad) {
  $('msg').textContent = text;
  $('msg').className = bad ? 'warn' : 'ok';
}

$('save').onclick = async () => { const w = await save(); note(w || 'Đã lưu.', !!w); };

$('test').onclick = async () => {
  const w = await save();
  if (w) return note(w, true);
  note('Đang thử dịch…');
  const r = await chrome.runtime.sendMessage({ type: 'test' });
  if (r && r.ok) note(r.reply);
  else note('Lỗi: ' + (r ? r.error : 'không phản hồi'), true);
};

$('clear').onclick = async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('cache:'));
  await chrome.storage.local.remove(keys);
  note('Đã xoá ' + keys.length + ' bản dịch đã lưu.');
};
// Tự lưu ngay khi đổi một ô (dán key xong đóng trang vẫn không mất).
for (const k of FIELDS) {
  $(k).addEventListener('change', async () => { const w = await save(); note(w || 'Đã tự lưu.', !!w); });
}