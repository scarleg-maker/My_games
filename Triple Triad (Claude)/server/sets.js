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

function getStarterDeckForSet(setId) {
  return STARTER_DECKS_RAW[setId] || [];
}

module.exports = { getSets, getSetDef, isValidSet, getCardsForSet, getOpponentsForSet, getStarterDeckForSet };
