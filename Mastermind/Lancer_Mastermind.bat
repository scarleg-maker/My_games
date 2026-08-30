@echo off
setloc Mastermind - Lancement du serveur

REM Se placer dans le dossier ou se trouve ce fichier .bat
cd /d "%~dp0"

REM Installer les dependances si besoin (premier lancement)
if not exist "node_modules" (
    echo Installation des dependances npm, veuillez patienter...
    call npm install
    if errorlevel 1 (
        echo.
        echo Une erreur est survenue lors de "npm install".
        echo Verifiez que Node.js est bien installe : https://nodejs.org
        pause
        exit /b 1
    )
)

echo Demarrage du serveur sur http://localhost:1700 ...

REM Lance le serveur en arriere-plan DANS la meme fenetre (pas de 2e fenetre)
start /B npm start

REM Laisse le temps au serveur de demarrer avant d'ouvrir le navigateur
timeout /t 3 /nobreak >nul

REM Ouvre la page maitre dans le navigateur par defaut
start "" "http://localhost:1700"

echo.
echo Le serveur tourne dans cette fenetre (ne pas la fermer pendant la partie).
echo Fermez cette fenetre pour arreter le serveur.

:boucle
timeout /t 3600 /nobreak >nul
goto boucle
