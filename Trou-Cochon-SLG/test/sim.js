// Simulation du moteur : conservation des pions, fin de partie, règles des tours.
const { createEngine } = require('../server.js');
const assert = require('assert');
let games = 0, maxRolls = 0;
for (let it = 0; it < 4000; it++) {
  const nbJ = 2 + (it % 5), nbC = 6 + (it % 5), nbP = 5 + (it % 4);
  const g = createEngine();
  const parts = Array.from({ length: nbJ }, (_, i) => i);
  g.start(parts, nbC, nbP);
  let rolls = 0, turnRolls = 0, lastSeat = g.current, lastRound = 1;
  while (!g.over) {
    const v = g.rollValue(); assert(v >= 1 && v <= nbC);
    const before = g.holes.slice(), seat = g.current, round = g.round;
    const r = g.resolve(v); rolls++; turnRolls++;
    // règle : au 1er tour un seul lancer, ensuite 3 maximum
    assert(turnRolls <= (round === 1 ? 1 : 3));
    if (v === nbC) assert(r.kind === 'lost' && g.lost.length > 0);
    else if (before[v - 1] !== null) { assert(r.kind === 'recover' && g.holes[v - 1] === null && r.turnEnds); }
    else assert(r.kind === 'place' && g.holes[v - 1] === seat);
    const total = Object.values(g.hand).reduce((a, b) => a + b, 0) + g.holes.filter(x => x !== null).length + g.lost.length;
    assert.strictEqual(total, nbJ * nbP, 'conservation des pions');
    if (!g.over && r.turnEnds) { g.advance(); turnRolls = 0; assert(!g.ranking.includes(g.current)); }
    assert(rolls < 200000, 'partie sans fin');
  }
  assert.deepStrictEqual([...g.ranking].sort(), parts, 'classement = permutation des joueurs');
  games++; maxRolls = Math.max(maxRolls, rolls);
}
console.log(`OK : ${games} parties simulées, la plus longue = ${maxRolls} lancers`);
