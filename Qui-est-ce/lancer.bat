@echo off
setlocal enabledelayedexpansion
title Qui est-ce ? - Lancement du serveur

REM Se placer dans le dossier ou se trouve ce fichier .bat
cd /d "%~dp0"

REM Detecte l'interpreteur Python disponible (py de preference : plus fiable
REM que "python", qui sur certains PC ouvre le Microsoft Store au lieu de
REM lancer un vrai Python installe)
set "PYCMD="
where py >nul 2>&1
if not errorlevel 1 (
    set "PYCMD=py -3"
) else (
    where python >nul 2>&1
    if not errorlevel 1 (
        set "PYCMD=python"
    )
)

if "%PYCMD%"=="" (
    echo ============================================================
    echo Python n'a pas ete trouve sur cet ordinateur.
    echo.
    echo Installe Python depuis https://www.python.org/downloads/
    echo IMPORTANT : coche la case "Add python.exe to PATH" au debut
    echo de l'installation, puis relance ce fichier.
    echo ============================================================
    pause
    exit /b 1
)

REM Installer les dependances si besoin (premier lancement)
%PYCMD% -c "import flask, PIL" >nul 2>&1
if errorlevel 1 (
    echo Installation des dependances Python, veuillez patienter...
    %PYCMD% -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo ============================================================
        echo Une erreur est survenue lors de l'installation des dependances.
        echo Verifie ta connexion internet, ou lance manuellement :
        echo    %PYCMD% -m pip install -r requirements.txt
        echo ============================================================
        pause
        exit /b 1
    )
)

echo Demarrage du serveur sur http://localhost:5000 ...

REM Empeche le serveur d'ouvrir lui-meme un onglet : c'est ce script qui s'en charge
set "QUIESTCE_SKIP_BROWSER=1"

REM Lance le serveur en arriere-plan DANS la meme fenetre (pas de 2e fenetre)
start /B %PYCMD% app.py

REM Laisse le temps au serveur de demarrer avant d'ouvrir le navigateur
timeout /t 3 /nobreak >nul

REM Ouvre la page d'accueil dans le navigateur par defaut
start "" "http://localhost:5000"

echo.
echo Le serveur tourne dans cette fenetre (ne pas la fermer pendant la partie).
echo Fermez cette fenetre pour arreter le serveur.

:boucle
timeout /t 3600 /nobreak >nul
goto boucle
