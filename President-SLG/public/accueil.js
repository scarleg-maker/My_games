const errorBox = document.getElementById('error-box');
const found = document.getElementById('found');
const joinCodeInput = document.getElementById('join-code');

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}
function clearError() {
  errorBox.classList.add('hidden');
}

// ---------- création de salon ----------
async function createRoom(code) {
  clearError();
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(code ? { code } : {})
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showError(data.error || 'Impossible de créer le salon.');
    recentAdd(data.code, 'maitre');
    location.href = '/' + data.code;
  } catch (e) {
    showError('Serveur injoignable.');
  }
}

document.getElementById('create-btn').addEventListener('click', () => createRoom());
document.getElementById('create-custom-btn').addEventListener('click', () => {
  const c = document.getElementById('custom-code').value.trim();
  if (!c) return showError('Indiquez un code.');
  createRoom(c);
});

// ---------- rejoindre un salon ----------
let watchTimer = null;

async function lookup(code, quiet) {
  clearInterval(watchTimer);
  code = code.trim().toUpperCase();
  if (!code) {
    if (!quiet) showError('Indiquez le code du salon.');
    return;
  }
  clearError();
  let info;
  try {
    info = await (await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' })).json();
  } catch (e) {
    if (!quiet) showError('Serveur injoignable.');
    return;
  }
  if (!info.exists) {
    found.innerHTML = `<p style="margin-top:14px; opacity:0.85;">Aucun salon « ${escapeHtml(code)} ». Vérifiez le code avec le maître du jeu.</p>`;
    return;
  }
  recentAdd(code, 'joueur');
  renderFound(info);
  watchTimer = setInterval(async () => {
    try {
      const i = await (await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' })).json();
      if (i.exists) renderFound(i);
    } catch (e) { /* ignore */ }
  }, 3000);
  renderRecent();
}

function renderFound(info) {
  const modeLabel = info.configured ? (info.mode === 'A' ? 'Cartes standardes' : 'Carte au choix') : null;
  let html = `<div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-top:14px; flex-wrap:wrap;">
    <span>Salon <strong style="color:var(--gold-bright)">${escapeHtml(info.code)}</strong>${modeLabel ? ' · ' + modeLabel : ''}</span>
    <a href="/${info.code}" target="_blank" style="font-size:0.85rem;">page maître</a>
  </div>`;

  if (!info.configured) {
    html += `<p style="margin-top:10px; opacity:0.8;">Le maître du jeu prépare la partie. Cette page se mettra à jour automatiquement.</p>`;
  } else {
    html += `<p style="font-size:0.85rem; opacity:0.75; margin:10px 0 6px;">Touchez votre nom :</p><div class="seats">`;
    info.players.forEach((name, i) => {
      const isAI = (info.aiPlayers || []).includes(name);
      const sub = isAI ? '🤖 joué par l\'IA' : `Joueur ${i + 1}`;
      html += `<a class="seat-link" href="/${info.code}/joueur${i + 1}" ${isAI ? 'aria-disabled="true"' : ''}>
        <span>${escapeHtml(name)}<small>${sub}</small></span><span>→</span>
      </a>`;
    });
    html += `</div>`;
    const statusLabels = {
      ready: 'En attente du premier tour.',
      playing: `Tour ${info.round} / ${info.totalRounds} en cours.`,
      'round-end': `Tour ${info.round} terminé.`,
      'game-over': 'Partie terminée.'
    };
    if (statusLabels[info.status]) {
      html += `<p style="font-size:0.8rem; opacity:0.7; margin-top:10px;">${statusLabels[info.status]}</p>`;
    }
  }
  found.innerHTML = html;
}

document.getElementById('join-btn').addEventListener('click', () => lookup(joinCodeInput.value));
joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') lookup(joinCodeInput.value);
});
document.getElementById('custom-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('create-custom-btn').click();
});

// ---------- salons récents (localStorage) ----------
function recentList() {
  try {
    return JSON.parse(localStorage.getItem('equipe-salons') || '[]');
  } catch (e) {
    return [];
  }
}
function recentAdd(code, role) {
  try {
    const list = recentList().filter((x) => x.code !== code);
    list.unshift({ code, role, t: Date.now() });
    localStorage.setItem('equipe-salons', JSON.stringify(list.slice(0, 8)));
  } catch (e) { /* ignore */ }
}
function recentRemove(code) {
  try {
    localStorage.setItem('equipe-salons', JSON.stringify(recentList().filter((x) => x.code !== code)));
  } catch (e) { /* ignore */ }
}
function renderRecent() {
  const list = recentList();
  const panel = document.getElementById('recent-panel');
  const box = document.getElementById('recent-list');
  if (!list.length) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  box.innerHTML = list
    .map((x) => {
      const href = x.role === 'maitre' ? '/' + x.code : '/' + x.code + '/rejoindre';
      return `<span class="recent-chip"><a href="${href}">${escapeHtml(x.code)} <span style="opacity:0.6">(${x.role})</span></a>
        <button data-rm="${escapeHtml(x.code)}" aria-label="Retirer ${escapeHtml(x.code)}">✕</button></span>`;
    })
    .join('');
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rm]');
  if (btn) {
    recentRemove(btn.dataset.rm);
    renderRecent();
  }
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- adresse /CODE/rejoindre (lien ou QR code du maître) : code pré-rempli ----------
const m = location.pathname.match(/^\/([A-Za-z0-9]{3,10})\/rejoindre/);
if (m) {
  joinCodeInput.value = m[1].toUpperCase();
  lookup(m[1], true);
}

// ---------- salon introuvable (redirection depuis /CODE) ----------
const params = new URLSearchParams(location.search);
if (params.get('introuvable') === '1' && params.get('salon')) {
  showError(`Le salon « ${params.get('salon')} » n'existe pas ou plus.`);
}

renderRecent();
