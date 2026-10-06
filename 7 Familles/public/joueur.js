const $ = id => document.getElementById(id);
const socket = io();
SF.watchConnection(socket);

const myId = (location.pathname.match(/joueur(\d+)/i) || [])[1] || '';
$('roomCode').textContent = SF.room;

// État complet de la page : tout l'affichage est recalculé à partir de lui (render),
// ce qui permet de recharger la page ou de perdre la connexion sans rien casser.
const S = {
  loaded: false, exists: false, name: '', started: false, handRevealed: false, ready: false,
  hand: [], families: [], players: [], current: null, piocheCount: 0, completed: [],
  request: null, pendingDraw: null, over: null, overDismissed: false, noRoom: false,
};

socket.on('connect', () => { S.noRoom = false; socket.emit('player-join', { room: SF.room, playerId: myId }); });
socket.on('no-room', () => { S.noRoom = true; render(); });
socket.on('error-msg', m => SF.toast(m, 'bad'));

socket.on('your-info', d => {
  Object.assign(S, {
    loaded: true, exists: d.exists, name: d.name, started: d.started, players: d.players, families: d.families,
    current: d.currentPlayerId, piocheCount: d.piocheCount, completed: d.completedFamilies, request: d.requestContext,
    ready: d.ready, handRevealed: d.handRevealed, hand: d.hand, pendingDraw: d.pendingDraw, over: d.over,
  });
  if (d.exists) SF.recent.add(SF.room, 'joueur', myId);
  render();
});
socket.on('game-started', d => {
  Object.assign(S, { started: true, players: d.players, piocheCount: d.piocheCount, handRevealed: false, ready: false,
    hand: [], current: null, completed: [], request: null, pendingDraw: null, over: null, overDismissed: false });
  render();
});
socket.on('game-reset', () => location.reload());
socket.on('your-hand', d => { S.hand = d.hand; S.handRevealed = true; if (d.families && d.families.length) S.families = d.families; render(); });
socket.on('card-received', ({ card, fromName }) => SF.toast(`✅ Carte reçue de ${fromName} : ${card.number}-${card.name}`, 'ok'));
socket.on('turn-changed', d => { S.current = d.currentPlayerId; S.piocheCount = d.piocheCount; S.request = null; render(); });
socket.on('request-context-update', ctx => { S.request = ctx; render(); });
socket.on('card-drawn', d => { S.pendingDraw = d.card; S.piocheCount = d.piocheCount; render(); });
socket.on('pioche-count', d => { S.piocheCount = d.count; render(); });
socket.on('family-completed', d => { S.completed = d.completed; render(); });
socket.on('game-over', d => { S.over = d; S.overDismissed = false; render(); });

// ---------- actions
$('dealBtn').onclick = () => socket.emit('request-hand');
$('readyBtn').onclick = () => { S.ready = true; render(); socket.emit('player-ready'); };
$('piocheBtn').onclick = () => socket.emit(S.piocheCount > 0 ? 'draw-pioche' : 'pass-turn');
$('drawCorrectBtn').onclick = () => { S.pendingDraw = null; render(); socket.emit('draw-result', { correct: true }); };
$('drawWrongBtn').onclick = () => { S.pendingDraw = null; render(); socket.emit('draw-result', { correct: false }); };
$('gameOverClose').onclick = () => { S.overDismissed = true; render(); };

// ---------- affichage
const famOf = name => S.families.find(f => f.name === name) || { name, color: '#999', size: 6 };
const playerName = id => (S.players.find(p => p.id === id) || {}).name || `Joueur ${id}`;
const show = (id, on) => $(id).classList.toggle('hidden', !on);

function render() {
  const msg = $('messageBox');
  if (S.noRoom || (S.loaded && !S.exists)) {
    ['waitingBox', 'dealBox', 'readyBox', 'gameArea', 'drawModal', 'gameOverModal'].forEach(id => show(id, false));
    msg.classList.remove('hidden');
    msg.innerHTML = S.noRoom
      ? `<p>Le salon <strong>${SF.esc(SF.room)}</strong> n'existe plus (serveur redémarré ou salon expiré). Demandez à l'arbitre de le recréer.</p><a href="/">Retour à l'accueil</a>`
      : `<p>Le siège « Joueur ${SF.esc(myId)} » n'existe pas (encore) dans le salon <strong>${SF.esc(SF.room)}</strong>. L'arbitre doit d'abord enregistrer les joueurs.</p><button onclick="location.reload()">Réessayer</button> <a href="/${SF.room}/rejoindre" style="margin-left:10px">Choisir un autre siège</a>`;
    return;
  }
  msg.classList.add('hidden');
  if (!S.loaded) return;

  $('playerTitle').textContent = `🎴 ${S.name} (Joueur ${myId})`;
  const turnStarted = !!S.current;
  show('waitingBox', !S.started);
  show('dealBox', S.started && !S.handRevealed);
  show('readyBox', S.started && S.handRevealed && !turnStarted);
  $('readyBtn').disabled = S.ready;
  $('readyStatus').textContent = S.ready ? 'En attente des autres joueurs...' : '';
  show('gameArea', S.started && S.handRevealed);

  const myTurn = turnStarted && S.current === myId && !S.over;
  const requestedMe = !!(S.request && S.request.toId === myId) && !S.over;
  renderBanners(turnStarted, myTurn, requestedMe);

  show('myTurnControls', myTurn);
  if (myTurn) renderTurnControls();

  renderHand(requestedMe);
  renderFamilyClaims();
  renderCompleted();

  show('drawModal', !!S.pendingDraw);
  if (S.pendingDraw) { const b = $('drawnCardBox'); b.innerHTML = ''; b.appendChild(buildCardEl(S.pendingDraw, false)); }
  show('gameOverModal', !!S.over && !S.overDismissed);
  if (S.over) {
    const lines = S.over.standings.map(s => `${SF.esc(s.name)} — ${s.count} famille(s)`).join('<br>');
    $('gameOverText').innerHTML = `<strong>${S.over.tie ? 'Égalité entre ' : 'Gagnant : '}${SF.esc(S.over.winner)}</strong><br><br>${lines}`;
  }
}

function renderBanners(turnStarted, myTurn, requestedMe) {
  const banner = $('turnBanner');
  if (S.over) { banner.textContent = 'Partie terminée.'; banner.className = 'turn-banner'; }
  else if (!turnStarted) { banner.textContent = 'En attente : la partie commence quand tous les joueurs sont prêts.'; banner.className = 'turn-banner'; }
  else if (myTurn) {
    const asking = S.request && S.request.fromId === myId;
    banner.textContent = asking ? `🎯 Vous interrogez ${playerName(S.request.toId)}.` : "🎯 C'est votre tour ! Choisissez un adversaire.";
    banner.className = 'turn-banner my-turn';
  } else { banner.textContent = `En attente : c'est au tour de ${playerName(S.current)}.`; banner.className = 'turn-banner'; }

  show('requestedBanner', requestedMe);
  if (requestedMe) $('requestedBanner').textContent = `${playerName(S.request.fromId)} vous demande une carte (annoncée à l'oral). Cliquez dessus si vous l'avez, sinon ne faites rien.`;
}

function renderTurnControls() {
  const grid = $('opponentGrid');
  const html = S.players.filter(p => p.id !== myId).map(p =>
    `<button class="opponent-btn${S.request && S.request.toId === p.id ? ' selected' : ''}" data-opp="${p.id}">${SF.esc(p.name)}</button>`).join('');
  if (grid.dataset.h !== html) { grid.innerHTML = html; grid.dataset.h = html; }
  grid.querySelectorAll('[data-opp]').forEach(b => b.onclick = () => socket.emit('select-opponent', { opponentId: b.dataset.opp }));

  const asking = S.request && S.request.fromId === myId;
  show('askingInfo', !!asking);
  if (asking) $('askingInfo').textContent = `Annoncez à voix haute la carte demandée à ${playerName(S.request.toId)}. S'il l'a, il clique dessus ; sinon, piochez.`;

  const pb = $('piocheBtn');
  pb.textContent = S.piocheCount > 0 ? `🎲 Pioche (${S.piocheCount})` : '⏭️ Pioche vide — Passer mon tour';
  pb.disabled = !!S.pendingDraw;

  const counts = {};
  S.hand.forEach(c => { counts[c.family] = (counts[c.family] || 0) + 1; });
  $('handFamiliesSummary').innerHTML = S.families.filter(f => counts[f.name] > 0)
    .map(f => `<span class="family-chip" style="background:${f.color}">${SF.esc(f.name)} (${counts[f.name]})</span>`).join('');
}

function buildCardEl(card, clickable) {
  const div = document.createElement('div');
  div.className = 'card' + (clickable ? ' clickable' : '');
  div.style.borderColor = famOf(card.family).color;
  div.innerHTML = `<img src="${SF.esc(card.file)}" alt="${SF.esc(card.name)}"><div class="card-label">${SF.esc(card.number)}-${SF.esc(card.name)}</div>`;
  return div;
}

function renderHand(requestedMe) {
  $('handCount').textContent = S.hand.length;
  const famIndex = {};
  S.families.forEach((f, i) => { famIndex[f.name] = i; });
  // cartes rangées par famille (ordre des familles), puis par numéro
  const sorted = [...S.hand].sort((a, b) => {
    const ia = famIndex[a.family] ?? 999, ib = famIndex[b.family] ?? 999;
    return ia !== ib ? ia - ib : a.number.localeCompare(b.number, undefined, { numeric: true });
  });
  const grid = $('handGrid');
  grid.innerHTML = '';
  sorted.forEach(card => {
    const el = buildCardEl(card, requestedMe);
    if (requestedMe) el.onclick = () => socket.emit('give-card', { cardId: card.id });
    grid.appendChild(el);
  });
}

function renderFamilyClaims() {
  const counts = {};
  S.hand.forEach(c => { counts[c.family] = (counts[c.family] || 0) + 1; });
  const eligible = S.families.filter(f => counts[f.name] >= (f.size || 6) && !S.completed.some(cf => cf.family === f.name));
  $('familyClaimBox').style.display = eligible.length && !S.over ? 'block' : 'none';
  const row = $('familyBtnRow');
  row.innerHTML = '';
  eligible.forEach(f => {
    const btn = document.createElement('button');
    btn.textContent = `🎉 Famille ${f.name}`;
    btn.style.background = f.color;
    btn.onclick = () => socket.emit('claim-family', { family: f.name });
    row.appendChild(btn);
  });
}

function renderCompleted() {
  $('completedFamiliesPlayer').innerHTML = S.completed.length
    ? S.completed.map(cf => `<span class="family-chip" style="background:${famOf(cf.family).color}">${SF.esc(cf.family)} → ${SF.esc(cf.ownerName)}</span>`).join('')
    : '<span class="muted small">Aucune pour l\'instant.</span>';
}
