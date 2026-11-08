# TransVid (trước đây: My Dual Subtitles)

Chrome/Edge extension (Manifest V3) lồng tiếng Việt cho video **YouTube, Udemy, Coursera** (trên web). Lấy phụ đề của trang; có phụ đề **tiếng Việt do người làm** thì đọc thẳng, không thì dịch phụ đề gốc (mọi ngôn ngữ) sang tiếng Việt rồi đọc bằng giọng nói. Không vẽ phụ đề lên video; phụ đề gốc của YouTube bị ẩn.

## Hành vi chính (quyết định của người dùng)

- **Nút "Lồng tiếng"** ở góc phải dưới video (`updateButton` trong `content/content.js`). Mặc định mọi video tắt: chưa bấm thì không bật CC, không mở menu phụ đề, không tải phụ đề, không dịch. Video đã bấm được nhớ trong `dubVideos` (tối đa 300). Tuỳ chọn `autoDub` = tự bật cho mọi video.
- **Đang lồng tiếng thì tắt hẳn tiếng gốc** (`video.muted`), loa bị bật lại thì tắt lại; tắt lồng tiếng thì bật lại (chỉ khi chính extension đã tắt).
- Tiếng Việt **do người làm**: đọc thẳng (`setCues(..., isVi=true)`), không dịch.
- Tiếng Việt **do máy dịch** (YouTube `tlang`, Udemy `[Auto]`/`[Tự động]`, Coursera `(auto)`): **không dùng**, dịch lại từ phụ đề gốc (`bsubPickCaption`, `bsubIsAutoLabel`).
- YouTube: `lang=vi&kind=asr` = video vốn nói tiếng Việt, không lồng tiếng. Có phụ đề Việt do người làm thì `content/hook.js` chuyển trình phát sang (`preferVi`).
- Udemy: `hook.js` bắt tệp `vtt-cf.udemycdn.com/…vtt`; `content.js` mở menu Captions (chỉ menu có mục "Off"/"Tắt", không nhầm menu tốc độ) để đọc nhãn và chọn bản tốt nhất. Mọi tệp VTT được giữ tới khi đọc xong menu.
- Coursera: đọc thẻ `<track>` của video, tải thẳng VTT.
- **Ghép câu** (`bsubSegmentSentences`): `Intl.Segmenter` tách câu trên chữ nối của cả đoạn, câu ≤ 20s / 300 ký tự (phụ đề tự động ≤ 12s / 220), gộp mảnh < 4 từ.

## Nguồn dịch (`background.js`)

Thứ tự: **key thuê Vilao** (`apiKey`; địa chỉ `https://api.vilao.ai/v1` + model `chib/gemini-3.8-flash` cố định trong `BSUB_DEFAULTS`, không hiện trong Cài đặt) → **Gemini** (`geminiKey`, tự chuyển model flash khi 429/404/503/quá giờ) → **Google Dịch**. Lỗi AI thì dịch tạm bằng Google, tạm ngừng gọi AI (429: 10 phút, 400/401/403: 30 phút), câu Google được AI dịch lại chạy nền. `via: 'gemini'` nghĩa là "dịch bằng AI" (cả Vilao). Key Vilao chỉ do người dùng dán trong Cài đặt — **không bao giờ ghi key vào mã hay file**.

## Cấu trúc

| Đường dẫn | Chạy ở | Việc |
|---|---|---|
| `content/hook.js` | YouTube, Udemy (MAIN world) | Chặn fetch/XHR `/api/timedtext` và `.vtt`, gửi bằng `postMessage`; `preferVi` |
| `content/content.js` | YouTube, Udemy, Coursera | Chọn phụ đề, ghép câu, dịch theo lô, đọc đúng lúc, nút trên video, tắt tiếng gốc, cache |
| `content/content.css` | Trang video | Nút "Lồng tiếng" (chỉ class `bsub-*`, không ảnh hưởng trang) |
| `background.js` | Service worker | Tin nhắn `translate`, `tts`, `test` |
| `lib/shared.js` | Mọi nơi | `BSUB_DEFAULTS`, ngôn ngữ, chọn phụ đề, ghép câu, `bsubCleanSource`/`bsubSpeakable`, nguồn AI |
| `lib/voices.js` | popup + options | Danh sách giọng, nghe thử |
| `popup/`, `options/` | Trang extension | Giao diện (Pico CSS trong `styles/`) |
| `icons/` | — | Logo 16/32/48/128 |

Cấu hình nằm trong `chrome.storage.local`. Khoá cache bản dịch: `'cache:' + hash('v5|' + cueKey + '|vi|' + bsubAiId(cfg))`; đổi cách dịch / ghép câu thì tăng `v5`.

## Quy tắc khi sửa

1. **Hai bước lọc khác nhau** (`lib/shared.js`): `bsubCleanSource` trước khi dịch chỉ bỏ rác phụ đề và **giữ** `$ % &`; `bsubSpeakable` trước khi đọc đổi ký hiệu thành chữ rồi bỏ ký hiệu còn lại.
2. **Sau mỗi lần sửa mã, đồng bộ script tạo extension** (viết lại toàn bộ thân script, gồm cả icon dạng base64):
   ```bash
   python -I tools/sync_ps1.py "D:/AI repo/craf/tao-transvid.ps1.txt" .
   ```
3. **Tăng `version` trong `manifest.json`** khi đổi hành vi (popup báo "tab đang chạy mã cũ" khi lệch).
4. Không giả danh extension/dịch vụ của hãng khác (đã bỏ Edge TTS qua WebSocket vì lý do này).
5. Quyền hẹp: chỉ các trang video và địa chỉ dịch vụ trong `host_permissions`; địa chỉ key thuê xin qua `optional_host_permissions` lúc bấm Lưu.

## Kiểm tra

- **Bộ test chính** (chạy mã thật với DOM / `chrome` giả, không cần Chrome): `node tests/test_extension.js`. Phải đạt hết trước khi báo xong.
- Chẩn đoán trên máy người dùng: popup → **Chẩn đoán** (nhật ký từng bước, key được che).
- Kiểm tra cuối trong Chrome thật: Reload extension tại `chrome://extensions`, **F5 tab video**, bấm nút Lồng tiếng. Tab mở trước khi Reload vẫn chạy mã cũ.
- Google Dịch (`client=gtx`) và giọng Google (`translate_tts`) là địa chỉ không chính thức.

## Quy trình làm việc (superpowers)

- Tính năng mới / đổi hành vi: `superpowers:brainstorming`.
- Lỗi, test hỏng: `superpowers:systematic-debugging` trước khi sửa.
- Viết mã: `superpowers:test-driven-development` (test thất bại trước).
- Trước khi báo xong: `superpowers:verification-before-completion`.
