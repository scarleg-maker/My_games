const folderZone = document.getElementById('folder-zone');
const archiveZone = document.getElementById('archive-zone');
const folderInput = document.getElementById('folder-input');
const archiveInput = document.getElementById('archive-input');
const tabs = document.querySelectorAll('.source-tab');
const statusLine = document.getElementById('status-line');
const validateBtn = document.getElementById('validate-btn');
const launchBtn = document.getElementById('launch-btn');
const postLaunch = document.getElementById('post-launch');

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
    const res = await fetch('/api/setup', { method: 'POST', body: formData });
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
    statusLine.textContent = '⚠ Impossible de contacter le serveur local.';
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
    const res = await fetch('/api/start', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      postLaunch.style.display = 'block';
      postLaunch.scrollIntoView({ behavior: 'smooth' });
    } else {
      statusLine.textContent = `⚠ ${data.error}`;
      statusLine.classList.add('warn');
    }
  } finally {
    launchBtn.disabled = false;
    launchBtn.textContent = 'Lancer la partie ▸';
  }
});
