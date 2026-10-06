const CODE = window.CODE;

const folderZone = document.getElementById('folder-zone');
const archiveZone = document.getElementById('archive-zone');
const folderInput = document.getElementById('folder-input');
const archiveInput = document.getElementById('archive-input');
const tabs = document.querySelectorAll('.source-tab');
const statusLine = document.getElementById('status-line');
const validateBtn = document.getElementById('validate-btn');
const launchBtn = document.getElementById('launch-btn');
const postLaunch = document.getElementById('post-launch');
const copyLinkBtn = document.getElementById('copy-link-btn');

let activeSource = 'folder';

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeSource = tab.dataset.source;
    folderZone.style.display = activeSource === 'folder' ? 'block' : 'none';
    archiveZone.style.display = activeSource === 'archive' ? 'block' : 'none';
    statusLine.className = 'status-line';
    launchBtn.style.display = 'none';
  });
});

function getSelectedSize() {
  const el = document.querySelector('input[name="size"]:checked');
  return el ? el.value : '6x6';
}

validateBtn.addEventListener('click', async () => {
  statusLine.className = 'status-line';
  launchBtn.style.display = 'none';

  const files = activeSource === 'folder' ? folderInput.files : archiveInput.files;
  if (!files || files.length === 0) {
    statusLine.textContent = activeSource === 'folder'
      ? "Sélectionne d'abord un dossier d'images."
      : "Sélectionne d'abord une archive .zip.";
    statusLine.classList.add('warn');
    return;
  }

  const formData = new FormData();
  formData.append('size', getSelectedSize());
  formData.append('name1', document.getElementById('name1').value.trim() || 'Joueur 1');
  formData.append('name2', document.getElementById('name2').value.trim() || 'Joueur 2');
  for (const f of files) formData.append('files', f);

  validateBtn.disabled = true;
  validateBtn.textContent = 'Analyse du dossier…';

  try {
    const res = await fetch(`/${CODE}/api/setup`, { method: 'POST', body: formData });
    const data = await res.json();

    if (data.ok) {
      statusLine.textContent = `✔ ${data.found} portrait(s) trouvé(s) pour ${data.required} cases requises. Le dossier est complet.`;
      statusLine.classList.add('ok');
      launchBtn.style.display = 'inline-block';
    } else if (data.found !== undefined) {
      statusLine.textContent = `⚠ ${data.error}`;
      statusLine.classList.add('warn');
    } else {
      statusLine.textContent = `⚠ ${data.error || 'Erreur inconnue.'}`;
      statusLine.classList.add('warn');
    }
  } catch (e) {
    statusLine.textContent = '⚠ Impossible de contacter le serveur.';
    statusLine.classList.add('warn');
  } finally {
    validateBtn.disabled = false;
    validateBtn.textContent = 'Constituer le dossier';
  }
});

launchBtn.addEventListener('click', async () => {
  launchBtn.disabled = true;
  launchBtn.textContent = 'Création des plateaux…';
  try {
    const res = await fetch(`/${CODE}/api/start`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      postLaunch.style.display = 'block';
      postLaunch.scrollIntoView({ behavior: 'smooth' });
      drawQR();
    } else {
      statusLine.textContent = `⚠ ${data.error}`;
      statusLine.classList.add('warn');
    }
  } finally {
    launchBtn.disabled = false;
    launchBtn.textContent = 'Lancer la partie ▸';
  }
});

/* QR code pointant vers la page du joueur 2 : scanné avec un téléphone ou
   une tablette, il ouvre directement le plateau, sans avoir à taper une
   adresse IP locale. Librairie chargée à la demande (CDN). */
let qrLibPromise = null;
function loadQrLib() {
  if (!qrLibPromise) {
    qrLibPromise = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return qrLibPromise;
}

function joinUrl() {
  return `${location.origin}/${CODE}/joueur2`;
}

async function drawQR() {
  const box = document.getElementById('qr');
  if (!box) return;
  const ok = await loadQrLib();
  if (!ok || !window.QRCode) { box.style.display = 'none'; return; }
  box.innerHTML = '';
  new QRCode(box, {
    text: joinUrl(), width: 104, height: 104,
    colorDark: '#2A2118', colorLight: '#f1ede4',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

copyLinkBtn.addEventListener('click', async () => {
  const url = joinUrl();
  try {
    await navigator.clipboard.writeText(url);
    copyLinkBtn.textContent = 'Lien copié !';
  } catch (e) {
    copyLinkBtn.textContent = url;
  }
  setTimeout(() => { copyLinkBtn.textContent = 'Copier le lien du joueur 2'; }, 2200);
});
