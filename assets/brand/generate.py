"""Generate Yosegi brand SVGs (symbol + outlined wordmark)."""
import math
import os

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
# The wordmark is outlined from Zen Kaku Gothic New 700 (SIL OFL 1.1). The font is not
# committed; see README.md for the one-line curl that fetches it next to this script.
FONT = os.environ.get("YOSEGI_FONT", os.path.join(HERE, "zkgn700.ttf"))
OUT = os.environ.get("YOSEGI_OUT", HERE)

INK = "#14110F"
LIGHT = "#F0E7D6"

UPEM = 1000
CAP = 700
TRACKING = -10          # -0.01em
TEXT = "Yosegı"         # dotless i; the tittle is the yosegi piece

# tittle, in font units. Dot of 'i' measured from the font: x 61..203, y 560..702
TIT_W = 195             # width of the wide (top) edge
TIT_RATIO_H = 0.605     # height / top width, taken from the symbol piece (121/200)
TIT_RATIO_B = 0.30      # bottom width / top width, taken from the piece (60/200)
TIT_CY = 620            # optical centre matched to the dot it replaces
TIT_CX_IN_GLYPH = 132   # horizontal centre of the dot inside the 'i' glyph

SYMBOL_H = 210.0        # reference height of the symbol artwork in lockups
CAP_RATIO = 0.62        # wordmark cap height / symbol height
GAP_H_RATIO = float(os.environ.get("YOSEGI_GAP_H", 0.16))   # horizontal lockup: gap / symbol height
GAP_V_RATIO = float(os.environ.get("YOSEGI_GAP_V", 0.05))   # vertical lockup: gap / symbol height
CAP_RATIO_V = 0.36      # vertical lockup: wordmark cap height / symbol height


def symbol_polygons():
    """The six trapezoids, baked into absolute coordinates (512 grid, y down)."""
    base = [(256, 196), (256, 56), (429, 156), (308, 226)]
    cx, cy, s = 312, 159, 0.85
    shrunk = [(cx + s * (x - cx), cy + s * (y - cy)) for x, y in base]
    out = []
    for k in range(6):
        a = math.radians(60 * k)
        ca, sa = math.cos(a), math.sin(a)
        pts = []
        for x, y in shrunk:
            dx, dy = x - 256, y - 256
            pts.append((256 + dx * ca - dy * sa, 256 + dx * sa + dy * ca))
        out.append(pts)
    return out


def polygons_bbox(polys):
    xs = [p[0] for poly in polys for p in poly]
    ys = [p[1] for poly in polys for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def shape_word():
    """Return [(glyph_name, x_offset_in_font_units)], plus the total advance."""
    with open(FONT, "rb") as fh:
        data = fh.read()
    face = hb.Face(data)
    font = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(TEXT)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    tt = TTFont(FONT)
    order = tt.getGlyphOrder()
    pen_glyphs = []
    x = 0.0
    for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        pen_glyphs.append((order[info.codepoint], x + pos.x_offset))
        x += pos.x_advance + TRACKING
    return pen_glyphs, x


def word_paths(scale, origin_x, baseline_y):
    """Outlined wordmark paths plus the tittle polygon, in output coordinates."""
    tt = TTFont(FONT)
    gs = tt.getGlyphSet()
    glyphs, advance = shape_word()
    paths = []
    for name, gx in glyphs:
        t = Transform(scale, 0, 0, -scale, origin_x + gx * scale, baseline_y)
        spen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}")
        gs[name].draw(TransformPen(spen, t))
        d = spen.getCommands()
        if d:
            paths.append(d)
    # tittle: the dotless i is the last glyph
    ix = glyphs[-1][1]
    h = TIT_W * TIT_RATIO_H
    b = TIT_W * TIT_RATIO_B
    cx = ix + TIT_CX_IN_GLYPH
    top, bot = TIT_CY + h / 2, TIT_CY - h / 2
    tit = [(cx - TIT_W / 2, top), (cx + TIT_W / 2, top), (cx + b / 2, bot), (cx - b / 2, bot)]
    tit_out = [(origin_x + x * scale, baseline_y - y * scale) for x, y in tit]
    return paths, tit_out, advance


def fmt_pts(pts):
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)


def svg(w, h, body, vb=None):
    vb = vb or f"0 0 {w:.2f} {h:.2f}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" '
        f'width="{w:.0f}" height="{h:.0f}" role="img" aria-label="Yosegi">'
        f"{body}</svg>\n"
    )


def write(name, text):
    with open(os.path.join(OUT, name), "w") as fh:
        fh.write(text)
    print(name, len(text), "bytes")


def build():
    polys = symbol_polygons()
    x0, y0, x1, y1 = polygons_bbox(polys)
    sw, sh = x1 - x0, y1 - y0
    print(f"symbol bbox {sw:.1f} x {sh:.1f}")

    # --- symbol only, tight bbox
    for suffix, color in (("", INK), ("-light", LIGHT)):
        body = "".join(
            f'<polygon points="{fmt_pts([(x - x0, y - y0) for x, y in p])}"/>' for p in polys
        )
        write(f"yosegi-symbol{suffix}.svg", svg(sw, sh, f'<g fill="{color}">{body}</g>'))

    # --- lockups
    k = SYMBOL_H / sh                      # scale the symbol grid to SYMBOL_H
    sym_w = sw * k
    cap = SYMBOL_H * CAP_RATIO
    scale = cap / CAP                      # font units -> output units

    def sym_body(dx, dy, color):
        pts = [[( (x - x0) * k + dx, (y - y0) * k + dy) for x, y in p] for p in polys]
        return f'<g fill="{color}">' + "".join(
            f'<polygon points="{fmt_pts(p)}"/>' for p in pts
        ) + "</g>"

    # horizontal: cap centre of the word on the symbol centre
    gap = SYMBOL_H * GAP_H_RATIO
    baseline = SYMBOL_H / 2 + cap / 2
    paths, tit, adv = word_paths(scale, sym_w + gap, baseline)
    word_w = adv * scale
    total_w = sym_w + gap + word_w
    desc = 199 * scale                     # 'g' descender
    top = 0.0
    bottom = max(SYMBOL_H, baseline + desc)
    for suffix, color in (("", INK), ("-light", LIGHT)):
        body = sym_body(0, 0, color) + f'<g fill="{color}">' + "".join(
            f'<path d="{d}"/>' for d in paths
        ) + f'<polygon points="{fmt_pts(tit)}"/></g>'
        write(
            f"yosegi-lockup-horizontal{suffix}.svg",
            svg(total_w, bottom - top, body, vb=f"0 {top:.2f} {total_w:.2f} {bottom - top:.2f}"),
        )

    # vertical: symbol centred over the word
    capv = SYMBOL_H * CAP_RATIO_V
    scalev = capv / CAP
    gapv = SYMBOL_H * GAP_V_RATIO
    baseline_v = SYMBOL_H + gapv + capv
    paths_v, tit_v, adv_v = word_paths(scalev, 0, baseline_v)
    word_w_v = adv_v * scalev
    total_w_v = max(sym_w, word_w_v)
    sym_dx = (total_w_v - sym_w) / 2
    word_dx = (total_w_v - word_w_v) / 2
    paths_v, tit_v, _ = word_paths(scalev, word_dx, baseline_v)
    height_v = baseline_v + 199 * scalev
    for suffix, color in (("", INK), ("-light", LIGHT)):
        body = sym_body(sym_dx, 0, color) + f'<g fill="{color}">' + "".join(
            f'<path d="{d}"/>' for d in paths_v
        ) + f'<polygon points="{fmt_pts(tit_v)}"/></g>'
        write(f"yosegi-lockup-vertical{suffix}.svg", svg(total_w_v, height_v, body))

    # --- favicon: symbol with 1/8 padding on a square
    pad = sh * 0.125
    side = sh + pad * 2
    dx = (side - sw) / 2
    body = f'<g fill="{INK}">' + "".join(
        f'<polygon points="{fmt_pts([(x - x0 + dx, y - y0 + pad) for x, y in p])}"/>'
        for p in polys
    ) + "</g>"
    write("favicon.svg", svg(side, side, body))


if __name__ == "__main__":
    if not os.path.exists(FONT):
        raise SystemExit(f"font not found: {FONT}\nSee README.md for how to fetch it.")
    os.makedirs(OUT, exist_ok=True)
    build()
