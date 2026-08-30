# -*- coding: utf-8 -*-
"""
Qui est-ce ? - serveur local Flask
Lance avec : python app.py
Puis ouvre http://localhost:5000/ dans le navigateur.
"""
import os
import platform
import random
import re
import shutil
import socket
import string
import subprocess
import threading
import time
import unicodedata
import webbrowser
import zipfile
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory
from PIL import Image, ImageChops

APP_ROOT = Path(__file__).parent.resolve()
UPLOAD_ROOT = APP_ROOT / "uploads"
UPLOAD_ROOT.mkdir(exist_ok=True)

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
CARD_TARGET_HEIGHT = 500  # hauteur (px) à laquelle chaque portrait est normalisé

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024  # 300 Mo

# Change à chaque redémarrage du serveur : ajouté en paramètre d'URL sur les
# fichiers CSS/JS pour forcer le navigateur à les recharger plutôt que de
# servir une version mise en cache (source fréquente de « ça n'a pas changé »
# après une mise à jour du code).
STATIC_VERSION = str(int(time.time()))


@app.context_processor
def inject_static_version():
    return {"v": STATIC_VERSION}

LOCK = threading.Lock()

GUESS_TURN_THRESHOLD = 6  # la proposition de réponse s'ouvre à partir de la fin de ce tour

# --- État global de la partie (une seule partie à la fois, usage local) ---
GAME = {
    "phase": "setup",          # setup -> ready -> countdown -> playing -> finished
    "rows": 0,
    "cols": 0,
    "pool_dir": None,          # dossier contenant les images sélectionnées
    "cards": [],               # liste des noms (sans extension) utilisés dans la partie
    "boards": {1: [], 2: []},  # liste ordonnée des noms de cartes par plateau
    "eliminated": {1: set(), 2: set()},
    "mystery": {1: None, 2: None},   # personnage que CE joueur doit faire deviner
    "choix_fait": {1: False, 2: False},
    "names": {1: "Joueur 1", 2: "Joueur 2"},
    "active_player": None,
    "starting_player": None,
    "turns_played": 0,
    "winner": None,
    "message": None,
    "photo_ratio": 0.75,
}


def reset_game():
    GAME.update({
        "phase": "setup",
        "rows": 0, "cols": 0,
        "pool_dir": None,
        "cards": [],
        "boards": {1: [], 2: []},
        "eliminated": {1: set(), 2: set()},
        "mystery": {1: None, 2: None},
        "choix_fait": {1: False, 2: False},
        "names": {1: "Joueur 1", 2: "Joueur 2"},
        "active_player": None,
        "starting_player": None,
        "turns_played": 0,
        "winner": None,
        "message": None,
        "photo_ratio": 0.75,
    })


def slugify_id():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=10))


def list_images(folder: Path):
    imgs = []
    for p in sorted(folder.rglob("*")):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS and not p.name.startswith("."):
            imgs.append(p)
    return imgs


def _trim_bbox(img: "Image.Image"):
    """Boîte englobante du sujet : se base sur le canal alpha si l'image a de
    la transparence, sinon rogne les bordures de couleur unie en comparant à
    une estimation du fond (moyenne des 4 coins) — avec un seuil de
    tolérance, pour ne pas être piégé par du bruit JPEG, un léger dégradé ou
    de l'anti-aliasing qui empêcherait sinon toute détection de marge."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        alpha = img.convert("RGBA").split()[-1]
        lo, _hi = alpha.getextrema()
        if lo < 250:  # transparence réellement exploitable
            # seuil volontairement élevé : beaucoup de portraits incluent une
            # ombre portée douce et très peu opaque sous les pieds du
            # personnage, qui gonflerait sinon la zone détectée bien au-delà
            # du sujet réel (image « collée en haut », grand vide en dessous)
            mask = alpha.point(lambda a: 255 if a > 110 else 0)
            bbox = mask.getbbox()
            if bbox:
                return bbox

    rgb = img.convert("RGB")
    w, h = rgb.size
    corners = [rgb.getpixel((0, 0)), rgb.getpixel((w - 1, 0)),
               rgb.getpixel((0, h - 1)), rgb.getpixel((w - 1, h - 1))]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    bg_img = Image.new("RGB", rgb.size, bg)
    diff = ImageChops.difference(rgb, bg_img).convert("L")
    # seuil : on ignore les petites variations (bruit / anti-aliasing / dégradé léger)
    mask = diff.point(lambda p: 255 if p > 24 else 0)
    return mask.getbbox()


def normalize_portrait(path: Path, target_height: int = CARD_TARGET_HEIGHT) -> Path:
    """Recadre le portrait sur son sujet (retire les marges transparentes ou
    de couleur unie autour du personnage) puis le redimensionne à une
    HAUTEUR fixe (la largeur suit proportionnellement). Toutes les images
    ont ainsi exactement la même hauteur. L'harmonisation des largeurs se
    fait ensuite en un second passage, une fois tout le lot traité — voir
    pad_portraits_to_common_width(). Renvoie le chemin final (toujours en
    .png, pour conserver la transparence)."""
    try:
        img = Image.open(path)
        img.load()
    except Exception:
        return path  # fichier illisible : laissé tel quel, sera filtré ailleurs si besoin

    rgba = img.convert("RGBA")
    bbox = _trim_bbox(img)
    if bbox and bbox != (0, 0, rgba.width, rgba.height):
        w, h = rgba.size
        bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pad_x = max(2, int(bw * 0.04))
        pad_y = max(2, int(bh * 0.04))
        left = max(0, bbox[0] - pad_x)
        top = max(0, bbox[1] - pad_y)
        right = min(w, bbox[2] + pad_x)
        bottom = min(h, bbox[3] + pad_y)
        rgba = rgba.crop((left, top, right, bottom))

    w, h = rgba.size
    if h == 0 or w == 0:
        return path
    new_w = max(1, round(w * (target_height / h)))
    rgba = rgba.resize((new_w, target_height), Image.LANCZOS)

    out_path = path.with_suffix(".png")
    rgba.save(out_path, "PNG")
    if out_path != path:
        try:
            path.unlink()
        except Exception:
            pass
    return out_path


def pad_portraits_to_common_width(folder: Path):
    """Une fois toutes les images du lot recadrées à la même hauteur (voir
    normalize_portrait), elles n'ont pas forcément la même largeur (un
    personnage plus fin/large qu'un autre). On complète les plus étroites
    avec du vide transparent réparti à GAUCHE et à DROITE (centrage), pour
    que tous les portraits partagent exactement les mêmes dimensions et que
    les cases du plateau soient identiques — sans risquer qu'un seul
    personnage inhabituellement haut ou étroit ne fasse exploser la hauteur
    de toutes les cases (un défaut de l'approche « largeur fixe »)."""
    files = list_images(folder)
    if not files:
        return

    widths = {}
    for f in files:
        try:
            with Image.open(f) as im:
                widths[f] = im.width
        except Exception:
            continue
    if not widths:
        return

    max_w = max(widths.values())
    for f, w in widths.items():
        if w >= max_w:
            continue
        try:
            im = Image.open(f).convert("RGBA")
            canvas = Image.new("RGBA", (max_w, im.height), (0, 0, 0, 0))
            canvas.paste(im, ((max_w - w) // 2, 0), im)
            canvas.save(f, "PNG")
        except Exception:
            continue


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def normalize_name(s):
    return strip_accents(s or "").strip().lower()


# ---------------------------------------------------------------- Pages ----

@app.route("/api/ping")
def api_ping():
    """Simple test de connectivité : si cette page ne s'affiche pas depuis un
    autre appareil, le problème est réseau (pare-feu, Wi-Fi...), pas le jeu."""
    return jsonify(ok=True, message="pong")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/joueur<int:player>")
def board_page(player):
    if player not in (1, 2):
        return "Joueur invalide", 404
    return render_template("board.html", player=player)


@app.route("/images/<path:filename>")
def serve_image(filename):
    if not GAME["pool_dir"]:
        return "Aucune image", 404
    return send_from_directory(GAME["pool_dir"], filename)


# ------------------------------------------------------------------ API ----

@app.route("/api/setup", methods=["POST"])
def api_setup():
    """Reçoit la taille du plateau + un dossier (fichiers multiples) ou une
    archive .zip contenant les portraits. Renvoie le nombre trouvé / requis."""
    with LOCK:
        reset_game()

        size = request.form.get("size", "6x6")
        try:
            rows, cols = (int(x) for x in size.lower().split("x"))
        except Exception:
            return jsonify(ok=False, error="Taille de plateau invalide."), 400

        name1 = (request.form.get("name1") or "").strip() or "Joueur 1"
        name2 = (request.form.get("name2") or "").strip() or "Joueur 2"
        GAME["names"] = {1: name1[:40], 2: name2[:40]}

        game_id = slugify_id()
        dest = UPLOAD_ROOT / game_id
        dest.mkdir(parents=True, exist_ok=True)

        files = request.files.getlist("files")
        if not files:
            return jsonify(ok=False, error="Aucun fichier reçu."), 400

        saved_any = False
        for f in files:
            if not f.filename:
                continue
            name = Path(f.filename).name
            suffix = Path(f.filename).suffix.lower()

            if suffix == ".zip":
                tmp_zip = dest / name
                f.save(tmp_zip)
                try:
                    with zipfile.ZipFile(tmp_zip) as z:
                        for member in z.namelist():
                            member_path = Path(member)
                            if member_path.suffix.lower() in IMAGE_EXTS and not member_path.name.startswith("."):
                                # aplati l'arborescence pour éviter les sous-dossiers macOS __MACOSX etc.
                                target = dest / member_path.name
                                with z.open(member) as src, open(target, "wb") as out:
                                    shutil.copyfileobj(src, out)
                                normalize_portrait(target)
                                saved_any = True
                except zipfile.BadZipFile:
                    return jsonify(ok=False, error="Archive .zip invalide."), 400
                finally:
                    tmp_zip.unlink(missing_ok=True)
            elif suffix in IMAGE_EXTS:
                target = dest / name
                f.save(target)
                normalize_portrait(target)
                saved_any = True
            # autres fichiers (ex: .DS_Store) ignorés

        if not saved_any:
            shutil.rmtree(dest, ignore_errors=True)
            return jsonify(ok=False, error="Aucune image valide trouvée dans la sélection."), 400

        # Toutes les images sont maintenant à la même largeur (normalize_portrait) ;
        # on harmonise leur hauteur en un seul passage sur l'ensemble du lot.
        pad_portraits_to_common_width(dest)

        images = list_images(dest)
        required = rows * cols
        found = len(images)

        GAME["rows"], GAME["cols"] = rows, cols
        GAME["pool_dir"] = str(dest)

        if found < required:
            return jsonify(
                ok=False,
                found=found,
                required=required,
                missing=required - found,
                error=f"Il manque {required - found} image(s) : {found} trouvée(s) pour {required} cases requises.",
            )

        return jsonify(ok=True, found=found, required=required, missing=0)


@app.route("/api/start", methods=["POST"])
def api_start():
    """Constitue les deux plateaux aléatoires à partir du pool d'images validé."""
    with LOCK:
        if not GAME["pool_dir"]:
            return jsonify(ok=False, error="Aucune sélection d'images en cours."), 400

        pool_dir = Path(GAME["pool_dir"])
        images = list_images(pool_dir)
        required = GAME["rows"] * GAME["cols"]
        if len(images) < required:
            return jsonify(ok=False, error="Pas assez d'images."), 400

        chosen = random.sample(images, required)
        names = [p.stem for p in chosen]
        # on garde une correspondance nom -> fichier réel (au cas où deux noms identiques)
        GAME["cards"] = list(zip(names, [p.name for p in chosen]))

        # Toutes les images du pool partagent désormais exactement les mêmes
        # dimensions (cf. normalize_portrait + pad_portraits_to_common_width) :
        # on calcule leur ratio une fois pour l'envoyer au client, qui peut
        # ainsi dimensionner les cases instantanément (en CSS) sans attendre
        # le chargement réel des images.
        try:
            with Image.open(chosen[0]) as sample:
                GAME["photo_ratio"] = round(sample.width / sample.height, 4)
        except Exception:
            GAME["photo_ratio"] = 0.75

        board1 = GAME["cards"][:]
        board2 = GAME["cards"][:]
        random.shuffle(board1)
        random.shuffle(board2)
        GAME["boards"][1] = board1
        GAME["boards"][2] = board2

        GAME["phase"] = "ready"
        return jsonify(ok=True)


@app.route("/api/state")
def api_state():
    player = int(request.args.get("player", 1))
    other = 2 if player == 1 else 1

    board = [{"name": n, "file": f, "eliminated": n in GAME["eliminated"][player]}
              for (n, f) in GAME["boards"].get(player, [])]

    return jsonify(
        phase=GAME["phase"],
        rows=GAME["rows"], cols=GAME["cols"],
        board=board,
        mystery=GAME["mystery"][player],       # ton propre personnage à faire deviner
        choix_fait=GAME["choix_fait"][player],
        opponent_choix_fait=GAME["choix_fait"][other],
        active_player=GAME["active_player"],
        starting_player=GAME["starting_player"],
        is_your_turn=(GAME["active_player"] == player),
        turns_played=GAME["turns_played"],
        guess_threshold=GUESS_TURN_THRESHOLD,
        can_guess=GAME["turns_played"] >= GUESS_TURN_THRESHOLD and GAME["phase"] == "playing",
        winner=GAME["winner"],
        winner_name=GAME["names"].get(GAME["winner"]) if GAME["winner"] else None,
        message=GAME["message"],
        your_name=GAME["names"][player],
        opponent_name=GAME["names"][other],
        names=GAME["names"],
        photo_ratio=GAME["photo_ratio"],
    )


@app.route("/api/choix", methods=["POST"])
def api_choix():
    with LOCK:
        data = request.get_json(force=True)
        player = int(data.get("player"))
        if GAME["phase"] not in ("ready",):
            return jsonify(ok=False, error="Le choix doit se faire avant le début de la partie."), 400
        if GAME["choix_fait"][player]:
            return jsonify(ok=False, error="Choix déjà effectué."), 400

        name, _file = random.choice(GAME["boards"][player])
        GAME["mystery"][player] = name
        GAME["choix_fait"][player] = True

        if GAME["choix_fait"][1] and GAME["choix_fait"][2]:
            GAME["starting_player"] = random.choice([1, 2])
            GAME["phase"] = "countdown"

        return jsonify(ok=True, mystery=name)


@app.route("/api/confirm_start", methods=["POST"])
def api_confirm_start():
    """Appelé par le client après le décompte de 3 pour lancer réellement la partie."""
    with LOCK:
        if GAME["phase"] != "countdown":
            return jsonify(ok=True)  # déjà lancé par l'autre onglet
        GAME["phase"] = "playing"
        GAME["active_player"] = GAME["starting_player"]
        return jsonify(ok=True)


@app.route("/api/eliminate", methods=["POST"])
def api_eliminate():
    with LOCK:
        data = request.get_json(force=True)
        player = int(data.get("player"))
        names = data.get("names")
        if names is None:
            single = data.get("name")
            names = [single] if single else []
        if GAME["phase"] != "playing" or GAME["active_player"] != player:
            return jsonify(ok=False, error="Ce n'est pas ton tour."), 403
        for name in names:
            if name in GAME["eliminated"][player]:
                GAME["eliminated"][player].discard(name)
            else:
                GAME["eliminated"][player].add(name)
        return jsonify(ok=True)


@app.route("/api/end_turn", methods=["POST"])
def api_end_turn():
    with LOCK:
        data = request.get_json(force=True)
        player = int(data.get("player"))
        if GAME["phase"] != "playing" or GAME["active_player"] != player:
            return jsonify(ok=False, error="Ce n'est pas ton tour."), 403
        GAME["turns_played"] += 1
        GAME["active_player"] = 2 if player == 1 else 1
        return jsonify(ok=True)


@app.route("/api/guess", methods=["POST"])
def api_guess():
    with LOCK:
        data = request.get_json(force=True)
        player = int(data.get("player"))
        guess = data.get("name", "")
        other = 2 if player == 1 else 1

        if GAME["phase"] != "playing" or GAME["active_player"] != player:
            return jsonify(ok=False, error="Ce n'est pas ton tour."), 403
        if GAME["turns_played"] < GUESS_TURN_THRESHOLD:
            return jsonify(ok=False, error="Trop tôt pour proposer une réponse."), 403

        target = GAME["mystery"][other]  # le personnage à deviner est celui de l'ADVERSAIRE
        correct = normalize_name(guess) == normalize_name(target)

        player_name = GAME["names"][player]

        if correct:
            GAME["phase"] = "finished"
            GAME["winner"] = player
            GAME["message"] = f"{player_name} a trouvé « {target} » et remporte la partie !"
            return jsonify(ok=True, correct=True, winner=player, target=target)
        else:
            GAME["turns_played"] += 1
            GAME["active_player"] = other
            GAME["message"] = f"{player_name} a proposé « {guess} », ce n'était pas la bonne réponse."
            return jsonify(ok=True, correct=False)


@app.route("/api/reset", methods=["POST"])
def api_reset():
    with LOCK:
        pool = GAME.get("pool_dir")
        reset_game()
        if pool:
            shutil.rmtree(pool, ignore_errors=True)
        return jsonify(ok=True)


def _ips_from_os_tools():
    """Interroge ipconfig (Windows) / hostname -I / ifconfig (Mac/Linux) pour
    lister TOUTES les adresses IPv4 locales, y compris celles d'un adaptateur
    de partage de connexion (ex : 192.168.137.1 sur le partage Wi-Fi Windows),
    que l'astuce « connexion UDP vers 8.8.8.8 » peut manquer si ce n'est pas
    l'interface utilisée pour sortir vers Internet."""
    ips = set()
    try:
        if platform.system() == "Windows":
            out = subprocess.check_output(
                ["ipconfig"], text=True, errors="ignore",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            ips.update(re.findall(r"IPv4[^:]*:\s*([\d.]+)", out))
        else:
            try:
                out = subprocess.check_output(["hostname", "-I"], text=True, errors="ignore")
                ips.update(out.split())
            except Exception:
                out = subprocess.check_output(["ifconfig"], text=True, errors="ignore")
                ips.update(re.findall(r"inet (?:addr:)?([\d.]+)", out))
    except Exception:
        pass
    return ips


def get_local_ips():
    ips = set()
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            ips.add(ip)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    ips.update(_ips_from_os_tools())
    # on écarte le loopback et les adresses APIPA/link-local (169.254.x.x),
    # jamais utiles pour se connecter depuis un autre appareil
    ips = {ip for ip in ips if not ip.startswith("127.") and not ip.startswith("169.254.")}
    return sorted(ips)


def print_lan_hint():
    ips = get_local_ips()
    print("Qui est-ce ? -> http://localhost:5000/  (sur ce PC)")
    if ips:
        print("Depuis une tablette / un smartphone connecté au MÊME réseau que ce PC :")
        for ip in ips:
            hint = ""
            if ip.startswith("192.168.137."):
                hint = "  <- adresse typique d'un partage de connexion Windows"
            print(f"   http://{ip}:5000/{hint}")
        if len(ips) > 1:
            print("   (plusieurs adresses détectées : essaie celle qui correspond au réseau")
            print("    auquel la tablette est connectée — Wi-Fi, partage de connexion, etc.)")
    else:
        print("Impossible de détecter une adresse réseau locale automatiquement.")
        print("Sur le PC, ouvre une invite de commandes et tape 'ipconfig' (Windows)")
        print("ou 'ifconfig' / 'ip a' (Mac/Linux) pour trouver ton adresse IPv4 locale.")
    print("(pense à autoriser Python dans le pare-feu si la connexion échoue)")


if __name__ == "__main__":
    print_lan_hint()
    # Si un script de lancement (lancer.bat / lancer.sh) ouvre déjà le
    # navigateur lui-même, on évite d'en ouvrir un deuxième ici.
    if not os.environ.get("QUIESTCE_SKIP_BROWSER"):
        threading.Timer(1.2, lambda: webbrowser.open("http://localhost:5000/")).start()
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
