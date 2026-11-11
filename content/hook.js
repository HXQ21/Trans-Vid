// Chạy trong trang (MAIN world) YouTube, Udemy, DeepLearning.AI: đọc lại phụ đề mà trình phát tự tải về.
//   YouTube: /api/timedtext (khi bật CC)   ·   Udemy: tệp .vtt trên udemycdn.com
//   DeepLearning.AI: trình phát Vidstack + hls.js tải subtitle/<ngôn ngữ>/….vtt qua XHR (bỏ thumbnails/, chapters/)
(() => {
  if (window.__bsubHook) return;
  window.__bsubHook = true;
  const isTT = u => typeof u === 'string' && u.indexOf('/api/timedtext') !== -1;
  const isVTT = u => typeof u === 'string' && (
    (/udemycdn\.com\/.+\.vtt(\?|$)/.test(u) && !/thumb/.test(u)) ||
    /deeplearning\.ai\/.+\/subtitle\/[^/]+\/[^/?]+\.vtt(\?|$)/.test(u));
  const post = (type, url, text) => {
    if (text) window.postMessage({ __bsub: type, url, text }, location.origin);
  };
  // Chẩn đoán: báo cho content.js biết hook đã chạy và đã bắt được gì.
  const note = msg => window.postMessage({ __bsub: 'hooklog', msg }, location.origin);

  // Chẩn đoán: video bị dừng lúc tab ẩn là do mã của trang (YouTube) gọi pause() hay do trình duyệt.
  // Chỉ ghi nhật ký, không đổi hành vi.
  if (typeof HTMLMediaElement !== 'undefined') {
    const origPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function () {
      if (document.hidden) {
        const where = String(new Error().stack || '').split(/\n/).slice(2, 4).join(' | ').replace(/\s+/g, ' ').slice(0, 160);
        note('trang gọi pause() lúc tab ẩn: ' + where);
      }
      return origPause.apply(this, arguments);
    };
  }
  note('hook.js đã chạy (MAIN world)');

  const origFetch = window.fetch;
  window.fetch = function (input) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const type = isTT(url) ? 'timedtext' : isVTT(url) ? 'vtt' : '';
      if (type) { note('bắt fetch ' + type); p.then(r => r.clone().text()).then(t => post(type, url, t)).catch(e => note('fetch đọc lỗi: ' + e)); }
    } catch (e) {}
    return p;
  };

  // Nội dung XHR ra chữ: hls.js (DeepLearning.AI) tải phụ đề dạng arraybuffer -> giải mã UTF-8, không JSON.stringify (ra "{}").
  const xhrText = x => {
    const rt = x.responseType;
    if (rt === '' || rt === 'text') return x.responseText;
    const r = x.response;
    if (typeof r === 'string') return r;
    if (r && (Object.prototype.toString.call(r) === '[object ArrayBuffer]' || ArrayBuffer.isView(r)) && typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(r);
    return JSON.stringify(r);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      const u = String(url);
      const type = isTT(u) ? 'timedtext' : isVTT(u) ? 'vtt' : '';
      if (type) {
        note('bắt xhr ' + type);
        this.addEventListener('load', () => {
          try { post(type, u, xhrText(this)); } catch (e) { note('xhr đọc lỗi: ' + e); }
        });
      }
    } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  // YouTube: content.js hỏi "có phụ đề Việt do người làm không?" -> có thì chuyển trình phát sang phụ đề đó.
  // (Bản "Tự động dịch" và phụ đề tự động tiếng Việt kind=asr không tính.)
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.__bsub !== 'preferVi') return;
    try {
      const player = document.getElementById('movie_player');
      const resp = player && player.getPlayerResponse ? player.getPlayerResponse() : window.ytInitialPlayerResponse;
      const tracks = (((resp || {}).captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || [];
      const vi = tracks.find(t => /^vi/i.test(t.languageCode || '') && t.kind !== 'asr');
      if (vi && player && player.setOption) {
        player.setOption('captions', 'track', { languageCode: vi.languageCode });
        note('chuyển trình phát sang phụ đề Việt do người làm');
      } else {
        note('video không có phụ đề Việt do người làm');
      }
    } catch (err) { note('chuyển phụ đề Việt lỗi: ' + err); }
  });
})();