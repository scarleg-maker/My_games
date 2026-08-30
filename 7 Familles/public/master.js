const socket = io();
socket.emit('master-join');

let familiesData = [];
let playersCount = 0;

// ---- Onglets ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ---- Upload zip ----
document.getElementById('uploadBtn').addEventListener('click', async () => {
  const input = document.getElementById('zipInput');
  if (!input.files.length) {
    document.getElementById('uploadStatus').textContent = 'Choisissez un fichier .zip.';
    return;
  }
  const fd = new FormData();
  fd.append('zipfile', input.files[0]);
  document.getElementById('uploadStatus').textContent = 'Chargement en cours...';
  try {
    const res = await fetch('/api/upload-zip', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) {
      document.getElementById('uploadStatus').textContent = '❌ ' + data.error;
      return;
    }
    document.getElementById('uploadStatus').textContent =
      `✅ ${data.count} cartes chargées` + (data.skipped ? ` (${data.skipped} fichiers ignorés, nom non conforme)` : '');
  } catch (e) {
    document.getElementById('uploadStatus').textContent = '❌ Erreur réseau : ' + e.message;
  }
});

socket.on('cards-loaded', ({ cards, families }) => {
  familiesData = families;
  if (!families.length) return;
  const panel = document.getElementById('familiesPreview');
  panel.style.display = 'block';
  const list = document.getElementById('familiesList');
  list.innerHTML = '';
  families.forEach(f => {
    const chip = document.createElement('span');
    chip.className = 'family-chip';
    chip.style.background = f.color;
    chip.textContent = f.name;
    list.appendChild(chip);
  });
  document.getElementById('cardsCount').textContent = `${cards.length} cartes / ${families.length} familles détectées.`;
});

// ---- Joueurs ----
document.getElementById('genNamesBtn').addEventListener('click', () => {
  let count = parseInt(document.getElementById('playerCount').value, 10);
  count = Math.max(2, Math.min(10, count || 2));
  document.getElementById('playerCount').value = count;
  playersCount = count;

  const form = document.getElementById('namesForm');
  form.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const num = String(i).padStart(2, '0');
    const row = document.createElement('div');
    row.className = 'player-name-row';
    row.innerHTML = `<span>Joueur ${num}</span><input type="text" id="pname_${i}" placeholder="Nom du joueur ${num}">`;
    form.appendChild(row);
  }
  document.getElementById('savePlayersBtn').style.display = 'inline-block';
});

document.getElementById('savePlayersBtn').addEventListener('click', () => {
  const names = [];
  for (let i = 1; i <= playersCount; i++) {
    names.push(document.getElementById('pname_' + i).value);
  }
  socket.emit('set-players', { count: playersCount, names });
});

socket.on('players-set', ({ players }) => {
  document.getElementById('playersStatus').textContent = `✅ ${players.length} joueurs enregistrés.`;
  const linksBox = document.getElementById('playerLinks');
  linksBox.innerHTML = '<h3>Liens des pages joueurs :</h3>';
  players.forEach(p => {
    const url = `${location.origin}/joueur${p.id}.html`;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.textContent = `${p.name} → ${url}`;
    linksBox.appendChild(a);
  });

  const tbody = document.querySelector('#statusTable tbody');
  tbody.innerHTML = '';
  players.forEach(p => {
    const tr = document.createElement('tr');
    tr.id = 'row-' + p.id;
    tr.innerHTML = `<td>${p.name}</td><td class="hc">-</td><td class="fam">-</td><td class="rd">❌</td>`;
    tbody.appendChild(tr);
  });
});

// ---- Lancement de partie ----
document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('start-game');
});

socket.on('error-msg', (msg) => {
  document.getElementById('startStatus').textContent = '❌ ' + msg;
});

socket.on('game-started', ({ piocheCount }) => {
  document.getElementById('startStatus').textContent = '✅ Partie lancée ! En attente que les joueurs se déclarent prêts.';
  document.getElementById('piocheCount').textContent = piocheCount;
  document.querySelectorAll('.tab-btn')[2].click();
});

socket.on('master-state', (state) => {
  document.getElementById('piocheCount').textContent = state.piocheCount;
  state.players.forEach(p => {
    const row = document.getElementById('row-' + p.id);
    if (!row) return;
    row.querySelector('.hc').textContent = p.handCount;
    row.querySelector('.fam').textContent = p.families.length ? p.families.join(', ') : '-';
    row.querySelector('.rd').textContent = p.ready ? '✅' : '❌';
    row.classList.toggle('current-turn', p.id === state.currentPlayerId);
  });

  const completedBox = document.getElementById('completedFamilies');
  completedBox.innerHTML = '';
  state.completedFamilies.forEach(cf => {
    const famColor = (familiesData.find(f => f.name === cf.family) || {}).color || '#999';
    const chip = document.createElement('span');
    chip.className = 'family-chip';
    chip.style.background = famColor;
    chip.textContent = `${cf.family} → ${cf.ownerName}`;
    completedBox.appendChild(chip);
  });
});

socket.on('players-status', (players) => {
  players.forEach(p => {
    const row = document.getElementById('row-' + p.id);
    if (row) row.querySelector('.rd').textContent = p.ready ? '✅' : '❌';
  });
});

socket.on('game-over', ({ winner, standings }) => {
  document.getElementById('winnerPanel').classList.remove('hidden');
  document.getElementById('winnerText').textContent = `Le gagnant est ${winner} !`;
  const list = document.getElementById('standingsList');
  list.innerHTML = '';
  standings.forEach(s => {
    const li = document.createElement('li');
    li.textContent = `${s.name} — ${s.count} famille(s)`;
    list.appendChild(li);
  });
});
