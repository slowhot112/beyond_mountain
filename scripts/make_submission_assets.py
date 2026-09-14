from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math

OUT = Path(r"C:\Users\张鸿飞\CodeBuddy\20260819220339\zhihu-alchemy\docs\submission")
OUT.mkdir(parents=True, exist_ok=True)

FONT_REG = r"C:\Windows\Fonts\Noto Sans SC (TrueType).otf"
FONT_BOLD = r"C:\Windows\Fonts\Noto Sans SC Bold (TrueType).otf"

def font(path, size):
    return ImageFont.truetype(path, size)

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def add_noise(img, amount=2):
    # Very subtle paper grain, avoiding the synthetic flat-gradient look.
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            n = ((x * 17 + y * 31) % (amount * 2 + 1)) - amount
            r, g, b = px[x, y][:3]
            px[x, y] = (max(0, min(255, r+n)), max(0, min(255, g+n)), max(0, min(255, b+n)))
    return img

def draw_cover():
    W, H = 1600, 900
    im = Image.new("RGB", (W, H), "#f7f5ef")
    d = ImageDraw.Draw(im)
    # Warm paper-to-sky gradient.
    for y in range(H):
        t = y / H
        c = lerp((249, 248, 243), (231, 239, 245), t)
        d.line((0, y, W, y), fill=c)
    # Quiet sun glow.
    glow = Image.new("RGBA", im.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(360, 30, -12):
        alpha = round(2.3 * (360-r))
        gd.ellipse((1210-r, 170-r, 1210+r, 170+r), fill=(255, 210, 107, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    im = Image.alpha_composite(im.convert("RGBA"), glow)
    d = ImageDraw.Draw(im)
    # Layered distant ridges.
    d.polygon([(0, 650), (170, 530), (310, 600), (490, 420), (670, 570), (850, 455), (1040, 575), (1240, 430), (1450, 555), (1600, 470), (1600, 900), (0, 900)], fill="#d6e2e8")
    d.polygon([(0, 710), (180, 605), (360, 690), (560, 515), (755, 665), (950, 545), (1150, 690), (1370, 540), (1600, 655), (1600, 900), (0, 900)], fill="#b9cbd4")
    d.polygon([(0, 790), (240, 675), (430, 760), (660, 630), (830, 770), (1060, 635), (1250, 755), (1450, 645), (1600, 730), (1600, 900), (0, 900)], fill="#8da5b2")
    # Main blue route, like a hand-drawn mountain path.
    route = [(1080, 900), (1045, 820), (1010, 758), (975, 714), (945, 665), (914, 622), (882, 595), (850, 548), (822, 502), (800, 445), (775, 392)]
    d.line(route, fill="#087fd0", width=10, joint="curve")
    d.line([(x+4, y) for x, y in route], fill="#67b4e9", width=3, joint="curve")
    for i, (x, y) in enumerate(route[::2]):
        r = 9 if i < 4 else 7
        d.ellipse((x-r, y-r, x+r, y+r), fill="#f4c95d", outline="#fff6dc", width=3)
    # Small trail sign.
    d.line((800, 445, 800, 360), fill="#6d7c82", width=8)
    d.rounded_rectangle((780, 315, 940, 372), radius=12, fill="#087fd0")
    d.text((810, 327), "下一步", font=font(FONT_BOLD, 24), fill="white")
    # Text panel with ample negative space.
    d.rounded_rectangle((92, 100, 760, 620), radius=30, fill=(255, 255, 255, 220), outline="#e1e7e9", width=2)
    d.text((150, 155), "山外山", font=font(FONT_BOLD, 76), fill="#172a35")
    d.text((154, 255), "把知乎真实经验，变成\n可以亲自验证的下一步", font=font(FONT_BOLD, 40), fill="#203d4c", spacing=18)
    d.line((154, 400, 610, 400), fill="#b7cbd7", width=3)
    d.text((154, 437), "看见分歧 · 对照处境 · 走一步再判断", font=font(FONT_REG, 25), fill="#4f6873")
    # Tiny product signature, not a competing logo.
    d.ellipse((155, 520, 185, 550), fill="#087fd0")
    d.text((202, 516), "知乎社区 × 现实验证", font=font(FONT_REG, 22), fill="#6b7b82")
    # Fine footer line and label.
    d.text((104, 838), "山外山  /  不替你选路，只把众声摆成你能看清的山势", font=font(FONT_REG, 20), fill="#607983")
    im = add_noise(im.convert("RGB"), 1)
    im.save(OUT / "shanwaishan-cover-16x9.png", format="PNG", optimize=True)

def draw_icon():
    S = 1024
    im = Image.new("RGB", (S, S), "#f7f5ef")
    d = ImageDraw.Draw(im)
    # Soft concentric field to remain legible in a tiny list tile.
    d.ellipse((70, 70, 954, 954), fill="#edf4f7")
    d.ellipse((130, 130, 894, 894), fill="#e2eef3")
    # Two mountain layers.
    d.polygon([(80, 790), (300, 560), (455, 720), (625, 430), (940, 790)], fill="#7b98a6")
    d.polygon([(105, 790), (300, 615), (440, 760), (625, 500), (900, 790)], fill="#496f83")
    # White ridge highlights.
    d.line([(300, 615), (440, 760), (625, 500)], fill="#dce9ee", width=13, joint="curve")
    # Route and endpoint.
    route = [(495, 790), (520, 718), (512, 655), (540, 600), (574, 550), (605, 500), (625, 452)]
    d.line(route, fill="#087fd0", width=24, joint="curve")
    for x, y in route[::2]:
        d.ellipse((x-16, y-16, x+16, y+16), fill="#f2c85b", outline="#fff7db", width=6)
    # Minimal sign mark instead of tiny text.
    d.line((625, 450, 625, 322), fill="#596e78", width=18)
    d.rounded_rectangle((584, 250, 790, 335), radius=20, fill="#087fd0")
    d.polygon([(625, 280), (680, 280), (680, 305), (625, 305)], fill="#ffffff")
    # Circular border.
    d.ellipse((70, 70, 954, 954), outline="#b7cbd5", width=8)
    im = add_noise(im, 1)
    im.save(OUT / "shanwaishan-icon-square.png", format="PNG", optimize=True)

if __name__ == "__main__":
    draw_cover()
    draw_icon()
    for p in sorted(OUT.glob("shanwaishan-*.png")):
        print(p, Image.open(p).size, p.stat().st_size)

