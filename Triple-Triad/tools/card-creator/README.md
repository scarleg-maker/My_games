# Créateur de cartes — Triple Triad

Outil autonome, 100% local (aucune connexion internet requise, rien n'est envoyé nulle part). Compose une
image de carte complète (cadre + illustration + nom + valeurs + niveau + élément) et l'exporte en PNG
transparent, prêt à l'emploi dans `data/cards_ffviii.json` (ou tout autre `data/cards_<votre_set>.json`).

## Utilisation

1. Ouvrez `index.html` directement dans votre navigateur (double-clic, aucun serveur nécessaire).
2. **1. Cadre** : les 3 cadres fournis (Normal / Rare / As) se chargent **automatiquement** à
   l'ouverture — cliquez simplement sur celui que vous voulez utiliser pour la carte en cours. Vous
   pouvez remplacer n'importe lequel par votre propre image via son bouton d'import, si besoin.
3. **2. Nom** : texte, police (menu déroulant), taille et couleur au choix.
4. **3. Valeurs** : les 4 chiffres (Haut/Droite/Bas/Gauche, 1 à 10) — **la valeur 10 s'affiche
   automatiquement "A"**, comme dans le jeu.
5. **4. Niveau** : le niveau de la carte (1 à 10, "A" pour 10 également), positionnable indépendamment
   des valeurs.
6. **5. Élément** *(optionnel)* : cliquez sur l'une des 8 icônes fournies (Feu, Glace, Foudre, Eau, Vent,
   Terre, Poison, Sacré), déjà chargées automatiquement — ou importez la vôtre en dessous si besoin.
   Positionnable, taille et rotation réglables.
7. **6. Illustration** : votre image trouvée. Ajustez position (X/Y), taille et **rotation**. La "zone de
   rognage" délimite la fenêtre visible (déjà calée sur la zone transparente réelle des 3 cadres fournis).
8. Cliquez **"Télécharger le PNG"** : sur Chrome/Edge, une vraie boîte de dialogue **"Enregistrer sous"**
   s'ouvre, vous laissant choisir le dossier et le nom du fichier. Sur Firefox/Safari (API non
   disponible côté navigateur), le fichier part directement dans votre dossier de téléchargements
   habituel.

## Les 3 cadres fournis

`sample-frame-normal.png`, `sample-frame-rare.png`, `sample-frame-as.png` sont vos cadres originaux,
**nettoyés** : le nom d'exemple ("PAWPA"/"ALEXANDER"/"WARD") et le chiffre de niveau d'exemple
(3/9/10) ont été retirés (leur ovale est désormais vide), pour que le nom et le niveau générés
dynamiquement par l'outil ne se superposent jamais à un texte déjà présent dans l'image. Le contour et le
décor de chaque cadre sont intégralement préservés.

## Astuce : éviter les coins vides sur l'illustration

La silhouette d'une carte n'est pas un rectangle parfait (coins arrondis, bandeau du nom qui mord sur le
haut). Une illustration réglée à exactement 100% peut donc laisser un léger espace vide dans ces coins.
La taille par défaut (115%) évite ce problème — augmentez-la encore si besoin selon votre image.

## Rendu en temps réel

L'aperçu se met à jour instantanément à chaque réglage (curseur, texte, couleur...), y compris avec de
grandes images sources : les mises à jour sont regroupées via `requestAnimationFrame` pour rester fluides
même en cas de réglages rapides successifs.

## Mémorisation automatique

Tous les réglages numériques (positions, tailles, rotations, polices, couleurs) sont mémorisés dans ce
navigateur d'une carte à l'autre — seules les images personnalisées (illustration, élément, ou un cadre
que vous remplaceriez) doivent être réimportées à chaque nouvelle carte. Bouton "↺ Réinitialiser" pour
tout effacer.

## Polices personnalisées ("Medieval Scribish", "E-BrantScript"...)

Ces polices sont ajoutées à la liste déroulante, mais elles ne s'afficheront correctement que si elles
sont **installées sur le système d'exploitation** de la personne qui ouvre l'outil (ce sont des polices
système, pas intégrées au fichier HTML). Si tu changes d'ordinateur ou partages l'outil avec quelqu'un
d'autre, la police ne s'appliquera pas tant qu'elle n'est pas installée là-bas aussi — le nom retombera
silencieusement sur une police par défaut du navigateur.

**Pour une fiabilité garantie sur n'importe quelle machine** (y compris rendre l'outil portable sans
dépendre de polices installées), envoie-moi directement les fichiers de police (`.ttf`/`.otf`) : je peux
les intégrer directement dans le projet via `@font-face`, ce qui les fera fonctionner à coup sûr, même
sur un ordinateur où elles ne sont pas installées.
