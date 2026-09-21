'use strict';
const sets = require('./sets');

// ============================================================================================
// Règles imposées PAR TOURNOI (aucune personnalisation par le joueur — le serveur applique
// toujours les règles définies ci-dessous pour chaque tournoi, quoi que le client envoie).
// La fonction rules(...) part d'un socle où tout est désactivé : ne précisez que les règles à
// ACTIVER pour ce tournoi. Modifiez ces objets directement pour changer les règles d'un tournoi.
// Trade rule toujours "none" au sens propre : aucune carte ne change de main pendant les manches
// de tournoi (seule la récompense finale compte), quel que soit le tournoi et ses règles.
// ============================================================================================
const RULES_BASE = {
  same: false, plus: false, combo: false, suddenDeath: false,
  elemental: false, wallAce: false, open: false, random: false,
};
function rules(overrides = {}) {
  return { ...RULES_BASE, ...overrides };
}

// ============================================================================================
// Tournois de base : Classique -> Bronze -> Argent -> Or, débloqués en cascade (il faut avoir
// REMPORTÉ le précédent). 4 manches à paliers d'adversaires fixes (pas de tirage aléatoire de
// plage). Aucune influence sur les statistiques victoires/défaites (comme tous les tournois).
// ============================================================================================
const BASE_TOURNAMENTS = [
  { id: 'classique', label: 'Classique', opponentTiers: [1, 2, 3, 4], rewardPoints: 150, rewardCardLevel: 4, rules: rules({ open: true, elemental: true }) },
  { id: 'bronze',    label: 'Bronze',    opponentTiers: [2, 3, 4, 5], rewardPoints: 200, rewardCardLevel: 5, rules: rules({ plus: true, same: true, combo: true }) },
  { id: 'argent',    label: 'Argent',    opponentTiers: [3, 4, 5, 6], rewardPoints: 250, rewardCardLevel: 6, rules: rules({}) }, // à définir manuellement
  { id: 'or',        label: 'Or',        opponentTiers: [4, 5, 6, 7], rewardPoints: 300, rewardCardLevel: 7, rules: rules({}) }, // à définir manuellement
];

// ============================================================================================
// Tournois spéciaux : débloqués par l'achat d'un pass en boutique (voir server/shop.js), pas par
// une progression séquentielle. 5 manches. Récompense = 1 carte du niveau indiqué, non encore
// obtenue. Si toutes les cartes de la récompense normale sont déjà obtenues, la récompense devient
// 250 points + 1 carte niveau 7 aléatoire (non obtenue) à la place.
// ============================================================================================
const SPECIAL_TOURNAMENTS = {
  ffviii: {
    gforces: {
      id: 'gforces',
      label: 'G-Forces',
      passKey: 'pass_gf',
      rounds: 5,
      rules: rules({}), // à définir manuellement
      // paliers 6 ou 7 tirés au hasard à chaque manche, sauf la 5e toujours palier 7
      pickRoundTier: (roundIndex) => (roundIndex === 4 ? 7 : (Math.random() < 0.5 ? 6 : 7)),
      rewardCardPool: [
        'golgotha_ffviii', 'shiva_ffviii', 'ifrit_ffviii',
        'ondine_ffviii', 'tauros_ffviii', 'taurux_ffviii',
      ],
      lossReward: { points: 300 }, // uniquement si défaite à la DERNIÈRE manche (5e)
      fallbackReward: { points: 250, cardLevel: 7 }, // si les 7 cartes ci-dessus sont déjà toutes obtenues
    },
    legende: {
      id: 'legende',
      label: 'Légende',
      rules: rules({}), // à définir manuellement
      passKey: 'pass_legendaire',
      rounds: 5,
      pickRoundTier: () => 9,
      rewardCardLevelPool: 10, // n'importe quelle carte niveau 10 non obtenue (tirée dynamiquement)
      lossReward: { points: 500 },
      fallbackReward: { points: 250, cardLevel: 7 },
    },
  },
  ffix: {
    boss: {
      id: 'boss',
      label: 'Tournoi Boss',
      passKey: 'pass_boss_ffix',
      rounds: 5,
      rules: rules({}), // à définir manuellement
      // paliers 6 ou 7 tirés au hasard à chaque manche, sauf la 5e toujours palier 7
      pickRoundTier: (roundIndex) => (roundIndex === 4 ? 7 : (Math.random() < 0.5 ? 6 : 7)),
      // toutes les 11 cartes niveau 8 (aucun achat direct pour ce set, contrairement à FFVIII)
      rewardCardLevelPool: 8,
      lossReward: { points: 300 },
      fallbackReward: { points: 250, cardLevel: 7 },
    },
    personnage: {
      id: 'personnage',
      label: 'Tournoi Personnage',
      rules: rules({}), // à définir manuellement
      passKey: 'pass_personnage_ffix',
      rounds: 5,
      pickRoundTier: () => 9,
      rewardCardLevelPool: 10,
      lossReward: { points: 500 },
      fallbackReward: { points: 250, cardLevel: 7 },
    },
  },
  dsbb: {
    ame: {
      id: 'ame',
      label: 'Tournoi Âme',
      passKey: 'pass_ame_dsbb',
      rounds: 5,
      rules: rules({}), // à définir manuellement
      pickRoundTier: (roundIndex) => (roundIndex === 4 ? 7 : (Math.random() < 0.5 ? 6 : 7)),
      rewardCardLevelPool: 8,
      lossReward: { points: 300 },
      fallbackReward: { points: 250, cardLevel: 7 },
    },
    seigneur: {
      id: 'seigneur',
      label: 'Tournoi Seigneur',
      rules: rules({}), // à définir manuellement
      passKey: 'pass_seigneur_dsbb',
      rounds: 5,
      pickRoundTier: () => 9,
      rewardCardLevelPool: 10,
      lossReward: { points: 500 },
      fallbackReward: { points: 250, cardLevel: 7 },
    },
  },
};

function getBaseTournamentDef(id) {
  return BASE_TOURNAMENTS.find(t => t.id === id) || null;
}

function getSpecialTournamentDef(setId, id) {
  return (SPECIAL_TOURNAMENTS[setId] && SPECIAL_TOURNAMENTS[setId][id]) || null;
}

/**
 * Liste les tournois de base avec leur état de déblocage pour ce joueur (le premier est toujours
 * débloqué ; chaque suivant nécessite d'avoir REMPORTÉ le précédent).
 */
function getBaseTournamentsWithStatus(save) {
  const won = save.tournamentsWon || [];
  return BASE_TOURNAMENTS.map((t, idx) => ({
    ...t,
    unlocked: idx === 0 || won.includes(BASE_TOURNAMENTS[idx - 1].id),
    completed: won.includes(t.id),
  }));
}

/**
 * Liste les tournois spéciaux avec leur état (débloqué = pass possédé en boutique).
 */
function getSpecialTournamentsWithStatus(setId, save) {
  const unlocks = save.unlocks || [];
  return Object.values(SPECIAL_TOURNAMENTS[setId] || {}).map(t => ({
    ...t,
    unlocked: unlocks.includes(t.passKey),
  }));
}

/** Choisit un adversaire au hasard dans un palier donné pour ce set. Lève une erreur si vide. */
function pickOpponentInTier(setId, tier) {
  const tiersForSet = sets.getOpponentsForSet(setId);
  const tierData = tiersForSet.find(t => t.tier === tier);
  if (!tierData || !tierData.opponents.length) {
    throw new Error(`Aucun adversaire défini pour le palier ${tier} de ce set — tournoi indisponible pour le moment.`);
  }
  const opponentIndex = Math.floor(Math.random() * tierData.opponents.length);
  return { tier, opponentIndex, opponentName: tierData.opponents[opponentIndex].name };
}

/** Prépare les manches (adversaires fixes, tirés une fois) d'un tournoi de base. */
function pickBaseTournamentRounds(setId, tournamentDef) {
  return tournamentDef.opponentTiers.map(tier => pickOpponentInTier(setId, tier));
}

/** Prépare les manches d'un tournoi spécial (paliers déterminés manche par manche). */
function pickSpecialTournamentRounds(setId, specialDef) {
  const rounds = [];
  for (let i = 0; i < specialDef.rounds; i++) {
    rounds.push(pickOpponentInTier(setId, specialDef.pickRoundTier(i)));
  }
  return rounds;
}

/** Cartes d'un pool donné non encore obtenues par le joueur (jamais présentes dans discovered). */
function unclaimedFromPool(save, cardIds) {
  const discovered = save.discovered || [];
  return cardIds.filter(id => !discovered.includes(id));
}

/** Toutes les cartes d'un niveau donné pour ce set, non encore obtenues. */
function unclaimedByLevel(setId, save, level) {
  const discovered = save.discovered || [];
  return sets.getCardsForSet(setId).filter(c => c.level === level && !discovered.includes(c.id)).map(c => c.id);
}

/**
 * Calcule la récompense de victoire finale d'un tournoi SPÉCIAL. Retourne { points, cardId } (l'un
 * des deux peut être absent). Si le pool normal est épuisé (toutes déjà obtenues), applique la
 * récompense de repli (fallbackReward : points + carte niveau 7 aléatoire non obtenue).
 */
function computeSpecialWinReward(setId, save, specialDef) {
  let pool;
  if (specialDef.rewardCardPool) {
    pool = unclaimedFromPool(save, specialDef.rewardCardPool);
  } else {
    pool = unclaimedByLevel(setId, save, specialDef.rewardCardLevelPool);
  }

  if (pool.length > 0) {
    const cardId = pool[Math.floor(Math.random() * pool.length)];
    return { cardId };
  }

  // Repli : toutes les cartes de la récompense normale sont déjà obtenues.
  const fallbackPool = unclaimedByLevel(setId, save, specialDef.fallbackReward.cardLevel);
  const reward = { points: specialDef.fallbackReward.points };
  if (fallbackPool.length > 0) {
    reward.cardId = fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
  }
  return reward;
}

module.exports = {
  BASE_TOURNAMENTS,
  SPECIAL_TOURNAMENTS,
  getBaseTournamentDef,
  getSpecialTournamentDef,
  getBaseTournamentsWithStatus,
  getSpecialTournamentsWithStatus,
  pickBaseTournamentRounds,
  pickSpecialTournamentRounds,
  computeSpecialWinReward,
  unclaimedByLevel,
};
