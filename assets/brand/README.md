# Brand assets

The Yosegi symbol, wordmark and lockups, plus the script that generates them.

## Files

| File | Use |
| --- | --- |
| `yosegi-symbol.svg` | Symbol alone, ink on light backgrounds |
| `yosegi-symbol-light.svg` | Symbol alone, on dark backgrounds |
| `yosegi-lockup-horizontal.svg` | Symbol + wordmark, the default form |
| `yosegi-lockup-horizontal-light.svg` | Same, on dark backgrounds |
| `yosegi-lockup-vertical.svg` | Stacked form, for avatars and square frames |
| `yosegi-lockup-vertical-light.svg` | Same, on dark backgrounds |
| `favicon.svg` | Symbol on a square with 1/8 padding |
| `yosegi-clearspace.png` | Reference sheet: clear space and minimum size |
| `yosegi-palette.png` | Reference sheet: the palette |
| `generate.py` | Regenerates every SVG above |

The SVGs are cropped to the artwork, with no built-in padding, so the clear space below is
applied by whatever places them. Text in the lockups is outlined; no font is needed to render
them.

The logo ships as SVG only. The two PNGs are reference sheets that have no SVG counterpart;
everything else would be a second copy of the mark that can drift from the SVG it was traced
from. Rasterise from these SVGs when a PNG is needed.

## Construction

Symbol. A hexagon divided into six trapezoids, one shape rotated by 60° six times. Each piece is
scaled to 0.85 about its own centre, which is what opens the seams, and its inner tip is cut at
30% of the radius, which is what opens the hexagonal void at the centre. The seams are real gaps
rather than white strokes, so the mark holds its form as a single flat colour, as a transparent
PNG, and in foil or embroidery.

Wordmark. Zen Kaku Gothic New 700, tracking -0.01em. The tittle of the `i` is replaced by one
piece of the symbol: the same trapezoid, same 60° edges, same 200:60:121 proportions, sized and
placed to the mass and optical centre of the dot it replaces.

Lockups. Cap height is 62% of the symbol height in the horizontal form and 36% in the vertical
one — the wordmark is four times wider than it is tall, so a single ratio cannot balance both.
The gap is 16% of the symbol height horizontally and 5% vertically, measured from the bounding
box. Both are tighter than a gap would normally be set, because the symbol meets its box at a
single vertex on every side: the space a hexagon gives back is counted twice otherwise, once in
the measurement and once in the eye. Horizontally the cap centre of the wordmark sits on the
centre of the symbol.

## Colour

| Name | Hex | Use |
| --- | --- | --- |
| Sumi | `#14110F` | Primary. The logo, on light backgrounds |
| Mizuki | `#F0E7D6` | Secondary. The logo, on dark backgrounds |
| Walnut | `#5B3B27` | Extended |
| Keyaki | `#B98A52` | Extended |
| Jindai | `#7A7268` | Extended |

Two colours carry the brand; the extended three are for patterns and diagrams, never for the logo
itself. Every colour is taken from a wood used in yosegi marquetry, which dyes nothing and builds
its patterns out of the timber's own colour.

## Clear space and minimum size

Clear space is 1/4 of the symbol height on all sides. The unit comes from the mark itself, so it
scales with it. Minimum size is 16px on screen and 8mm in print.

## Regenerating

Requires Python with `fonttools` and `uharfbuzz`, plus the font next to the script:

```sh
pip install fonttools uharfbuzz
curl -sL -H "User-Agent: Mozilla/4.0" "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@700" \
  | grep -o 'https://[^)]*\.ttf' \
  | xargs curl -sL -o zkgn700.ttf
python3 generate.py
```

`YOSEGI_FONT` overrides the font path. The font file is not committed; it is Zen Kaku Gothic New,
licensed under the SIL Open Font License 1.1, which permits the outlines embedded in these logo
files.
