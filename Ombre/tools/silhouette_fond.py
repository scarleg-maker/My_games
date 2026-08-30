"""
Transforme les images d'un dossier en silhouettes noires, puis les colle
sur un fond d'image choisi INTERACTIVEMENT pour chaque image.

Structure attendue :
    test db/
        image1.jpg
        image2.png
        fonds/              <- mets ici tes images de fond
            plage.jpg
            ville.png
        ombre/              <- créé automatiquement, résultats ici

Usage:
    python silhouette_fond.py "D:\\IA\\Sites\\Ombre\\tools\\test db"
"""

import sys
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


def composite_on_background(silhouette, background_path):
    """Colle la silhouette (RGBA) sur un fond, redimensionné à la taille de la silhouette."""
    bg = Image.open(background_path).convert("RGBA")
    bg = bg.resize(silhouette.size)  # ajuste le fond à la taille de l'image silhouette
    result = Image.alpha_composite(bg, silhouette)
    return result.convert("RGB")  # pas besoin de transparence dans le résultat final


def choose_background(backgrounds, image_name):
    print(f"\nImage : {image_name}")
    print("  0. Aucun fond (garder transparent)")
    for i, bg in enumerate(backgrounds, start=1):
        print(f"  {i}. {bg.name}")
    while True:
        choice = input("Choix (numéro) : ").strip()
        if choice.isdigit() and 0 <= int(choice) <= len(backgrounds):
            return None if int(choice) == 0 else backgrounds[int(choice) - 1]
        print("Entrée invalide, réessaie.")


def process_folder(input_folder, bg_color=None, tolerance=20):
    input_folder = Path(input_folder)
    if not input_folder.is_dir():
        print(f"Erreur : le dossier '{input_folder}' n'existe pas.")
        sys.exit(1)

    fonds_folder = input_folder / "fonds"
    output_folder = input_folder / "ombre"
    output_folder.mkdir(exist_ok=True)

    backgrounds = []
    if fonds_folder.is_dir():
        backgrounds = [f for f in fonds_folder.iterdir() if f.is_file() and f.suffix.lower() in EXTENSIONS]

    if not backgrounds:
        print(f"Aucun fond trouvé dans '{fonds_folder}'. Place tes images de fond là-bas.")

    files = [f for f in input_folder.iterdir() if f.is_file() and f.suffix.lower() in EXTENSIONS]

    if not files:
        print("Aucune image source trouvée dans ce dossier.")
        return

    print(f"{len(files)} image(s) à traiter.\n")

    for f in files:
        try:
            with Image.open(f) as img:
                silhouette = to_silhouette(img, bg_color=bg_color, tolerance=tolerance)

            chosen_bg = choose_background(backgrounds, f.name) if backgrounds else None

            if chosen_bg:
                final_img = composite_on_background(silhouette, chosen_bg)
                out_path = output_folder / (f.stem + ".png")
                final_img.save(out_path, "PNG")
            else:
                out_path = output_folder / (f.stem + ".png")
                silhouette.save(out_path, "PNG")

            print(f"  OK -> {out_path.name}")

        except Exception as e:
            print(f"  ERREUR sur {f.name} : {e}")

    print(f"\nTerminé. Résultats dans : {output_folder}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage : python silhouette_fond.py \"chemin_du_dossier\"")
        sys.exit(1)

    process_folder(sys.argv[1])
