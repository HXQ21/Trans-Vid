# My Dual Subtitles

Chrome/Edge extension (Manifest V3) lồng tiếng Việt cho video **YouTube, Udemy, Coursera** trên web.

Cách dùng: rê chuột vào video, bấm nút **Lồng tiếng** ở góc phải dưới. Mặc định mọi video đều tắt (không tự dịch); video đã bật được nhớ. Trong Cài đặt có tuỳ chọn "Tự bật cho mọi video".

Cách hoạt động: lấy phụ đề của video → ghép các mảnh phụ đề thành câu trọn vẹn → có phụ đề tiếng Việt do người làm thì đọc thẳng; không thì dịch phụ đề gốc (mọi ngôn ngữ) sang tiếng Việt (Gemini nếu có key, không thì Google Dịch) → đọc bằng giọng nói đúng lúc câu xuất hiện. Đang lồng tiếng thì tiếng gốc của video bị tắt hẳn. Phụ đề tiếng Việt do máy dịch (YouTube "Tự động dịch", Udemy `[Auto]`, Coursera `(auto)`) không dùng.

Không chạy trong app điện thoại; video phải có phụ đề.

## Cài đặt

1. Mở `chrome://extensions`, bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục này.
3. Mở **Cài đặt** của extension, dán key Gemini (tuỳ chọn, lấy ở aistudio.google.com/apikey).
4. Mở video, bấm nút **Lồng tiếng** trên video; bấm icon extension để chỉnh giọng và âm lượng.

## Giọng đọc

- Mặc định: giọng Google.
- Nam Minh / Hoài My (Microsoft): có sẵn khi dùng trình duyệt Edge, hoặc qua key Azure Speech.

## Kiểm tra

```bash
node tools/test_extension.js
```

Gặp lỗi: popup → nút **Chẩn đoán** sao chép nhật ký từng bước.

Ghi chú cho người phát triển (và Claude Code): xem `CLAUDE.md`.

Giao diện popup / Cài đặt dùng [Pico CSS](https://picocss.com) v2.1.1 (MIT), chép sẵn trong `pico.min.css`.
