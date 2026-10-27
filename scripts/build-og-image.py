"""
Build `public/og.png` — the 1200×630 card WhatsApp, X and LinkedIn render when a
Pryva link is shared.

Brand asset, not a photo: cream paper, the violet mark, the promise, and the
four entry prices straight from the catalogue. Re-run after a pricing change:

    /tmp/imgvenv/bin/python scripts/build-og-image.py

(Needs Pillow; only the DejaVu fonts that ship with Linux are required.)
"""

import json
import re

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
CREAM = (250, 247, 241)
INK = (28, 24, 38)
INK_2 = (86, 80, 100)
LAV = (124, 92, 214)
LAV_SOFT = (233, 224, 250)
PEACH = (255, 226, 205)
WHITE = (255, 255, 255)

# Prices come from the generated table, never typed: run `npm run pricing:build`
# first and this card follows the catalogue.
def entry_prices():
    sheet = json.load(open("data/supplier-costs.json", encoding="utf-8"))["catalog"]
    generated = open("src/lib/prices.generated.ts", encoding="utf-8").read()
    prices = {
        slug: int(price)
        for slug, price in re.findall(r'"([a-z0-9-]+)":\s*{\s*\n\s*"price":\s*(\d+)', generated)
    }
    wanted = {
        "numbers": "Virtual number",
        "esim": "eSIM data",
        "proxies": "Residential proxy",
        "email-otp": "Email inbox",
    }
    rows = []
    for service, label in wanted.items():
        candidates = [
            prices[slug]
            for slug, row in sheet.items()
            if row["service"] == service and slug in prices
        ]
        if candidates:
            rows.append((label, min(candidates)))
    return rows


def naira(value):
    return "\u20a6" + f"{value:,}"


BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"

def font(path, size):
    return ImageFont.truetype(path, size)


def fit(path, size, max_width, draw, text):
    """Shrink a font until the string fits max_width."""
    while size > 12:
        f = font(path, size)
        if draw.textlength(text, font=f) <= max_width:
            return f
        size -= 1
    return font(path, size)

canvas = Image.new("RGB", (W, H), CREAM)

# --- soft glows -----------------------------------------------------------
glow = Image.new("RGB", (W, H), CREAM)
g = ImageDraw.Draw(glow)
g.ellipse((-220, -260, 520, 380), fill=LAV_SOFT)
g.ellipse((760, 300, 1360, 820), fill=PEACH)
g.ellipse((820, -220, 1320, 220), fill=(240, 232, 255))
glow = glow.filter(ImageFilter.GaussianBlur(120))
canvas = Image.blend(canvas, glow, 0.85)

draw = ImageDraw.Draw(canvas)

# --- brand mark ------------------------------------------------------------
mark = Image.open("public/images/brand/pryva-mark-512.png").convert("RGBA")
mark_size = 112
mark = mark.resize((mark_size, mark_size), Image.LANCZOS)
canvas.paste(mark, (72, 62), mark)

draw.text((72 + mark_size + 22, 84), "Pryva", font=font(BOLD, 46), fill=INK)
draw.text(
    (72 + mark_size + 24, 138),
    "Nigerian digital services",
    font=font(REG, 22),
    fill=INK_2,
)

# --- headline --------------------------------------------------------------
LEFT_X = 72
TEXT_RIGHT = 700          # the price card starts at 748; keep the copy clear of it
TEXT_W = TEXT_RIGHT - LEFT_X

head1 = "Numbers, eSIMs and proxies"
head2 = "without the friction."
f1 = fit(BOLD, 50, TEXT_W, draw, head1)
f2 = fit(SERIF, 50, TEXT_W, draw, head2)
draw.text((LEFT_X, 232), head1, font=f1, fill=INK)
draw.text((LEFT_X, 232 + f1.size + 14), head2, font=f2, fill=LAV)

body1 = "Real numbers, eSIM data, proxies, inboxes and accounts."
body2 = "Pay in Naira. Refunded automatically if no code lands."
f3 = fit(REG, 24, TEXT_W, draw, body1)
f4 = fit(REG, 24, TEXT_W, draw, body2)
draw.text((LEFT_X, 366), body1, font=f3, fill=INK_2)
draw.text((LEFT_X, 366 + f3.size + 10), body2, font=f4, fill=INK_2)

# --- price card ------------------------------------------------------------
card = (748, 196, 1128, 462)
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle(
    (card[0] + 6, card[1] + 14, card[2] + 6, card[3] + 14), radius=34, fill=(60, 40, 110, 45)
)
shadow = shadow.filter(ImageFilter.GaussianBlur(22))
canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow).convert("RGB")
draw = ImageDraw.Draw(canvas)

draw.rounded_rectangle(card, radius=34, fill=WHITE, outline=(232, 226, 240), width=2)
draw.text((card[0] + 30, card[1] + 26), "FROM", font=font(BOLD, 18), fill=(150, 142, 165))

rows = [(label, naira(price)) for label, price in entry_prices()]
y = card[1] + 62
for label, price in rows:
    draw.text((card[0] + 30, y), label, font=font(REG, 23), fill=INK_2)
    tw = draw.textlength(price, font=font(BOLD, 24))
    draw.text((card[2] - 30 - tw, y - 1), price, font=font(BOLD, 24), fill=INK)
    y += 52
    if label != rows[-1][0]:
        draw.line((card[0] + 30, y - 16, card[2] - 30, y - 16), fill=(240, 236, 246), width=1)

# --- bottom chips ----------------------------------------------------------
chips = ["Instant delivery", "Auto-refund if no code", "Naira only"]
x = 72
for chip in chips:
    f = font(BOLD, 18)
    tw = draw.textlength(chip, font=f)
    draw.rounded_rectangle((x, 512, x + tw + 38, 556), radius=22, fill=WHITE, outline=(228, 220, 240), width=2)
    draw.text((x + 19, 523), chip, font=f, fill=LAV)
    x += tw + 50

draw.text((72, 588), "pryva.ng", font=font(REG, 20), fill=(160, 152, 175))

canvas.save("public/og.png", optimize=True)
print("public/og.png", canvas.size)
