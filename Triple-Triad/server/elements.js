'use strict';
const ELEMENTS = require('../data/elements.json');

function elementPool() {
  return ELEMENTS.map(e => e.name);
}

/**
 * Assigne aléatoirement un élément à un sous-ensemble des 9 cases du plateau (3 maximum).
 * Retourne un tableau de 9 entrées (nom d'élément ou null).
 */
function assignRandomElements() {
  const pool = elementPool();
  if (pool.length === 0) return Array(9).fill(null);
  const cells = Array(9).fill(null);
  const count = 1 + Math.floor(Math.random() * 3); // entre 1 et 3 cases élémentaires
  const indices = [...Array(9).keys()].sort(() => Math.random() - 0.5).slice(0, count);
  for (const idx of indices) {
    cells[idx] = pool[Math.floor(Math.random() * pool.length)];
  }
  return cells;
}

function clamp(value) {
  return Math.max(0, Math.min(10, value));
}

/**
 * Applique le bonus/malus élémental à une carte au moment où elle est posée sur une case.
 * +1 sur chaque côté si l'élément de la carte correspond à celui de la case,
 * -1 sinon (carte d'un autre élément, ou sans élément), si la case a un élément assigné.
 *
 * Les valeurs ajustées (top/right/bottom/left) ne servent qu'à la capture "basique" (comparaison
 * directe). Les valeurs de base d'origine sont conservées dans baseTop/baseRight/baseBottom/baseLeft
 * pour que les règles Identique et Plus continuent de se baser sur les chiffres non modifiés (voir
 * server/engine.js). La carte retournée porte aussi un champ `elementalDelta` (+1/-1/null) pour
 * l'affichage côté client.
 */
function applyElementalAdjustment(card, cellElement) {
  const base = {
    baseTop: card.baseTop ?? card.top,
    baseRight: card.baseRight ?? card.right,
    baseBottom: card.baseBottom ?? card.bottom,
    baseLeft: card.baseLeft ?? card.left,
  };
  if (!cellElement) return { ...card, ...base, elementalDelta: null };
  const match = card.element && card.element === cellElement;
  const delta = match ? 1 : -1;
  return {
    ...card,
    ...base,
    top: clamp(card.top + delta),
    right: clamp(card.right + delta),
    bottom: clamp(card.bottom + delta),
    left: clamp(card.left + delta),
    elementalDelta: delta,
  };
}

module.exports = { assignRandomElements, applyElementalAdjustment, elementPool };
