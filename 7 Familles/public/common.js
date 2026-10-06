// 7 Familles — code partagé (accueil, page arbitre, pages joueurs)
(function () {
  const SF = (window.SF = {});

  SF.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // code du salon = premier segment de l'adresse (/K7QF, /K7QF/joueur2.html, /K7QF/rejoindre)
  const seg = location.pathname.split('/')[1] || '';
  SF.room = /^(static|api|cards)$/i.test(seg) ? '' : seg.toUpperCase();
  if (seg && SF.room && seg !== SF.room && /^[a-z0-9]{3,10}$/i.test(seg))      // /famille → /FAMILLE
    history.replaceState(null, '', location.pathname.replace('/' + seg, '/' + SF.room) + location.search);

  SF.roomInfo = async function (code = SF.room) {
    try { return await (await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' })).json(); }
    catch { return null; }
  };

  SF.toast = function (text, kind = 'info') {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 4200);
    while (box.children.length > 3) box.firstChild.remove();
  };

  // salons récents de cet appareil (page d'accueil)
  SF.recent = {
    key: 'sf-salons',
    list() { try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch { return []; } },
    add(code, role, seat) {
      try {
        const l = this.list().filter(x => x.code !== code);
        l.unshift({ code, role, seat: seat || null, t: Date.now() });
        localStorage.setItem(this.key, JSON.stringify(l.slice(0, 8)));
      } catch { }
    },
    remove(code) { try { localStorage.setItem(this.key, JSON.stringify(this.list().filter(x => x.code !== code))); } catch { } },
  };

  // bandeau « connexion perdue » (Socket.io se reconnecte tout seul)
  SF.watchConnection = function (socket) {
    document.body.insertAdjacentHTML('beforeend', '<div class="offline-bar">Connexion au serveur perdue — reconnexion…</div>');
    socket.on('disconnect', () => document.body.classList.add('offline'));
    socket.on('connect', () => document.body.classList.remove('offline'));
  };
})();
