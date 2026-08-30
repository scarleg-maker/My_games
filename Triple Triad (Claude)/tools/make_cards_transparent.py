#!/usr/bin/env python3
"""
Rend transparente une couleur de fond (noir par défaut, ou n'importe quelle couleur) autour de vos
images de cartes, et les convertit en PNG.

Fonctionnement : on part des 4 bords de l'image et on "inonde" (flood fill) les pixels proches de la
couleur cible connectés à ces bords, en les rendant transparents. Les pixels de cette couleur qui
seraient à l'INTÉRIEUR de l'illustration (ombres, zones du dessin) ne sont PAS touchés, puisqu'ils ne
sont pas reliés au bord de l'image par une zone continue de cette couleur.

Prérequis (sur votre machine, pas besoin de Node.js) :
    pip install Pillow
    pip install numpy   (optionnel, accélère beaucoup le traitement)

Utilisation (fond noir, par défaut) :
    python3 tools/make_cards_transparent.py public/images/cards public/images/cards_transparent

Utilisation (cibler une autre couleur, ex: le bleu de fond à l'intérieur d'une carte) :
    python3 tools/make_cards_transparent.py public/images/cards public/images/cards_transparent --color 23,88,197 --tolerance 60

    Astuce pour trouver le code RGB de votre bleu : ouvrez l'image dans un éditeur (Paint, GIMP,
    Photoshop...) et utilisez la pipette / le sélecteur de couleur sur une zone de fond bleu uni.

On peut aussi enchaîner plusieurs passes (d'abord le noir, puis le bleu) en relançant le script deux
fois sur le résultat de la première passe.

Options utiles :
    --color 0,0,0     : couleur RGB à rendre transparente (0,0,0 = noir par défaut)
    --tolerance 40    : écart de couleur toléré par canal (0-255, plus haut = détecte plus de nuances)
    --feather 2       : adoucit le bord de la découpe (anti-crénelage), 0 pour désactiver

Après conversion, mettez à jour le champ "image" des cartes concernées dans data/cards.json
pour pointer vers les nouveaux fichiers .png (ou remplacez directement vos anciens fichiers).
"""
import argparse
import os
import sys
from collections import deque

try:
    from PIL import Image, ImageFilter
except ImportError:
    print("Ce script nécessite Pillow : pip install Pillow")
    sys.exit(1)


def flood_fill_transparent(im, target_rgb=(0, 0, 0), tolerance=40, feather=2):
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    tr, tg, tb = target_rgb

    def matches(x, y):
        r, g, b, a = px[x, y]
        return abs(r - tr) <= tolerance and abs(g - tg) <= tolerance and abs(b - tb) <= tolerance

    visited = bytearray(w * h)
    q = deque()

    # amorce le flood fill depuis tous les pixels du bord de l'image
    for x in range(w):
        for y in (0, h - 1):
            if matches(x, y):
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if matches(x, y):
                q.append((x, y))

    mask = Image.new("L", (w, h), 0)  # 255 = zone à rendre transparente
    mpx = mask.load()

    while q:
        x, y = q.popleft()
        idx = y * w + x
        if visited[idx]:
            continue
        visited[idx] = 1
        if not matches(x, y):
            continue
        mpx[x, y] = 255
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))

    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))

    r, g, b, a = im.split()
    try:
        import numpy as np
        a_arr = np.array(a, dtype=np.int16)
        m_arr = np.array(mask, dtype=np.int16)
        new_alpha = np.clip(a_arr - m_arr, 0, 255).astype("uint8")
        im.putalpha(Image.fromarray(new_alpha, mode="L"))
    except ImportError:
        # repli sans numpy (plus lent mais fonctionne partout, y compris sans dépendance externe)
        a_px = a.load()
        m_px = mask.load()
        for y in range(h):
            for x in range(w):
                a_px[x, y] = max(0, a_px[x, y] - m_px[x, y])
        im.putalpha(a)
    return im


def parse_color(s):
    parts = [int(p.strip()) for p in s.split(",")]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("Couleur attendue au format R,G,B (ex: 23,88,197)")
    return tuple(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", help="Dossier contenant vos images de cartes (jpg/png)")
    parser.add_argument("output", help="Dossier de sortie pour les PNG transparents")
    parser.add_argument("--color", type=parse_color, default=(0, 0, 0), help="Couleur RGB à rendre transparente (défaut: 0,0,0 = noir)")
    parser.add_argument("--tolerance", type=int, default=40, help="Tolérance de couleur par canal (0-255)")
    parser.add_argument("--feather", type=float, default=2, help="Adoucissement du bord (0 = désactivé)")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)
    extensions = (".jpg", ".jpeg", ".png", ".webp")
    files = [f for f in os.listdir(args.source) if f.lower().endswith(extensions)]

    if not files:
        print(f"Aucune image trouvée dans {args.source}")
        return

    for filename in sorted(files):
        src_path = os.path.join(args.source, filename)
        name_no_ext = os.path.splitext(filename)[0]
        out_path = os.path.join(args.output, name_no_ext + ".png")
        try:
            im = Image.open(src_path)
            result = flood_fill_transparent(im, target_rgb=args.color, tolerance=args.tolerance, feather=args.feather)
            result.save(out_path, "PNG")
            print(f"OK  {filename} -> {os.path.basename(out_path)}")
        except Exception as e:
            print(f"ERREUR sur {filename}: {e}")

    print(f"\nTerminé. {len(files)} image(s) traitée(s) dans {args.output}")
    print("N'oubliez pas de mettre à jour les champs \"image\" dans data/cards.json (extension .png).")


if __name__ == "__main__":
    main()
