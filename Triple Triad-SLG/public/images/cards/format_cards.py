#!/usr/bin/env python3
"""
format_cards.py — remet en forme un fichier JSON "une carte par bloc de plusieurs
lignes" en "une carte par ligne", avec les champs alignés en colonnes.

Usage :
    python format_cards.py fichier.json                fichier.json
    python format_cards.py fichier.json fichier_out.json

Si aucun fichier de sortie n'est précisé, le fichier d'entrée est modifié
sur place (une copie de sauvegarde .bak est créée à côté).

Ce que fait le script :
  1) Fusionne chaque objet JSON multi-lignes en une seule ligne.
  2) Réordonne et aligne les champs en colonnes selon un ordre FIXE
     (id, name, level, top, right, bottom, left, image, element, set),
     quel que soit l'ordre d'origine dans le fichier. Si un champ (ex.
     "element") est absent sur une ligne, sa colonne reste vide mais les
     champs suivants ("set") restent alignés au bon endroit.
  3) Insère une ligne vide chaque fois que la valeur de "level" change
     d'un objet à l'autre (les éventuelles lignes vides déjà présentes
     entre objets sont normalisées : une seule ligne vide, uniquement
     aux changements de niveau).
"""

import re
import sys
import shutil
from typing import Optional
from collections import OrderedDict

# Ordre de sortie souhaité pour les champs connus.
FIXED_ORDER = [
    "id", "name", "level", "top", "right", "bottom", "left",
    "image", "element", "set",
]

# --- Étape 1 : fusion des lignes (objet multi-lignes -> une seule ligne) ---

def collapse_objects(text: str) -> str:
    text = re.sub(r'\{\r?\n[ \t]*(?=")', '{ ', text)
    text = re.sub(r',\r?\n[ \t]*(?=")', ', ', text)
    text = re.sub(r'\r?\n[ \t]*\}', ' }', text)
    return text


# --- Étape 2 : extraction clé/valeur + réordonnancement/alignement ---

FIELD_RE = re.compile(
    r'"(?P<key>[^"]+)"\s*:\s*(?P<value>"[^"]*"|-?\d+(?:\.\d+)?|true|false|null)\s*,?'
)
LINE_RE = re.compile(r'^(\{)\s*(.*?)\s*(\},?)\s*$')


def parse_line(stripped: str):
    """Retourne (brace_open, OrderedDict(key->valeur brute), brace_close) ou None."""
    if not stripped.startswith('{'):
        return None
    m = LINE_RE.match(stripped)
    if not m:
        return None
    brace_open, body, brace_close = m.groups()
    fields = OrderedDict()
    for fm in FIELD_RE.finditer(body):
        fields[fm.group('key')] = fm.group('value')
    if not fields:
        return None
    return brace_open, fields, brace_close


def reorder_and_align(text: str) -> str:
    raw_lines = text.splitlines()

    # entries[i] = None (ligne non concernée) ou (brace_open, fields, brace_close)
    entries = [parse_line(line.strip()) for line in raw_lines]

    # Déterminer l'ordre complet des colonnes : d'abord FIXED_ORDER (dans cet
    # ordre), puis toute clé inconnue rencontrée (triée alphabétiquement).
    known = [k for k in FIXED_ORDER]
    extra = set()
    for e in entries:
        if e is None:
            continue
        for k in e[1].keys():
            if k not in FIXED_ORDER:
                extra.add(k)
    key_order = known + sorted(extra)

    # Largeur de colonne = plus grande chaîne '"clé": valeur, ' rencontrée pour
    # cette clé (uniquement sur les lignes où elle est présente).
    col_width = {}
    for e in entries:
        if e is None:
            continue
        _, fields, _ = e
        for k, v in fields.items():
            cell = f'"{k}": {v}, '
            col_width[k] = max(col_width.get(k, 0), len(cell))

    out_lines = []
    for line, e in zip(raw_lines, entries):
        if e is None:
            out_lines.append(line)
            continue
        brace_open, fields, brace_close = e
        cells = []
        for k in key_order:
            width = col_width.get(k, 0)
            if width == 0:
                continue
            if k in fields:
                cell = f'"{k}": {fields[k]}, '.ljust(width)
            else:
                cell = ' ' * width
            cells.append(cell)
        content = ''.join(cells).rstrip()
        content = re.sub(r',\s*$', '', content)
        out_lines.append(f'{brace_open} {content} {brace_close}')

    return out_lines, entries


# --- Étape 3 : ligne vide à chaque changement de "level" ---

def insert_level_breaks(out_lines, entries):
    result = []
    prev_level = None
    for line, e in zip(out_lines, entries):
        if e is None:
            # on ne garde pas les lignes vides déjà présentes entre objets :
            # elles seront réinsérées uniquement aux changements de niveau.
            if line.strip() == '':
                continue
            result.append(line)
            continue

        _, fields, _ = e
        level = fields.get('level')
        if prev_level is not None and level != prev_level:
            result.append('')
        result.append(line)
        prev_level = level

    return '\n'.join(result) + '\n'


def process(input_path: str, output_path: Optional[str]) -> str:
    with open(input_path, 'r', encoding='utf-8') as f:
        text = f.read()

    text = collapse_objects(text)
    out_lines, entries = reorder_and_align(text)
    text = insert_level_breaks(out_lines, entries)

    target = output_path or input_path
    if target == input_path:
        shutil.copyfile(input_path, input_path + '.bak')

    with open(target, 'w', encoding='utf-8') as f:
        f.write(text)

    return target


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage : python format_cards.py fichier.json [fichier_sortie.json]")
        sys.exit(1)

    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else None
    result = process(src, dst)
    print(f"Fichier reformaté écrit dans : {result}")