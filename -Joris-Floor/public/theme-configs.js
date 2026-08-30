/**
 * ============================================================
 *  CONFIGURATION DES THÈMES - joueur.html / arbitre.html
 * ============================================================
 *
 * Chaque thème correspond à une valeur possible du paramètre
 * d'URL "theme". Exemple :
 *
 *    joueur.html?theme=pirates
 *    joueur.html?theme=dragons
 *    joueur.html?theme=desserts   (thème par défaut)
 *
 * Si le paramètre ?theme=... est absent, invalide, ou que le
 * thème demandé n'existe pas dans cet objet, la page retombe
 * automatiquement sur "desserts".
 *
 * DÉTECTION AUTOMATIQUE DES FICHIERS :
 * Il n'est plus nécessaire de lister les fichiers un par un.
 * Il suffit d'indiquer le "folder" (dossier) du thème : le
 * serveur local scanne ce dossier et détecte automatiquement
 * tout ce qu'il contient. Déposez ou retirez des fichiers du
 * dossier à tout moment, sans jamais retoucher ce fichier.
 *
 * DEUX TYPES DE THÈME :
 *   - Images (par défaut) : .jpg, .jpeg, .png, .gif, .webp
 *   - Audio : ajoutez "mediaType: 'audio'" au thème ; les
 *     fichiers .mp3/.wav/.ogg du dossier seront alors détectés.
 *     Le son se joue automatiquement une seule fois côté page
 *     Joueur (pas de contrôle ni de réécoute) ; côté page
 *     Arbitre, un lecteur avec contrôles reste disponible pour
 *     vérifier la réponse.
 *
 * STRUCTURE DE DOSSIERS RECOMMANDÉE :
 *
 *   /public/
 *       /theme-configs.js
 *       /Images/
 *           /Desserts/
 *               Baba au rhum.png
 *               Canneles.png
 *               ...
 *           /pirates/
 *               bateau.jpg
 *               tresor.jpg
 *               ...
 *           /dragons/
 *               dragon1.jpg
 *               ...
 *       /Audio/
 *           /langues-etrangeres/
 *               allemand.mp3
 *               espagnol.mp3
 *               ...
 *
 * POUR AJOUTER UN NOUVEAU THÈME IMAGE :
 *   1. Créez un sous-dossier dans "Images/" avec le nom du thème
 *   2. Déposez-y vos images (jpg/png/gif/webp)
 *   3. Copiez un bloc ci-dessous, changez juste la clé, "name",
 *      "displayName" et "folder"
 *   4. La page sera accessible via ?theme=VOTRE_CLE
 *   5. Côté page Arbitre, cliquez sur "🔄 Actualiser le thème"
 *      pour aller chercher les fichiers de ce nouveau dossier
 *
 * POUR AJOUTER UN NOUVEAU THÈME AUDIO :
 *   Mêmes étapes, mais dans "Audio/" et en ajoutant
 *   "mediaType: 'audio'" au bloc (voir "langues-etrangeres"
 *   ci-dessous comme exemple)
 */

window.themeConfigs = {

  // ---------- THÈME PAR DÉFAUT ----------
  desserts: {
    name: 'desserts',
    displayName: 'Desserts',
    folder: 'Images/Desserts/',
    // Plus besoin de lister les fichiers ici : ils sont
    // détectés automatiquement depuis le dossier ci-dessus.
    sounds: {
      bip: 'bip.mp3'
      // Remarque : les sons de victoire "Assaillant.mp3" et
      // "defenseur.mp3" sont communs à tous les thèmes et
      // n'ont pas besoin d'être redéfinis ici.
    }
  },

  // ---------- EXEMPLE DE THÈME 1 ----------
  pirates: {
    name: 'pirates',
    displayName: 'Pirates',
    folder: 'Images/pirates/',
    sounds: {
      bip: 'bip.mp3'
    }
  },

  // ---------- EXEMPLE DE THÈME 2 ----------
  dragons: {
    name: 'dragons',
    displayName: 'Dragons',
    folder: 'Images/dragons/',
    sounds: {
      bip: 'bip.mp3'
    }
  },

  // ---------- DRAPEAUX DU MONDE ----------
  drapeaux: {
    name: 'drapeaux',
    displayName: 'Drapeaux du monde',
    folder: 'Images/drapeaux/',
    sounds: {
      bip: 'bip.mp3'
    }
  },

  // ---------- THÈMES DE Theme.html ----------
  // (générés automatiquement à partir des 15 thématiques du tirage ;
  // créez le dossier Images/<clé>/ correspondant et déposez-y vos
  // images — la liste sera détectée automatiquement)

  'langues-etrangeres': {
    name: 'langues-etrangeres',
    displayName: 'Langues étrangères',
	description: 'Identifier la langue parlée',
    folder: 'Images/Langues-etrangeres/',
    sounds: { bip: 'bip.mp3' }
  },
  'series': {
    name: 'series',
    displayName: 'Génériques de séries',
    mediaType: 'audio',
	description: 'Trouver la série associée à ce générique',
    folder: 'Audio/Series/',
    sounds: { bip: 'bip.mp3' },
	timerDuration: 60000
  },
  sports: {
    name: 'sports',
    displayName: 'Sports',
	description: 'Quel est ce sport ?',
    folder: 'Images/Sports/',
    sounds: { bip: 'bip.mp3' }
  },
   desserts: {
    name: 'desserts',
    displayName: 'Desserts et Patisseries',
	description: 'Comment se nomme ce dessert ou pâtisserie ?',
    folder: 'Images/Desserts/',
    sounds: { bip: 'bip.mp3' }
  },
    drapeaux: {
    name: 'drapeaux',
    displayName: 'Drapeaux du monde',
	description: 'A quel pays appartient ce drapeau ?',
    folder: 'Images/Drapeaux/',
    sounds: { bip: 'bip.mp3' }
  },
  disney: {
    name: 'disney',
    displayName: 'Personnages Disney',
	description: 'Identifier le personnage de Disney',
    folder: 'Images/Disney/',
    sounds: { bip: 'bip.mp3' }
  },
  mammiferes: {
    name: 'mammiferes',
    displayName: 'Mammiferes',
	description: 'Quel est donc ce mammifère ?',
    folder: 'Images/Mammiferes/',
    sounds: { bip: 'bip.mp3' }
  },
    oiseaux: {
    name: 'oiseaux',
    displayName: 'Oiseaux',
	description: 'Comment s\'appelle cet oiseau ?',
    folder: 'Images/Oiseaux/',
    sounds: { bip: 'bip.mp3' }
  },
    insectes: {
    name: 'insectes',
    displayName: 'Insectes et petites bêtes',
	description: 'Trouver le nom de cette betite bête',
    folder: 'Images/Insectes/',
    sounds: { bip: 'bip.mp3' }
  },
  'transport': {
    name: 'transport',
    displayName: 'Moyens de transport',
	description: 'Identifier ce moyen de transport',
    folder: 'Images/Transport/',
    sounds: { bip: 'bip.mp3' }
  },
  monnaies: {
    name: 'monnaies',
    displayName: 'Monnaies du monde',
	description: 'Quel pays utilise cette monnaie ?',
    folder: 'Images/Monnaies/',
    sounds: { bip: 'bip.mp3' }
  },
  instruments: {
    name: 'instruments',
    displayName: 'Instruments de musique',
	description: 'Identifier cet instrument de musique',
    folder: 'Images/Instruments/',
    sounds: { bip: 'bip.mp3' }
  },
  fruits: {
    name: 'fruits',
    displayName: 'Fruits',
	description: 'Comment s\'appelle ce fruit ?',
    folder: 'Images/Fruits/',
    sounds: { bip: 'bip.mp3' }
  },
  logos: {
    name: 'logos',
    displayName: 'Logos de marques',
	description: 'Identifier la marque associée à ce logo',
    folder: 'Images/Logos/',
    sounds: { bip: 'bip.mp3' }
  },
  geographie: {
    name: 'geographie',
    displayName: 'Géographie',
	description: 'Quel est ce pays ?',
    folder: 'Images/Geographie/',
    sounds: { bip: 'bip.mp3' }
  },
  cinema: {
    name: 'cinema',
    displayName: 'Cinéma',
	mediaType: 'audio',
	description: 'Comment s\'appelle ce film ?',
    folder: 'Audio/Cinema/',
    sounds: { bip: 'bip.mp3' },
	timerDuration: 60000
  },
  legumes: {
    name: 'legumes',
    displayName: 'Légumes',
	description: 'Identifier ce légume ou aromate',
    folder: 'Images/Legumes/',
    sounds: { bip: 'bip.mp3' }
  },

  // ---------- NOUVEAUX THÈMES ----------

  'poissons-marins': {
    name: 'poissons-marins',
    displayName: 'Poissons et animaux marins',
	description: 'Comment s\'appelle cet animal marin ?',
    folder: 'Images/Poissons-marins/',
    sounds: { bip: 'bip.mp3' }
  },
  'arbres-feuilles': {
    name: 'arbres-feuilles',
    displayName: 'Arbres et feuilles',
	description: 'Identifier cet arbre ou plante',
    folder: 'Images/Arbres-feuilles/',
    sounds: { bip: 'bip.mp3' }
  },
  'cris-animaux': {
    name: 'cris-animaux',
    displayName: 'Cris d\'animaux',
    mediaType: 'audio',
	description: 'Quel animal pousse ce cri ?',
    folder: 'Audio/Cris/',
    sounds: { bip: 'bip.mp3' },
	timerDuration: 60000
  },
  pokemon: {
    name: 'pokemon',
    displayName: 'Pokémon',
	description: 'Comment s\'appelle ce Pokemon ?',
    folder: 'Images/Pokemon/',
    sounds: { bip: 'bip.mp3' }
  },
  pixar: {
    name: 'pixar',
    displayName: 'Personnages Pixar',
	description: 'Identifier ce personnages de Pixar',
    folder: 'Images/Pixar/',
    sounds: { bip: 'bip.mp3' }
  },
  'jeux-video': {
    name: 'jeux-video',
    displayName: 'Personnages de jeux vidéo',
	description: 'Comment se nomme ce personnage de jeux vidéo ?',
    folder: 'Images/Jeux-video/',
    sounds: { bip: 'bip.mp3' }
  },
  legende: {
    name: 'legende',
    displayName: 'Personnages des légendes',
	description: 'Identifier le nom de ce personnage des mythes et légendes',
    folder: 'Images/Legende/',
    sounds: { bip: 'bip.mp3' }
  },
  'dessins-animes': {
    name: 'dessins-animes',
    displayName: 'Génériques de dessins animés',
    mediaType: 'audio',
	description: 'Quel est le nom de ce dessin animé ?',
    folder: 'Audio/Dessins-animes/',
    sounds: { bip: 'bip.mp3' },
	timerDuration: 60000
  },
  'accents-langues': {
    name: 'accents-langues',
    displayName: 'Accents et langues parlées',
    mediaType: 'audio',
	description: 'Quelle est cette langue ?',
    folder: 'Audio/Accents-langues/',
    sounds: { bip: 'bip.mp3' },
	timerDuration: 60000
  },
  'vehicules': {
    name: 'vehicules',
    displayName: 'Marques de véhicules',
	description: 'Identifier cette marque de véhicules',
    folder: 'Images/Vehicules/',
    sounds: { bip: 'bip.mp3' }
  },
  bricolage: {
    name: 'bricolage',
    displayName: 'Outils de bricolage',
	description: 'Comment ce nomme cet outil ?',
    folder: 'Images/Bricolage/',
    sounds: { bip: 'bip.mp3' }
  },
  'jeux-societe': {
    name: 'jeux-societe',
    displayName: 'Jeux de société',
	description: 'Identifier ce jeu de société',
    folder: 'Images/Jeux-societe/',
    sounds: { bip: 'bip.mp3' }
  },
  metiers: {
    name: 'metiers',
    displayName: 'Métiers',
	description: 'Quel est ce métier ?',
    folder: 'Images/Metiers/',
    sounds: { bip: 'bip.mp3' }
  },
  dieux: {
    name: 'dieux',
    displayName: 'Dieux mythologiques',
	description: 'Quel dieu mythologique est représenté ?',
    folder: 'Images/Dieux/',
    sounds: { bip: 'bip.mp3' }
  },
  meubles: {
    name: 'meubles',
    displayName: 'Meubles',
	description: 'Identifier le meuble présenté',
    folder: 'Images/Meubles/',
    sounds: { bip: 'bip.mp3' }
  },
  personnages: {
    name: 'personnages',
    displayName: 'Personnages populaires',
	description: 'Comment se nomme ce personnage popuplaire ?',
    folder: 'Images/Personnages/',
    sounds: { bip: 'bip.mp3' }
  }

  // Ajoutez d'autres thèmes ici en suivant le même modèle...
};