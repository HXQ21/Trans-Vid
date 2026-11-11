const $ = id => document.getElementById(id);
const FIELDS = ['geminiKey', 'apiKey', 'voice', 'azureKey', 'azureRegion', 'readMode'];
const hasAzure = () => !!$('azureKey').value.trim();

// Nhãn "đang dùng" cho nguồn dịch: Vilao > Gemini > Google Dịch.
function showSource() {
  const vilao = !!$('apiKey').value.trim(), gemini = !vilao && !!$('geminiKey').value.trim();
  $('srcVilao').hidden = !vilao;
  $('srcGemini').hidden = !gemini;
  $('srcGoogleRow').hidden = vilao || gemini;
}

bsubGet().then(cfg => {
  bsubFillVoices($('voice'), cfg.voice, !!cfg.azureKey);
  for (const k of FIELDS) $(k).value = cfg[k];
  $('autoDub').checked = !!cfg.autoDub;
  showSource();
});
$('apiKey').addEventListener('input', showSource);
$('geminiKey').addEventListener('input', showSource);
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
  return grantAll(o);
}

// Xin quyền gọi các dịch vụ cần dùng (Chrome hỏi một lần). Trả về lời nhắc nếu còn thiếu quyền.
// Chrome có thể đang chặn cả quyền khai báo sẵn (mục "Truy cập trang web" bị hạn chế): xin lại luôn.
async function grantAll(cfg) {
  const want = bsubNeededOrigins(cfg);
  try {
    const missing = [];
    for (const o of want) if (!(await chrome.permissions.contains({ origins: [o] }))) missing.push(o);
    if (!missing.length) return '';
    return (await chrome.permissions.request({ origins: missing })) ? '' : 'Chưa cấp quyền gọi ' + missing.join(', ') + ': dịch / giọng đọc sẽ lỗi.';
  } catch (e) {
    return 'Bấm nút Lưu để cấp quyền gọi dịch vụ dịch và giọng đọc.';
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