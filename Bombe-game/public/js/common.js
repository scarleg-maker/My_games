// Code partagé entre l'accueil, la page arbitre et les pages joueurs
(function () {
  // code du salon = premier segment de l'adresse (/K7QF, /K7QF/joueur2, /K7QF/rejoindre)
  const seg = location.pathname.split('/')[1] || '';
  window.ROOM = /^[A-Za-z0-9]{3,10}$/.test(seg) && seg !== 'static' ? seg.toUpperCase() : '';
  // adresse tapée en minuscules (/famille) → on affiche la forme officielle (/FAMILLE)
  if (window.ROOM && seg !== window.ROOM)
    history.replaceState(null, '', location.pathname.replace('/' + seg, '/' + window.ROOM) + location.search);

  window.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.imgUrl = f => `/images_pool/${window.ROOM}/${encodeURIComponent(f)}`;
  window.stripExt = f => String(f).replace(/\.[^/.]+$/, '');

  window.toast = function (text, kind = 'info') {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 4200);
    while (box.children.length > 3) box.firstChild.remove();
  };

  // salons récents de cet appareil (page d'accueil)
  window.recentSalons = {
    list() { try { return JSON.parse(localStorage.getItem('bombe-salons') || '[]'); } catch { return []; } },
    add(code, role) {
      try {
        const l = this.list().filter(x => x.code !== code);
        l.unshift({ code, role, t: Date.now() });
        localStorage.setItem('bombe-salons', JSON.stringify(l.slice(0, 8)));
      } catch { }
    },
    remove(code) { try { localStorage.setItem('bombe-salons', JSON.stringify(this.list().filter(x => x.code !== code))); } catch { } },
  };
})();
