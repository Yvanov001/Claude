#!/usr/bin/env python3
"""
Genere les icones PWA de l'application "Differentiel".

Charte : papier ivoire (#FAF8F3), encre (#1C1B19), bordeaux clinique (#8B3A3A).
Motif : un delta (triangle, symbole du "differentiel") ivoire sur fond bordeaux,
evoquant a la fois le signe mathematique de variation et une marque clinique sobre.

Rendu en 4x puis reduction (anti-aliasing) pour des bords nets a toutes tailles.
"""
import math
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

BORDEAUX = (139, 58, 58)       # #8B3A3A
BORDEAUX_DARK = (107, 42, 42)  # coin bas pour un leger degrade
IVORY = (250, 248, 243)        # #FAF8F3
KRAFT = (168, 153, 104)        # #A89968 (liseret)

SS = 4  # super-sampling


def rounded_bg(size, radius_ratio=0.22, bleed=False):
    """Fond bordeaux avec coins arrondis (ou plein pour maskable)."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # leger degrade vertical bordeaux -> bordeaux fonce
    grad = Image.new("RGB", (1, s))
    for y in range(s):
        t = y / max(1, s - 1)
        r = int(BORDEAUX[0] + (BORDEAUX_DARK[0] - BORDEAUX[0]) * t)
        g = int(BORDEAUX[1] + (BORDEAUX_DARK[1] - BORDEAUX[1]) * t)
        b = int(BORDEAUX[2] + (BORDEAUX_DARK[2] - BORDEAUX[2]) * t)
        grad.putpixel((0, y), (r, g, b))
    grad = grad.resize((s, s))
    if bleed:
        mask = Image.new("L", (s, s), 255)
    else:
        mask = Image.new("L", (s, s), 0)
        md = ImageDraw.Draw(mask)
        rad = int(s * radius_ratio)
        md.rounded_rectangle([0, 0, s - 1, s - 1], radius=rad, fill=255)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    return img, ImageDraw.Draw(img), s


def _tri_points(cx, cy, R):
    pts = []
    for ang in (-90, 30, 150):  # sommets, pointe en haut
        a = math.radians(ang)
        pts.append((cx + R * math.cos(a), cy + R * math.sin(a)))
    return pts


def draw_delta(img, d, s, safe=0.82):
    """Dessine un triangle (delta) ivoire a contour net, interieur evide.

    Le contour est obtenu par difference de deux triangles pleins : le fond
    (degrade) est restaure a l'interieur, garantissant des coins mites propres.
    """
    cx, cy = s / 2, s / 2
    R = s * 0.31 * (safe / 0.82)
    cy_opt = cy + R * 0.12  # correction optique (barycentre)
    stroke = max(2, s * 0.058)

    bg_copy = img.copy()  # fond degrade a restaurer a l'interieur

    outer = _tri_points(cx, cy_opt, R)
    d.polygon(outer, fill=IVORY)

    inner = _tri_points(cx, cy_opt, R - stroke)
    inner_mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(inner_mask).polygon(inner, fill=255)
    img.paste(bg_copy, (0, 0), inner_mask)

    # point central ivoire (repere clinique)
    dot = s * 0.045
    d2 = ImageDraw.Draw(img)
    d2.ellipse([cx - dot, cy_opt + R * 0.05 - dot,
                cx + dot, cy_opt + R * 0.05 + dot], fill=IVORY)
    return img


def make(size, name, maskable=False, apple=False):
    safe = 0.80 if maskable else 0.90
    img, d, s = rounded_bg(size, bleed=maskable or apple)
    draw_delta(img, d, s, safe=safe)
    out = img.resize((size, size), Image.LANCZOS)
    if apple:  # apple-touch-icon : pas de transparence
        bg = Image.new("RGB", (size, size), BORDEAUX)
        bg.paste(out, (0, 0), out)
        out = bg
    path = os.path.join(OUT, name)
    out.save(path)
    print("wrote", os.path.relpath(path))


make(192, "icon-192.png")
make(512, "icon-512.png")
make(512, "icon-maskable-512.png", maskable=True)
make(192, "icon-maskable-192.png", maskable=True)
make(180, "apple-touch-icon.png", apple=True)
make(32, "favicon-32.png")
make(16, "favicon-16.png")
print("done")
