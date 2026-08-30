'use strict';
const { loadMergedArray } = require('./dataMerger');
const { items: CARDS, sourceFiles } = loadMergedArray('cards', { uniqueKey: 'id' });
console.log(`[cardLoader] ${CARDS.length} carte(s) chargée(s) depuis : ${sourceFiles.join(', ')}`);
const CARD_BY_ID = new Map(CARDS.map(c => [c.id, c]));

function getCardDef(cardId) {
  const def = CARD_BY_ID.get(cardId);
  if (!def) throw new Error(`Carte inconnue: ${cardId}`);
  return def;
}

/**
 * Construit une main jouable (5 cartes) à partir d'une liste de cardId,
 * en assignant un instanceId unique et le propriétaire.
 */
function buildHand(cardIds, owner) {
  return cardIds.map((cardId, i) => {
    const def = getCardDef(cardId);
    return {
      instanceId: `${owner}-${cardId}-${i}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      cardId: def.id,
      name: def.name,
      level: def.level,
      top: def.top,
      right: def.right,
      bottom: def.bottom,
      left: def.left,
      image: def.image || null,
      element: def.element || null,
      owner,
    };
  });
}

module.exports = { getCardDef, buildHand, ALL_CARDS: CARDS };
