"""Generate a simple F1 PitWall icon (256x256 PNG).
Run: python generate_icon.py
Requires: pip install Pillow
"""
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    # Fallback: create a minimal 1x1 PNG as placeholder
    import struct, zlib
    def create_minimal_png(path, size=256):
        # Create a solid red square PNG
        width = height = size
        raw = b''
        for y in range(height):
            raw += b'\x00'  # filter byte
            for x in range(width):
                # Red circle on dark bg
                cx, cy = width // 2, height // 2
                r = min(width, height) // 2 - 10
                dx, dy = x - cx, y - cy
                if dx*dx + dy*dy < r*r:
                    raw += b'\xe1\x06\x00\xff'  # F1 red
                else:
                    raw += b'\x0a\x0a\x0f\xff'  # dark bg
        def chunk(ty, data):
            c = ty + data
            return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
        with open(path, 'wb') as f:
            f.write(b'\x89PNG\r\n\x1a\n')
            f.write(chunk(b'IHDR', ihdr))
            f.write(chunk(b'IDAT', zlib.compress(raw)))
            f.write(chunk(b'IEND', b''))
    create_minimal_png('icon.png', 256)
    print('Created icon.png (minimal fallback)')
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
