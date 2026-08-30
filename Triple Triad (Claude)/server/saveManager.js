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
    tournament: null, // progression de tournoi en cours (voir server/tournament.js)
  };
  writeSave(fresh);
  return fresh;
}

function writeSave(saveData) {
  const file = saveFilePath(saveData.name, saveData.set);
  fs.writeFileSync(file, JSON.stringify(saveData, null, 2), 'utf-8');
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
  setLastDeck,
  resetSave,
  deleteSave,
  importSave,
  addPoints,
  spendPoints,
};
