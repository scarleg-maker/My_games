# -*- coding: utf-8 -*-
"""
Qui-est-ce-SLG - serveur Flask avec salons (plusieurs parties séparées)
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

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory
from PIL import Image, ImageChops

APP_ROOT = Path(__file__).parent.resolve()
UPLOAD_ROOT = APP_ROOT / "uploads"
UPLOAD_ROOT.mkdir(exist_ok=True)

# Archives intégrées : chaque .zip (ou sous-dossier d'images) placé dans
# "archives/" est proposé dans la page de préparation, sans rien envoyer.
ARCHIVES_DIR = APP_ROOT / "archives"
ARCHIVES_DIR.mkdir(exist_ok=True)

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
CARD_TARGET_HEIGHT = 500  # hauteur (px) à laquelle chaque portrait est normalisé
GUESS_TURN_THRESHOLD = 6  # la proposition de réponse s'ouvre à partir de la fin de ce tour

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024  # 300 Mo

# Change à chaque redémarrage du serveur : ajouté en paramètre d'URL sur les
# fichiers CSS/JS pour forcer le navigateur à les recharger plutôt que de
# servir une version mise en cache.
STATIC_VERSION = str(int(time.time()))


@app.context_processor
def inject_static_version():
    return {"v": STATIC_VERSION}


# ======================================================================
# SALONS (rooms) : chaque salon est une partie indépendante, identifiée
# par un code court. Plusieurs groupes peuvent jouer en même temps sur le
# même serveur sans se gêner.
# ======================================================================

ROOMS = {}  # code -> dict d'état de partie
ROOMS_LOCK = threading.Lock()

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # sans 0/O ni 1/I/L (ambigus)
CODE_RE = re.compile(r"^[A-Z0-9]{3,10}$")
RESERVED_CODES = {"API", "STATIC", "IMAGES", "JOUEUR1", "JOUEUR2", "FAVICON", "ROOMS"}
ROOM_IDLE_SECONDS = 6 * 3600   # un salon sans activité depuis 6h est supprimé
MAX_ROOMS = 300


def clean_code(code):
    return (code or "").strip().upper()


def valid_code(code):
    return bool(CODE_RE.match(code)) and code not in RESERVED_CODES


def generate_code():
    length = 4
    while True:
        for _ in range(50):
            code = "".join(random.choices(CODE_ALPHABET, k=length))
            if code not in ROOMS and valid_code(code):
                return code
        length += 1


def new_room_state(code):
    return {
        "code": code,
        "phase": "setup",          # setup -> ready -> countdown -> playing -> finished
        "rows": 0,
        "cols": 0,
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
        "last_activity": time.time(),
    }


def reset_room(room):
    code = room["code"]
    room.clear()
    room.update(new_room_state(code))


def purge_idle_rooms(force=False):
    now = time.time()
    stale = [c for c, r in ROOMS.items() if force or now - r["last_activity"] > ROOM_IDLE_SECONDS]
    for code in stale:
        pool = ROOMS[code].get("pool_dir")
        if pool:
            shutil.rmtree(pool, ignore_errors=True)
        del ROOMS[code]


def _purge_loop():
    while True:
        time.sleep(600)
        with ROOMS_LOCK:
            purge_idle_rooms()


threading.Thread(target=_purge_loop, daemon=True).start()


def get_room(code, create=False):
    code = clean_code(code)
    if not valid_code(code):
        return None
    room = ROOMS.get(code)
    if room:
        room["last_activity"] = time.time()
        return room
    if not create:
        return None
    if len(ROOMS) >= MAX_ROOMS:
        purge_idle_rooms(force=False)
    room = new_room_state(code)
    ROOMS[code] = room
    return room


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
    les cases du plateau soient identiques."""
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
def accueil():
    return render_template("accueil.html")


@app.route("/<code>")
def setup_page(code):
    code = clean_code(code)
    if not valid_code(code):
        return redirect("/")
    get_room(code, create=True)
    return render_template("setup.html", code=code)


@app.route("/<code>/joueur<int:player>")
def board_page(code, player):
    code = clean_code(code)
    if player not in (1, 2) or not valid_code(code):
        return "Page invalide", 404
    room = get_room(code, create=False)
    if not room:
        return render_template("room_missing.html", code=code), 404
    return render_template("board.html", player=player, code=code)


@app.route("/<code>/images/<path:filename>")
def serve_image(code, filename):
    room = get_room(code, create=False)
    if not room or not room["pool_dir"]:
        return "Aucune image", 404
    return send_from_directory(room["pool_dir"], filename)


# ------------------------------------------------------------------ API salons ----

@app.route("/api/rooms", methods=["POST"])
def api_create_room():
    with ROOMS_LOCK:
        data = request.get_json(force=True, silent=True) or {}
        requested = clean_code(data.get("code"))
        if requested:
            if not valid_code(requested):
                return jsonify(ok=False, error="Code invalide : 3 à 10 lettres ou chiffres."), 400
            if requested in ROOMS:
                return jsonify(ok=False, error=f"Le salon {requested} est déjà utilisé."), 400
            code = requested
        else:
            code = generate_code()
        get_room(code, create=True)
        return jsonify(ok=True, code=code)


@app.route("/api/rooms/<code>")
def api_room_info(code):
    code = clean_code(code)
    room = get_room(code, create=False) if valid_code(code) else None
    if not room:
        return jsonify(exists=False, code=code)
    return jsonify(
        exists=True, code=code, phase=room["phase"],
        names={str(k): v for k, v in room["names"].items()},
    )


# ------------------------------------------------------------------ API partie (scopée à un salon) ----

def list_archives():
    """Archives disponibles : [{id, label, count}] (zip ou sous-dossier)."""
    out = []
    for p in sorted(ARCHIVES_DIR.iterdir(), key=lambda x: x.name.lower()):
        if p.name.startswith("."):
            continue
        try:
            if p.is_file() and p.suffix.lower() == ".zip":
                with zipfile.ZipFile(p) as z:
                    n = sum(1 for m in z.namelist()
                            if Path(m).suffix.lower() in IMAGE_EXTS and not Path(m).name.startswith("."))
            elif p.is_dir():
                n = sum(1 for f in p.rglob("*") if f.is_file() and f.suffix.lower() in IMAGE_EXTS)
            else:
                continue
        except Exception:
            continue
        if n:
            out.append({"id": p.name, "label": p.stem if p.is_file() else p.name, "count": n})
    return out


@app.route("/api/archives")
def api_archives():
    return jsonify(archives=list_archives())


@app.route("/<code>/api/setup", methods=["POST"])
def api_setup(code):
    with ROOMS_LOCK:
        room = get_room(code, create=True)
        if not room:
            return jsonify(ok=False, error="Code de salon invalide."), 400

        old_pool = room.get("pool_dir")
        reset_room(room)
        if old_pool:
            shutil.rmtree(old_pool, ignore_errors=True)

        size = request.form.get("size", "6x6")
        try:
            rows, cols = (int(x) for x in size.lower().split("x"))
        except Exception:
            return jsonify(ok=False, error="Taille de plateau invalide."), 400

        name1 = (request.form.get("name1") or "").strip() or "Joueur 1"
        name2 = (request.form.get("name2") or "").strip() or "Joueur 2"
        room["names"] = {1: name1[:40], 2: name2[:40]}

        game_id = slugify_id()
        dest = UPLOAD_ROOT / code / game_id
        dest.mkdir(parents=True, exist_ok=True)

        files = request.files.getlist("files")
        archive_id = (request.form.get("archive") or "").strip()
        if not files and not archive_id:
            return jsonify(ok=False, error="Aucun fichier reçu."), 400

        saved_any = False
        if archive_id:
            # Archive intégrée : on ne prend que les noms listés (pas de chemin libre).
            src = next((ARCHIVES_DIR / a["id"] for a in list_archives() if a["id"] == archive_id), None)
            if src is None:
                shutil.rmtree(dest, ignore_errors=True)
                return jsonify(ok=False, error="Archive introuvable."), 400
            if src.is_dir():
                for f in sorted(src.rglob("*")):
                    if f.is_file() and f.suffix.lower() in IMAGE_EXTS and not f.name.startswith("."):
                        target = dest / f.name
                        shutil.copyfile(f, target)
                        normalize_portrait(target)
                        saved_any = True
            else:
                with zipfile.ZipFile(src) as z:
                    for member in z.namelist():
                        mp = Path(member)
                        if mp.suffix.lower() in IMAGE_EXTS and not mp.name.startswith("."):
                            target = dest / mp.name
                            with z.open(member) as srcf, open(target, "wb") as out:
                                shutil.copyfileobj(srcf, out)
                            normalize_portrait(target)
                            saved_any = True
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

        if not saved_any:
            shutil.rmtree(dest, ignore_errors=True)
            return jsonify(ok=False, error="Aucune image valide trouvée dans la sélection."), 400

        pad_portraits_to_common_width(dest)

        images = list_images(dest)
        required = rows * cols
        found = len(images)

        room["rows"], room["cols"] = rows, cols
        room["pool_dir"] = str(dest)

        if found < required:
            return jsonify(
                ok=False,
                found=found,
                required=required,
                missing=required - found,
                error=f"Il manque {required - found} image(s) : {found} trouvée(s) pour {required} cases requises.",
            )

        return jsonify(ok=True, found=found, required=required, missing=0)


@app.route("/<code>/api/start", methods=["POST"])
def api_start(code):
    with ROOMS_LOCK:
        room = get_room(code, create=False)
        if not room:
            return jsonify(ok=False, error="Ce salon n'existe plus.", noroom=True), 404
        if not room["pool_dir"]:
            return jsonify(ok=False, error="Aucune sélection d'images en cours."), 400

        pool_dir = Path(room["pool_dir"])
        images = list_images(pool_dir)
        required = room["rows"] * room["cols"]
        if len(images) < required:
            return jsonify(ok=False, error="Pas assez d'images."), 400

        chosen = random.sample(images, required)
        names = [p.stem for p in chosen]
        room["cards"] = list(zip(names, [p.name for p in chosen]))

        try:
            with Image.open(chosen[0]) as sample:
                room["photo_ratio"] = round(sample.width / sample.height, 4)
        except Exception:
            room["photo_ratio"] = 0.75

        board1 = room["cards"][:]
        board2 = room["cards"][:]
        random.shuffle(board1)
        random.shuffle(board2)
        room["boards"][1] = board1
        room["boards"][2] = board2

        room["phase"] = "ready"
        return jsonify(ok=True)


@app.route("/<code>/api/state")
def api_state(code):
    room = get_room(code, create=False)
    if not room:
        return jsonify(exists=False)

    player = int(request.args.get("player", 1))
    other = 2 if player == 1 else 1

    board = [{"name": n, "file": f, "eliminated": n in room["eliminated"][player]}
              for (n, f) in room["boards"].get(player, [])]

    return jsonify(
        exists=True,
        phase=room["phase"],
        rows=room["rows"], cols=room["cols"],
        board=board,
        mystery=room["mystery"][player],
        choix_fait=room["choix_fait"][player],
        opponent_choix_fait=room["choix_fait"][other],
        active_player=room["active_player"],
        starting_player=room["starting_player"],
        is_your_turn=(room["active_player"] == player),
        turns_played=room["turns_played"],
        guess_threshold=GUESS_TURN_THRESHOLD,
        can_guess=room["turns_played"] >= GUESS_TURN_THRESHOLD and room["phase"] == "playing",
        winner=room["winner"],
        winner_name=room["names"].get(room["winner"]) if room["winner"] else None,
        message=room["message"],
        your_name=room["names"][player],
        opponent_name=room["names"][other],
        names=room["names"],
        photo_ratio=room["photo_ratio"],
    )


@app.route("/<code>/api/choix", methods=["POST"])
def api_choix(code):
    with ROOMS_LOCK:
        room = get_room(code, create=False)
        if not room:
            return jsonify(ok=False, error="Ce salon n'existe plus.", noroom=True), 404
        data = request.get_json(force=True)
        player = int(data.get("player"))
        if room["phase"] not in ("ready",):
            return jsonify(ok=False, error="Le choix doit se faire avant le début de la partie."), 400
        if room["choix_fait"][player]:
            return jsonify(ok=False, error="Choix déjà effectué."), 400

        name, _file = random.choice(room["boards"][player])
        room["mystery"][player] = name
        room["choix_fait"][player] = True

        if room["choix_fait"][1] and room["choix_fait"][2]:
            room["starting_player"] = random.choice([1, 2])
            room["phase"] = "countdown"

        return jsonify(ok=True, mystery=name)


@app.route("/<code>/api/confirm_start", methods=["POST"])
def api_confirm_start(code):
    with ROOMS_LOCK:
        room = get_room(code, create=False)
        if not room:
            return jsonify(ok=True)
        if room["phase"] != "countdown":
            return jsonify(ok=True)
        room["phase"] = "playing"
        room["active_player"] = room["starting_player"]
        return jsonify(ok=True)


@app.route("/<code>/api/eliminate", methods=["POST"])
def api_eliminate(code):
    with ROOMS_LOCK:
        room = get_room(code, create=False)
        if not room:
            return jsonify(ok=False, error="Ce salon n'existe plus.", noroom=True), 404
        data = request.get_json(force=True)
        player = int(data.get("player"))
        names = data.get("names")
        if names is None:
            single = data.get("name")
            names = [single] if single else []
        if room["phase"] != "playing" or room["active_player"] != player:
            return jsonify(ok=False, error="Ce n'est pas ton tour."), 403
        for name in names:
            if name in room["eliminated"][player]:
                room["eliminated"][player].discard(name)
            else:
                room["eliminated"][player].add(name)
        return jsonify(ok=True)


@app.route("/<code>/api/end_turn", methods=["POST"])
def api_end_turn(code):
    with ROOMS_LOCK:
        room = get_room(code, create=False)
        if not room:
            return jsonify(ok=False, error="Ce salon n'existe plus.", noroom=True), 404
        data = request.get_json(force=True)
        player = int(data.get("player"))
        if room["phase"] != "playing" or room["active_player"] != player:
            return jsonify(ok=False, error="Ce n'est pas ton tour."), 403
        room["turns_played"] += 1
        room["active_player"] = 2 if player == 1 else 1
        return jsonify(ok=True)


@app.route("/<code>/api/guess", methods=["POST"])
def api_guess(code):
    with ROOMS_LOCK:
        room = get_room(code, create=False)
        if not room:
            return jsonify(ok=False, error="Ce salon n'existe plus.", noroom=True), 404
        data = request.get_json(force=True)
        player = int(data.get("player"))
        guess = data.get("name", "")
        other = 2 if player == 1 else 1

        if room["phase"] != "playing" or room["active_player"] != player:
            return jsonify(ok=False, error="Ce n'est pas ton tour."), 403
        if room["turns_played"] < GUESS_TURN_THRESHOLD:
            return jsonify(ok=False, error="Trop tôt pour proposer une réponse."), 403

        target = room["mystery"][other]
        correct = normalize_name(guess) == normalize_name(target)
        player_name = room["names"][player]

        if correct:
            room["phase"] = "finished"
            room["winner"] = player
            room["message"] = f"{player_name} a trouvé « {target} » et remporte la partie !"
            return jsonify(ok=True, correct=True, winner=player, target=target)
        else:
            room["turns_played"] += 1
            room["active_player"] = other
            room["message"] = f"{player_name} a proposé « {guess} », ce n'était pas la bonne réponse."
            return jsonify(ok=True, correct=False)


@app.route("/<code>/api/reset", methods=["POST"])
def api_reset(code):
    with ROOMS_LOCK:
        room = get_room(code, create=False)
        if not room:
            return jsonify(ok=True)
        pool = room.get("pool_dir")
        reset_room(room)
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
    ips = {ip for ip in ips if not ip.startswith("127.") and not ip.startswith("169.254.")}
    return sorted(ips)


def print_lan_hint():
    ips = get_local_ips()
    print("Qui-est-ce-SLG -> http://localhost:5000/  (sur ce PC)")
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
    if not os.environ.get("QUIESTCE_SKIP_BROWSER"):
        threading.Timer(1.2, lambda: webbrowser.open("http://localhost:5000/")).start()
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
