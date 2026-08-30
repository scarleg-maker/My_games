const { Game } = require('./lib/game');
const { legalMoves } = require('./lib/rules');
const AI = require('./lib/ai');

function simulateAllAI(n, difficulty) {
  const g = new Game('AI' + n, n);
  for (let i = 0; i < n; i++) g.addJoueurIA();
  g.aiDifficulty = difficulty;
  g.startHand();
  let steps = 0;
  while (g.phase !== 'scoring' && steps < 5000) {
    steps++;
    if (g.phase === 'bidding') {
      const pid = g.currentBidder();
      g.placeBid(pid, AI.chooseBid(g, pid, g.aiDifficulty));
    } else if (g.phase === 'chien') {
      g.submitChienDiscard(g.taker, AI.chooseDiscard(g, g.taker, g.aiDifficulty));
    } else if (g.phase === 'calling') {
      g.callKing(g.taker, AI.chooseKing(g, g.taker));
    } else if (g.phase === 'poignee') {
      const pending = g.joueurs.find((p) => !g.readySet.has(p.id));
      if (pending) {
        const d = AI.choosePoignee(g, pending.id, g.aiDifficulty);
        if (d) { try { g.declarePoignee(pending.id, d); } catch (e) {} }
        if (!g.chelemAnnonce && AI.shouldAnnounceChelem(g, pending.id, g.aiDifficulty)) {
          try { g.announceChelem(pending.id); } catch (e) {}
        }
        g.confirmReady(pending.id);
      }
    } else if (g.phase === 'playing') {
      const pid = g.joueurs[g.turnIndex].id;
      g.playCard(pid, AI.chooseCard(g, pid, g.aiDifficulty));
    } else if (g.phase === 'all_passed') {
      g.startHand();
    }
  }
  console.log(`[IA ${n}j/${difficulty}] phase=${g.phase} steps=${steps} taker=${g.taker} level=${g.bidLevel} success=${g.lastResult && g.lastResult.success} chelem=${g.lastResult && g.lastResult.chelemBonus} sumDelta=${g.lastResult ? Object.values(g.lastResult.delta).reduce((a, b) => a + b, 0) : 'N/A'}`);
}
['debutant', 'confirme', 'expert'].forEach((d) => [3, 4, 5].forEach((n) => simulateAllAI(n, d)));
console.log('--- fin des simulations 100% IA (3 niveaux) ---');


function simulate(n) {
  const g = new Game('TEST', n);
  for (let i = 0; i < n; i++) g.addJoueur('p' + i, 'Joueur' + i);
  g.startHand();
  console.log(`--- ${n} joueurs --- phase=${g.phase}`);

  // Bidding: first player bids garde, rest pass
  let count = 0;
  while (g.phase === 'bidding') {
    const cur = g.currentBidder();
    if (count === 0) g.placeBid(cur, 'garde'); else g.placeBid(cur, 'passe');
    count++;
  }
  console.log('taker=', g.taker, 'level=', g.bidLevel, 'phase=', g.phase);

  if (g.phase === 'chien') {
    const hand = g.hands[g.taker];
    const cfg = require('./lib/rules').CONFIG[n];
    const nonTrumpNonKing = hand.filter((c) => c.suit !== 'A' && c.suit !== 'X' && !(c.suit !== 'A' && c.suit !== 'X' && c.rank === 14));
    const discard = nonTrumpNonKing.slice(0, cfg.chien).map((c) => c.id);
    g.submitChienDiscard(g.taker, discard);
  }
  console.log('phase after chien=', g.phase);

  if (g.phase === 'calling') {
    const suits = ['C', 'D', 'P', 'T'];
    const holds = g.hands[g.taker].filter((c) => c.rank === 14).map((c) => c.suit);
    const pick = suits.find((s) => !holds.includes(s));
    g.callKing(g.taker, pick);
  }
  console.log('phase after calling=', g.phase, 'partner=', g.partnerId);

  if (g.phase === 'poignee') {
    for (const p of g.joueurs) g.confirmReady(p.id);
  }
  console.log('phase after poignee=', g.phase);

  // Play all tricks with simple legal-first strategy
  let safety = 0;
  while (g.phase === 'playing' && safety < 1000) {
    safety++;
    const pid = g.joueurs[g.turnIndex].id;
    const hand = g.hands[pid];
    const ledSuit = g.currentTrick.length ? require('./lib/rules').determineLedSuit(g.currentTrick) : null;
    const legal = legalMoves(hand, g.currentTrick, ledSuit);
    const chosen = legal[Math.floor(Math.random() * legal.length)];
    g.playCard(pid, chosen.id);
  }
  console.log('phase after play=', g.phase, 'tricks=', g.tricks.length);
  console.log('result=', JSON.stringify(g.lastResult, null, 2));
  console.log('scores=', g.scores);

  // sanity: sum of deltas should be 0
  const sum = Object.values(g.lastResult.delta).reduce((a, b) => a + b, 0);
  console.log('sum of deltas (should be ~0):', sum);
}

[3, 4, 5].forEach(simulate);
console.log('ALL SIMULATIONS COMPLETED OK');
