'use strict';
const { ALL_CARDS } = require('./cardLoader');
const sets = require('./sets');

// Paliers d'achat : coût en points, plage de niveaux, carte tirée au hasard dans la plage.
const BUY_TIERS = {
  'lvl1-2': { cost: 200, minLevel: 1, maxLevel: 2, label: 'Niveau 1 à 2' },
  'lvl3-5': { cost: 500, minLevel: 3, maxLevel: 5, label: 'Niveau 3 à 5' },
  'lvl6-7': { cost: 1000, minLevel: 6, maxLevel: 7, label: 'Niveau 6 à 7' },
  'lvl8-10': { cost: 5000, minLevel: 8, maxLevel: 10, label: 'Niveau 8 à 10' },
};

// Prix de vente par niveau. Les niveaux 8, 9 et 10 ne sont pas vendables (absents de cette table).
const SELL_PRICE_BY_LEVEL = { 1: 50, 2: 75, 3: 100, 4: 125, 5: 150, 6: 175, 7: 200 };

// Poids par défaut appliqué à une carte sans champ "rarity" (= comportement équitable d'origine).
const DEFAULT_RARITY_WEIGHT = 3;

function getBuyTiers() {
  return BUY_TIERS;
}

/**
 * Tirage aléatoire pondéré : chaque carte a une probabilité proportionnelle à son champ "rarity"
 * (1 = plus rare, 5 = plus commune ; les cartes sans ce champ comptent comme 3, valeur neutre).
 */
function weightedRandomPick(cards) {
  const totalWeight = cards.reduce((sum, c) => sum + (c.rarity ?? DEFAULT_RARITY_WEIGHT), 0);
  let roll = Math.random() * totalWeight;
  for (const card of cards) {
    roll -= (card.rarity ?? DEFAULT_RARITY_WEIGHT);
    if (roll <= 0) return card;
  }
  return cards[cards.length - 1]; // filet de sécurité anti-arrondi flottant
}

/**
 * Tire une carte aléatoire (pondérée par rareté) dans la plage de niveaux du palier demandé (jamais
 * une carte légendaire : celles-ci ne s'obtiennent qu'en duel). Lève une erreur si le palier est
 * invalide ou si aucune carte n'existe dans cette plage de niveaux (ex: niveau 8-10 tant qu'aucune
 * carte de ce niveau n'est définie).
 */
function buyRandomCard(setId, tierKey) {
  const tier = BUY_TIERS[tierKey];
  if (!tier) throw new Error('Palier d\'achat invalide.');
  const setCards = sets.getCardsForSet(setId);
  const pool = setCards.filter(c => c.level >= tier.minLevel && c.level <= tier.maxLevel && !c.legendary);
  if (!pool.length) throw new Error(`Aucune carte disponible pour le moment dans la plage "${tier.label}".`);
  const card = weightedRandomPick(pool);
  return { card, cost: tier.cost };
}

/** Retourne le prix de vente d'une carte selon son niveau, ou null si elle n'est pas vendable. */
function sellPrice(level) {
  return SELL_PRICE_BY_LEVEL[level] ?? null;
}

module.exports = { getBuyTiers, buyRandomCard, sellPrice, SELL_PRICE_BY_LEVEL, BUY_TIERS };
