"""Generate F1 PitWall icon (PNG only). electron-builder converts to ICO internally."""
import struct, zlib, os

def _chunk(t, d):
    c = t+d
    return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xFFFFFFFF)

def create_png(path, size=256):
    cx=cy=size//2; r=size//2-10
    raw=bytearray()
    for y in range(size):
        raw+=b'\x00'
        for x in range(size):
            dx,dy=x-cx,y-cy
            raw+=(b'\xe1\x06\x00\xff' if dx*dx+dy*dy<r*r else b'\x0a\x0a\x0f\xff')
    ihdr=struct.pack('>IIBBBBB',size,size,8,6,0,0,0)
    with open(path,'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(_chunk(b'IHDR',ihdr))
        f.write(_chunk(b'IDAT',zlib.compress(bytes(raw))))
        f.write(_chunk(b'IEND',b''))

def main():
    p=os.path.join(os.path.dirname(os.path.abspath(__file__)),'icon.png')
    try:
        from PIL import Image,ImageDraw,ImageFont
        img=Image.new('RGBA',(256,256),(10,10,15,255))
        d=ImageDraw.Draw(img)
        d.ellipse([20,20,236,236],fill=(225,6,0,255))
        try: f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',80)
        except: f=ImageFont.load_default()
        b=d.textbbox((0,0),'PW',font=f)
        d.text(((256-b[2]+b[0])/2,(256-b[3]+b[1])/2-10),'PW',fill=(255,255,255,255),font=f)
        img.save(p)
        print('Created',p,'(Pillow)')
    except ImportError:
        create_png(p)
        print('Created',p,'(stdlib fallback)')

if __name__=='__main__': main()
