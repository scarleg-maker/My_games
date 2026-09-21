'use strict';
const SETS = require('../data/sets.json');
const { loadMergedArray, loadMergedTiers, loadMergedObject } = require('./dataMerger');
const { items: ALL_CARDS_RAW } = loadMergedArray('cards', { uniqueKey: 'id' });
const { items: ALL_OPPONENTS_RAW } = loadMergedTiers('opponents');
const { items: STARTER_DECKS_RAW } = loadMergedObject('starterDeck');

function getSets() {
  return SETS;
}

function getSetDef(setId) {
  return SETS.find(s => s.id === setId) || null;
}

function isValidSet(setId) {
  return !!getSetDef(setId);
}

/** Cartes appartenant au set demandé (union des tags listés dans "includes"). */
function getCardsForSet(setId) {
  const setDef = getSetDef(setId);
  if (!setDef) return [];
  return ALL_CARDS_RAW.filter(c => setDef.includes.includes(c.set));
}

/**
 * Paliers d'adversaires pour ce set : chaque palier ne garde que les adversaires dont le tag "set"
 * appartient au set demandé. Un palier qui n'aurait plus aucun adversaire est retiré de la liste.
 */
function getOpponentsForSet(setId) {
  const setDef = getSetDef(setId);
  if (!setDef) return [];
  return ALL_OPPONENTS_RAW
    .map(tier => ({ ...tier, opponents: tier.opponents.filter(o => setDef.includes.includes(o.set)) }))
    .filter(tier => tier.opponents.length > 0);
}

/**
 * Deck de départ pour ce set, toujours retourné sous forme de liste plate (avec doublons) prête à
 * être utilisée telle quelle par saveManager. Accepte deux formats en entrée dans le fichier JSON :
 *  - format compact (recommandé) : [{ "id": "bogomile_ffviii", "quantity": 3 }, ...]
 *  - ancien format : liste plate ["bogomile_ffviii", "bogomile_ffviii", "bogomile_ffviii", ...]
 */
function getStarterDeckForSet(setId) {
  const raw = STARTER_DECKS_RAW[setId] || [];
  const flat = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      flat.push(entry); // ancien format : déjà une carte individuelle
    } else if (entry && entry.id) {
      const qty = Number(entry.quantity) || 1;
      for (let i = 0; i < qty; i++) flat.push(entry.id);
    }
  }
  return flat;
}

module.exports = { getSets, getSetDef, isValidSet, getCardsForSet, getOpponentsForSet, getStarterDeckForSet };
