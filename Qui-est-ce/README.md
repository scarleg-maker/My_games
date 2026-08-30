# Qui est-ce ? — jeu local en Python/Flask

## Lancement rapide

- **macOS / Linux** : double-clique sur `lancer.sh` (ou lance `./lancer.sh` dans
  un terminal). Le script installe Flask si besoin, démarre le serveur et
  ouvre automatiquement la page d'accueil dans ton navigateur.
- **Windows** : double-clique sur `lancer.bat`.

### `lancer.bat` ne démarre pas ?

Le script affiche maintenant un message clair selon le problème rencontré :

- **« Python n'a pas été trouvé »** : Python n'est pas installé (ou pas
  accessible). Installe-le depuis https://www.python.org/downloads/ — coche
  bien la case **« Add python.exe to PATH »** pendant l'installation, puis
  relance `lancer.bat`. (Piège fréquent sur Windows : si tu tapes `python`
  dans une invite de commandes et que ça ouvre le Microsoft Store au lieu de
  lancer Python, c'est justement parce qu'il n'est pas réellement installé —
  installe-le depuis le lien ci-dessus, pas depuis le Store.)
- **« L'installation de Flask a échoué »** : vérifie ta connexion internet,
  ou ouvre une invite de commandes dans le dossier `Qui est-ce` et tape
  `python -m pip install -r requirements.txt` pour voir le message d'erreur
  complet.
- La fenêtre se ferme trop vite pour lire l'erreur ? Ouvre une invite de
  commandes (`cmd`), fais `cd` jusqu'au dossier `Qui est-ce`, puis tape
  `lancer.bat` directement : la fenêtre restera ouverte après l'exécution.

## Installation manuelle (alternative)

```bash
cd "Qui est-ce"
pip install -r requirements.txt
python app.py
```

Le navigateur s'ouvre automatiquement sur **http://localhost:5000/**. S'il
ne s'ouvre pas tout seul, ouvre cette adresse manuellement.

## Jouer avec une tablette ou un smartphone (2e joueur)

Le serveur tourne sur le PC, mais chaque appareil peut ouvrir sa propre
page de plateau dans un navigateur — y compris une tablette ou un
smartphone, à condition qu'il soit **sur le même réseau** que le PC.

1. **Mets le PC et la tablette sur le même réseau Wi-Fi.** Deux cas possibles :
   - la tablette et le PC sont connectés à la même box/Wi-Fi ;
   - ou le PC partage sa connexion (point d'accès mobile / hotspot) et la
     tablette se connecte à ce réseau partagé.
2. **Lance le serveur** (`lancer.sh` / `lancer.bat` ou `python app.py`). La
   console affiche une ou plusieurs adresses du type :
   ```
   Depuis une tablette / un smartphone connecté au MÊME réseau que ce PC :
      http://192.168.1.42:5000/
   ```
   Si plusieurs adresses apparaissent (Wi-Fi + partage de connexion, etc.),
   essaie celle qui correspond au réseau utilisé par la tablette.
3. Sur le PC (joueur 1), reste sur la page qui s'est ouverte automatiquement.
   Une fois la partie créée, ouvre `/joueur1`.
4. Sur la tablette (joueur 2), ouvre son navigateur et tape l'adresse
   affichée à l'étape 2 suivie de `/joueur2`, par exemple :
   `http://192.168.1.42:5000/joueur2`
5. Si la page ne se charge pas :
   - **Teste d'abord le diagnostic intégré** : sur la tablette, ouvre
     `http://<IP-du-PC>:5000/api/ping`. Si tu vois `{"ok":true,"message":"pong"}`,
     le réseau fonctionne et le souci vient d'ailleurs (relance simplement
     `http://<IP-du-PC>:5000/`). Si la page ne se charge pas du tout
     (« Impossible d'accéder à ce site », délai dépassé...), c'est un
     blocage réseau, pas un bug du jeu — continue ci-dessous.
   - vérifie que la tablette est bien sur le même réseau (pas en 4G/5G, et
     pas sur un « réseau invité » si ta box en propose un) ;
   - **Pare-feu Windows** (cause la plus fréquente) : au premier lancement,
     Windows doit afficher une fenêtre « Voulez-vous autoriser Python à
     communiquer sur ce réseau ? » — coche **Réseaux privés** *et*
     **Réseaux publics**, puis « Autoriser l'accès ». Si tu l'as fermée par
     erreur, ouvre PowerShell **en administrateur** (clic droit dessus >
     « Exécuter en tant qu'administrateur ») et lance :
     ```powershell
     New-NetFirewallRule -DisplayName "Qui est-ce" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow
     ```
   - **Profil réseau « Public »** : si Windows considère le Wi-Fi comme un
     réseau public, il bloque par défaut les connexions entrantes même pour
     les apps autorisées. Vérifie/change dans *Paramètres > Réseau et
     Internet > Wi-Fi > (ton réseau) > Profil réseau* en choisissant
     **Privé**.
   - **IP incorrecte** : la console du serveur affiche maintenant *toutes*
     les adresses IP détectées sur le PC (Wi-Fi, partage de connexion...).
     Utilise celle qui correspond au réseau de la tablette — par exemple
     `192.168.137.1` est l'adresse typique du partage de connexion Windows.
   - **Isolation Wi-Fi (« AP/Client isolation »)** : certains routeurs ou
     hotspots bloquent volontairement la communication entre appareils
     connectés, même sur le même réseau. Si tout le reste est correct et
     que ça ne fonctionne toujours pas, c'est probablement ça — il faut
     désactiver cette option dans les paramètres du routeur/hotspot (pas
     modifiable depuis le jeu).

## Déroulé d'une partie

1. **Page d'accueil** : indique le nom des deux joueurs, choisis la taille
   du plateau (4×6, 5×6, 6×6 ou 7×6), puis sélectionne soit un dossier
   d'images, soit une archive `.zip` contenant les portraits. Le nom de
   chaque suspect est le nom du fichier (sans l'extension), par exemple
   `Jean.jpg` → « Jean ». S'il manque des portraits par rapport au nombre
   de cases requises, un message l'indique.
2. Clique sur **« Constituer le dossier »** puis **« Lancer la partie »**.
   Deux liens apparaissent : ouvre-les sur les deux appareils/onglets, un
   par joueur (les deux plateaux sont générés aléatoirement et de façon
   indépendante, et se redimensionnent automatiquement pour tenir sur
   l'écran).
3. Sur chaque plateau, clique sur **« Choix »** : un personnage est tiré au
   sort et affiché à gauche — c'est le personnage que l'autre joueur devra
   deviner. Il reste privé, seul le joueur concerné le voit sur sa page.
4. Une fois les deux choix faits, un décompte de 3 secondes démarre sur les
   deux pages, puis le joueur désigné au hasard commence. Le plateau de
   l'autre joueur est verrouillé pendant ce temps.
5. Le joueur actif peut sélectionner plusieurs cases (clic multiple) puis
   cliquer sur **« Éliminer »** pour les griser d'un coup (ou les
   restaurer). Le bouton **« Fin du tour »** demande une confirmation avant
   de passer la main à l'adversaire.
6. À partir de la fin du 6ᵉ tour, le bouton **« Proposer un suspect »**
   apparaît. En cliquant dessus, le joueur actif passe en mode sélection :
   il clique sur un suspect encore actif du plateau, confirme sa
   proposition, puis le serveur vérifie. Bonne réponse = victoire ; mauvaise
   réponse = la main passe à l'adversaire. Le joueur peut décocher ce mode à
   tout moment pour revenir à l'élimination normale.

## Notes techniques

- Le serveur garde l'état de la partie en mémoire (une seule partie à la
  fois) — parfait pour une utilisation locale à deux joueurs, sur le même
  ordinateur ou sur deux appareils reliés au même réseau.
- Les images acceptées : `.png .jpg .jpeg .gif .webp .bmp`.
- Les pages interrogent le serveur toutes les secondes pour rester
  synchronisées entre les deux plateaux.
