// Chạy trong trang (MAIN world) YouTube và Udemy: đọc lại phụ đề mà trình phát tự tải về.
//   YouTube: /api/timedtext (khi bật CC)   ·   Udemy: tệp .vtt trên udemycdn.com
(() => {
  if (window.__bsubHook) return;
  window.__bsubHook = true;
  const isTT = u => typeof u === 'string' && u.indexOf('/api/timedtext') !== -1;
  const isVTT = u => typeof u === 'string' && /udemycdn\.com\/.+\.vtt(\?|$)/.test(u) && !/thumb/.test(u);
  const post = (type, url, text) => {
    if (text) window.postMessage({ __bsub: type, url, text }, location.origin);
  };
  // Chẩn đoán: báo cho content.js biết hook đã chạy và đã bắt được gì.
  const note = msg => window.postMessage({ __bsub: 'hooklog', msg }, location.origin);
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

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      const u = String(url);
      const type = isTT(u) ? 'timedtext' : isVTT(u) ? 'vtt' : '';
      if (type) {
        note('bắt xhr ' + type);
        this.addEventListener('load', () => {
          try {
            const rt = this.responseType;
            post(type, u, rt === '' || rt === 'text' ? this.responseText
              : typeof this.response === 'string' ? this.response : JSON.stringify(this.response));
          } catch (e) { note('xhr đọc lỗi: ' + e); }
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