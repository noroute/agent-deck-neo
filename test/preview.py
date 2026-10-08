# Compose the recorded key images into a Neo-like preview PNG.
import sys, json, io, cairosvg
from PIL import Image, ImageDraw, ImageFont
out, tag, dest = sys.argv[1], sys.argv[2], sys.argv[3]
K, G, P = 144, 22, 40
W = P*2 + K*4 + G*3; H = P*2 + K*2 + G + 30 + 64
im = Image.new("RGB", (W, H), "#E9E6E1"); d = ImageDraw.Draw(im)
d.rounded_rectangle([8, 8, W-9, H-9], 40, fill="#F4F2EE", outline="#D8D4CD", width=2)
for i in range(8):
    svg = open(f"{out}/{tag}-key{i}.svg").read()
    key = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=K, output_height=K))).convert("RGB")
    mask = Image.new("L", (K, K), 0); ImageDraw.Draw(mask).rounded_rectangle([0,0,K-1,K-1], 16, fill=255)
    x = P + (i % 4) * (K + G); y = P + (i // 4) * (K + G)
    d.rounded_rectangle([x-5, y-5, x+K+4, y+K+4], 20, fill="#1B1B1B")
    im.paste(key, (x, y), mask)
fb = json.load(open(f"{out}/{tag}-infobar.json"))
bx0, by0 = W//2 - 232, P + 2*K + G + 30
d.rounded_rectangle([bx0, by0, bx0+464, by0+100], 14, fill="#0A0A0A")
try:
    f1 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
    f2 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
except Exception:
    f1 = f2 = ImageFont.load_default()
d.text((W//2, by0+32), fb.get("headline",""), font=f1, fill="#FFFFFF", anchor="mm")
d.text((W//2, by0+74), fb.get("detail",""), font=f2, fill="#B8C0CC", anchor="mm")
im.save(dest)
