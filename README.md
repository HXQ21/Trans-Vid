# My Dual Subtitles

Chrome/Edge extension (Manifest V3) lồng tiếng Việt cho video YouTube có phụ đề tiếng Anh, tiếng Trung hoặc tiếng Hindi.

Cách hoạt động: lấy phụ đề của YouTube (tự bật CC) → dịch sang tiếng Việt (Gemini nếu có key, không thì Google Dịch) → đọc bằng giọng nói đúng lúc câu xuất hiện, giảm âm lượng video khi đọc.

## Cài đặt

1. Mở `chrome://extensions`, bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục này.
3. Mở **Cài đặt** của extension, dán key Gemini (tuỳ chọn, lấy ở aistudio.google.com/apikey).
4. Mở video YouTube, bấm icon extension để chỉnh giọng và âm lượng.

## Giọng đọc

- Mặc định: giọng Google.
- Nam Minh / Hoài My (Microsoft): có sẵn khi dùng trình duyệt Edge, hoặc qua key Azure Speech.

## Kiểm tra

```bash
node tools/test_extension.js
```

Gặp lỗi: popup → nút **Chẩn đoán** sao chép nhật ký từng bước.

Ghi chú cho người phát triển (và Claude Code): xem `CLAUDE.md`.
