<p align="center">
  <img src="icons/icon128.png" width="96" alt="TransVid">
</p>

<h1 align="center">TransVid</h1>

<p align="center">
  Lồng tiếng Việt cho video <b>YouTube</b>, <b>Udemy</b>, <b>Coursera</b> ngay trên trình duyệt.<br>
  Extension Chrome / Edge (Manifest V3).
</p>

---

## Tính năng

- **Nút "Lồng tiếng" ở góc phải dưới video.** Mặc định mọi video đều tắt; bấm nút mới dịch và đọc. Video đã bật được nhớ.
- **Đọc thẳng phụ đề Việt do người làm.** Phụ đề Việt do máy dịch (YouTube "Tự động dịch", Udemy `[Auto]`, Coursera `(auto)`) bị bỏ qua, AI dịch lại từ phụ đề gốc.
- **Dịch mọi ngôn ngữ sang tiếng Việt**, giữ mạch văn và xưng hô theo ngữ cảnh:
  - Vilao (key thuê, `chib/gemini-3.8-flash`), hoặc
  - Gemini (key miễn phí, tự chuyển model khi hết lượt), hoặc
  - Google Dịch (không cần key, dùng khi không có key hoặc AI lỗi).
- **Ghép câu thông minh**: gộp các dòng phụ đề vụn thành câu trọn vẹn trước khi dịch.
- **Giọng đọc**: Google (mặc định), Microsoft Nam Minh / Hoài My (có sẵn trên Edge, hoặc qua Azure Speech).
- **Tắt hẳn tiếng gốc** khi đang lồng tiếng, bật lại khi tắt lồng tiếng.
- **Bản dịch được lưu lại**: xem lại video không tốn thêm lượt dịch.

## Cài đặt

1. Tải mã về (`Code` → `Download ZIP`, giải nén) hoặc `git clone`.
2. Mở `chrome://extensions` (Edge: `edge://extensions`), bật **Developer mode**.
3. Bấm **Load unpacked**, chọn thư mục vừa tải.
4. Mở **Cài đặt** của TransVid và dán key (tuỳ chọn):
   - **Key Vilao** — dịch bằng Vilao; Chrome sẽ hỏi quyền truy cập `api.vilao.ai`, bấm **Cho phép**.
   - **Gemini API key** — lấy miễn phí ở [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
   - Không có key: dịch bằng Google Dịch.

## Sử dụng

1. Mở một video có phụ đề trên YouTube, Udemy hoặc Coursera.
2. Rê chuột vào video, bấm nút **VI Lồng tiếng** ở góc phải dưới.
3. Bấm icon TransVid trên thanh công cụ để chọn giọng, chỉnh âm lượng, xem tiến độ dịch.

Gặp lỗi: popup → **Chẩn đoán** sao chép nhật ký từng bước (key được che).

## Cấu trúc

```
manifest.json
background.js          service worker: dịch (Vilao / Gemini / Google) và tạo giọng đọc
content/
  hook.js              chặn tệp phụ đề YouTube / Udemy (MAIN world)
  content.js           chọn phụ đề, ghép câu, dịch theo lô, đọc đúng lúc, nút trên video
  content.css          nút "Lồng tiếng" trên video
lib/
  shared.js            cấu hình mặc định, ngôn ngữ, chọn phụ đề, ghép câu, làm sạch văn bản
  voices.js            danh sách giọng, nghe thử
popup/                 cửa sổ khi bấm icon
options/               trang Cài đặt
styles/                Pico CSS + giao diện
icons/                 logo
tests/test_extension.js  bộ test (chạy mã thật trong môi trường giả, không cần Chrome)
tools/sync_ps1.py      đồng bộ script tạo extension (.ps1)
```

## Phát triển

```bash
node tests/test_extension.js
```


## Quyền riêng tư

- Key chỉ lưu trên máy (`chrome.storage.local`) và chỉ gửi tới đúng dịch vụ của nó.
- Phụ đề video được gửi tới dịch vụ dịch đang dùng (Vilao, Google Gemini hoặc Google Dịch) và dịch vụ giọng đọc (Google hoặc Azure).
- Google Dịch và giọng Google dùng địa chỉ không chính thức, Google có thể giới hạn bất cứ lúc nào.

## Ghi công

- Giao diện dùng [Pico CSS](https://picocss.com) v2.1.1 (giấy phép MIT), chép sẵn trong `styles/pico.min.css`.
