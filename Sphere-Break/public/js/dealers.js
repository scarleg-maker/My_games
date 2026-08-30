/**
 * Sphere Break — échelle des 15 croupiers.
 *
 * Déblocage : chaque croupier a un `mode` :
 *  - 'OR'  : débloqué dès que `wins >= minWins` **OU** `ratio >= minRatio`.
 *  - 'AND' : débloqué seulement si les deux conditions sont vraies en même
 *            temps. Réservé aux 4 croupiers les plus forts.
 * Le ratio n'est pris en compte qu'à partir de 5 parties jouées.
 *
 * `gilReward` : Gils gagnés en battant ce croupier (croissant avec la
 * difficulté).
 *
 * `forcedCombo` : si non-null, ce croupier IMPOSE sa règle de Combo pour la
 * manche, quel que soit le réglage choisi par le joueur au menu principal :
 *   - 'multiple' : seul le Combo Multiple est actif
 *   - 'jetons'   : seul le Combo Jetons est actif
 *   - 'both'     : les deux Combos sont actifs en même temps
 *   - null       : le joueur choisit librement au menu principal
 */
const DEALERS = [
  { id: 0,  name: 'Cour d\'Entraînement',     stars: 1, maxTurns: 10, timeLimit: 60, quota: 15,  minWins: 0,   minRatio: 0,  mode: 'OR',  gilReward: 50,  forcedCombo: null },
  { id: 1,  name: 'Marché de Luca',            stars: 1, maxTurns: 10, timeLimit: 55, quota: 20,  minWins: 2,   minRatio: 0,  mode: 'OR',  gilReward: 65,  forcedCombo: null },
  { id: 2,  name: 'Ruelles de Kilika',          stars: 2, maxTurns: 12, timeLimit: 55, quota: 26,  minWins: 4,   minRatio: 25, mode: 'OR',  gilReward: 85,  forcedCombo: null },
  { id: 3,  name: 'Sanctuaire de Djose',        stars: 2, maxTurns: 12, timeLimit: 50, quota: 32,  minWins: 6,   minRatio: 30, mode: 'OR',  gilReward: 110, forcedCombo: null },
  { id: 4,  name: 'Halte de Guadosalam',        stars: 2, maxTurns: 14, timeLimit: 50, quota: 40,  minWins: 9,   minRatio: 35, mode: 'OR',  gilReward: 140, forcedCombo: null },
  { id: 5,  name: 'Auberge de Mushroom Rock',   stars: 3, maxTurns: 14, timeLimit: 45, quota: 48,  minWins: 12,  minRatio: 40, mode: 'OR',  gilReward: 175, forcedCombo: 'jetons' },
  { id: 6,  name: 'Terrasses de Macalania',     stars: 3, maxTurns: 16, timeLimit: 45, quota: 58,  minWins: 16,  minRatio: 45, mode: 'OR',  gilReward: 215, forcedCombo: null },
  { id: 7,  name: 'Veille de Bikanel',          stars: 3, maxTurns: 16, timeLimit: 40, quota: 68,  minWins: 20,  minRatio: 50, mode: 'OR',  gilReward: 260, forcedCombo: null },
  { id: 8,  name: 'Passage d\'Home',            stars: 3, maxTurns: 18, timeLimit: 40, quota: 80,  minWins: 26,  minRatio: 53, mode: 'OR',  gilReward: 310, forcedCombo: 'multiple' },
  { id: 9,  name: 'Antichambre de Bevelle',     stars: 4, maxTurns: 18, timeLimit: 35, quota: 92,  minWins: 32,  minRatio: 56, mode: 'OR',  gilReward: 365, forcedCombo: null },
  { id: 10, name: 'Cercle du Palais Guado',     stars: 4, maxTurns: 20, timeLimit: 35, quota: 106, minWins: 40,  minRatio: 60, mode: 'OR',  gilReward: 425, forcedCombo: null },
  { id: 11, name: 'Salle du Conseil',           stars: 4, maxTurns: 20, timeLimit: 30, quota: 120, minWins: 50,  minRatio: 64, mode: 'AND', gilReward: 490, forcedCombo: 'both' },
  { id: 12, name: 'Abysses de Sin',             stars: 5, maxTurns: 24, timeLimit: 30, quota: 140, minWins: 65,  minRatio: 68, mode: 'AND', gilReward: 560, forcedCombo: 'both' },
  { id: 13, name: 'Ruines de Zanarkand',        stars: 5, maxTurns: 26, timeLimit: 25, quota: 165, minWins: 80,  minRatio: 74, mode: 'AND', gilReward: 635, forcedCombo: 'both' },
  { id: 14, name: 'Trône Céleste',              stars: 5, maxTurns: 30, timeLimit: 25, quota: 200, minWins: 100, minRatio: 80, mode: 'AND', gilReward: 715, forcedCombo: 'both' },
];

function computeRatio(stats) {
  const games = stats.wins + stats.losses;
  return games >= 5 ? (stats.wins / games) * 100 : 0;
}

function isDealerUnlocked(dealer, stats) {
  const ratio = computeRatio(stats);
  const winsOk = stats.wins >= dealer.minWins;
  const ratioOk = ratio >= dealer.minRatio;
  return dealer.mode === 'AND' ? (winsOk && ratioOk) : (winsOk || ratioOk);
}
