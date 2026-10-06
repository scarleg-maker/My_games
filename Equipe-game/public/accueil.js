// ---------- salons récents (mémorisés sur cet appareil) ----------
const RECENT_KEY = 'equipe-game-recent-rooms';
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
function addRecent(code, role) {
  let list = getRecent().filter(r => r.code !== code);
  list.unshift({ code, role });
  list = list.slice(0, 10);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  renderRecent();
}
function removeRecent(code) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(getRecent().filter(r => r.code !== code)));
  renderRecent();
}
function renderRecent() {
  const box = document.getElementById('recent-block');
  const list = getRecent();
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<h2>Salons récents sur cet appareil</h2><ul>' + list.map(r =>
    `<li><a href="${r.role === 'maitre' ? '/' + r.code : '/' + r.code}">${r.code}<span style="font-weight:400;color:#777;margin-left:6px;">${r.role === 'maitre' ? 'maître du jeu' : 'joueur'}</span></a>
     <button data-rm="${r.code}" title="Retirer" aria-label="Retirer ${r.code}">✕</button></li>`
  ).join('') + '</ul>';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]');
  if (b) removeRecent(b.dataset.rm);
});
renderRecent();

// ---------- créer un salon ----------
const createErr = document.getElementById('create-error');

async function createRoom(code) {
  createErr.textContent = '';
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(code ? { code } : {})
    });
    const data = await res.json();
    if (!data.ok) { createErr.textContent = data.error; return; }
    addRecent(data.code, 'maitre');
    location.href = '/' + data.code;
  } catch {
    createErr.textContent = 'Serveur injoignable.';
  }
}
document.getElementById('create-btn').addEventListener('click', () => createRoom());
document.getElementById('create-custom-btn').addEventListener('click', () => {
  const c = document.getElementById('custom-code').value.trim();
  if (!c) { createErr.textContent = 'Indiquez un code.'; return; }
  createRoom(c);
});
document.getElementById('custom-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('create-custom-btn').click();
});

// ---------- rejoindre un salon ----------
const joinInput = document.getElementById('join-code');
const joinResult = document.getElementById('join-result');
let pollTimer = null;

async function lookupRoom(code, quiet) {
  code = code.trim().toUpperCase();
  clearInterval(pollTimer);
  if (!code) { if (!quiet) joinResult.innerHTML = '<p class="error">Indiquez le code du salon.</p>'; return; }
  let info;
  try {
    info = await (await fetch('/api/rooms/' + encodeURIComponent(code))).json();
  } catch {
    joinResult.innerHTML = '<p class="error">Serveur injoignable.</p>';
    return;
  }
  if (!info.exists) {
    joinResult.innerHTML = `<p class="error">Aucun salon « ${escapeHtml(code)} ». Vérifiez le code avec le maître du jeu.</p>`;
    return;
  }
  addRecent(code, 'joueur');
  renderJoinResult(code, info);
  pollTimer = setInterval(async () => {
    try {
      const i = await (await fetch('/api/rooms/' + encodeURIComponent(code))).json();
      if (i.exists) renderJoinResult(code, i);
    } catch { /* ignore */ }
  }, 3000);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderJoinResult(code, info) {
  let h = `<div class="found-head">Salon <strong>${escapeHtml(code)}</strong></div>`;
  if (!info.players || info.players.length === 0) {
    h += '<p style="margin-top:10px;color:#555;">Le maître du jeu configure encore la partie. Cette page se met à jour automatiquement.</p>';
  } else {
    h += '<div class="seats">' + info.players.map((p, i) =>
      `<a class="seat" href="/${code}/joueur${i + 1}">
        <span>${escapeHtml(p.name)}<span class="seat-sub">Joueur ${i + 1}${p.eliminated ? ' — éliminé' : ''}</span></span>
        <span>→</span>
      </a>`
    ).join('') + '</div>';
  }
  joinResult.innerHTML = h;
}
document.getElementById('join-btn').addEventListener('click', () => lookupRoom(joinInput.value));
joinInput.addEventListener('keydown', e => { if (e.key === 'Enter') lookupRoom(joinInput.value); });
