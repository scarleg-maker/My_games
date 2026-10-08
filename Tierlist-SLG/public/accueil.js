const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const codeInput = document.getElementById('codeInput');
const found = document.getElementById('found');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Recently visited rooms, remembered per-browser (not shared with anyone else) ---
function recentList() {
  try { return JSON.parse(localStorage.getItem('tierlist_slg_recent_rooms') || '[]'); } catch (e) { return []; }
}
function recentAdd(code, role) {
  let list = recentList().filter(r => r.code !== code);
  list.unshift({ code, role, ts: Date.now() });
  list = list.slice(0, 8);
  try { localStorage.setItem('tierlist_slg_recent_rooms', JSON.stringify(list)); } catch (e) {}
}
function recentRemove(code) {
  const list = recentList().filter(r => r.code !== code);
  try { localStorage.setItem('tierlist_slg_recent_rooms', JSON.stringify(list)); } catch (e) {}
  renderRecent();
}
function renderRecent() {
  const list = recentList();
  const panel = document.getElementById('recentPanel');
  const box = document.getElementById('recentList');
  if (!list.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  box.innerHTML = list.map(r => `
    <a href="${r.role === 'maitre' ? `/${r.code}/setup.html` : `/?rejoindre=${r.code}`}">
      <span><strong>${escapeHtml(r.code)}</strong> — ${r.role === 'maitre' ? 'maître' : 'joueur'}</span>
      <button type="button" data-rm="${escapeHtml(r.code)}" class="secondary" style="padding:4px 10px;">✕</button>
    </a>
  `).join('');
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rm]');
  if (btn) { e.preventDefault(); recentRemove(btn.dataset.rm); }
});
renderRecent();

createBtn.addEventListener('click', async () => {
  createBtn.disabled = true;
  createBtn.textContent = 'Création...';
  try {
    const res = await fetch('/api/new-code');
    const data = await res.json();
    recentAdd(data.code, 'maitre');
    window.location.href = `/${data.code}/setup.html`;
  } catch (err) {
    alert('Erreur réseau : ' + err.message);
    createBtn.disabled = false;
    createBtn.textContent = 'Créer un salon';
  }
});

async function lookup(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (!code) { found.innerHTML = '<p class="help">Indique le code du salon.</p>'; return; }
  found.innerHTML = '<p class="help">Recherche...</p>';
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    const info = await res.json();
    if (!info.exists) {
      found.innerHTML = `<p class="help">Aucun salon « ${escapeHtml(code)} » pour le moment. Vérifie le code avec le maître de la partie.</p>`;
      return;
    }
    recentAdd(code, 'joueur');
    if (info.players.length === 0) {
      found.innerHTML = `
        <p class="help">Salon <strong>${escapeHtml(info.code)}</strong> — ${escapeHtml(info.title)} (mode solo, pas de joueurs à rejoindre).</p>
      `;
      return;
    }
    found.innerHTML = `
      <p class="help">Salon <strong>${escapeHtml(info.code)}</strong> — ${escapeHtml(info.title)}. Touche ton nom :</p>
      <div class="seat-list">
        ${info.players.map(p => `<a href="/${info.code}/joueur${p.num}.html" class="link-list"><span>${escapeHtml(p.name)}</span><span>→</span></a>`).join('')}
      </div>
    `;
  } catch (err) {
    found.innerHTML = `<p class="help">Erreur réseau : ${escapeHtml(err.message)}</p>`;
  }
}

joinBtn.addEventListener('click', () => lookup(codeInput.value));
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(codeInput.value); });

// /?rejoindre=CODE (e.g. from "recent rooms") pre-fills and looks up right away
const params = new URLSearchParams(window.location.search);
if (params.get('rejoindre')) {
  codeInput.value = params.get('rejoindre').toUpperCase();
  lookup(codeInput.value);
}
