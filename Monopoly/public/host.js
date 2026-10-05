const ROOM = (location.pathname.split('/')[1] || '').toUpperCase();
const socket = io();
let room = null, game = null;

document.getElementById('room-code').textContent = ROOM;
document.title = `Monopoly — Salon ${ROOM}`;
MP.recent.add(ROOM, 'hôte');

const $ = (id) => document.getElementById(id);
const boardSelect = $('board-select'), seatRows = $('seat-rows');

function act(a) {
  socket.emit('act', a, (r) => { if (r && !r.ok) MP.toast(r.error, 'bad'); });
}

// ---------- connexion
socket.on('connect', () => {
  socket.emit('joinRoom', { code: ROOM, role: 'host' }, (r) => {
    if (!r.ok) return noRoom(r.error);
    room = r.room; game = r.state; render();
  });
});
socket.on('room', (r) => { room = r; if (r.phase === 'lobby') game = null; render(); });
socket.on('state', (s) => { game = s; renderGame(); });
socket.on('roomClosed', () => noRoom('Ce salon a été fermé.'));
function noRoom(msg) {
  document.body.innerHTML = `<main class="home"><section class="setup-card"><h2>Salon introuvable</h2><p>${MP.esc(msg || '')}</p><a class="btn primary" href="/">Retour à l'accueil</a></section></main>`;
}

fetch('/api/boards').then((r) => r.json()).then((boards) => {
  boardSelect.innerHTML = boards.map((b) => `<option value="${b.id}">${MP.esc(b.name)}</option>`).join('');
  if (room) boardSelect.value = room.boardId;
});
boardSelect.onchange = () => act({ type: 'config', boardId: boardSelect.value });
$('count-minus').onclick = () => room && act({ type: 'config', nbPlayers: room.nbPlayers - 1 });
$('count-plus').onclick = () => room && act({ type: 'config', nbPlayers: room.nbPlayers + 1 });
$('solo-ai-btn').onclick = () => {
  // 1 humain + 3 IA
  act({ type: 'config', nbPlayers: 4 });
  for (let i = 0; i < 4; i++) act({ type: 'config', seat: i, seatType: i === 0 ? 'human' : 'ai' });
};
$('start-btn').onclick = () => act({ type: 'start' });
$('rematch-btn').onclick = () => act({ type: 'rematch' });
$('reset-btn').onclick = () => act({ type: 'reset' });

// ---------- invitation (QR + lien)
const isLocal = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname);
function baseUrl() {
  // en local, « localhost » n'est pas joignable depuis un téléphone : on propose l'adresse du réseau
  return isLocal && room && room.lanUrls && room.lanUrls.length ? room.lanUrls[0] : location.origin;
}
function renderInvite() {
  const url = `${baseUrl()}/${ROOM}/rejoindre`;
  $('join-url').textContent = url;
  $('copy-join').onclick = () => MP.copy(url);
  $('watch-link').href = `/${ROOM}/plateau`;
  MP.drawQR($('qr'), url, 128);
}

// ---------- configuration des sièges
function seatRowHtml(s) {
  const status = s.type === 'ai' ? '🤖 IA'
    : s.claimed ? `✔ installé${s.online ? ' · <span class="on-txt">en ligne</span>' : ''}` : 'en attente…';
  return `<div class="player-row" data-seat="${s.index}">
    <div class="swatch" style="background:${s.color}"></div>
    <input type="text" class="seat-name" maxlength="16" value="${MP.esc(s.name)}" placeholder="${s.type === 'ai' ? 'Nom de l\'IA' : 'Nom suggéré (optionnel)'}">
    <select class="seat-type">
      <option value="human"${s.type === 'human' ? ' selected' : ''}>Humain</option>
      <option value="ai"${s.type === 'ai' ? ' selected' : ''}>IA</option>
    </select>
    <span class="seat-status small muted" data-status>${status}</span>
    ${s.type === 'human' && s.claimed ? '<button class="seat-release" title="Libérer le siège">✕</button>' : ''}
    <a class="seat-link small" href="/${ROOM}/joueur${s.index + 1}" target="_blank" title="Ouvrir ce siège">↗</a>
  </div>`;
}
function renderLobby() {
  const typing = seatRows.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
  $('count-display').textContent = room.nbPlayers;
  if (document.activeElement !== boardSelect) boardSelect.value = room.boardId;
  if (typing) {
    // on ne reconstruit pas les lignes pendant la saisie : on met seulement à jour les statuts
    room.seats.forEach((s) => {
      const el = seatRows.querySelector(`[data-seat="${s.index}"] [data-status]`);
      if (el) el.innerHTML = seatRowHtml(s).match(/data-status>([\s\S]*?)<\/span>/)[1];
    });
  } else {
    seatRows.innerHTML = room.seats.map(seatRowHtml).join('');
    seatRows.querySelectorAll('.player-row').forEach((row) => {
      const i = +row.dataset.seat;
      row.querySelector('.seat-name').onchange = (e) => act({ type: 'config', seat: i, seatName: e.target.value });
      row.querySelector('.seat-type').onchange = (e) => act({ type: 'config', seat: i, seatType: e.target.value });
      const rel = row.querySelector('.seat-release');
      if (rel) rel.onclick = () => act({ type: 'release', seat: i });
    });
  }
  const missing = room.seats.filter((s) => !s.claimed).length;
  const humans = room.seats.filter((s) => s.type === 'human').length;
  $('start-hint').textContent = missing
    ? `${missing} siège${missing > 1 ? 's' : ''} à occuper : les joueurs scannent le QR code, ou passe le siège en IA.`
    : humans ? 'Tout le monde est installé : la partie peut démarrer.' : 'Il faut au moins un joueur humain.';
  $('start-btn').disabled = missing > 0 || humans === 0;
}

// ---------- partie en cours
function renderGame() {
  if (!room || room.phase === 'lobby' || !game) return;
  $('game-title').textContent = game.gameOver
    ? `🏆 ${game.players.find((p) => p.id === game.winnerId)?.name} remporte la partie !`
    : `Partie en cours — plateau « ${game.boardName} »`;
  $('game-players').innerHTML = game.players.map((p, i) => `
    <div class="player-card${i === game.currentPlayerIndex && !game.gameOver ? ' active' : ''}${p.bankrupt ? ' bankrupt' : ''}">
      <div class="swatch" style="background:${p.color}"></div>
      <div class="pname">${MP.esc(p.name)}${p.type === 'ai' ? ' 🤖' : ''}${p.inJail ? ' 🔒' : ''}</div>
      <div class="pmoney">${p.money} M€</div></div>`).join('');
}

function render() {
  if (!room) return;
  renderInvite();
  const lobby = room.phase === 'lobby';
  $('lobby-card').classList.toggle('hidden', !lobby);
 
  $('game-card').classList.toggle('hidden', lobby);
  $('rematch-btn').classList.toggle('hidden', room.phase !== 'over');
  if (lobby) renderLobby(); else renderGame();
}
