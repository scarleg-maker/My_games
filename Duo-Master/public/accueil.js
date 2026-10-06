/* Duo-Master — page d'accueil (/ et /CODE/rejoindre) */
(() => {
  const { $, esc } = DM;
  const found = $('#found');
  const codeInput = $('#code');
  let watching = null;
  let watchTimer = null;

  const MODES = { speed: 'Rapidité', answer: 'Réponse' };

  async function createRoom(code) {
    try {
      const r = await DM.api('/api/rooms', code ? { code } : {});
      if (!r.ok) return DM.toast(r.error, true);
      DM.recentRooms.add(r.code, 'arbitre');
      location.href = '/' + r.code;
    } catch { DM.toast('Serveur injoignable', true); }
  }
  $('#create').addEventListener('click', () => createRoom());
  $('#createCustom').addEventListener('click', () => {
    const c = $('#mycode').value.trim();
    if (!c) return DM.toast('Indique un code', true);
    createRoom(c);
  });
  $('#mycode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#createCustom').click(); });

  async function lookup(code, quiet) {
    code = code.trim().toUpperCase();
    if (!code) { if (!quiet) DM.toast('Indique le code du salon', true); return; }
    const info = await DM.roomInfo(code);
    if (!info) { if (!quiet) DM.toast('Serveur injoignable', true); return; }
    if (!info.exists) {
      watching = null;
      clearInterval(watchTimer);
      found.innerHTML = `<p class="err-msg">Aucun salon « ${esc(code)} ». Vérifie le code avec l'arbitre.</p>`;
      return;
    }
    watching = code;
    DM.recentRooms.add(code, 'joueur');
    renderSeats(info);
    clearInterval(watchTimer);
    watchTimer = setInterval(async () => {
      if (!watching) return;
      const i = await DM.roomInfo(watching);
      if (i && i.exists) renderSeats(i);
    }, 3000);
    renderRecent();
  }

  function renderSeats(info) {
    let h = `<div class="found-head"><span>Salon <strong>${esc(info.code)}</strong> · ${esc(info.themeEmoji)} ${esc(info.themeName)} · ${MODES[info.mode] || ''} · ${info.playerCount} joueurs</span>
      <a href="/${esc(info.code)}">page arbitre</a></div>`;
    h += `<p class="muted small" style="margin:4px 0 8px">${info.started ? (info.gameOver ? 'Partie terminée.' : 'Partie en cours.') : 'En attente du lancement.'} Touche ton nom :</p>`;
    h += '<div class="seats">' + info.players.map((p) => {
      const label = p.name || `Joueur ${p.id}`;
      const sub = p.online ? 'déjà connecté' : 'pas encore connecté';
      return `<a class="seat" href="/${esc(info.code)}/joueur${p.id}">
        <span class="dot${p.online ? ' on' : ''}"></span>
        <span class="who">${esc(label)}<small>Joueur ${p.id} — ${sub}</small></span><span>→</span></a>`;
    }).join('');
    h += `<a class="seat" href="/${esc(info.code)}/ecran"><span class="dot"></span><span class="who">Écran commun<small>Scores et tirage, sans point à marquer</small></span><span>→</span></a>`;
    h += '</div>';
    found.innerHTML = h;
  }

  $('#join').addEventListener('click', () => lookup(codeInput.value));
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(codeInput.value); });

  function renderRecent() {
    const card = $('#recentCard');
    const list = DM.recentRooms.list();
    if (!list.length) { card.hidden = true; return; }
    card.hidden = false;
    $('#recent').innerHTML = list.map((x) => `
      <span class="recent-item">
        <a href="${x.role === 'arbitre' ? '/' + esc(x.code) : '/' + esc(x.code) + '/rejoindre'}">${esc(x.code)}<small>${esc(x.role)}</small></a>
        <button data-rm="${esc(x.code)}" type="button" title="Retirer de la liste" aria-label="Retirer ${esc(x.code)}">✕</button>
      </span>`).join('');
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    DM.recentRooms.remove(b.dataset.rm);
    renderRecent();
  });
  renderRecent();

  // Arrivée via /CODE/rejoindre (lien ou QR code de l'arbitre) : le code est déjà connu.
  if (DM.room) { codeInput.value = DM.room; lookup(DM.room, true); }
})();
