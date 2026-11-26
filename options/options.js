const $ = id => document.getElementById(id);
const FIELDS = ['apiProvider', 'vilaoKey', 'customBase', 'customModel', 'customKey', 'geminiKey', 'voice', 'azureKey', 'azureRegion', 'readMode'];
const hasAzure = () => !!$('azureKey').value.trim();
const isCustom = () => $('apiProvider').value === 'custom';
// Tự điền API dùng được khi đủ địa chỉ https:// + model + key.
const customReady = () => !!(bsubNormApiBase($('customBase').value) && $('customModel').value.trim() && $('customKey').value.trim());

// Vilao: chỉ ô key. Tự điền API: ô địa chỉ, model, key.
function showProvider() {
  $('rowVilao').hidden = isCustom();
  for (const id of ['rowBase', 'rowModel', 'rowCKey']) $(id).hidden = !isCustom();
}

// Nhãn "đang dùng" cho nguồn dịch: Nguồn AI (Vilao / tự điền) > Gemini > Google Dịch.
function showSource() {
  const rented = isCustom() ? customReady() : !!$('vilaoKey').value.trim();
  const gemini = !rented && !!$('geminiKey').value.trim();
  $('srcRented').hidden = !rented;
  $('srcGemini').hidden = !gemini;
  $('srcGoogleRow').hidden = rented || gemini;
}

bsubGet().then(cfg => {
  bsubFillVoices($('voice'), cfg.voice, !!cfg.azureKey);
  // Bản cũ lưu key Vilao ở apiKey.
  if (!cfg.vilaoKey && cfg.apiProvider !== 'custom') cfg.vilaoKey = cfg.apiKey;
  for (const k of FIELDS) $(k).value = cfg[k];
  showProvider();
  showSource();
});
for (const id of ['vilaoKey', 'customBase', 'customModel', 'customKey', 'geminiKey']) $(id).addEventListener('input', showSource);
$('apiProvider').addEventListener('change', () => { showProvider(); showSource(); });
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
  // Bộ địa chỉ / model / key dùng để dịch theo nguồn đã chọn. Vilao: địa chỉ + model cố định.
  let warn = '';
  o.apiBase = BSUB_DEFAULTS.apiBase;
  o.apiModel = BSUB_DEFAULTS.apiModel;
  o.apiKey = o.vilaoKey;
  const base = bsubNormApiBase(o.customBase);
  if (base) o.customBase = $('customBase').value = base;
  $('customBase').classList.toggle('bad', o.apiProvider === 'custom' && !!o.customBase && !base);
  if (o.apiProvider === 'custom') {
    if (base && o.customModel && o.customKey) {
      o.apiBase = base;
      o.apiModel = o.customModel;
      o.apiKey = o.customKey;
    } else {
      o.apiKey = '';
      const miss = [!o.customBase && 'địa chỉ API', !o.customModel && 'model', !o.customKey && 'key'].filter(Boolean);
      warn = (o.customBase && !base ? 'Địa chỉ API phải bắt đầu bằng https:// (ví dụ https://openrouter.ai/api/v1).' : 'Tự điền API: còn thiếu ' + miss.join(', ') + '.')
        + ' Tạm dịch bằng ' + (o.geminiKey ? 'Gemini' : 'Google Dịch') + '.';
    }
  }
  await chrome.storage.local.set(o);
  showSource();
  return [warn, await grantAll(o)].filter(Boolean).join(' ');
}

// Lấy danh sách model của dịch vụ tự điền (GET {địa chỉ}/models) để gợi ý ở ô Model.
$('listModels').onclick = async () => {
  const base = bsubNormApiBase($('customBase').value), key = $('customKey').value.trim();
  if (!base || !key) return note('Điền địa chỉ API (https://…) và key trước.', true);
  const origin = new URL(base).origin + '/*';
  // Xin quyền ngay trong cú bấm (Chrome chỉ hỏi quyền khi người dùng vừa bấm).
  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted) return note('Chưa cấp quyền gọi ' + origin + '.', true);
  note('Đang lấy danh sách model…');
  try {
    const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const ids = (Array.isArray(j) ? j : j.data || j.models || [])
      .map(m => (typeof m === 'string' ? m : m && (m.id || m.name))).filter(Boolean).sort();
    if (!ids.length) throw new Error('không có model nào');
    $('modelList').replaceChildren(...ids.map(id => { const op = document.createElement('option'); op.value = id; return op; }));
    note('Có ' + ids.length + ' model: bấm vào ô Model để chọn.');
  } catch (e) {
    note('Không lấy được danh sách model (' + e.message + '). Gõ tên model theo tài liệu của dịch vụ.', true);
  }
};

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