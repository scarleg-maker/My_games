"""
Transforme toutes les images d'un dossier en silhouettes noires (PNG transparent).
- Les originaux ne sont JAMAIS modifiés.
- Les résultats sont enregistrés dans un sous-dossier "ombre" (créé automatiquement).
- Formats lus : .png, .jpg, .jpeg, .webp, .bmp, .tiff

Usage:
    python silhouette_batch.py "D:\\IA\\Sites\\Ombre\\tools\\test db"
    python silhouette_batch.py "D:\\chemin\\dossier" --bg-color 255 255 255 --tolerance 30
    python silhouette_batch.py "D:\\chemin\\dossier" --output-name resultats
"""

import sys
import argparse
from pathlib import Path
from PIL import Image

EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}


def to_silhouette(img, bg_color=None, tolerance=20):
    img = img.convert("RGBA")
    pixels = img.load()
    width, height = img.size

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]

            if bg_color is not None:
                dist = ((r - bg_color[0]) ** 2 + (g - bg_color[1]) ** 2 + (b - bg_color[2]) ** 2) ** 0.5
                if dist <= tolerance:
                    pixels[x, y] = (0, 0, 0, 0)
                    continue

            if a > 0:
                pixels[x, y] = (0, 0, 0, a)

    return img


def process_folder(input_folder, output_name="ombre", bg_color=None, tolerance=20):
    input_folder = Path(input_folder)
    if not input_folder.is_dir():
        print(f"Erreur : le dossier '{input_folder}' n'existe pas.")
        sys.exit(1)

    output_folder = input_folder / output_name
    output_folder.mkdir(exist_ok=True)

    files = [f for f in input_folder.iterdir() if f.is_file() and f.suffix.lower() in EXTENSIONS]

    if not files:
        print("Aucune image trouvée dans ce dossier.")
        return

    print(f"{len(files)} image(s) trouvée(s). Traitement en cours...\n")

    for f in files:
        try:
            with Image.open(f) as img:
                result = to_silhouette(img, bg_color=bg_color, tolerance=tolerance)
                out_path = output_folder / (f.stem + ".png")
                result.save(out_path, "PNG")
                print(f"  OK  -> {f.name}  =>  {out_path.name}")
        except Exception as e:
            print(f"  ERREUR sur {f.name} : {e}")

    print(f"\nTerminé. Résultats dans : {output_folder}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transforme toutes les images d'un dossier en silhouettes noires.")
    parser.add_argument("folder", help="Dossier contenant les images sources")
    parser.add_argument("--output-name", default="ombre", help="Nom du sous-dossier de sortie (défaut: ombre)")
    parser.add_argument("--bg-color", nargs=3, type=int, metavar=("R", "G", "B"),
                         help="Couleur de fond à rendre transparente, ex: --bg-color 255 255 255")
    parser.add_argument("--tolerance", type=int, default=20,
                         help="Tolérance de couleur pour le détourage du fond (défaut: 20)")
    args = parser.parse_args()

    process_folder(args.folder, output_name=args.output_name, bg_color=args.bg_color, tolerance=args.tolerance)