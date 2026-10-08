const code = window.location.pathname.replace(/\//g, '').toUpperCase();
document.getElementById('code-salon').textContent = code;

const NOMS_JOUEUR = { joueur1: 'Joueur 1', joueur2: 'Joueur 2' };

async function init() {
  try {
    const res = await fetch(`/api/salons/${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!data.existe || data.mode !== 'duo') {
      document.getElementById('carte-chargement').innerHTML =
        `<p class="info" style="color:#D33F49;">Ce salon n'existe pas (ou n'est plus actif). <a class="retour" href="/">← Retour à l'accueil</a></p>`;
      return;
    }
    document.getElementById('carte-chargement').style.display = 'none';
    afficherLiens();
    connecterSocket();
  } catch {
    document.getElementById('carte-chargement').innerHTML =
      `<p class="info" style="color:#D33F49;">Serveur injoignable.</p>`;
  }
}

function afficherLiens() {
  const carte = document.getElementById('carte-salons');
  const conteneur = document.getElementById('salon-liens');
  conteneur.innerHTML = '';

  ['joueur1', 'joueur2'].forEach((joueur, i) => {
    const url = `${window.location.origin}/${code}/${joueur}`;
    const bloc = document.createElement('div');
    bloc.className = 'salon-lien';
    bloc.innerHTML = `
      <div class="qr" id="qr-${joueur}"></div>
      <div class="salon-lien-texte">
        <strong>Joueur ${i + 1}</strong>
        <a href="${url}" target="_blank">${url}</a>
        <span class="info" id="etat-${joueur}">En attente de connexion...</span>
      </div>
    `;
    conteneur.appendChild(bloc);
    // eslint-disable-next-line no-undef
    new QRCode(document.getElementById(`qr-${joueur}`), {
      text: url,
      width: 112,
      height: 112,
      colorDark: '#3A0E28',
      colorLight: '#FFF3A3',
    });
  });

  carte.style.display = 'block';
}

function connecterSocket() {
  const socket = io();
  socket.on('connect', () => socket.emit('rejoindre', { code }));

  socket.on('duo-update', (etat) => {
    if (!etat) return;
    const objet = etat.type === 'mots' ? 'mot' : 'nombre';
    document.getElementById('carte-statut').style.display = 'block';
    const statutDiv = document.getElementById('statut-salon');

    ['joueur1', 'joueur2'].forEach((joueur) => {
      const info = etat[joueur];
      const span = document.getElementById(`etat-${joueur}`);
      if (span) {
        span.textContent = info.ready
          ? `${info.nom} a choisi son ${objet} ✓`
          : `En attente que ${info.nom || NOMS_JOUEUR[joueur]} choisisse son ${objet}...`;
      }
    });

    if (etat.status === 'choix') {
      statutDiv.innerHTML = `<p class="info">La partie commence dès que les deux joueurs ont validé leur ${objet} secret.</p>`;
    } else if (etat.status === 'jeu') {
      const nomTour = etat[etat.turn] ? etat[etat.turn].nom : NOMS_JOUEUR[etat.turn];
      statutDiv.innerHTML = `<p class="info">Partie en cours — c'est au tour de <strong>${nomTour}</strong> de proposer un ${objet}.</p>`;
    } else if (etat.status === 'fini') {
      const nomGagnant = etat[etat.winner] ? etat[etat.winner].nom : NOMS_JOUEUR[etat.winner];
      statutDiv.innerHTML = `<p class="info">🎉 Partie terminée — <strong>${nomGagnant}</strong> a gagné !</p>`;
    }
  });
}

init();
