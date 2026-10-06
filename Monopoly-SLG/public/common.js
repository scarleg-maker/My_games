// Monopoly-SLG — utilitaires partagés (accueil, hôte, joueur)
(function () {
  const MP = (window.MP = {});
  MP.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  MP.toast = function (text, kind = 'info') {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 4200);
    while (box.children.length > 3) box.firstChild.remove();
  };
  MP.roomInfo = async function (code) {
    try { return await (await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' })).json(); }
    catch { return null; }
  };
  MP.copy = async function (text) {
    try { await navigator.clipboard.writeText(text); MP.toast('Lien copié : ' + text, 'ok'); }
    catch { window.prompt('Copie ce lien :', text); }
  };
  // salons récents de cet appareil
  MP.recent = {
    list() { try { return JSON.parse(localStorage.getItem('monopoly-slg-salons') || '[]'); } catch { return []; } },
    add(code, role) {
      try {
        const l = MP.recent.list().filter((x) => x.code !== code);
        l.unshift({ code, role, t: Date.now() });
        localStorage.setItem('monopoly-slg-salons', JSON.stringify(l.slice(0, 8)));
      } catch {}
    },
    remove(code) { try { localStorage.setItem('monopoly-slg-salons', JSON.stringify(MP.recent.list().filter((x) => x.code !== code))); } catch {} },
  };
  // QR code (bibliothèque chargée à la demande)
  let qrLib = null;
  MP.drawQR = function (box, url, size = 128) {
    if (!box || box.dataset.done === url) return;
    if (!qrLib) {
      qrLib = new Promise((ok) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        sc.onload = () => ok(true); sc.onerror = () => ok(false);
        document.head.appendChild(sc);
      });
    }
    qrLib.then((ok) => {
      if (!ok || !window.QRCode) { box.style.display = 'none'; return; }
      box.innerHTML = ''; box.dataset.done = url;
      new QRCode(box, { text: url, width: size, height: size, colorDark: '#1c2b22', colorLight: '#f3ecd8', correctLevel: QRCode.CorrectLevel.M });
    });
  };
})();
