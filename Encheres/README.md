# Jeu des Enchères

Tout est regroupé dans **ce seul dossier**. La page `Jeu_des_Encheres.html` est le point d'entrée
unique : c'est elle qui permet de choisir le mode de jeu, **🅱️ Enchères décalées** ou
**🅰️ Temps réel**, en haut de l'écran de réglages (avant même le nombre de joueurs, l'argent de
départ, etc.).

## Fichiers

- `Jeu_des_Encheres.html` — page principale (réglages + sélecteur de mode + jeu)
- `joueur.html` — page ouverte par chaque joueur sur son propre appareil, uniquement utile en mode A
- `shared.css` — styles de `joueur.html`
- `server.js` — serveur Node.js, uniquement nécessaire pour le mode A
- `package.json` — dépendances du serveur (Express, Socket.IO)
- `Lancer_Encheres.bat` — raccourci Windows : installe si besoin et démarre le serveur du mode A,
  puis ouvre la page maître automatiquement

## Mode 🅱️ Enchères décalées (local, sans serveur)

Double-cliquez simplement sur `Jeu_des_Encheres.html`. Choisissez le mode "Enchères décalées"
(coché par défaut) et jouez comme avant : un seul écran, un maître qui enregistre les achats.

## Mode 🅰️ Temps réel (réseau, plusieurs appareils)

Ce mode nécessite [Node.js](https://nodejs.org/) et le petit serveur inclus dans ce dossier.

### Démarrage rapide (Windows)

Double-cliquez sur `Lancer_Encheres.bat` : il installe les dépendances si besoin, démarre le
serveur et ouvre automatiquement la page maître dans votre navigateur. Ne fermez pas la fenêtre
noire pendant la partie (elle fait tourner le serveur) ; la fermer arrête le serveur.

### Démarrage manuel

1. Installer les dépendances (une seule fois) :
   ```bash
   cd Jeu-des-Encheres
   npm install
   ```
2. Démarrer le serveur :
   ```bash
   npm start
   ```
   La console affiche :
   ```
   Maître  : http://localhost:5500/  (ou /maitre)
   Joueurs : http://<IP-de-ce-PC>:5500/joueur1  (jusqu'à /joueur8)
   ```
3. Sur l'ordinateur du **maître**, ouvrir `http://localhost:5500/` (ne pas double-cliquer sur le
   fichier HTML pour ce mode : la page doit être servie par le serveur).
4. Sur chaque téléphone/tablette **joueur**, connecté au **même réseau Wi‑Fi/local**, ouvrir
   l'adresse indiquée sur la page maître (voir étape 5), en remplaçant `localhost` par l'adresse
   IP locale du PC maître (ex. `192.168.1.23:5500/joueur1`) — trouvable via `ipconfig` (Windows)
   ou `ifconfig` / `ip a` (Mac/Linux). Si le joueur ouvre la page sur le **même PC** que le maître
   (test local), `localhost:5500/joueur1` fonctionne tel quel.
5. Sur la page maître, choisir le mode **🅰️ Temps réel** : dès que le nombre de joueurs est
   défini, un encart affiche des **liens cliquables** vers les pages joueurs
   (`localhost:5500/joueur1`, etc. — remplacez `localhost` par l'IP du PC maître pour les autres
   appareils), ainsi que les joueurs déjà connectés (Joueur 1 ✓ connecté, etc.), mis à jour en
   direct. Ces liens restent accessibles (repliables) une fois la partie lancée, en haut de
   l'écran de jeu.
6. Configurer la partie (nombre de joueurs, argent de départ, achats max, noms, images/.zip —
   **mêmes réglages que le mode B**), puis cliquer sur **"Lancer la partie"**.
7. La page maître affiche alors un bouton **"Lancer l'enchère"** : c'est le maître qui déclenche
   chaque image manuellement, une par une. Après avoir cliqué :
   - La mise démarre à **0 M pendant 10 secondes**.
   - Chaque joueur enchérit avec le montant de son choix parmi trois boutons : **+5 M**, **+10 M**
     ou **+20 M**. Dès qu'un joueur enchérit, les autres ont **5 secondes** pour surenchérir
     (le chrono repart à 5 s à chaque nouvelle enchère).
   - Si personne ne surenchérit après 5 s, l'image est **remportée par le plus offrant**.
   - Si **personne n'enchérit du tout** sur une image, **20 M sont retirés à chaque joueur**
     (comme "Passer l'image" en mode B).
   - À tout moment pendant une manche active, le maître peut cliquer sur **"Passer sans
     pénalité"** pour annuler l'image en cours : personne ne la remporte, et **aucun argent
     n'est retiré**, même si des enchères étaient déjà en cours (contrairement au cas "personne
     n'a enchéri" qui coûte 20 M à chacun).
   - Le résultat de la manche s'affiche, puis le bouton devient **"Image suivante"** : c'est
     à nouveau le maître qui décide quand tirer l'image suivante.
   - La partie s'arrête automatiquement quand il n'y a plus d'images, quand tous les joueurs ont
     atteint leur nombre d'achats max, ou quand plus personne n'a de quoi enchérir (< 10 M).
8. Le bouton **"Nouvelle partie"** (disponible en fin de partie, en Mode A comme en Mode B)
   réinitialise entièrement la partie : joueurs, argent, images restantes, enchères et objets
   déjà achetés repartent à zéro, pour reconfigurer une nouvelle partie depuis le même écran.

## Miniatures des achats

Chaque objet acheté (par enchère remportée) s'affiche avec son nom et sa miniature, en grand
format et centrée :
- Sur la page **maître** (Mode A comme Mode B), dans la carte de chaque joueur.
- Sur la page de **chaque joueur** (Mode A), sous ses boutons d'enchère, au fur et à mesure de
  ses achats.

## Élimination finale (Mode A et Mode B)

À la fin de la partie (plus d'images, joueurs à leur maximum d'achats, etc.), la page **maître**
affiche un bouton **"Éliminer"** sur la carte de chaque joueur. Le maître clique pour éliminer les
joueurs un par un (par exemple pour départager selon la valeur des collections, ou tout autre
critère de son choix) jusqu'à ce qu'il n'en reste plus qu'un seul, qui est alors désigné
**🏆 vainqueur**. Cette étape est manuelle et se passe uniquement sur l'écran du maître.

## Notes

- Une seule partie en Mode A est active à la fois sur le serveur.
- Les images sont transmises aux joueurs via le serveur (pas besoin de les copier sur chaque
  appareil).
- Si un joueur rafraîchit sa page, il peut se reconnecter sur la même URL `/joueurN` : son état
  (argent, achats) est conservé côté serveur.
- Pour retrouver l'image de fond du marteau (mode B), copiez `Marteau.png` dans ce même dossier.
