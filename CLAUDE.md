# My Dual Subtitles

Chrome/Edge extension (Manifest V3) lồng tiếng Việt cho video YouTube có phụ đề tiếng Anh, tiếng Trung hoặc tiếng Hindi. Lấy phụ đề của YouTube, dịch sang tiếng Việt, rồi đọc bằng giọng nói. Không vẽ phụ đề lên video; phụ đề gốc của YouTube bị ẩn.

## Cấu trúc

| File | Chạy ở | Việc |
|---|---|---|
| `hook.js` | Trang YouTube (MAIN world) | Chặn fetch/XHR `/api/timedtext`, gửi phụ đề bằng `postMessage` |
| `content.js` | Trang YouTube | Gộp câu, gọi dịch theo lô, đọc đúng lúc, giảm âm lượng video, cache bản dịch |
| `background.js` | Service worker | Tin nhắn `translate`, `tts`, `test`. Dịch bằng Gemini, lỗi thì dùng Google Dịch. Tạo giọng bằng Google hoặc Azure |
| `shared.js` | Cả 3 nơi | Cấu hình mặc định, ngôn ngữ nguồn, giọng Microsoft, `bsubStripSymbols` |
| `voices.js` | popup + options | Danh sách giọng, nút nghe thử |
| `popup.*`, `options.*` | Trang extension | Giao diện cài đặt |

Cấu hình nằm trong `chrome.storage.local`. Khoá cache bản dịch có tiền tố phiên bản (`v3|`): đổi cách dịch thì tăng số này để bỏ cache cũ.

## Quy tắc khi sửa

1. **Hai bước lọc khác nhau** (`shared.js`): `bsubCleanSource` trước khi dịch chỉ bỏ rác phụ đề (`>>`, `[Music]`, `♪`) và **giữ** `$ % &` vì chúng mang nghĩa; `bsubSpeakable` trước khi đọc đổi ký hiệu thành chữ (`$5` → "5 đô la", `&` → "và") rồi bỏ mọi ký hiệu còn lại. Đừng lọc mạnh trước khi dịch (từng làm "$0" thành "0").
2. **Sau mỗi lần sửa mã, đồng bộ script tạo extension**:
   ```bash
   python -I tools/sync_ps1.py "D:/AI repo/craf/tao-my-dual-subtitles.ps1.txt" .
   ```
   Script `tao-my-dual-subtitles.ps1.txt` ghi đè 13 file khi chạy lại. Sửa tay trong thư mục mà không đồng bộ thì lần chạy sau sẽ mất chỗ sửa. File mới phải được thêm vào script (công cụ trên tự thêm khối mới). `CLAUDE.md` này cũng nằm trong script, nên sửa xong cũng phải đồng bộ.
3. **Tăng `version` trong `manifest.json`** khi đổi hành vi. Popup so version của mã trong tab với version extension để báo "tab đang chạy mã cũ".
4. Không dùng địa chỉ không chính thức giả danh extension của hãng khác (đã bỏ qua Edge TTS qua WebSocket vì lý do này). Giọng Microsoft chỉ lấy từ giọng có sẵn trên Edge hoặc Azure Speech chính thức.
5. Quyền truy cập giữ hẹp: chỉ YouTube và các địa chỉ dịch vụ trong `host_permissions`. Thêm dịch vụ mới thì thêm đúng địa chỉ đó, không dùng `<all_urls>`.

## Kiểm tra

- Cú pháp: `node --check <file>.js` cho từng file JS.
- **Bộ test chính** (chạy mã thật trong môi trường giả, không cần Chrome): `node tools/test_extension.js`. Phải đạt hết trước khi báo xong.
- Chẩn đoán trên máy người dùng: popup → nút **Chẩn đoán** (nhật ký từng bước: hook, phụ đề, dịch, tạo giọng, phát).
- `background.js` chạy được trong Node bằng `vm` với `chrome` giả để test dịch và giọng đọc.
- Google Dịch và giọng Google gọi được thật từ Node. Từ trang web thì bị CORS, nên chỉ extension thật (service worker) mới gọi được.
- Test cuối cùng phải làm trong Chrome thật: Reload extension tại `chrome://extensions`, **F5 tab YouTube**, bấm CC. Tab mở trước khi Reload vẫn chạy mã cũ.

## Đã kiểm chứng trong Chrome thật (v2.5.1)

Tự bật CC, bắt phụ đề, dịch bằng Google Dịch, đọc bằng giọng Google liên tục từ câu đầu; không còn ký hiệu hay thẻ <i> trong câu đọc.

## Điều chưa kiểm chứng với dịch vụ thật

- Gemini (dịch theo ngữ cảnh) và Azure Speech (Nam Minh / Hoài My) mới test bằng API giả lập, chưa thử với key thật.
- Google Dịch (`translate.googleapis.com`, `client=gtx`) và giọng Google (`translate_tts`) là địa chỉ không chính thức, Google có thể giới hạn hoặc đổi bất cứ lúc nào.

## Quy trình làm việc (superpowers)

Dự án dùng plugin superpowers. Kỹ năng không tự chạy, nên phải gọi chủ động:

- Trước khi thêm tính năng mới hoặc đổi hành vi: dùng `superpowers:brainstorming`.
- Gặp lỗi, test hỏng, hành vi lạ: dùng `superpowers:systematic-debugging` trước khi sửa.
- Trước khi báo "xong": dùng `superpowers:verification-before-completion` và chạy kiểm tra ở mục trên.