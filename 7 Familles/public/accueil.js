const found = document.getElementById('found'), codeInput = document.getElementById('code');
let watching = null, watchTimer = null;

async function createRoom(code) {
  try {
    const r = await (await fetch('/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(code ? { code } : {}),
    })).json();
    if (!r.ok) return SF.toast(r.error, 'bad');
    SF.recent.add(r.code, 'arbitre');
    location.href = '/' + r.code;
  } catch { SF.toast('Serveur injoignable', 'bad'); }
}
document.getElementById('create').onclick = () => createRoom();
document.getElementById('createCustom').onclick = () => {
  const c = document.getElementById('mycode').value.trim();
  if (!c) return SF.toast('Indiquez un code', 'bad');
  createRoom(c);
};
document.getElementById('mycode').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('createCustom').click(); });

async function lookup(code, quiet) {
  code = code.trim().toUpperCase();
  if (!code) { if (!quiet) SF.toast('Indiquez le code du salon', 'bad'); return; }
  const info = await SF.roomInfo(code);
  if (!info) { if (!quiet) SF.toast('Serveur injoignable', 'bad'); return; }
  if (!info.exists) {
    watching = null; clearInterval(watchTimer);
    found.innerHTML = `<p class="err">Aucun salon « ${SF.esc(code)} ». Vérifiez le code avec l'arbitre.</p>`;
    return;
  }
  watching = code;
  SF.recent.add(code, 'joueur');
  renderSeats(info);
  clearInterval(watchTimer);
  watchTimer = setInterval(async () => {
    if (!watching) return;
    const i = await SF.roomInfo(watching);
    if (i && i.exists) renderSeats(i);
  }, 3000);
  renderRecent();
}

function renderSeats(info) {
  let h = `<div class="found-head"><span>Salon <strong class="code-big">${info.code}</strong></span><a href="/${info.code}" class="small">page arbitre</a></div>`;
  if (!info.players.length) {
    h += `<p class="muted">L'arbitre n'a pas encore enregistré les joueurs. Cette liste se met à jour toute seule…</p>`;
  } else {
    h += `<p class="small muted" style="margin:.6rem 0 0">${info.started ? 'Partie en cours — ' : ''}Touchez votre siège :</p><div class="seats">`;
    h += info.players.map(p => `<a class="seat ${p.online ? 'taken' : ''}" href="/${info.code}/joueur${p.id}.html">
      <span class="dot${p.online ? ' on' : ''}"></span>
      <span class="who">${SF.esc(p.name)}<small>Joueur ${p.id} — ${p.online ? 'déjà connecté' : 'libre'}</small></span><span>→</span></a>`).join('');
    h += '</div>';
  }
  found.innerHTML = h;
}
document.getElementById('join').onclick = () => lookup(codeInput.value);
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') lookup(codeInput.value); });

function renderRecent() {
  const box = document.getElementById('recent'), list = SF.recent.list();
  if (!list.length) { box.innerHTML = ''; return; }
  const href = x => x.role === 'arbitre' ? '/' + x.code : x.seat ? `/${x.code}/joueur${x.seat}.html` : `/${x.code}/rejoindre`;
  const label = x => x.role === 'arbitre' ? 'arbitre' : x.seat ? `joueur ${x.seat}` : 'joueur';
  box.innerHTML = '<h2>Salons récents sur cet appareil</h2><ul>' + list.map(x =>
    `<li><a href="${href(x)}"><strong>${SF.esc(x.code)}</strong><span class="small muted">${label(x)}</span></a>
     <button data-rm="${SF.esc(x.code)}" title="Retirer de la liste" aria-label="Retirer ${SF.esc(x.code)}">✕</button></li>`).join('') + '</ul>';
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-rm]');
  if (b) { SF.recent.remove(b.dataset.rm); renderRecent(); }
});
renderRecent();

// adresse /CODE/rejoindre (lien ou QR code de l'arbitre) : le code est déjà rempli
if (/\/rejoindre\/?$/.test(location.pathname) && SF.room) { codeInput.value = SF.room; lookup(SF.room, true); }
