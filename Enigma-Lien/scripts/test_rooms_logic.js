/**
 * Tests unitaires du registre de salons (lib/rooms.js) : codes, doublons,
 * réservation de places, purge des salons inactifs. Sans réseau.
 */
const assert = require("assert");
const themeStore = require("../lib/themeStore");
const { RoomRegistry, validCode, cleanCode } = require("../lib/rooms");

console.log("=== [salons] codes ===");
assert.strictEqual(cleanCode("  k7qf "), "K7QF");
for (const bad of ["AB", "ABCDEFGHIJK", "AB CD", "A-BC", "API", "IMAGES", "JOUEUR1", "SOLO"]) {
  assert.ok(!validCode(bad), `${bad} devrait être refusé`);
}
for (const ok of ["ABC", "K7QF", "FAMILLE", "2026"]) assert.ok(validCode(ok), `${ok} devrait être accepté`);
console.log("✅ validation des codes OK");

console.log("=== [salons] création, doublons, reuse ===");
const reg = new RoomRegistry(themeStore, { idleMs: 50, maxRooms: 3 });
const a = reg.create("fam");
assert.strictEqual(a.code, "FAM");
assert.throws(() => reg.create("FAM"), /déjà en cours/);
assert.strictEqual(reg.create("FAM", { reuse: true }), a);
const gen = reg.create();
assert.ok(/^[A-Z2-9]{4}$/.test(gen.code) && !/[01ILO]/.test(gen.code));
assert.notStrictEqual(a.tournament, gen.tournament, "chaque salon a son propre tournoi");
console.log("✅ création / doublons / reuse OK");

console.log("=== [salons] places libres ===");
const claimed = [];
for (let i = 0; i < 10; i++) claimed.push(a.claimSlot());
assert.deepStrictEqual(claimed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.strictEqual(a.claimSlot(), null, "salon complet");
a.reservations.clear();
a.tournament.setPlayerName(1, "Alice");
assert.strictEqual(a.claimSlot(), 2, "une place nommée n'est plus proposée");
console.log("✅ attribution de places OK");

console.log("=== [salons] purge ===");
a.sockets = 1; // une page ouverte : le salon est conservé même inactif
a.lastActivity -= 10_000; gen.lastActivity -= 10_000;
assert.strictEqual(reg.purge(false), 1, "seul le salon sans page ouverte est supprimé");
assert.ok(reg.get("FAM") && !reg.get(gen.code));
a.sockets = 0;
assert.strictEqual(reg.purge(true), 1);
assert.strictEqual(reg.size, 0);
console.log("✅ purge des salons inactifs OK");

console.log("=== [salons] limite ===");
const small = new RoomRegistry(themeStore, { maxRooms: 2 });
const r1 = small.create("AAA"), r2 = small.create("BBB");
r1.sockets = 1; r2.sockets = 1;
assert.throws(() => small.create("CCC"), /Trop de salons/);
r2.sockets = 0;
assert.ok(small.create("CCC"), "un salon inactif est recyclé quand on atteint la limite");
console.log("✅ limite de salons OK");

console.log("\n🎉 REGISTRE DE SALONS VALIDÉ.");
