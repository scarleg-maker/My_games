'use strict';
const sets = require('./sets');

// ============================================================================================
// Système de jalons : un titre de progression basé sur les cartes niveau 1-7 UNIQUES obtenues
// (save.discovered, pas save.collection — une carte compte une fois, peu importe le nombre
// d'exemplaires possédés, sinon la progression grimperait trop vite). Chaque carte niveau X
// rapporte points(X) = round(X*(X+1)*5/14) — formule calibrée pour donner exactement 1 point au
// niveau 1 et 20 points au niveau 7, avec une progression naturelle entre les deux.
// ============================================================================================

function pointsForLevel(level) {
  return Math.round((level * (level + 1) * 5) / 14);
}

// Paliers par set (à ajuster/étendre manuellement au fil de l'ajout de nouveaux univers). Les
// seuils ci-dessous sont calibrés sur un maximum de 660 points (11 cartes/niveau, niveaux 1-7).
const MILESTONE_TIERS = {
  ffviii: [
    { threshold: 0, label: 'Civil', icon: '⚪' },
    { threshold: 20, label: 'Étudiant', icon: '📘' },
    { threshold: 60, label: 'Jeune Diplômé', icon: '🎓' },
    { threshold: 120, label: 'SeeD', icon: '🔰' },
    { threshold: 200, label: 'SeeD de Rang B', icon: '🥉' },
    { threshold: 300, label: 'SeeD de Rang A', icon: '🥈' },
    { threshold: 420, label: 'SeeD d\'Élite', icon: '🥇' },
    { threshold: 550, label: 'Héros de Balamb', icon: '🏆' },
  ],
  ffix: [
    { threshold: 0, label: 'Spectateur', icon: '👀' },
    { threshold: 20, label: 'Figurant', icon: '🎭' },
    { threshold: 60, label: 'Apprenti Comédien', icon: '📜' },
    { threshold: 120, label: 'Acteur de Tantalus', icon: '🎪' },
    { threshold: 200, label: 'Voleur de Lindblum', icon: '🗡️' },
    { threshold: 300, label: 'Vedette de la Troupe', icon: '💫' },
    { threshold: 420, label: 'Bras Droit de Bach', icon: '🏅' },
    { threshold: 550, label: 'Légende de Gaia', icon: '🌍' },
  ],
  dsbb: [
    { threshold: 0, label: 'Mort-Vivant Inconscient', icon: '🧟' },
    { threshold: 25, label: 'Porteur de la Flamme', icon: '🕯️' },
    { threshold: 70, label: 'Pèlerin des Cendres', icon: '🌫️' },
    { threshold: 140, label: 'Chevalier Errant', icon: '🗡️' },
    { threshold: 230, label: 'Élu de la Flamme', icon: '🔥' },
    { threshold: 340, label: 'Chasseur de Yharnam', icon: '🌙' },
    { threshold: 470, label: 'Grand Veilleur', icon: '👁️' },
    { threshold: 620, label: 'Chasseur des Cendres', icon: '💀' },
  ],
  // Paliers génériques utilisés pour tout set sans thème dédié défini ci-dessus.
  default: [
    { threshold: 0, label: 'Novice', icon: '⚪' },
    { threshold: 20, label: 'Amateur', icon: '📘' },
    { threshold: 60, label: 'Confirmé', icon: '🎓' },
    { threshold: 120, label: 'Expert', icon: '🔰' },
    { threshold: 200, label: 'Vétéran', icon: '🥉' },
    { threshold: 300, label: 'Maître', icon: '🥈' },
    { threshold: 420, label: 'Grand Maître', icon: '🥇' },
    { threshold: 550, label: 'Légende', icon: '🏆' },
  ],
};

// Icônes des 3 jalons spéciaux (indépendants du système de points).
const SPECIAL_BADGE_ICONS = {
  maitreDesGForces: '⚔️',
  celebrite: '⭐',
  herosLegendaire: '👑',
};

// Titres des 3 jalons spéciaux par set — à adapter à la terminologie propre à chaque univers (par
// exemple : pas de "G-Forces" dans DSBB, qui a ses propres tournois "Âme" et "Seigneur").
const SPECIAL_BADGE_LABELS = {
  ffviii: {
    maitreDesGForces: 'Maître des G-Forces',
    celebrite: 'Célébrité',
    herosLegendaire: 'Héros légendaire',
  },
  ffix: {
    maitreDesGForces: 'Maître des Boss',
    celebrite: 'Vedette de Gaia',
    herosLegendaire: 'Héros légendaire',
  },
  dsbb: {
    maitreDesGForces: 'Porteur d\'Âmes',
    celebrite: 'Élu des Seigneurs',
    herosLegendaire: 'Héros légendaire',
  },
  // Libellés génériques utilisés pour tout set sans thème dédié défini ci-dessus.
  default: {
    maitreDesGForces: 'Maître Absolu',
    celebrite: 'Célébrité',
    herosLegendaire: 'Héros légendaire',
  },
};

function getSpecialBadgeLabels(setId) {
  return SPECIAL_BADGE_LABELS[setId] || SPECIAL_BADGE_LABELS.default;
}

function getMilestoneTiers(setId) {
  return MILESTONE_TIERS[setId] || MILESTONE_TIERS.default;
}

/** Somme des points des cartes niveau 1-7 UNIQUES obtenues (chaque carte ne compte qu'une fois). */
function computeMilestonePoints(setId, save) {
  const discovered = new Set(save.discovered || []);
  const cards = sets.getCardsForSet(setId).filter(c => c.level >= 1 && c.level <= 7);
  let points = 0;
  for (const c of cards) {
    if (discovered.has(c.id)) points += pointsForLevel(c.level);
  }
  return points;
}

function getCurrentTier(setId, points) {
  const tiers = getMilestoneTiers(setId);
  let current = tiers[0];
  for (const t of tiers) {
    if (points >= t.threshold) current = t;
  }
  return current;
}

/**
 * Jalons spéciaux indépendants du système de points, basés sur la possession de TOUTES les
 * cartes d'une catégorie (peu importe l'ordre d'obtention) :
 *  - Maître des G-Forces : toutes les cartes niveau 8 ET 9
 *  - Célébrité : toutes les cartes niveau 10
 *  - Héros légendaire : absolument toutes les cartes du set — remplace tous les autres titres
 */
function getSpecialBadges(setId, save) {
  const discovered = new Set(save.discovered || []);
  const allCards = sets.getCardsForSet(setId);
  const lvl8and9 = allCards.filter(c => c.level === 8 || c.level === 9);
  const lvl10 = allCards.filter(c => c.level === 10);

  const hasAll8and9 = lvl8and9.length > 0 && lvl8and9.every(c => discovered.has(c.id));
  const hasAll10 = lvl10.length > 0 && lvl10.every(c => discovered.has(c.id));
  const hasAllCards = allCards.length > 0 && allCards.every(c => discovered.has(c.id));

  return { hasAll8and9, hasAll10, hasAllCards };
}

/** Résumé complet des jalons pour ce joueur : titre à afficher, progression, tableau des paliers. */
function getMilestoneSummary(setId, save) {
  const points = computeMilestonePoints(setId, save);
  const tiers = getMilestoneTiers(setId);
  const currentTier = getCurrentTier(setId, points);
  const badges = getSpecialBadges(setId, save);

  const displayTitle = badges.hasAllCards ? 'Héros légendaire' : currentTier.label;
  const displayIcon = badges.hasAllCards ? SPECIAL_BADGE_ICONS.herosLegendaire : currentTier.icon;

  const currentIndex = tiers.findIndex(t => t.label === currentTier.label);
  const nextTier = tiers[currentIndex + 1] || null;

  return {
    points,
    displayTitle,
    displayIcon,
    currentTierLabel: currentTier.label,
    nextTier: nextTier ? { label: nextTier.label, threshold: nextTier.threshold, icon: nextTier.icon } : null,
    badges: {
      maitreDesGForces: badges.hasAll8and9,
      celebrite: badges.hasAll10,
      herosLegendaire: badges.hasAllCards,
    },
    badgeIcons: SPECIAL_BADGE_ICONS,
    badgeLabels: getSpecialBadgeLabels(setId),
    allTiers: tiers.map(t => ({ ...t, reached: points >= t.threshold })),
  };
}

module.exports = {
  pointsForLevel,
  getMilestoneTiers,
  computeMilestonePoints,
  getSpecialBadges,
  getSpecialBadgeLabels,
  getMilestoneSummary,
};
