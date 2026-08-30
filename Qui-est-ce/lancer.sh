#!/usr/bin/env bash
# Lance le serveur "Qui est-ce ?" et ouvre automatiquement la page d'accueil
# dans le navigateur. Double-clique sur ce fichier (ou lance-le depuis un
# terminal avec ./lancer.sh) pour démarrer la partie.

cd "$(dirname "$0")"

PYTHON=python3
command -v $PYTHON >/dev/null 2>&1 || PYTHON=python

if ! $PYTHON -c "import flask, PIL" >/dev/null 2>&1; then
    echo "Installation des dépendances (Flask, Pillow)…"
    $PYTHON -m pip install -r requirements.txt --quiet
fi

echo "Démarrage du serveur… (laisse cette fenêtre ouverte pendant la partie)"
$PYTHON app.py
