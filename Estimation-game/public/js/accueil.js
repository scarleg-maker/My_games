const RECENT_KEY = 'estimation-game-recent-rooms';

const found = document.getElementById('found');
const codeInput = document.getElementById('code-input');
let watchTimer = null;

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toastErr(msg) {
  found.innerHTML = `<p class="error-text">${escapeHtml(msg)}</p>`;
}

// ---------------------------------------------------------------------
// Salons récents (mémorisés sur cet appareil)
// ---------------------------------------------------------------------
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
}
function addRecent(code, role) {
  const list = getRecent().filter(r => r.code !== code);
  list.unshift({ code, role, at: Date.now() });
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  renderRecent();
}
function removeRecent(code) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(getRecent().filter(r => r.code !== code)));
  renderRecent();
}
function renderRecent() {
  const box = document.getElementById('recent-rooms');
  const list = getRecent();
  if (!list.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = '<h2>Salons récents sur cet appareil</h2><div class="recent-list">' +
    list.map(r => `
      <div class="recent-chip">
        <a href="${r.role === 'maitre' ? '/' + r.code : '/' + r.code + '/rejoindre'}">
          <strong>${escapeHtml(r.code)}</strong><span>${r.role === 'maitre' ? 'maître du jeu' : 'joueur'}</span>
        </a>
        <button data-rm="${escapeHtml(r.code)}" title="Retirer" aria-label="Retirer ${escapeHtml(r.code)}">✕</button>
      </div>`).join('') + '</div>';
}
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-rm]');
  if (btn) removeRecent(btn.dataset.rm);
});

// ---------------------------------------------------------------------
// Créer un salon
// ---------------------------------------------------------------------
async function createRoom(code) {
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(code ? { code } : {}),
    });
    const data = await res.json();
    if (!data.ok) { alert(data.error); return; }
    addRecent(data.code, 'maitre');
    window.location.href = '/' + data.code;
  } catch (e) {
    alert('Serveur injoignable.');
  }
}
document.getElementById('create-btn').addEventListener('click', () => createRoom());
document.getElementById('create-custom-btn').addEventListener('click', () => {
  const c = document.getElementById('mycode').value.trim();
  if (!c) { alert('Indiquez un code.'); return; }
  createRoom(c);
});

// ---------------------------------------------------------------------
// Rejoindre un salon : recherche + liste des sièges
// ---------------------------------------------------------------------
async function roomInfo(code) {
  try {
    const res = await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' });
    return await res.json();
  } catch (e) { return null; }
}

async function lookup(rawCode, quiet) {
  const code = rawCode.trim().toUpperCase();
  if (!code) { if (!quiet) toastErr('Indiquez le code du salon.'); return; }
  const info = await roomInfo(code);
  if (!info) { if (!quiet) toastErr('Serveur injoignable.'); return; }
  if (!info.exists) {
    clearInterval(watchTimer);
    toastErr(`Aucun salon « ${code} ». Vérifiez le code avec le maître du jeu.`);
    return;
  }
  addRecent(code, 'joueur');
  renderSeats(info);
  clearInterval(watchTimer);
  watchTimer = setInterval(async () => {
    const i = await roomInfo(code);
    if (i && i.exists) renderSeats(i);
  }, 3000);
}

function renderSeats(info) {
  let html = `<div class="found-head">
    <span>Salon <strong>${escapeHtml(info.code)}</strong>${info.theme ? ' — ' + escapeHtml(info.theme) : ''}</span>
  </div>`;

  if (!info.players.length) {
    html += `<p class="muted" style="margin-top:10px">La partie n'est pas encore configurée. Demandez au maître du jeu de choisir les joueurs.</p>`;
  } else {
    html += `<p class="muted small" style="margin:8px 0">Touchez votre nom :</p><div class="seats">`;
    html += info.players.map((p, i) => {
      const sub = p.connected ? 'déjà connecté' : 'pas encore connecté';
      return `<a class="seat-row ${p.connected ? 'taken' : ''}" href="/${info.code}/joueur${i + 1}">
        <span class="status-dot ${p.connected ? 'on' : ''}"></span>
        <span class="who">${escapeHtml(p.name)}<small>${sub}</small></span>
        <span>→</span>
      </a>`;
    }).join('');
    html += `</div>`;
  }
  found.innerHTML = html;
}

document.getElementById('join-btn').addEventListener('click', () => lookup(codeInput.value));
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') lookup(codeInput.value); });
document.getElementById('mycode').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('create-custom-btn').click();
});

renderRecent();

// Adresse /CODE/rejoindre (lien du QR code affiché par le maître) : le code est pré-rempli
const m = window.location.pathname.match(/^\/([A-Za-z0-9]{3,10})\/rejoindre/);
if (m) {
  codeInput.value = m[1].toUpperCase();
  lookup(m[1], true);
}
