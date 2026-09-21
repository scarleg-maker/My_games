'use strict';
const fs = require('fs');
const path = require('path');
const sets = require('./sets');

const SAVES_ROOT = path.join(__dirname, '..', 'saves');
const STARTING_POINTS = 1000;

if (!fs.existsSync(SAVES_ROOT)) fs.mkdirSync(SAVES_ROOT, { recursive: true });

function sanitizeName(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40);
}

function sanitizeSet(setId) {
  return String(setId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40);
}

function setDir(setId) {
  const dir = path.join(SAVES_ROOT, sanitizeSet(setId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Format de stockage de save.collection : la liste des cartes possédées, compactée en
 * [{id, quantity}, ...] sur le disque (économise beaucoup d'espace dès qu'un joueur possède
 * plusieurs exemplaires d'une même carte). En mémoire, une fois chargée, la collection reste une
 * liste PLATE classique (un cardId par exemplaire possédé, doublons compris) : tout le reste du
 * code (shop, tournois, jalons, client...) continue de la manipuler exactement comme avant, sans
 * aucun changement. Seules loadOrCreateSave (à la lecture) et writeSave (à l'écriture) connaissent
 * ces deux fonctions de conversion.
 */
function expandCollection(raw) {
  if (!Array.isArray(raw)) return [];
  const flat = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      flat.push(entry); // ancien format (liste plate) : déjà une carte individuelle
    } else if (entry && entry.id) {
      const qty = Number(entry.quantity) || 0;
      for (let i = 0; i < qty; i++) flat.push(entry.id);
    }
  }
  return flat;
}

function compactCollection(flat) {
  const counts = new Map();
  for (const id of flat) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.entries()].map(([id, quantity]) => ({ id, quantity }));
}

function saveFilePath(name, setId) {
  return path.join(setDir(setId), `${sanitizeName(name)}.txt`);
}

function saveExists(name, setId) {
  return fs.existsSync(saveFilePath(name, setId));
}

/**
 * Charge la sauvegarde d'un joueur pour un set donné, ou en crée une nouvelle avec le deck de
 * départ de ce set si c'est sa toute première partie dans cet univers. Un même pseudo peut avoir
 * une progression totalement indépendante dans chaque set (fichiers séparés par dossier).
 */
function loadOrCreateSave(name, setId) {
  const starterDeck = sets.getStarterDeckForSet(setId);
  const file = saveFilePath(name, setId);
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf-8');
    const save = JSON.parse(raw);
    let changed = false;
    // Compatibilité ascendante / format de stockage : la collection est toujours étalée en liste
    // plate une fois chargée en mémoire, qu'elle vienne de l'ancien format (déjà plat) ou du nouveau
    // format compact [{id, quantity}] utilisé sur le disque.
    save.collection = expandCollection(save.collection);
    // Compatibilité ascendante : les sauvegardes créées avant l'ajout de "discovered"
    // reçoivent un historique reconstruit à partir de leur collection actuelle.
    if (!Array.isArray(save.discovered)) {
      save.discovered = [...new Set(save.collection)];
      changed = true;
    }
    // Compatibilité ascendante : les sauvegardes créées avant l'ajout des points de Commerce.
    if (typeof save.points !== 'number') {
      save.points = STARTING_POINTS;
      changed = true;
    }
    // Compatibilité ascendante : les sauvegardes créées avant l'ajout du Tournoi.
    if (!save.tournament) {
      save.tournament = null;
      changed = true;
    }
    if (!save.set) {
      save.set = setId;
      changed = true;
    }
    // Compatibilité ascendante : les sauvegardes créées avant l'ajout des déblocages (pass tournoi...).
    if (!Array.isArray(save.unlocks)) {
      save.unlocks = [];
      changed = true;
    }
    if (!Array.isArray(save.tournamentsWon)) {
      save.tournamentsWon = [];
      changed = true;
    }
    if (changed) writeSave(save);
    return save;
  }
  const fresh = {
    name: String(name).trim(),
    set: setId,
    createdAt: new Date().toISOString(),
    collection: [...starterDeck], // liste des cardId possédés (peut contenir des doublons)
    discovered: [...new Set(starterDeck)], // historique : tous les cardId un jour obtenus
    stats: { wins: 0, losses: 0, draws: 0 },
    lastDeck: [...starterDeck],
    points: STARTING_POINTS,
    unlocks: [], // identifiants des déblocages achetés (pass tournoi, accès combat niveau 9...)
    tournamentsWon: [], // ids des tournois de base remportés (déblocage en cascade Classique->Bronze->Argent->Or)
    tournament: null, // progression de tournoi en cours (voir server/tournament.js)
  };
  writeSave(fresh);
  return fresh;
}

function writeSave(saveData) {
  const file = saveFilePath(saveData.name, saveData.set);
  // La collection est stockée compactée [{id, quantity}] sur le disque pour économiser de l'espace,
  // mais l'objet EN MÉMOIRE (saveData, tel que détenu par l'appelant) garde sa liste plate intacte —
  // aucun des nombreux points du code qui manipulent save.collection n'a besoin de changer.
  const onDisk = { ...saveData, collection: compactCollection(saveData.collection) };
  fs.writeFileSync(file, JSON.stringify(onDisk, null, 2), 'utf-8');
  return saveData;
}

/** Ajoute des cartes gagnées à la collection (et à l'historique de découverte) et sauvegarde. */
function addCardsToSave(name, setId, cardIds) {
  const save = loadOrCreateSave(name, setId);
  save.collection.push(...cardIds);
  for (const id of cardIds) {
    if (!save.discovered.includes(id)) save.discovered.push(id);
  }
  return writeSave(save);
}

/** Retire des cartes perdues de la collection (une occurrence par id fourni). */
function removeCardsFromSave(name, setId, cardIds) {
  const save = loadOrCreateSave(name, setId);
  for (const id of cardIds) {
    const idx = save.collection.indexOf(id);
    if (idx !== -1) save.collection.splice(idx, 1);
  }
  return writeSave(save);
}

function recordResult(name, setId, result) {
  const save = loadOrCreateSave(name, setId);
  save.stats[result] = (save.stats[result] || 0) + 1;
  return writeSave(save);
}

/**
 * Retire N victoires ET N défaites en même temps des statistiques du joueur (menu "Profil joueur").
 * Permet d'améliorer volontairement son ratio victoires/défaites, au prix d'un total de victoires
 * plus bas (peut faire repasser sous un seuil de déblocage basé sur le nombre de victoires brut).
 * Refuse si removeCount dépasse les défaites OU les victoires actuelles (jamais de valeur négative).
 */
function adjustRatio(name, setId, removeCount) {
  const save = loadOrCreateSave(name, setId);
  const n = Math.floor(Number(removeCount));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('Le nombre à retirer doit être un entier positif.');
  }
  if (n > (save.stats.losses || 0)) {
    throw new Error(`Impossible de retirer ${n} défaite(s) : il n'y en a que ${save.stats.losses || 0}.`);
  }
  if (n > (save.stats.wins || 0)) {
    throw new Error(`Impossible de retirer ${n} victoire(s) : il n'y en a que ${save.stats.wins || 0}.`);
  }
  save.stats.wins -= n;
  save.stats.losses -= n;
  return writeSave(save);
}

/** Ajoute un identifiant de déblocage (pass tournoi, accès combat...) s'il n'est pas déjà présent. */
function addUnlock(name, setId, unlockKey) {
  const save = loadOrCreateSave(name, setId);
  if (!Array.isArray(save.unlocks)) save.unlocks = [];
  if (!save.unlocks.includes(unlockKey)) save.unlocks.push(unlockKey);
  return writeSave(save);
}

/** Retire un identifiant de déblocage (ex: combat niveau 9 consommé une fois la carte gagnée). */
function removeUnlock(name, setId, unlockKey) {
  const save = loadOrCreateSave(name, setId);
  save.unlocks = (save.unlocks || []).filter(u => u !== unlockKey);
  return writeSave(save);
}

/** Enregistre un tournoi de base comme remporté (déblocage en cascade du suivant). */
function addTournamentWin(name, setId, tournamentId) {
  const save = loadOrCreateSave(name, setId);
  if (!Array.isArray(save.tournamentsWon)) save.tournamentsWon = [];
  if (!save.tournamentsWon.includes(tournamentId)) save.tournamentsWon.push(tournamentId);
  return writeSave(save);
}

function setLastDeck(name, setId, deckCardIds) {
  const save = loadOrCreateSave(name, setId);
  save.lastDeck = deckCardIds;
  return writeSave(save);
}

/** Ajoute des points au solde du joueur (ex: récompense de victoire, vente de carte). */
function addPoints(name, setId, amount) {
  const save = loadOrCreateSave(name, setId);
  save.points = (save.points || 0) + amount;
  return writeSave(save);
}

/**
 * Débite des points si le solde est suffisant. Retourne la sauvegarde mise à jour,
 * ou lève une erreur si le solde est insuffisant.
 */
function spendPoints(name, setId, amount) {
  const save = loadOrCreateSave(name, setId);
  if ((save.points || 0) < amount) throw new Error('Points insuffisants.');
  save.points -= amount;
  return writeSave(save);
}

/** Remet la collection à zéro avec le deck de départ du set (conserve le nom, les stats, les points et l'historique). */
function resetSave(name, setId) {
  const starterDeck = sets.getStarterDeckForSet(setId);
  const save = loadOrCreateSave(name, setId);
  save.collection = [...starterDeck];
  save.lastDeck = [...starterDeck];
  for (const id of starterDeck) {
    if (!save.discovered.includes(id)) save.discovered.push(id);
  }
  return writeSave(save);
}

/** Supprime définitivement le fichier de sauvegarde d'un joueur pour ce set. */
function deleteSave(name, setId) {
  const file = saveFilePath(name, setId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
}

/**
 * Importe une sauvegarde fournie par le joueur (contenu d'un fichier .txt existant).
 * Valide la structure minimale avant d'écrire sur le disque. Le set d'import est celui
 * actuellement sélectionné côté client (le fichier lui-même ne "choisit" pas son dossier).
 */
function importSave(data, setId) {
  if (!data || typeof data !== 'object') throw new Error('Fichier de sauvegarde invalide.');
  if (!data.name || typeof data.name !== 'string') throw new Error('Le fichier ne contient pas de nom de joueur valide.');
  if (!Array.isArray(data.collection)) throw new Error('Le fichier ne contient pas de collection de cartes valide.');
  const cleanSave = {
    name: data.name.trim(),
    set: setId,
    createdAt: data.createdAt || new Date().toISOString(),
    collection: data.collection.filter(id => typeof id === 'string'),
    discovered: Array.isArray(data.discovered)
      ? [...new Set(data.discovered.filter(id => typeof id === 'string'))]
      : [...new Set(data.collection.filter(id => typeof id === 'string'))],
    stats: {
      wins: Number(data.stats?.wins) || 0,
      losses: Number(data.stats?.losses) || 0,
      draws: Number(data.stats?.draws) || 0,
    },
    lastDeck: Array.isArray(data.lastDeck) ? data.lastDeck : [],
    points: typeof data.points === 'number' ? data.points : STARTING_POINTS,
    unlocks: Array.isArray(data.unlocks) ? data.unlocks.filter(id => typeof id === 'string') : [],
    tournamentsWon: Array.isArray(data.tournamentsWon) ? data.tournamentsWon.filter(id => typeof id === 'string') : [],
    tournament: data.tournament || null,
  };
  return writeSave(cleanSave);
}

module.exports = {
  sanitizeName,
  saveExists,
  loadOrCreateSave,
  writeSave,
  addCardsToSave,
  removeCardsFromSave,
  recordResult,
  adjustRatio,
  addUnlock,
  removeUnlock,
  addTournamentWin,
  setLastDeck,
  resetSave,
  deleteSave,
  importSave,
  addPoints,
  spendPoints,
};
