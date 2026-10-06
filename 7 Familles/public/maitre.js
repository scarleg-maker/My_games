const $ = id => document.getElementById(id);
const socket = io();
SF.watchConnection(socket);

let familiesData = [], currentPlayers = [], lanUrls = [], started = false, playersCount = 4;

$('roomCode').textContent = SF.room;
$('inviteCode').textContent = SF.room;
$('noRoomCode').textContent = SF.room;

socket.on('connect', () => socket.emit('master-join', { room: SF.room }));
socket.on('error-msg', msg => { SF.toast(msg, 'bad'); $('startStatus').textContent = '❌ ' + msg; });
socket.on('no-room', () => { $('main').classList.add('hidden'); $('noRoom').classList.remove('hidden'); });
$('recreate').onclick = async () => {
  try {
    const r = await (await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: SF.room }) })).json();
    if (r.ok) location.reload(); else SF.toast(r.error, 'bad');
  } catch { SF.toast('Serveur injoignable', 'bad'); }
};

// ---- Onglets
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  $('tab-' + btn.dataset.tab).classList.add('active');
}));

// ---- Invitation (code + QR code + lien)
// En local, « localhost » n'est pas joignable depuis un téléphone : on propose l'adresse du réseau local.
const isLocalHost = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname);
let ipIdx = Math.max(0, parseInt(localStorage.getItem('sf-ip') || '0', 10) || 0);
const baseUrl = () => (isLocalHost && lanUrls.length ? lanUrls[Math.min(ipIdx, lanUrls.length - 1)] : location.origin);
const joinUrl = () => `${baseUrl()}/${SF.room}/rejoindre`;
function renderInvite() {
  const url = joinUrl();
  $('joinUrl').textContent = url;
  const src = '/api/qr?text=' + encodeURIComponent(url);
  if ($('qrImg').getAttribute('src') !== src) $('qrImg').src = src;
}
$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText(joinUrl()); SF.toast('Lien copié : ' + joinUrl(), 'ok'); }
  catch { prompt('Copiez ce lien :', joinUrl()); }
};

// plusieurs adresses réseau possibles (WSL, VPN…) : l'arbitre choisit celle à mettre dans le QR code
function setupIpChoice() {
  const many = isLocalHost && lanUrls.length > 1;
  $('ipRow').classList.toggle('hidden', !many);
  if (!many) return;
  $('ipSelect').innerHTML = lanUrls.map((u, i) => `<option value="${i}">${SF.esc(u.replace(/^http:\/\//, ''))}</option>`).join('');
  $('ipSelect').value = String(Math.min(ipIdx, lanUrls.length - 1));
}
$('ipSelect').onchange = () => {
  ipIdx = parseInt($('ipSelect').value, 10) || 0;
  try { localStorage.setItem('sf-ip', String(ipIdx)); } catch { }
  renderInvite(); renderLinks();
};

socket.on('server-info', d => {
  lanUrls = d.lanUrls || [];
  setupIpChoice();
  $('main').classList.remove('hidden'); $('noRoom').classList.add('hidden');
  SF.recent.add(SF.room, 'arbitre');
  renderInvite(); renderLinks();
});

// ---- Cartes
$('uploadBtn').addEventListener('click', async () => {
  const input = $('zipInput');
  if (!input.files.length) { $('uploadStatus').textContent = 'Choisissez un fichier .zip.'; return; }
  const fd = new FormData();
  fd.append('zipfile', input.files[0]);
  $('uploadStatus').textContent = 'Chargement en cours...';
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(SF.room)}/upload-zip`, { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) { $('uploadStatus').textContent = '❌ ' + data.error; return; }
    $('uploadStatus').textContent = `✅ ${data.count} cartes chargées` + (data.skipped ? ` (${data.skipped} fichiers ignorés, nom non conforme)` : '')
      + (data.warnings && data.warnings.length ? ' — ⚠️ ' + data.warnings.join(' ; ') : '');
  } catch (e) { $('uploadStatus').textContent = '❌ Erreur réseau : ' + e.message; }
});

socket.on('cards-loaded', ({ cards, families }) => {
  familiesData = families;
  if (!families.length) { $('familiesPreview').style.display = 'none'; return; }
  $('familiesPreview').style.display = 'block';
  $('familiesList').innerHTML = families.map(f => `<span class="family-chip" style="background:${f.color}">${SF.esc(f.name)} (${f.size})</span>`).join('');
  $('cardsCount').textContent = `${cards.length} cartes / ${families.length} familles détectées.`;
});

// ---- Joueurs
function buildNamesForm(count, names = []) {
  playersCount = count;
  $('playerCount').value = count;
  const form = $('namesForm');
  form.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const row = document.createElement('div');
    row.className = 'player-name-row';
    row.innerHTML = `<span>Joueur ${i}</span><input type="text" id="pname_${i}" maxlength="20" placeholder="Nom du joueur ${i}">`;
    form.appendChild(row);
    row.querySelector('input').value = names[i - 1] || '';
  }
  $('savePlayersBtn').style.display = 'inline-block';
  applyLocks();
}
$('genNamesBtn').addEventListener('click', () => {
  let count = parseInt($('playerCount').value, 10);
  count = Math.max(2, Math.min(10, count || 2));
  const old = [];
  for (let i = 1; i <= playersCount; i++) { const el = $('pname_' + i); old.push(el ? el.value : ''); }
  buildNamesForm(count, old);
});
$('savePlayersBtn').addEventListener('click', () => {
  const names = [];
  for (let i = 1; i <= playersCount; i++) names.push($('pname_' + i).value);
  socket.emit('set-players', { count: playersCount, names });
});

function renderLinks() {
  const box = $('playerLinks');
  if (!currentPlayers.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<h3>Liens des pages joueurs :</h3>' + currentPlayers.map(p => {
    const url = `${baseUrl()}/${SF.room}/joueur${p.id}.html`;
    return `<a href="${SF.esc(url)}" target="_blank">${SF.esc(p.name)} → ${SF.esc(url)}</a>`;
  }).join('');
}

let formBuilt = false;
socket.on('players-set', ({ players }) => {
  currentPlayers = players;
  $('playersStatus').textContent = `✅ ${players.length} joueurs enregistrés.`;
  if (!formBuilt || document.activeElement.tagName !== 'INPUT') { buildNamesForm(players.length, players.map(p => p.name)); formBuilt = true; }
  renderLinks();
  const tbody = document.querySelector('#statusTable tbody');
  tbody.innerHTML = players.map(p => `<tr id="row-${p.id}"><td>${SF.esc(p.name)}</td><td class="hc">-</td><td class="fam">-</td><td class="rd">❌</td><td class="on">⚪</td></tr>`).join('');
});

// ---- Partie
$('startGameBtn').addEventListener('click', () => socket.emit('start-game'));
$('resetBtn').addEventListener('click', () => {
  if (confirm('Démarrer une nouvelle partie ? Les cartes distribuées et les familles de la partie en cours seront perdues.')) socket.emit('reset-game');
});
function applyLocks() {
  $('startGameBtn').disabled = started;
  $('resetBtn').classList.toggle('hidden', !started);
  $('savePlayersBtn').disabled = started;
  $('genNamesBtn').disabled = started;
  $('uploadBtn').disabled = started;
  $('zipInput').disabled = started;
}

socket.on('game-started', ({ piocheCount }) => {
  $('startStatus').textContent = '✅ Partie lancée ! En attente que les joueurs se déclarent prêts.';
  $('piocheCount').textContent = piocheCount;
  document.querySelector('.tab-btn[data-tab="partie"]').click();
});
socket.on('game-reset', () => { $('startStatus').textContent = 'Nouvelle partie : vous pouvez modifier les cartes ou les joueurs, puis relancer.'; });

function showOver(over) {
  $('winnerPanel').classList.toggle('hidden', !over);
  if (!over) return;
  $('winnerText').textContent = over.tie ? `Égalité entre ${over.winner} !` : `Le gagnant est ${over.winner} !`;
  $('standingsList').innerHTML = over.standings.map(s => `<li>${SF.esc(s.name)} — ${s.count} famille(s)</li>`).join('');
}
socket.on('game-over', showOver);

socket.on('master-state', state => {
  started = state.started;
  applyLocks();
  if (started && !$('startStatus').textContent) $('startStatus').textContent = '✅ Partie en cours.';
  $('piocheCount').textContent = started ? state.piocheCount : '-';
  state.players.forEach(p => {
    const row = $('row-' + p.id);
    if (!row) return;
    row.querySelector('.hc').textContent = started ? p.handCount : '-';
    row.querySelector('.fam').textContent = p.families.length ? p.families.join(', ') : '-';
    row.querySelector('.rd').textContent = p.ready ? '✅' : '❌';
    row.querySelector('.on').textContent = p.online ? '🟢' : '⚪';
    row.classList.toggle('current-turn', p.id === state.currentPlayerId);
  });
  $('completedFamilies').innerHTML = state.completedFamilies.map(cf => {
    const color = (familiesData.find(f => f.name === cf.family) || {}).color || '#999';
    return `<span class="family-chip" style="background:${color}">${SF.esc(cf.family)} → ${SF.esc(cf.ownerName)}</span>`;
  }).join('');
  showOver(state.over);
});
