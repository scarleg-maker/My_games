'use strict';
const { ALL_CARDS } = require('./cardLoader');
const sets = require('./sets');
const legendaryDuels = require('./legendaryDuels');

// ============================================================================================
// Achats spéciaux liés aux cartes légendaires (par set). Distinct des paliers BUY_TIERS ci-dessous
// (qui excluent explicitement les cartes légendaires) : ce catalogue gère l'achat direct de cartes
// niveau 8 (n°01-04), les pass de tournoi (G-Forces, Légendaire), et les accès combat niveau 9.
// ============================================================================================
const LEGENDARY_SHOP_CONFIG = {
  ffviii: {
    directCards: {
      cost: 1500,
      minWins: 20,
      cardIds: ['grochocobo_ffviii', 'angel_ffviii', 'gilgamesh_ffviii', 'minimog_ffviii', 'chicobo_ffviii'],
    },
    gfPass: {
      cost: 500,
      minWins: 20,
      key: 'pass_gf',
      label: 'Pass Tournoi G-Forces',
    },
    lvl9Duels: {
      cost: 400,
      minWins: 40,
      cardIds: [
        'carbuncle_ffviii', 'diablos_ffviii', 'leviathan_ffviii', 'odin_ffviii', 'zephyr_ffviii',
        'cerberus_ffviii', 'alexander_ffviii', 'phoenix_ffviii', 'bahamut_ffviii', 'helltrain_ffviii',
        'orbital_ffviii',
      ],
    },
    legendaryPass: {
      cost: 750,
      minWins: 50,
      minRatio: 75, // en pourcentage, sur les statistiques Solo uniquement
      key: 'pass_legendaire',
      label: 'Pass Tournoi Légendaire',
    },
  },
  ffix: {
    // Pas d'achat direct de carte niveau 8 pour ce set (contrairement à FFVIII) : les 11 cartes
    // niveau 8 s'obtiennent uniquement via le Tournoi Boss.
    gfPass: {
      cost: 500,
      minWins: 20,
      key: 'pass_boss_ffix',
      label: 'Pass Tournoi Boss',
    },
    lvl9Duels: {
      cost: 400,
      minWins: 40,
      cardIds: [
        'ramuh_ffix', 'shiva_ffix', 'ifrit_ffix', 'fenrir_ffix', 'phenix_ffix',
        'leviathan_ffix', 'carbuncle_ffix', 'odin_ffix', 'bahamut_ffix', 'marthym_ffix',
        'arkh_ffix',
      ],
    },
    legendaryPass: {
      cost: 750,
      minWins: 50,
      minRatio: 75,
      key: 'pass_personnage_ffix',
      label: 'Pass Tournoi Personnage',
    },
  },
  dsbb: {
    // Paliers 8 et 10 : Pass Tournoi Âme (niveau 8) et Pass Tournoi Seigneur (niveau 10).
    gfPass: {
      cost: 500,
      minWins: 20,
      key: 'pass_ame_dsbb',
      label: 'Pass Tournoi Âme',
    },
    legendaryPass: {
      cost: 750,
      minWins: 50,
      minRatio: 75,
      key: 'pass_seigneur_dsbb',
      label: 'Pass Tournoi Seigneur',
    },
    lvl9Duels: {
      cost: 400,
      minWins: 40,
      cardIds: [
        'midir_le_devoreur_de_tenebres_dsbb',
        'chevalier_des_fumees_dsbb',
        'freja_la_bien_aimee_du_duc_dsbb',
        'seath_le_sans_ecailles_dsbb',
        'sire_alonne_dsbb',
        'dieu_dragon_dsbb',
        'aldrich_devoreur_de_dieux_dsbb',
        'demon_des_tempetes_dsbb',
        'lorian_et_lothric_dsbb',
        'roi_d_ivoire_calcine_dsbb',
        'yhorm_le_geant_dsbb',
        'nito_seigneur_des_tombes_dsbb',
        'ludwig_le_maudit_dsbb',
        'astraea_la_pucelle_et_garl_vinland_dsbb',
      ],
    },
  },
};

function getLegendaryShopConfig(setId) {
  return LEGENDARY_SHOP_CONFIG[setId] || null;
}

function computeSoloRatio(save) {
  const wins = save.stats?.wins || 0;
  const losses = save.stats?.losses || 0;
  const total = wins + losses;
  if (total === 0) return null;
  return (wins / total) * 100;
}

function cardLabel(setId, cardId) {
  const def = sets.getCardsForSet(setId).find(c => c.id === cardId);
  return def ? def.name : cardId;
}

/**
 * Construit la liste des achats spéciaux disponibles pour ce set et cette sauvegarde, avec pour
 * chacun son état (déjà possédé, condition remplie ou non, libellé de la condition manquante).
 * Un item "duel" disparaît entièrement de la liste une fois la carte correspondante obtenue
 * (conformément à la règle : le déblocage n'a plus lieu d'être une fois le combat gagné).
 */
function getLegendaryShopItems(setId, save) {
  const config = getLegendaryShopConfig(setId);
  if (!config) return [];

  const wins = save.stats?.wins || 0;
  const ratio = computeSoloRatio(save);
  const unlocks = save.unlocks || [];
  const items = [];

  // --- Niveau 8, n°01-04 : achat direct de la carte (optionnel selon le set) ---
  if (config.directCards) {
    for (const cardId of config.directCards.cardIds) {
      if (save.collection.includes(cardId)) continue; // déjà possédée : rien à acheter
      const conditionMet = wins >= config.directCards.minWins;
      items.push({
        id: `buy_card_${cardId}`,
        type: 'card',
        cardId,
        label: cardLabel(setId, cardId),
        cost: config.directCards.cost,
        owned: false,
        conditionMet,
        conditionLabel: `${config.directCards.minWins} victoires minimum (Solo)`,
      });
    }
  }

  // --- Niveau 8, n°05-11 : Pass Tournoi G-Forces (optionnel selon le set) ---
  if (config.gfPass) {
    const owned = unlocks.includes(config.gfPass.key);
    const conditionMet = wins >= config.gfPass.minWins;
    items.push({
      id: config.gfPass.key,
      type: 'pass',
      label: config.gfPass.label,
      cost: config.gfPass.cost,
      owned,
      conditionMet,
      conditionLabel: `${config.gfPass.minWins} victoires minimum (Solo)`,
    });
  }

  // --- Niveau 9 : accès combat unique par carte (optionnel selon le set) ---
  if (config.lvl9Duels) {
    for (const cardId of config.lvl9Duels.cardIds) {
      if (save.collection.includes(cardId)) continue; // carte déjà gagnée : le déblocage disparaît
      const unlockKey = `duel_lvl9_${cardId}`;
      const owned = unlocks.includes(unlockKey);
      const conditionMet = wins >= config.lvl9Duels.minWins;
      const duelOpponent = legendaryDuels.getDuelOpponent(setId, cardId);
      const universeSuffix = duelOpponent && duelOpponent.set ? ` (${duelOpponent.set})` : '';
      items.push({
        id: unlockKey,
        type: 'duel',
        cardId,
        label: `Combat : ${cardLabel(setId, cardId)}${universeSuffix}`,
        cost: config.lvl9Duels.cost,
        owned,
        conditionMet,
        conditionLabel: `${config.lvl9Duels.minWins} victoires minimum (Solo)`,
      });
    }
  }

  // --- Niveau 10 : Pass Tournoi Légendaire (optionnel selon le set) ---
  if (config.legendaryPass) {
    const owned = unlocks.includes(config.legendaryPass.key);
    const conditionMet = wins >= config.legendaryPass.minWins && ratio !== null && ratio > config.legendaryPass.minRatio;
    items.push({
      id: config.legendaryPass.key,
      type: 'pass',
      label: config.legendaryPass.label,
      cost: config.legendaryPass.cost,
      owned,
      conditionMet,
      conditionLabel: `Ratio > ${config.legendaryPass.minRatio}% et ${config.legendaryPass.minWins} victoires minimum (Solo)`,
    });
  }

  return items;
}

/** Achète une carte niveau 8 (n°01-04) directement : ajoutée telle quelle à la collection. */
function buyDirectLegendaryCard(setId, save, cardId) {
  const config = getLegendaryShopConfig(setId);
  if (!config || !config.directCards || !config.directCards.cardIds.includes(cardId)) {
    throw new Error('Cette carte n\'est pas disponible à l\'achat direct.');
  }
  if (save.collection.includes(cardId)) throw new Error('Vous possédez déjà cette carte.');
  const wins = save.stats?.wins || 0;
  if (wins < config.directCards.minWins) {
    throw new Error(`${config.directCards.minWins} victoires minimum requises (Solo).`);
  }
  return config.directCards.cost;
}

/** Achète le Pass Tournoi G-Forces. Lève une erreur si déjà possédé ou condition non remplie. */
function buyGfPass(setId, save) {
  const config = getLegendaryShopConfig(setId);
  if (!config || !config.gfPass) throw new Error('Set non configuré pour cet achat.');
  if ((save.unlocks || []).includes(config.gfPass.key)) throw new Error('Vous possédez déjà ce pass.');
  const wins = save.stats?.wins || 0;
  if (wins < config.gfPass.minWins) throw new Error(`${config.gfPass.minWins} victoires minimum requises (Solo).`);
  return { cost: config.gfPass.cost, key: config.gfPass.key };
}

/** Achète l'accès à un combat niveau 9 unique. Lève une erreur si déjà possédé/gagné ou condition non remplie. */
function buyLvl9Duel(setId, save, cardId) {
  const config = getLegendaryShopConfig(setId);
  if (!config || !config.lvl9Duels || !config.lvl9Duels.cardIds.includes(cardId)) {
    throw new Error('Ce combat n\'est pas disponible à l\'achat.');
  }
  if (save.collection.includes(cardId)) throw new Error('Vous possédez déjà cette carte.');
  const unlockKey = `duel_lvl9_${cardId}`;
  if ((save.unlocks || []).includes(unlockKey)) throw new Error('Vous possédez déjà cet accès.');
  const wins = save.stats?.wins || 0;
  if (wins < config.lvl9Duels.minWins) throw new Error(`${config.lvl9Duels.minWins} victoires minimum requises (Solo).`);
  return { cost: config.lvl9Duels.cost, key: unlockKey };
}

/** Achète le Pass Tournoi Légendaire. Lève une erreur si déjà possédé ou conditions non remplies. */
function buyLegendaryPass(setId, save) {
  const config = getLegendaryShopConfig(setId);
  if (!config || !config.legendaryPass) throw new Error('Set non configuré pour cet achat.');
  if ((save.unlocks || []).includes(config.legendaryPass.key)) throw new Error('Vous possédez déjà ce pass.');
  const wins = save.stats?.wins || 0;
  const ratio = computeSoloRatio(save);
  if (wins < config.legendaryPass.minWins || ratio === null || ratio <= config.legendaryPass.minRatio) {
    throw new Error(`Ratio > ${config.legendaryPass.minRatio}% et ${config.legendaryPass.minWins} victoires minimum requises (Solo).`);
  }
  return { cost: config.legendaryPass.cost, key: config.legendaryPass.key };
}

// Paliers d'achat : coût en points, plage de niveaux, carte tirée au hasard dans la plage.
const BUY_TIERS = {
  'lvl1-2': { cost: 200, minLevel: 1, maxLevel: 2, label: 'Niveau 1 à 2' },
  'lvl3-5': { cost: 350, minLevel: 3, maxLevel: 5, label: 'Niveau 3 à 5' },
  'lvl6-7': { cost: 550, minLevel: 6, maxLevel: 7, label: 'Niveau 6 à 7' },
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

module.exports = {
  getBuyTiers, buyRandomCard, sellPrice, SELL_PRICE_BY_LEVEL, BUY_TIERS,
  getLegendaryShopConfig, getLegendaryShopItems, computeSoloRatio,
  buyDirectLegendaryCard, buyGfPass, buyLvl9Duel, buyLegendaryPass,
};
