# Créateur de cartes — Triple Triad

Outil autonome, 100% local (aucune connexion internet requise, rien n'est envoyé nulle part). Compose une
image de carte complète (cadre + illustration + nom + valeurs + niveau + élément) et l'exporte en PNG
transparent, prêt à l'emploi dans `data/cards_ffviii.json` (ou tout autre `data/cards_<votre_set>.json`).

## Ouverture rapide (Windows) — recommandé sur Opera GX

Double-cliquez sur **`Lancer_Card_Creator.bat`**. Il démarre un petit serveur local (nécessite Python,
déjà présent sur la plupart des PC ; sinon [python.org](https://python.org)) et ouvre l'outil automatiquement
dans votre navigateur par défaut à `http://localhost:8090`.

**Pourquoi c'est utile** : sur les navigateurs à base de Chromium (Chrome, Edge, **Opera GX**), la fenêtre
"Enregistrer sous" du bouton de téléchargement (qui laisse choisir le dossier de destination) ne
fonctionne correctement que si la page est servie via `http://...`, pas en ouverture directe du fichier
(`file://...`). Ce script règle ce point automatiquement, sans avoir à taper de commande dans PowerShell.

Pour arrêter le serveur, fermez simplement la fenêtre noire qui s'est ouverte.

*(Sur Firefox/Safari, ou si vous préférez, l'ouverture directe de `index.html` en double-clic reste tout
à fait fonctionnelle — juste sans le choix du dossier de destination au téléchargement.)*

## Utilisation

1. Ouvrez `index.html` directement dans votre navigateur (double-clic, aucun serveur nécessaire) — ou
   utilisez `Lancer_Card_Creator.bat` ci-dessus pour une expérience complète sur Opera GX/Chrome/Edge.
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

## Modifier une carte déjà créée (fichiers "projet")

Le PNG téléchargé est une image **aplatie** : impossible d'en extraire à nouveau le nom, les valeurs ou
la police pour les corriger. Pour pouvoir rouvrir une carte plus tard (nom faux, valeur à changer, ajout
d'un élément...), utilisez les deux boutons sous "Télécharger le PNG" :

- **💾 Sauvegarder le projet** : télécharge un fichier `<nom>.projet.json` contenant **tous les
  réglages** (nom, niveau, valeurs, police, positions, couleurs, cadre choisi) **et l'illustration
  elle-même** (encodée dans le fichier). Gardez ce fichier à côté de votre PNG exporté.
- **📂 Charger un projet** : sélectionnez un fichier `.projet.json` précédemment sauvegardé pour tout
  restaurer d'un coup — modifiez ce qu'il faut, puis réexportez le PNG.

**Astuce** : sauvegardez le fichier projet **à chaque fois** que vous exportez une carte définitive, même
si vous pensez ne plus y toucher — bien plus rapide qu'un recommencement de zéro si une correction s'avère
nécessaire plus tard (typo dans le nom, valeur mal recopiée...).

*(Le cadre n'est embarqué dans le fichier projet que si vous en avez importé un personnalisé à la main —
les 3 cadres fournis avec l'outil se rechargent de toute façon automatiquement à chaque ouverture, inutile
de les dupliquer dans chaque fichier projet.)*

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
