const $ = id => document.getElementById(id);
const FIELDS = ['geminiKey', 'geminiModel', 'voice', 'azureKey', 'azureRegion', 'duck'];
const hasAzure = () => !!$('azureKey').value.trim();

bsubGet().then(cfg => {
  bsubFillVoices($('voice'), cfg.voice, !!cfg.azureKey);
  for (const k of FIELDS) $(k).value = cfg[k];
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
  o.geminiModel = o.geminiModel || BSUB_DEFAULTS.geminiModel;
  o.azureRegion = (o.azureRegion || BSUB_DEFAULTS.azureRegion).toLowerCase().replace(/[^a-z0-9]/g, '');
  o.duck = Math.min(1, Math.max(0, isFinite(o.duck) ? o.duck : 0.2));
  await chrome.storage.local.set(o);
}

function note(text, bad) {
  $('msg').textContent = text;
  $('msg').className = bad ? 'warn' : 'ok';
}

$('save').onclick = async () => { await save(); note('Đã lưu.'); };

$('test').onclick = async () => {
  await save();
  note('Đang thử dịch…');
  const r = await chrome.runtime.sendMessage({ type: 'test' });
  if (r && r.ok) { note(r.reply); if (r.model) $('geminiModel').value = r.model; }
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
  $(k).addEventListener('change', async () => { await save(); note('Đã tự lưu.'); });
}