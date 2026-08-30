/**
 * Test unitaire déterministe de la machine à états lib/tournament.js
 * (sans réseau). On utilise directement round.solution — normalement caché
 * aux clients — pour scripter des victoires/défaites exactes et vérifier
 * les deux modes de bout en bout : Sprinteur (cible atteinte) et Survie
 * (élimination progressive jusqu'à un survivant, puis cas d'égalité à 0 survivant).
 */
const assert = require("assert");
const themeStore = require("../lib/themeStore");
const { Tournament } = require("../lib/tournament");
const { validateArrangement } = require("../lib/puzzleEngine");

function solveWith(t, slot) {
  const order = t.round.solution.map((c) => c.name);
  return t.submit(slot, order);
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

/**
 * Trouve, SANS toucher à l'état du tournoi, un ordre garanti incorrect pour la
 * manche en cours (on ne peut pas se permettre de "deviner et re-soumettre" :
 * une soumission gagnante consomme le tour du joueur et une resoumission
 * échouerait avec "Tu ne peux plus jouer cette manche").
 */
function findWrongOrder(t) {
  for (const perm of permutations(t.round.display.map((c) => c.name))) {
    const arrangement = perm.map((n) => t.round.display.find((c) => c.name === n));
    const { solved } = validateArrangement(arrangement, t.round.links, t.theme.criteria, t.theme.battleTable);
    if (!solved) return perm;
  }
  return null; // cas dégénéré : toutes les permutations résolvent l'énigme
}

function failWith(t, slot) {
  const order = findWrongOrder(t);
  if (!order) throw new Error("Toutes les permutations résolvent cette énigme, impossible de forcer un échec.");
  return t.submit(slot, order);
}

function testSprint() {
  console.log("=== [logique] Sprinteur : cible atteinte ===");
  const t = new Tournament(themeStore);
  t.configure({ themeId: "pokemon", mode: "sprint", sprintTarget: 3, livesPerRound: 4 });
  t.setPlayerName(1, "Alice");
  t.setPlayerName(2, "Bob");
  t.start();
  assert.strictEqual(t.status, "playing");

  for (let round = 1; round <= 3; round++) {
    const res = solveWith(t, 1); // Alice gagne toujours
    assert.strictEqual(res.playerResult.solved, true, `manche ${round} devrait être résolue par Alice`);
    assert.strictEqual(res.scorerSlot, 1);
    if (round < 3) {
      assert.strictEqual(res.tournamentOver, false, `le tournoi ne doit pas être fini avant la manche 3 (round ${round})`);
      assert.strictEqual(res.roundOver, true);
      t.startNextRound();
    } else {
      assert.strictEqual(res.tournamentOver, true, "le tournoi doit être fini après 3 victoires d'Alice");
      assert.deepStrictEqual(res.winnerSlots, [1]);
    }
  }
  assert.strictEqual(t.status, "finished");
  assert.strictEqual(t.players[1].score, 3);
  console.log("✅ Sprinteur OK (Alice gagne 3-0, tournoi terminé correctement)");

  console.log("=== [logique] Sprinteur : personne ne résout (tous à sec de vies) -> manche nulle, tournoi continue ===");
  const t2 = new Tournament(themeStore);
  t2.configure({ themeId: "pokemon", mode: "sprint", sprintTarget: 2, livesPerRound: 1 });
  t2.setPlayerName(1, "Alice");
  t2.setPlayerName(2, "Bob");
  t2.start();
  const roundNumberBefore = t2.round.number;
  const r1 = failWith(t2, 1);
  assert.strictEqual(r1.playerResult.solved, false);
  assert.strictEqual(r1.roundOver, false, "la manche ne doit pas finir tant que Bob n'a pas aussi échoué");
  const r2 = failWith(t2, 2);
  assert.strictEqual(r2.roundOver, true, "la manche doit finir quand tous les joueurs actifs sont à sec");
  assert.strictEqual(r2.tournamentOver, false);
  assert.strictEqual(t2.status, "playing", "le tournoi doit continuer après une manche sans vainqueur");
  console.log("✅ Manche sans vainqueur gérée correctement, tournoi toujours en cours");
}

function testSurvieEliminationJusquaUnSurvivant() {
  console.log("=== [logique] Survie : élimination progressive jusqu'à un survivant ===");
  const t = new Tournament(themeStore);
  t.configure({ themeId: "pokemon", mode: "survie", livesPerRound: 1 });
  t.setPlayerName(1, "Casey");
  t.setPlayerName(2, "Drew");
  t.setPlayerName(3, "Erika");
  t.start();
  assert.strictEqual(t.round.participants.length, 3);

  // Manche 1 : Casey et Drew réussissent, Erika échoue -> éliminée
  let r;
  r = solveWith(t, 1); assert.strictEqual(r.roundOver, false);
  r = solveWith(t, 2); assert.strictEqual(r.roundOver, false);
  r = failWith(t, 3);
  assert.strictEqual(r.roundOver, true, "manche 1 doit se clore une fois les 3 joueurs résolus");
  assert.strictEqual(t.players[3].active, false, "Erika doit être éliminée");
  assert.strictEqual(t.status, "playing", "il reste 2 joueurs actifs, le tournoi continue");

  t.startNextRound(); // le serveur ferait ceci après un court délai
  assert.strictEqual(t.round.participants.length, 2, "la manche 2 ne doit avoir que 2 participants");

  // Manche 2 : Casey réussit, Drew échoue -> Drew éliminé, Casey seul survivant -> tournoi fini
  r = solveWith(t, 1); assert.strictEqual(r.roundOver, false);
  r = failWith(t, 2);
  assert.strictEqual(r.roundOver, true);
  assert.strictEqual(r.tournamentOver, true, "un seul survivant doit terminer le tournoi");
  assert.deepStrictEqual(r.winnerSlots, [1]);
  assert.strictEqual(t.status, "finished");
  assert.strictEqual(t.players[1].score, 2, "Casey doit avoir survécu à 2 manches");
  console.log("✅ Survie OK (Casey dernier survivant après 2 manches, score=2)");
}

function testSurvieEgaliteZeroSurvivant() {
  console.log("=== [logique] Survie : tous éliminés la même manche -> égalité ===");
  const t = new Tournament(themeStore);
  t.configure({ themeId: "pokemon", mode: "survie", livesPerRound: 1 });
  t.setPlayerName(1, "Casey");
  t.setPlayerName(2, "Drew");
  t.start();
  let r = failWith(t, 1); assert.strictEqual(r.roundOver, false);
  r = failWith(t, 2);
  assert.strictEqual(r.roundOver, true);
  assert.strictEqual(r.tournamentOver, true, "0 survivant doit quand même terminer le tournoi (égalité)");
  assert.strictEqual(r.winnerSlots.length, 2, "égalité entre les 2 joueurs éliminés au même tour");
  assert.strictEqual(t.status, "finished");
  console.log("✅ Cas d'égalité (0 survivant) géré correctement :", r.winnerSlots);
}

function testMasterEndAndReset() {
  console.log("=== [logique] Fin manuelle (master:end) et réinitialisation ===");
  const t = new Tournament(themeStore);
  t.configure({ themeId: "dragonball", mode: "sprint", sprintTarget: 10, livesPerRound: 4 });
  t.setPlayerName(1, "Sangoku-fan");
  t.start();
  solveWith(t, 1); // score = 1, loin de la cible 10
  const state = t.end();
  assert.strictEqual(state.status, "finished");
  assert.deepStrictEqual(state.winnerSlots, [1], "seul joueur avec le meilleur score doit gagner à l'arrêt manuel");
  t.resetToLobby();
  assert.strictEqual(t.status, "lobby");
  assert.strictEqual(t.players[1].score, 0, "le score doit être remis à zéro après reset");
  assert.strictEqual(t.players[1].name, "Sangoku-fan", "le nom du joueur doit être conservé après reset");
  console.log("✅ Fin manuelle + reset OK (thème Dragon Ball également vérifié)");
}

try {
  testSprint();
  testSurvieEliminationJusquaUnSurvivant();
  testSurvieEgaliteZeroSurvivant();
  testMasterEndAndReset();
  console.log("\n🎉 TOUTE LA LOGIQUE DE TOURNOI EST VALIDÉE.");
} catch (e) {
  console.error("\n❌ ÉCHEC:", e.message);
  console.error(e.stack);
  process.exitCode = 1;
}
