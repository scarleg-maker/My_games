'use strict';
const sets = require('./sets');

/**
 * Paliers de tournoi disponibles. Chaque palier définit :
 * - cost : points requis pour participer
 * - opponentTierRange : [min, max] des paliers d'adversaires IA dans lesquels les 5 manches sont tirées
 * - rewardScale : multiplicateur indicatif pour calibrer les récompenses (une fois définies)
 * - hidden : si true, le palier n'apparaît dans aucune liste tant que sa condition de déblocage
 *   (à définir plus tard, voir isTierUnlocked) n'est pas remplie.
 */
const TOURNAMENT_TIERS = {
  easy:    { id: 'easy',    label: 'Facile',  cost: 0,    opponentTierRange: [1, 3], rewardScale: 1 },
  medium:  { id: 'medium',  label: 'Medium',  cost: 200,  opponentTierRange: [2, 5], rewardScale: 2 },
  expert:  { id: 'expert',  label: 'Expert',  cost: 500,  opponentTierRange: [4, 6], rewardScale: 4 },
  // 4e palier caché : sa condition de déblocage sera définie plus tard (ex: avoir été Champion en Expert).
  mystery: { id: 'mystery', label: '???',     cost: 1000, opponentTierRange: [6, 6], rewardScale: 8, hidden: true },
};

/**
 * Détermine si un palier caché est débloqué pour un joueur donné. Toujours faux pour l'instant :
 * remplacez ce corps quand la condition de déblocage du 4e tournoi sera définie, par exemple :
 *   return (save.stats.wins || 0) >= 50;
 */
function isTierUnlocked(tierDef, save) {
  if (!tierDef.hidden) return true;
  return false; // TODO : condition de déblocage à définir plus tard
}

/** Liste des paliers de tournoi visibles pour un joueur (les paliers cachés non débloqués sont exclus). */
function getVisibleTiers(save) {
  return Object.values(TOURNAMENT_TIERS).filter(t => isTierUnlocked(t, save));
}

function getTierDef(tierKey) {
  return TOURNAMENT_TIERS[tierKey] || null;
}

/**
 * Choisit 5 adversaires de plus en plus forts pour un nouveau tournoi, à l'intérieur de la plage de
 * paliers du tournoi choisi (Facile/Medium/Expert/...). Si la plage compte moins de 5 paliers, les
 * dernières manches répètent le palier le plus élevé disponible dans cette plage (toujours 5 manches).
 */
function pickTournamentOpponents(setId, tierDef) {
  const [minTier, maxTier] = tierDef.opponentTierRange;
  const tiersForSet = sets.getOpponentsForSet(setId).filter(t => t.tier >= minTier && t.tier <= maxTier);
  const sortedTiers = [...tiersForSet].sort((a, b) => a.tier - b.tier);
  if (sortedTiers.length === 0) throw new Error('Aucun adversaire disponible pour ce palier de tournoi.');

  const rounds = [];
  for (let i = 0; i < 5; i++) {
    const tierIdx = Math.min(i, sortedTiers.length - 1);
    const tierData = sortedTiers[tierIdx];
    const opponentIndex = Math.floor(Math.random() * tierData.opponents.length);
    rounds.push({
      tier: tierData.tier,
      opponentIndex,
      opponentName: tierData.opponents[opponentIndex].name,
    });
  }
  return rounds;
}

/**
 * Choisit l'adversaire de la manche décisive (place de 3e) : même palier que la 4e manche perdue,
 * si possible différent de l'adversaire déjà affronté à cette manche.
 */
function pickDeciderOpponent(setId, tier, excludeOpponentIndex) {
  const tiersForSet = sets.getOpponentsForSet(setId);
  const tierData = tiersForSet.find(t => t.tier === tier);
  if (!tierData) throw new Error('Palier introuvable pour la manche décisive.');
  const indices = tierData.opponents.map((o, idx) => idx).filter(idx => idx !== excludeOpponentIndex);
  const pool = indices.length ? indices : tierData.opponents.map((o, idx) => idx);
  const opponentIndex = pool[Math.floor(Math.random() * pool.length)];
  return { tier, opponentIndex, opponentName: tierData.opponents[opponentIndex].name };
}

/**
 * Attribution de la récompense finale selon le classement ET le palier de tournoi joué (tierKey).
 * Les récompenses n'ont pas encore été définies par le créateur du jeu : cette fonction est un point
 * d'ancrage prêt à l'emploi, à compléter plus tard (ex: saveManager.addCardsToSave / addPoints selon
 * le "placement" ET le rewardScale du palier pour calibrer des récompenses de plus en plus importantes).
 */
function grantTournamentReward(placement, { name, setId, tierKey }, saveManager) {
  const tierDef = getTierDef(tierKey);
  const scale = tierDef ? tierDef.rewardScale : 1;
  // TODO : définir les vraies récompenses ici, par exemple :
  // if (placement === 'champion') saveManager.addPoints(name, setId, 1000 * scale);
  // if (placement === 'second') saveManager.addPoints(name, setId, 500 * scale);
  // if (placement === 'third') saveManager.addPoints(name, setId, 250 * scale);
  return null;
}

module.exports = {
  TOURNAMENT_TIERS,
  isTierUnlocked,
  getVisibleTiers,
  getTierDef,
  pickTournamentOpponents,
  pickDeciderOpponent,
  grantTournamentReward,
};
