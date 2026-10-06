const createBtn = document.getElementById('create-btn');
const createCustomBtn = document.getElementById('create-custom-btn');
const customCodeInput = document.getElementById('custom-code');
const joinBtn = document.getElementById('join-btn');
const joinCodeInput = document.getElementById('join-code');
const joinResult = document.getElementById('join-result');
const statusLine = document.getElementById('status-line-home');

function showStatus(msg, kind) {
  statusLine.textContent = msg;
  statusLine.className = 'status-line' + (kind ? ' ' + kind : '');
}

async function createRoom(code) {
  showStatus('', null);
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(code ? { code } : {})
    });
    const data = await res.json();
    if (data.ok) {
      location.href = '/' + data.code;
    } else {
      showStatus(`⚠ ${data.error}`, 'warn');
    }
  } catch (e) {
    showStatus('⚠ Impossible de contacter le serveur.', 'warn');
  }
}

createBtn.addEventListener('click', () => createRoom());
createCustomBtn.addEventListener('click', () => {
  const c = customCodeInput.value.trim();
  if (!c) { showStatus('⚠ Indique un code.', 'warn'); return; }
  createRoom(c);
});
customCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') createCustomBtn.click(); });

async function lookupRoom(code, quiet) {
  joinResult.innerHTML = '';
  code = code.trim().toUpperCase();
  if (!code) { if (!quiet) showStatus('⚠ Indique le code du salon.', 'warn'); return; }
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!data.exists) {
      if (!quiet) showStatus(`⚠ Aucun salon « ${code} ». Vérifie le code.`, 'warn');
      return;
    }
    showStatus('', null);
    const n1 = (data.names && data.names['1']) ? ' — ' + data.names['1'] : '';
    const n2 = (data.names && data.names['2']) ? ' — ' + data.names['2'] : '';
    joinResult.innerHTML = `
      <p class="hint-text" style="margin-top:0.8rem;">Salon <strong>${code}</strong> trouvé — choisis ta place :</p>
      <div style="display:flex; gap:0.6rem; margin-top:0.6rem;">
        <a href="/${code}/joueur1" style="flex:1;"><button class="btn-ghost-dark" style="width:100%;">Joueur 1${n1}</button></a>
        <a href="/${code}/joueur2" style="flex:1;"><button class="btn-ghost-dark" style="width:100%;">Joueur 2${n2}</button></a>
      </div>`;
  } catch (e) {
    showStatus('⚠ Impossible de contacter le serveur.', 'warn');
  }
}

joinBtn.addEventListener('click', () => lookupRoom(joinCodeInput.value));
joinCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') lookupRoom(joinCodeInput.value); });

// adresse /CODE directe avec un ?rejoindre (lien partagé) : code déjà rempli
const params = new URLSearchParams(location.search);
const prefill = params.get('rejoindre');
if (prefill) {
  joinCodeInput.value = prefill.toUpperCase();
  lookupRoom(prefill, true);
}
