# Qui est-ce ? — jeu en salons, Python/Flask

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

## Les salons : plusieurs parties en même temps

Le serveur peut héberger **plusieurs parties indépendantes en parallèle**,
chacune dans son propre « salon », identifié par un code court (ex. `6GT7`
ou un code personnalisé comme `FAMILLE`). Deux groupes peuvent jouer en même
temps sur le même serveur sans se gêner.

- **Page d'accueil (`/`)** : « Créer un salon » génère un code aléatoire (ou
  tu peux choisir le tien dans « Choisir mon propre code ») ; « Rejoindre un
  salon » permet d'entrer un code existant puis de choisir sa place (Joueur
  1 ou Joueur 2).
- Un salon créé devient accessible à l'adresse **`/<CODE>`** (page de
  préparation), et les plateaux à **`/<CODE>/joueur1`** et
  **`/<CODE>/joueur2`**.
- Sur la page de préparation, une fois la partie lancée, un **QR code**
  apparaît pour inviter le 2ᵉ joueur : il n'a qu'à le scanner avec son
  téléphone pour arriver directement sur son plateau, sans taper d'adresse.
  Un bouton « Copier le lien » fait la même chose si le QR code ne
  s'affiche pas (connexion internet indisponible sur le PC, par exemple).
- Un salon sans activité depuis **6 heures** est automatiquement supprimé
  (ses images aussi), pour ne pas accumuler des parties abandonnées.
- Le bouton **« Nouvelle enquête (même salon) »**, affiché à la fin d'une
  partie, repart directement sur la page de préparation du même salon — pas
  besoin de recréer un code pour rejouer avec les mêmes personnes.

## Jouer avec une tablette ou un smartphone (2e joueur)

Le serveur tourne sur le PC, mais chaque appareil peut ouvrir sa propre
page de plateau dans un navigateur — y compris une tablette ou un
smartphone, à condition qu'il soit **sur le même réseau** que le PC (ou
que le jeu soit déployé en ligne, voir plus bas).

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
3. Sur le PC (joueur 1), crée un salon et prépare la partie. Une fois lancée,
   reste sur `/<CODE>/joueur1`, ou ouvre ce lien manuellement.
4. Sur la tablette (joueur 2) : **le plus simple est de scanner le QR code**
   affiché sur la page de préparation. Sinon, ouvre le navigateur sur
   l'adresse affichée à l'étape 2, suivie de `/<CODE>/joueur2`, par exemple :
   `http://192.168.1.42:5000/ABCD/joueur2`
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

## Déployer sur Render (alternative au réseau local)

Héberger le jeu sur Render évite tous les soucis de réseau local / pare-feu
ci-dessus : les deux joueurs se connectent simplement à une URL publique,
quel que soit leur réseau — et grâce aux salons, plusieurs groupes peuvent
jouer en même temps sur le même déploiement.

1. Mets le dossier du projet dans un dépôt Git (GitHub, GitLab...).
2. Sur [render.com](https://render.com), crée un **New Web Service** et
   connecte ce dépôt.
3. Renseigne :
   - **Build Command** : `pip install -r requirements.txt`
   - **Start Command** : `gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4`

   (ces valeurs sont aussi dans le `Procfile` fourni — Render peut les
   détecter automatiquement, mais les renseigner à la main dans le
   dashboard fonctionne toujours).
4. Une fois déployé, Render donne une URL publique du type
   `https://qui-est-ce-xxxx.onrender.com`. Chacun va sur cette adresse,
   crée ou rejoint un salon, comme en local.

**Important : garde `--workers 1`.** Tous les salons sont gardés en mémoire
par le serveur (pas de base de données) ; avec plusieurs workers, les
joueurs d'un même salon pourraient être répartis sur des processus
différents qui ne partagent pas le même état, et le jeu se
désynchroniserait. Le paramètre `--threads 4` permet quand même de gérer
plusieurs requêtes en parallèle (utile puisque chaque page interroge le
serveur chaque seconde) sans avoir besoin de plusieurs workers.

Un `package.json` n'est pas nécessaire : ce projet n'utilise aucune
dépendance Node.js, et Render (comme Railway) détecte un projet Python via
`requirements.txt`. En ajouter un pourrait même perturber la détection
automatique de certaines plateformes.

## Déroulé d'une partie

1. **Page d'accueil** : crée un salon (ou rejoins-en un avec son code).
2. **Page de préparation du salon** : indique le nom des deux joueurs,
   choisis la taille du plateau (4×6, 5×6, 6×6 ou 7×6), puis sélectionne
   soit un dossier d'images, soit une archive `.zip` contenant les
   portraits. Le nom de chaque suspect est le nom du fichier (sans
   l'extension), par exemple `Jean.jpg` → « Jean ». S'il manque des
   portraits par rapport au nombre de cases requises, un message l'indique.
3. Clique sur **« Constituer le dossier »** puis **« Lancer la partie »**.
   Deux liens et un QR code apparaissent : ouvre-les sur les deux
   appareils/onglets, un par joueur (les deux plateaux sont générés
   aléatoirement et de façon indépendante, et se redimensionnent
   automatiquement pour tenir sur l'écran).
4. Sur chaque plateau, clique sur **« Choix »** : un personnage est tiré au
   sort et affiché à gauche — c'est le personnage que l'autre joueur devra
   deviner. Il reste privé, seul le joueur concerné le voit sur sa page.
5. Une fois les deux choix faits, un décompte de 3 secondes démarre sur les
   deux pages, puis le joueur désigné au hasard commence. Le plateau de
   l'autre joueur est verrouillé pendant ce temps.
6. Le joueur actif peut sélectionner plusieurs cases (clic multiple) puis
   cliquer sur **« Éliminer »** pour les griser d'un coup (ou les
   restaurer). Le bouton **« Fin du tour »** demande une confirmation avant
   de passer la main à l'adversaire.
7. À partir de la fin du 6ᵉ tour, le bouton **« Proposer un suspect »**
   apparaît. En cliquant dessus, le joueur actif passe en mode sélection :
   il clique sur un suspect encore actif du plateau, confirme sa
   proposition, puis le serveur vérifie. Bonne réponse = victoire ; mauvaise
   réponse = la main passe à l'adversaire. Le joueur peut décocher ce mode à
   tout moment pour revenir à l'élimination normale.
8. À la fin, « Nouvelle enquête (même salon) » relance une partie dans le
   même salon ; « Retour à l'accueil » permet de créer ou rejoindre un
   autre salon.

## Notes techniques

- Chaque salon garde son état de partie en mémoire, indépendamment des
  autres — plusieurs groupes peuvent jouer simultanément sur le même
  serveur. Un salon inactif depuis 6h est automatiquement supprimé.
- Les images acceptées : `.png .jpg .jpeg .gif .webp .bmp`.
- Les pages interrogent le serveur toutes les secondes pour rester
  synchronisées entre les deux plateaux d'un même salon.
- Le QR code est généré côté navigateur via la librairie `qrcodejs`
  (chargée depuis `cdnjs.cloudflare.com`) : une connexion internet est
  nécessaire sur l'appareil qui affiche la page de préparation pour que le
  QR code s'affiche (le reste du jeu fonctionne entièrement hors ligne, en
  réseau local).
