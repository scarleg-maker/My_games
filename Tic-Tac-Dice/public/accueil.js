const createBtn = document.getElementById('createBtn');
const createCustomBtn = document.getElementById('createCustomBtn');
const customCode = document.getElementById('customCode');
const createError = document.getElementById('createError');
const joinBtn = document.getElementById('joinBtn');
const joinCode = document.getElementById('joinCode');
const joinError = document.getElementById('joinError');
const recentBox = document.getElementById('recentBox');
const recentList = document.getElementById('recentList');

const RECENT_KEY = 'tictacdice:recentRooms';

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function addRecent(code) {
  const list = getRecent().filter((c) => c !== code);
  list.unshift(code);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch {}
}
function removeRecent(code) {
  const list = getRecent().filter((c) => c !== code);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
  renderRecent();
}
function renderRecent() {
  const list = getRecent();
  if (!list.length) { recentBox.style.display = 'none'; return; }
  recentBox.style.display = 'block';
  recentList.innerHTML = list.map((code) => `
    <li>
      <a href="/${code}">${code}</a>
      <button data-rm="${code}" title="Retirer" aria-label="Retirer ${code}">✕</button>
    </li>`).join('');
}
recentList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rm]');
  if (btn) removeRecent(btn.dataset.rm);
});
renderRecent();

async function createRoom(code) {
  createError.style.display = 'none';
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(code ? { code } : {})
    });
    const data = await res.json();
    if (!data.ok) {
      createError.textContent = data.error || 'Erreur inconnue.';
      createError.style.display = 'block';
      return;
    }
    addRecent(data.code);
    window.location.href = '/' + data.code;
  } catch {
    createError.textContent = 'Serveur injoignable.';
    createError.style.display = 'block';
  }
}

createBtn.addEventListener('click', () => createRoom());
createCustomBtn.addEventListener('click', () => {
  const c = customCode.value.trim();
  if (!c) {
    createError.textContent = 'Indique un code.';
    createError.style.display = 'block';
    return;
  }
  createRoom(c);
});
customCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') createCustomBtn.click(); });

function doJoin() {
  joinError.style.display = 'none';
  const code = joinCode.value.trim().toUpperCase();
  if (!code) {
    joinError.textContent = 'Indique le code du salon.';
    joinError.style.display = 'block';
    return;
  }
  addRecent(code);
  window.location.href = '/' + code;
}
joinBtn.addEventListener('click', doJoin);
joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

// Lien /CODE/rejoindre (ex. depuis un QR code) : préremplit le code
const m = window.location.pathname.match(/^\/([A-Za-z0-9]{3,10})\/rejoindre$/);
if (m) joinCode.value = m[1].toUpperCase();
