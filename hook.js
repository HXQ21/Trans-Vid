// Chạy trong trang YouTube (MAIN world): đọc lại phản hồi /api/timedtext mà player tự tải khi bật CC.
(() => {
  if (window.__bsubHook) return;
  window.__bsubHook = true;
  const isTT = u => typeof u === 'string' && u.indexOf('/api/timedtext') !== -1;
  const post = (url, text) => {
    if (text) window.postMessage({ __bsub: 'timedtext', url, text }, location.origin);
  };
  // Chẩn đoán: báo cho content.js biết hook đã chạy và đã bắt được gì.
  const note = msg => window.postMessage({ __bsub: 'hooklog', msg }, location.origin);
  note('hook.js đã chạy (MAIN world)');

  const origFetch = window.fetch;
  window.fetch = function (input) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (isTT(url)) { note('bắt fetch timedtext'); p.then(r => r.clone().text()).then(t => post(url, t)).catch(e => note('fetch đọc lỗi: ' + e)); }
    } catch (e) {}
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      const u = String(url);
      if (isTT(u)) {
        note('bắt xhr timedtext');
        this.addEventListener('load', () => {
          try {
            const rt = this.responseType;
            post(u, rt === '' || rt === 'text' ? this.responseText
              : typeof this.response === 'string' ? this.response : JSON.stringify(this.response));
          } catch (e) { note('xhr đọc lỗi: ' + e); }
        });
      }
    } catch (e) {}
    return origOpen.apply(this, arguments);
  };
})();