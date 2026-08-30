@echo off
title 7 Familles - Serveur de jeu
cd /d "%~dp0"

echo =========================================
echo    7 FAMILLES - Demarrage du serveur
echo =========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERREUR] Node.js n'est pas installe ou n'est pas dans le PATH.
    echo Telechargez-le ici : https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Premiere installation, cela peut prendre une minute...
    call npm install
    echo.
)

echo Recherche de l'adresse IP locale...
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LOCALIP=%%a
)
set LOCALIP=%LOCALIP: =%

echo =========================================
echo   Le serveur va demarrer sur le port 1500
echo.
echo   Page maitre (sur cet ordinateur) :
echo     http://localhost:1500/index.html
echo.
echo   Pages joueurs (a distribuer sur le reseau) :
if defined LOCALIP (
    echo     http://%LOCALIP%:2000/player/1
    echo     http://%LOCALIP%:2000/player/2
    echo     ... etc (un lien par joueur, IDs consecutifs)
) else (
    echo     http://VOTRE_IP_LOCALE:1500/joueur1
)
echo =========================================
echo.
echo Ouverture du navigateur dans 2 secondes...
echo (Ne fermez pas cette fenetre tant que la partie n'est pas terminee)
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:1500"

call npm start

pause
