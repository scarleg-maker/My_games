# Tuto — Créateur de cartes Triple Triad

Ce guide te fait créer une carte complète du début à la fin, en partant de zéro.

## 0. Ouvrir l'outil

Double-clique sur `tools/card-creator/index.html`. Ton navigateur s'ouvre avec :
- **À gauche** : l'aperçu de ta carte (sur fond à damier gris = zones transparentes)
- **À droite** : tous les réglages, organisés en blocs numérotés 1 à 6

Les 3 cadres (Normal/Rare/As) sont **déjà chargés automatiquement** — tu devrais voir 3 vignettes en haut à droite, avec "Normal" entouré en doré (= actif par défaut).

---

## 1. Choisir le cadre (bloc "1. Cadre")

Clique simplement sur la vignette **"Rare"** ou **"As"** si tu veux changer — le cadre entouré en doré est celui utilisé sur l'aperçu à gauche. Pour l'instant, laisse "Normal" sélectionné.

👉 **À ce stade, l'aperçu à gauche doit déjà afficher le cadre noir avec le contour blanc**, sans rien à l'intérieur (transparent). Si tu ne vois rien du tout, vérifie que tu as bien ouvert `index.html` en double-clic (pas juste glissé dans un onglet vide).

---

## 2. Nom, niveau et valeurs (blocs "2" et "3")

Dans le bloc **"2. Nom de la carte"** :
- Tape un nom, ex: `Bogomile`
- Laisse la police et la taille par défaut pour l'instant

Dans le bloc **"3. Valeurs"** :
- Mets 4 chiffres, ex: Haut=`6`, Droite=`2`, Bas=`6`, Gauche=`3`

👉 **À ce stade, tu dois voir "Bogomile" écrit en haut de la carte, et les 4 chiffres en haut à gauche.** Si rien n'apparaît, regarde le point "Ça ne s'affiche pas" en bas de ce guide.

Dans le bloc **"4. Niveau"** :
- Mets `1` (ou n'importe quel niveau 1 à 10)

👉 Un petit chiffre doit apparaître dans l'ovale en bas de la carte.

---

## 3. Ajouter ton illustration (bloc "6. Illustration") — **l'étape qui bloque le plus souvent**

C'est ici que 90% des galères viennent. Voici la marche à suivre précise :

1. Clique sur **"Choisir un fichier"** (sous "6. Illustration") et sélectionne ton image (le monstre/personnage que tu as trouvé).
2. **Ton image doit apparaître immédiatement** dans l'aperçu, au centre de la carte (souvent trop grande ou mal cadrée au départ, c'est normal).
3. Utilise les curseurs pour ajuster :
   - **Position X** et **Position Y** : déplacent ton image dans la carte (50% = centré)
   - **Taille** : agrandit/réduit ton image (100% = taille "naturelle" dans la zone, 115% par défaut pour éviter les coins vides)
   - **Rotation** : si ton image est de travers

**Astuce essentielle** : ne touche **pas** aux curseurs "Zone X/Y/largeur/hauteur" — ils sont déjà calés correctement sur les 3 cadres fournis. Ce sont juste les curseurs **Position X/Y/Taille** (les 3 premiers) que tu dois bouger pour cadrer ton image.

👉 Si ton image ne bouge pas du tout quand tu touches les curseurs → vérifie que tu as bien importé une image à l'étape 1 de cette section (un fichier doit être sélectionné, pas juste le champ vide).

---

## 4. Élément (optionnel, bloc "5")

Si ta carte a un élément (feu, glace...), importe une icône ici de la même façon, puis ajuste sa position/taille avec les curseurs. Sinon, ignore complètement ce bloc.

---

## 5. Télécharger ta carte

En haut à gauche, sous l'aperçu :
1. Tape un nom de fichier dans le champ (ex: `bogomile`)
2. Clique sur **"⬇️ Télécharger le PNG"**

- **Sur Chrome/Edge** : une fenêtre "Enregistrer sous" s'ouvre → choisis ton dossier (idéalement directement `public/images/cards/` de ton projet) → Enregistrer.
- **Sur Firefox/Safari** : le fichier part automatiquement dans ton dossier de téléchargements habituel (pas de choix de dossier possible, limitation du navigateur).

---

## Problèmes fréquents

**"Rien ne s'affiche du tout, même pas le cadre noir"**
→ Le fichier a été ouvert autrement qu'en double-clic (ex: glissé dans un onglet déjà ouvert sur un autre site). Ferme l'onglet et redouble-clique sur `index.html`.

**"Mon image ne se met pas à jour quand je bouge les curseurs"**
→ Vérifie que tu as bien cliqué sur "Choisir un fichier" dans le bloc **6. Illustration** (pas un autre bloc) et qu'un nom de fichier apparaît à côté du bouton.

**"Le nom/niveau se superpose bizarrement au cadre"**
→ Descends dans le bloc concerné et ajuste le curseur "Position Y" (pour le nom) ou "Position X/Y" (pour le niveau) de quelques %.

**"Le bouton Télécharger ne fait rien"**
→ Vérifie que le champ nom de fichier n'est pas vide, et regarde si une fenêtre de sauvegarde s'est ouverte *derrière* ta fenêtre de navigateur (ça arrive parfois).

**"J'ai des coins blancs/vides autour de mon illustration"**
→ Augmente légèrement le curseur "Taille" de l'illustration (essaie 130-150%) : la silhouette de carte a des coins arrondis, une image un peu plus grande que 100% comble ce vide naturellement.

**"Mes réglages ont disparu en rouvrant l'outil"**
→ Normal pour les **images** (à réimporter à chaque session), mais les **curseurs/textes** doivent rester mémorisés. Si même ça a disparu, ton navigateur bloque peut-être le stockage local en navigation privée.

---

Si un point précis te bloque encore après ce guide, dis-moi exactement à quelle étape et ce que tu vois (ou ne vois pas) à l'écran, je creuse avec toi.
