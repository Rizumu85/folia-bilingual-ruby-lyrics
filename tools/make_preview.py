"""Draw the mod's 1280x720 preview image: one sung line with ruby over the kanji, its
translation, and the next line dimmed — the layout the mod renders. The sentence is made up
for this image, not taken from any song.

    python tools/make_preview.py            (needs Pillow and the Yu Gothic fonts shipped with Windows)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / 'bilingual-ruby-lyrics' / 'preview.png'
FONTS = Path('C:/Windows/Fonts')
bold = lambda size: ImageFont.truetype(str(FONTS / 'YuGothB.ttc'), size)
regular = lambda size: ImageFont.truetype(str(FONTS / 'YuGothR.ttc'), size)

W, H = 1280, 720
PRIMARY, SECONDARY, ACCENT, DIM = (242, 240, 232), (150, 154, 170), (166, 205, 232), (92, 96, 108)
image = Image.new('RGB', (W, H), (17, 19, 24))
draw = ImageDraw.Draw(image)

# (text, reading, colour): sung so far, being sung now, not yet sung
line = [('窓', 'まど', PRIMARY), ('の', '', PRIMARY), ('外', 'そと', PRIMARY), ('で', '', PRIMARY), ('雨', 'あめ', PRIMARY), ('が', '', PRIMARY),
        ('歌', 'うた', ACCENT), ('って', '', SECONDARY), ('いる', '', SECONDARY)]
main, small = bold(64), regular(25)
width = sum(draw.textlength(text, font=main) for text, _, _ in line)
x, y = (W - width) / 2, 286
for text, reading, colour in line:
    advance = draw.textlength(text, font=main)
    draw.text((x, y), text, font=main, fill=colour)
    if reading:
        draw.text((x + (advance - draw.textlength(reading, font=small)) / 2, y - 36), reading, font=small, fill=colour)
    x += advance

def centred(text, font, top, colour):
    draw.text(((W - draw.textlength(text, font=font)) / 2, top), text, font=font, fill=colour)

centred('窗外，雨正在歌唱', regular(34), 392, SECONDARY)
centred('明日の朝まで', regular(30), 500, DIM)
image.save(OUT, optimize=True)
print(OUT, image.size, OUT.stat().st_size // 1024, 'KB')
