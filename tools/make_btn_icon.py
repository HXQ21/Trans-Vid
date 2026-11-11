"""Tạo icons/btn.png (logo cho nút trên video) từ ảnh logo gốc nền trắng.

Cắt đúng ô vuông bo góc của logo, làm nền ngoài trong suốt (thụt vào vài px để không còn
viền trắng lẫn ở mép), thu nhỏ bằng Lanczos rồi làm nét nhẹ.

Chạy: python -I tools/make_btn_icon.py <ảnh-gốc> [thư-mục-extension]
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

SIZE = 96          # hiển thị 24–28px, đủ nét trên màn hình độ phân giải cao
INSET = 5          # px (ảnh gốc) thụt vào để bỏ mép bị trộn với nền trắng
SS = 4             # siêu lấy mẫu cho mép bo góc mượt


def logo_box(im):
    """Khung ô vuông logo: vùng không phải nền trắng theo hàng/cột giữa."""
    px, (w, h) = im.load(), im.size
    dark = lambda c: sum(c[:3]) < 600
    xs = [x for x in range(w) if dark(px[x, h // 2])]
    ys = [y for y in range(h) if dark(px[w // 2, y])]
    return xs[0], ys[0], xs[-1] + 1, ys[-1] + 1


def corner_radius(im, box):
    """Bán kính bo góc: đo độ thụt của mép trên ở độ sâu d, giải r từ hình tròn."""
    px = im.load()
    x0, y0, x1, _ = box
    best = None
    for r in range(40, (x1 - x0) // 2):
        err = 0
        for d in (10, 30, 60, 100):
            y = y0 + d
            xs = [x for x in range(x0, x1) if sum(px[x, y][:3]) < 600]
            inset = xs[0] - x0 if xs else 0
            if d < r:
                expect = r - (r * r - (r - d) ** 2) ** 0.5
                err += (expect - inset) ** 2
        if best is None or err < best[0]:
            best = (err, r)
    return best[1]


def main():
    src = Path(sys.argv[1])
    ext = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent
    im = Image.open(src).convert('RGB')
    box = logo_box(im)
    r = corner_radius(im, box)
    x0, y0, x1, y1 = box
    crop = im.crop((x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET))
    side = max(crop.size)
    crop = crop.resize((side, side), Image.LANCZOS)
    mask = Image.new('L', (side * SS, side * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, side * SS - 1, side * SS - 1), radius=(r - INSET) * SS, fill=255)
    mask = mask.resize((side, side), Image.LANCZOS)
    crop.putalpha(mask)
    out = crop.resize((SIZE, SIZE), Image.LANCZOS)
    rgb = out.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=2))
    rgb.putalpha(out.getchannel('A'))
    dst = ext / 'icons' / 'btn.png'
    rgb.save(dst, optimize=True)
    print('khung', box, 'bán kính', r, '->', dst, rgb.size)


if __name__ == '__main__':
    main()
