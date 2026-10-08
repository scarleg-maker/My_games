// Aides communes aux pages d'un salon (accueil, maitre, joueur).
// Adresses : /CODE (maitre), /CODE/rejoindre (invitation), /CODE/joueurN (ecran joueur).
(function (global) {
  const m = location.pathname.match(/^\/([A-Za-z0-9]{3,10})(?:\/|$)/);
  const code = m ? m[1].toUpperCase() : '';

  // /k7qf -> /K7QF (l'adresse affichee et partagee reste toujours en majuscules)
  if (m && m[1] !== code) {
    history.replaceState(null, '', location.pathname.replace('/' + m[1], '/' + code) + location.search);
  }

  const RECENT_KEY = 'casino-salons';

  const Salon = {
    code,

    // /api/salons/CODE + suffixe (ex. '/parties')
    api(suffix = '') { return `/api/salons/${encodeURIComponent(code)}${suffix}`; },

    // adresse complete d'une page du salon (ex. '/rejoindre', '/joueur2')
    url(suffix = '') { return `${location.origin}/${code}${suffix}`; },

    // connexion temps reel : le serveur range la page dans le bon salon
    connect() { return io({ query: { room: code } }); },

    esc(s) {
      return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    // salons ouverts recemment sur cet appareil (memorises dans le navigateur)
    recent: {
      list() {
        try { const l = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(l) ? l : []; }
        catch { return []; }
      },
      add(c, role) {
        try {
          const l = Salon.recent.list().filter(x => x.code !== c);
          l.unshift({ code: c, role, t: Date.now() });
          localStorage.setItem(RECENT_KEY, JSON.stringify(l.slice(0, 12)));
        } catch { }
      },
      remove(c) {
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(Salon.recent.list().filter(x => x.code !== c))); } catch { }
      }
    },

    // dessine un QR code (SVG, bibliotheque embarquee : fonctionne sans internet)
    drawQR(box, text) {
      if (!box) return;
      if (typeof global.qrcode !== 'function') { box.style.display = 'none'; return; }
      try {
        const qr = global.qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        const svg = box.querySelector('svg');
        if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block'; }
        box.style.display = '';
      } catch (e) {
        box.style.display = 'none';
      }
    }
  };

  global.Salon = Salon;
})(window);
