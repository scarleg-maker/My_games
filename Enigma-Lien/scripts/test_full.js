/**
 * Script de vérification end-to-end (pas un test unitaire formel) :
 *  1. démarre le serveur en sous-processus
 *  2. joue une partie solo complète jusqu'à la victoire (via l'API REST)
 *  3. simule un tournoi Sprinteur avec 2 joueurs via Socket.IO jusqu'à la victoire
 *  4. vérifie le câblage réseau d'un tournoi Survie (3 joueurs)
 *  5. vérifie les salons : codes, QR code, places libres, isolation entre salons simultanés
 * Échoue bruyamment (exit code != 0) si quoi que ce soit ne se comporte pas comme attendu.
 */
const { spawn } = require("child_process");
const path = require("path");
const { io } = require("socket.io-client");

const PORT = 9599;
const BASE = `http://localhost:${PORT}`;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function startServer() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  child.stdout.on("data", (d) => { if (d.toString().includes("en écoute")) ready = true; });
  child.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  const start = Date.now();
  while (!ready && Date.now() - start < 8000) await wait(100);
  if (!ready) throw new Error("Le serveur n'a pas démarré à temps.");
  return child;
}

async function testSolo() {
  console.log("\n=== Test solo (mode facile : 10 vies pour forcer la victoire à terme) ===");
  // On force beaucoup de vies pour garantir une victoire en un nombre raisonnable d'essais
  // (en réarrangeant intelligemment via recherche exhaustive des 6! = 720 permutations).
  let res = await fetch(`${BASE}/api/solo/start`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ themeId: "pokemon", player: "TestBot", lives: 5000 }),
  });
  const start = await res.json();
  if (!res.ok) throw new Error("start solo failed: " + JSON.stringify(start));
  console.log("Session créée, display:", start.display.map((p) => p.name).join(", "));

  // Recherche exhaustive de la bonne permutation parmi les 6 personnages affichés
  function permutations(arr) {
    if (arr.length <= 1) return [arr];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of permutations(rest)) out.push([arr[i], ...p]);
    }
    return out;
  }
  const names = start.display.map((p) => p.name);
  let solved = false;
  for (const perm of permutations(names)) {
    const r = await fetch(`${BASE}/api/solo/${start.sessionId}/validate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: perm }),
    });
    const data = await r.json();
    if (data.gameOver) {
      if (!data.won) throw new Error("La session solo s'est terminée en défaite avant d'avoir trouvé la solution — bug de vies ?");
      console.log("✅ Solo résolu après recherche exhaustive. Stats:", data.stats);
      solved = true;
      break;
    }
  }
  if (!solved) throw new Error("Aucune permutation n'a résolu l'énigme — le moteur de génération/validation est incohérent !");

  const lb = await (await fetch(`${BASE}/api/leaderboard`)).json();
  const me = lb.find((p) => p.name === "TestBot");
  if (!me || me.victoires !== 1) throw new Error("Le classement n'a pas été mis à jour correctement : " + JSON.stringify(lb));
  console.log("✅ Classement mis à jour :", me);
}

async function createRoom(code) {
  const r = await fetch(`${BASE}/api/rooms`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(code ? { code } : {}),
  });
  const data = await r.json();
  if (!data.ok) throw new Error("création de salon refusée : " + data.error);
  return data.code;
}

// Une page (maître ou joueur) se connecte toujours à UN salon : io({ query: { room } })
function connectPlayer(room) {
  return new Promise((resolve) => {
    const socket = io(BASE, { transports: ["websocket"], query: { room } });
    socket.on("connect", () => resolve(socket));
  });
}

async function solveRoundBruteForce(socket, slot, state) {
  // Cherche une permutation qui valide le lien, en itérant les permutations de state.round.display
  function permutations(arr) {
    if (arr.length <= 1) return [arr];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of permutations(rest)) out.push([arr[i], ...p]);
    }
    return out;
  }
  const names = state.round.display.map((p) => p.name);
  for (const perm of permutations(names)) {
    const res = await new Promise((resolve) => socket.emit("player:validate", { slot, order: perm }, resolve));
    if (!res.ok) throw new Error("validate error: " + res.error);
    if (res.result.playerResult.solved) return res.result;
  }
  throw new Error("Impossible de résoudre la manche par force brute — incohérence du moteur.");
}

async function testSprint() {
  console.log("\n=== Test tournoi Sprinteur (2 joueurs, cible = 2 manches gagnées) ===");
  const room = await createRoom();
  const master = await connectPlayer(room);
  master.emit("master:hello");
  await wait(200);

  await new Promise((resolve, reject) => master.emit("master:configure", { themeId: "pokemon", mode: "sprint", sprintTarget: 2, livesPerRound: 5000 }, (r) => r.ok ? resolve() : reject(new Error(r.error))));

  const p1 = await connectPlayer(room);
  const p2 = await connectPlayer(room);
  await new Promise((resolve, reject) => p1.emit("player:setName", { slot: 1, name: "Alice" }, (r) => r.ok ? resolve() : reject(new Error(r.error))));
  await new Promise((resolve, reject) => p2.emit("player:setName", { slot: 2, name: "Bob" }, (r) => r.ok ? resolve() : reject(new Error(r.error))));

  let p1State = null, p2State = null;
  p1.on("player:state", (s) => (p1State = s));
  p2.on("player:state", (s) => (p2State = s));
  await wait(200);

  await new Promise((resolve, reject) => master.emit("master:start", {}, (r) => r.ok ? resolve() : reject(new Error(r.error))));
  await wait(300);

  let tournamentOver = false;
  let masterState = null;
  master.on("master:state", (s) => { masterState = s; if (s.status === "finished") tournamentOver = true; });

  let rounds = 0;
  while (!tournamentOver && rounds < 6) {
    rounds++;
    await wait(200);
    if (!p1State || !p1State.round) { await wait(300); continue; }
    console.log(`  Manche ${p1State.round.number} : Alice tente de résoudre…`);
    const result = await solveRoundBruteForce(p1, 1, p1State);
    console.log(`  -> résolu (score Alice attendu++), tournamentOver=${result.tournamentOver}`);
    if (result.tournamentOver) { tournamentOver = true; break; }
    await wait(4000); // laisse le temps au serveur d'enchaîner la manche suivante (délai de 3.5s)
  }
  if (!tournamentOver) throw new Error("Le tournoi Sprinteur ne s'est pas terminé après plusieurs manches — bug d'enchaînement.");
  if (!masterState.winnerSlots.includes(1)) throw new Error("Alice aurait dû être déclarée vainqueur du Sprint : " + JSON.stringify(masterState.winnerSlots));
  console.log("✅ Sprinteur terminé, vainqueur(s) :", masterState.winnerSlots);

  master.close(); p1.close(); p2.close();
}

async function testSurvie() {
  // La machine à états (éliminations, survivant unique, égalité à 0 survivant) est déjà
  // validée de façon déterministe par scripts/test_tournament_logic.js. Ici on vérifie
  // uniquement le câblage réseau réel (Socket.IO) : inscriptions, démarrage, une vraie
  // soumission, arrêt manuel côté maître — sans dépendre de connaître la solution cachée.
  console.log("\n=== Test tournoi Survie (câblage réseau : lobby, démarrage, soumission, arrêt manuel) ===");
  const room = await createRoom();
  const master = await connectPlayer(room);
  master.emit("master:hello");
  await wait(200);
  await new Promise((resolve, reject) => master.emit("master:configure", { themeId: "dragonball", mode: "survie", livesPerRound: 3 }, (r) => r.ok ? resolve() : reject(new Error(r.error))));

  const sockets = [await connectPlayer(room), await connectPlayer(room), await connectPlayer(room)];
  const names = ["Casey", "Drew", "Erika"];
  const states = [null, null, null];
  for (let i = 0; i < 3; i++) {
    const slot = i + 1;
    await new Promise((resolve, reject) => sockets[i].emit("player:setName", { slot, name: names[i] }, (r) => r.ok ? resolve() : reject(new Error(r.error))));
    sockets[i].on("player:state", (s) => (states[i] = s));
  }
  await wait(200);

  let masterState = null;
  master.on("master:state", (s) => (masterState = s));

  await new Promise((resolve, reject) => master.emit("master:start", {}, (r) => r.ok ? resolve() : reject(new Error(r.error))));
  await wait(300);
  if (masterState.status !== "playing") throw new Error("Le tournoi Survie n'est pas passé en statut 'playing'.");
  if (masterState.players.filter((p) => p.active).length !== 3) throw new Error("Les 3 joueurs devraient être actifs au départ.");
  console.log("✅ Lobby -> démarrage OK, 3 joueurs actifs, thème Dragon Ball chargé côté tournoi.");

  // Casey soumet un vrai arrangement (peu importe s'il est juste ou faux : on vérifie juste
  // que le serveur traite la soumission sans planter et met à jour l'état de façon cohérente).
  const st = states[0];
  if (!st || !st.round) throw new Error("Casey n'a pas reçu la manche en cours.");
  const order = st.round.display.map((p) => p.name);
  const res = await new Promise((resolve) => sockets[0].emit("player:validate", { slot: 1, order }, resolve));
  if (!res.ok) throw new Error("Soumission refusée de façon inattendue : " + res.error);
  console.log(`✅ Soumission traitée (solved=${res.result.playerResult.solved}), vies restantes=${res.result.playerResult.livesLeft}.`);

  await new Promise((resolve, reject) => master.emit("master:end", {}, (r) => r.ok ? resolve() : reject(new Error(r.error))));
  await wait(200);
  if (masterState.status !== "finished") throw new Error("master:end aurait dû terminer le tournoi.");
  console.log("✅ Arrêt manuel du tournoi (master:end) OK, statut='finished'.");

  sockets.forEach((s) => s.close());
  master.close();
}


function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function testRooms() {
  console.log("\n=== Test salons (codes, QR code, places libres, isolation de 2 salons simultanés) ===");

  // codes : invalides / réservés / doublons
  let r = await (await fetch(`${BASE}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "ab" }) })).json();
  if (r.ok) throw new Error("Un code de 2 caractères aurait dû être refusé.");
  r = await (await fetch(`${BASE}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "images" }) })).json();
  if (r.ok) throw new Error("Un code réservé (IMAGES) aurait dû être refusé.");
  const A = await createRoom("famille");
  if (A !== "FAMILLE") throw new Error("Le code devrait être normalisé en majuscules : " + A);
  r = await (await fetch(`${BASE}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "FAMILLE" }) })).json();
  if (r.ok) throw new Error("Un code déjà pris aurait dû être refusé.");
  const B = await createRoom();
  if (!/^[A-Z2-9]{4}$/.test(B)) throw new Error("Code aléatoire inattendu : " + B);
  console.log(`✅ Codes : FAMILLE et ${B} créés, doublons / codes invalides / réservés refusés.`);

  // info + salon inexistant
  let info = await (await fetch(`${BASE}/api/rooms/familLe`)).json();
  if (!info.exists || info.seats.length !== 10) throw new Error("Info du salon FAMILLE incorrecte : " + JSON.stringify(info));
  info = await (await fetch(`${BASE}/api/rooms/ZZZZ9`)).json();
  if (info.exists) throw new Error("Le salon ZZZZ9 ne devrait pas exister.");

  // pages servies
  for (const [url, mustContain] of [
    [`/${A}`, "Salon"], [`/${A}/rejoindre`, "Rejoindre un salon"], [`/${A}/joueur3`, "slotLabel"], ["/", "Créer un salon"],
  ]) {
    const html = await (await fetch(BASE + url)).text();
    if (!html.includes(mustContain)) throw new Error(`La page ${url} ne contient pas "${mustContain}".`);
  }
  const old = await fetch(`${BASE}/maitre.html`, { redirect: "manual" });
  if (old.status !== 302) throw new Error("L'ancienne page /maitre.html aurait dû rediriger vers l'accueil (302), reçu " + old.status);
  const old2 = await fetch(`${BASE}/joueur2.html`, { redirect: "manual" });
  if (old2.status !== 302) throw new Error("L'ancienne page /joueur2.html aurait dû rediriger vers l'accueil.");
  const out = await fetch(`${BASE}/${A}/joueur11`);
  if (out.status !== 404) throw new Error("/CODE/joueur11 (hors 1..10) aurait dû être 404.");
  console.log("✅ Pages /CODE, /CODE/rejoindre, /CODE/joueurN servies ; anciennes URLs fixes redirigées.");

  // QR code
  const qr = await fetch(`${BASE}/api/qr?text=${encodeURIComponent("http://exemple.test/" + A + "/rejoindre")}`);
  const svg = await qr.text();
  if (!qr.headers.get("content-type").includes("image/svg+xml") || !svg.includes("<svg")) throw new Error("Le QR code n'est pas un SVG valide.");
  console.log(`✅ QR code SVG généré côté serveur (${svg.length} octets).`);

  // places libres : 3 arrivées simultanées -> 3 places différentes
  const claims = await Promise.all([1, 2, 3].map(() => fetch(`${BASE}/api/rooms/${A}/claim`, { method: "POST" }).then((x) => x.json())));
  const slots = claims.map((c) => c.slot);
  if (new Set(slots).size !== 3 || claims.some((c) => !c.ok)) throw new Error("Les places attribuées simultanément doivent être distinctes : " + JSON.stringify(claims));
  const none = await fetch(`${BASE}/api/rooms/NOPE2/claim`, { method: "POST" });
  if (none.status !== 404) throw new Error("claim sur un salon inconnu aurait dû être 404.");
  console.log("✅ 3 arrivées simultanées -> places distinctes", slots);

  // isolation : mêmes numéros de place dans 2 salons, tournoi lancé dans A seulement
  const mA = await connectPlayer(A), mB = await connectPlayer(B);
  mA.emit("master:hello"); mB.emit("master:hello");
  const stA = { v: null }, stB = { v: null };
  mA.on("master:state", (s) => (stA.v = s)); mB.on("master:state", (s) => (stB.v = s));
  await wait(200);
  let res = await emitAck(mA, "master:configure", { themeId: "pokemon", mode: "survie", livesPerRound: 3 });
  if (!res.ok) throw new Error(res.error);
  res = await emitAck(mB, "master:configure", { themeId: "dragonball", mode: "sprint", sprintTarget: 3, livesPerRound: 4 });
  if (!res.ok) throw new Error(res.error);

  const a1 = await connectPlayer(A), b1 = await connectPlayer(B);
  res = await emitAck(a1, "player:setName", { slot: 1, name: "Alice" });
  if (!res.ok) throw new Error(res.error);
  // même nom + même place dans l'AUTRE salon : doit être accepté (salons indépendants)
  res = await emitAck(b1, "player:setName", { slot: 1, name: "Alice" });
  if (!res.ok) throw new Error("Le même nom dans un autre salon devrait être accepté : " + res.error);
  await wait(200);

  res = await emitAck(mA, "master:start", {});
  if (!res.ok) throw new Error(res.error);
  await wait(300);
  if (stA.v.status !== "playing") throw new Error("Le salon A devrait être en cours de partie.");
  if (stB.v.status !== "lobby") throw new Error("Le salon B ne devrait PAS être affecté par le démarrage du salon A (status=" + stB.v.status + ").");
  if (stA.v.config.themeId !== "pokemon" || stB.v.config.themeId !== "dragonball") throw new Error("Les thèmes des deux salons devraient être indépendants.");

  // B démarre aussi, et A le termine : B continue
  res = await emitAck(mB, "master:start", {});
  if (!res.ok) throw new Error(res.error);
  res = await emitAck(mA, "master:end", {});
  if (!res.ok) throw new Error(res.error);
  await wait(300);
  if (stA.v.status !== "finished" || stB.v.status !== "playing") throw new Error(`Fin de A ne doit pas toucher B (A=${stA.v.status}, B=${stB.v.status}).`);
  console.log("✅ Deux salons simultanés (Pokémon/Survie et Dragon Ball/Sprint) restent totalement indépendants.");

  // les infos publiques reflètent l'état de chaque salon
  const iA = await (await fetch(`${BASE}/api/rooms/${A}`)).json();
  const iB = await (await fetch(`${BASE}/api/rooms/${B}`)).json();
  if (iA.status !== "finished" || iB.status !== "playing" || iB.mode !== "sprint") throw new Error("Infos publiques incohérentes : " + JSON.stringify([iA.status, iB.status, iB.mode]));

  // une page qui se connecte à un salon inexistant reçoit room:missing
  const ghost = await connectPlayer("ZZZZ9");
  const missing = await new Promise((resolve) => { ghost.on("room:missing", resolve); setTimeout(() => resolve(null), 1500); });
  if (!missing) throw new Error("Un salon inexistant doit déclencher l'événement room:missing.");
  ghost.close();

  [mA, mB, a1, b1].forEach((x) => x.close());
  console.log("✅ Infos publiques par salon OK, salon inexistant -> room:missing.");
}

(async () => {
  const child = await startServer();
  try {
    await testSolo();
    await testSprint();
    await testSurvie();
    await testRooms();
    console.log("\n🎉 TOUT EST OK.");
  } finally {
    child.kill();
  }
})().catch((e) => {
  console.error("\n❌ ÉCHEC:", e.message);
  process.exitCode = 1;
});
