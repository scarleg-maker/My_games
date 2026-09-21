'use strict';
const fs = require('fs');
const path = require('path');
const { ALL_CARDS } = require('./cardLoader');
const sets = require('./sets');

const REGISTRY_DIR = path.join(__dirname, '..', 'data');

function registryFile(setId) {
  return path.join(REGISTRY_DIR, `legendary-registry-${setId}.json`);
}

function getLegendaryCardIds(setId) {
  return sets.getCardsForSet(setId).filter(c => c.legendary).map(c => c.id);
}

function isLegendary(cardId) {
  const def = ALL_CARDS.find(c => c.id === cardId);
  return !!(def && def.legendary);
}

/**
 * Construit l'assignation initiale pour un set : chaque carte légendaire est détenue par le premier
 * adversaire de ce set (dans l'ordre de data/opponents*.json) dont le deck de base la contient.
 */
function buildInitialRegistry(setId) {
  const opponentsForSet = sets.getOpponentsForSet(setId);
  const registry = {};
  for (const cardId of getLegendaryCardIds(setId)) {
    let holder = null;
    outer:
    for (const tierData of opponentsForSet) {
      for (let i = 0; i < tierData.opponents.length; i++) {
        if (tierData.opponents[i].deck.includes(cardId)) {
          holder = { tier: tierData.tier, opponentIndex: i };
          break outer;
        }
      }
    }
    registry[cardId] = holder;
  }
  return registry;
}

const registryCache = new Map(); // setId -> registry object

function persist(setId) {
  fs.writeFileSync(registryFile(setId), JSON.stringify(registryCache.get(setId), null, 2), 'utf-8');
}

function loadRegistry(setId) {
  if (registryCache.has(setId)) return registryCache.get(setId);
  const file = registryFile(setId);
  let registry;
  if (fs.existsSync(file)) {
    try {
      registry = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      registry = buildInitialRegistry(setId);
    }
  } else {
    registry = buildInitialRegistry(setId);
  }
  // toute carte légendaire ajoutée depuis la dernière écriture du registre reçoit une entrée initiale
  const init = buildInitialRegistry(setId);
  let changed = false;
  for (const cardId of getLegendaryCardIds(setId)) {
    if (!(cardId in registry)) {
      registry[cardId] = init[cardId];
      changed = true;
    }
  }
  registryCache.set(setId, registry);
  if (changed || !fs.existsSync(file)) persist(setId);
  return registry;
}

function getHolder(setId, cardId) {
  const registry = loadRegistry(setId);
  return registry[cardId] || null;
}

/** Une carte légendaire vient d'être perdue par un joueur au profit d'un adversaire IA : elle migre chez lui. */
function setHolder(setId, cardId, tier, opponentIndex) {
  const registry = loadRegistry(setId);
  registry[cardId] = { tier, opponentIndex };
  persist(setId);
}

/** Une carte légendaire vient d'être gagnée par un joueur : elle quitte le "monde" des IA. */
function clearHolder(setId, cardId) {
  const registry = loadRegistry(setId);
  registry[cardId] = null;
  persist(setId);
}

function getHolderName(setId, cardId) {
  const holder = getHolder(setId, cardId);
  if (!holder) return null;
  const opponentsForSet = sets.getOpponentsForSet(setId);
  const tierData = opponentsForSet.find(t => t.tier === holder.tier);
  const opp = tierData && tierData.opponents[holder.opponentIndex];
  return opp ? opp.name : null;
}

/** Choisit une carte de remplacement (même niveau, non légendaire, dans le set) pour compléter un deck à 5 cartes. */
function pickSubstitute(setId, level, excludeIds) {
  const setCards = sets.getCardsForSet(setId);
  const candidates = setCards.filter(c => c.level === level && !c.legendary && !excludeIds.includes(c.id));
  const pool = candidates.length ? candidates : setCards.filter(c => c.level === level && !c.legendary);
  if (!pool.length) return excludeIds[0];
  return pool[Math.floor(Math.random() * pool.length)].id;
}

/**
 * Calcule le deck réellement distribué à un adversaire pour ce duel précis, en tenant compte :
 * - de la carte légendaire déjà obtenue par CE joueur par le passé (jamais reproposée, quel que soit
 *   l'adversaire affronté) ;
 * - du détenteur actuel de la carte (si elle a migré vers un autre adversaire suite à une défaite
 *   d'un joueur, cet adversaire-ci ne l'a plus).
 */
function resolveOpponentDeck(setId, baseDeck, tier, opponentIndex, playerDiscovered) {
  return baseDeck.map(cardId => {
    if (!isLegendary(cardId)) return cardId;
    const holder = getHolder(setId, cardId);
    const isCurrentHolder = holder && holder.tier === tier && holder.opponentIndex === opponentIndex;
    const alreadyOwnedByPlayer = playerDiscovered.includes(cardId);
    if (isCurrentHolder && !alreadyOwnedByPlayer) return cardId;
    const def = ALL_CARDS.find(c => c.id === cardId);
    return pickSubstitute(setId, def.level, baseDeck);
  });
}

module.exports = {
  getLegendaryCardIds,
  isLegendary,
  getHolder,
  setHolder,
  clearHolder,
  getHolderName,
  resolveOpponentDeck,
  loadRegistry,
};
