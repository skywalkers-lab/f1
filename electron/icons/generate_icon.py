"""Generate a simple F1 PitWall icon (PNG + ICO).
Run: python generate_icon.py
Optionally uses Pillow for higher quality; falls back to pure-stdlib otherwise.
"""
import struct
import zlib
import os

# ── Pure-stdlib PNG builder ───────────────────────────────────────────────────

def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    c = chunk_type + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)


def create_png(path: str, size: int = 256) -> None:
    """Create a 256x256 RGBA PNG: dark background + red circle + 'PW' letters."""
    width = height = size
    cx, cy = width // 2, height // 2
    r = min(width, height) // 2 - 10

    raw = bytearray()
    for y in range(height):
        raw += b"\x00"  # filter byte: None
        for x in range(width):
            dx, dy = x - cx, y - cy
            if dx * dx + dy * dy < r * r:
                raw += b"\xe1\x06\x00\xff"  # F1 red
            else:
                raw += b"\x0a\x0a\x0f\xff"  # dark bg

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(_png_chunk(b"IHDR", ihdr))
        f.write(_png_chunk(b"IDAT", zlib.compress(bytes(raw))))
        f.write(_png_chunk(b"IEND", b""))


def png_to_ico(png_path: str, ico_path: str) -> None:
    """Wrap a PNG file as a single-image ICO (modern format with embedded PNG)."""
    with open(png_path, "rb") as f:
        png_data = f.read()

    # Read PNG dimensions from IHDR chunk (bytes 16-24)
    w = struct.unpack(">I", png_data[16:20])[0]
    h = struct.unpack(">I", png_data[20:24])[0]
    # ICO uses 0 to mean 256
    icon_w = w if w < 256 else 0
    icon_h = h if h < 256 else 0

    image_offset = 6 + 16  # ICONDIR (6) + one ICONDIRENTRY (16)

    # ICONDIR header
    header = struct.pack("<HHH", 0, 1, 1)  # reserved, type=ICO, count=1

    # ICONDIRENTRY
    entry = struct.pack(
        "<BBBBHHII",
        icon_w, icon_h,  # width, height (0 = 256)
        0,               # color count (0 for 32-bit)
        0,               # reserved
        1,               # planes
        32,              # bit count
        len(png_data),   # size of image data
        image_offset,    # offset to image data
    )

    with open(ico_path, "wb") as f:
        f.write(header)
        f.write(entry)
        f.write(png_data)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    png_path = os.path.join(script_dir, "icon.png")
    ico_path = os.path.join(script_dir, "icon.ico")

    try:
        from PIL import Image, ImageDraw, ImageFont  # type: ignore

        size = 256
        img = Image.new("RGBA", (size, size), (10, 10, 15, 255))
        draw = ImageDraw.Draw(img)
        margin = 20
        draw.ellipse([margin, margin, size - margin, size - margin], fill=(225, 6, 0, 255))
        try:
            font = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 80
            )
        except OSError:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), "PW", font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(((size - tw) / 2, (size - th) / 2 - 10), "PW", fill=(255, 255, 255, 255), font=font)
        img.save(png_path)

        # Also save multi-size ICO directly via Pillow
        sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
        img.save(ico_path, format="ICO", sizes=sizes)
        print(f"Created {png_path} and {ico_path} (Pillow)")

    except ImportError:
        # Fallback: pure stdlib
        create_png(png_path)
        png_to_ico(png_path, ico_path)
        print(f"Created {png_path} and {ico_path} (stdlib fallback)")


if __name__ == "__main__":
    main()

    exit(0)

def main():
    size = 256
    img = Image.new('RGBA', (size, size), (10, 10, 15, 255))
    draw = ImageDraw.Draw(img)
    
    # Red circle background
    margin = 20
    draw.ellipse([margin, margin, size-margin, size-margin], fill=(225, 6, 0, 255))
    
    # White "PW" text
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 80)
    except OSError:
        font = ImageFont.load_default()
    
    bbox = draw.textbbox((0, 0), "PW", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2 - 10), "PW", fill=(255, 255, 255, 255), font=font)
    
    img.save('icon.png')
    print(f'Created icon.png ({size}x{size})')

if __name__ == '__main__':
    main()
