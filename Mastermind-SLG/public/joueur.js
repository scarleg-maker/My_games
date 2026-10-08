// L'URL est de la forme /ABCD/joueur1 ou /ABCD/joueur2 : le salon isole
// totalement cette partie des autres parties en cours sur le serveur.
const segments = window.location.pathname.split('/').filter(Boolean);
const code = (segments[0] || '').toUpperCase();
const moi = (segments[1] || '').includes('joueur2') ? 'joueur2' : 'joueur1';
const adversaire = moi === 'joueur1' ? 'joueur2' : 'joueur1';

document.getElementById('badge-joueur').textContent = moi === 'joueur1' ? 'Joueur 1' : 'Joueur 2';
const eyebrowEl = document.querySelector('.eyebrow');
if (eyebrowEl) eyebrowEl.textContent = `Mode duel — Salon ${code}`;

// --- Nom mémorisé dans le navigateur d'une partie à l'autre ---
const champNom = document.getElementById('champ-nom');
champNom.value = localStorage.getItem('mastermind-slg:nom') || '';
champNom.addEventListener('input', () => localStorage.setItem('mastermind-slg:nom', champNom.value));

const socket = io();
let dernierEtat = null;

socket.on('connect', () => {
  socket.emit('rejoindre', { code, joueur: moi, nom: champNom.value });
});

champNom.addEventListener('change', () => {
  socket.emit('definir-nom', { code, joueur: moi, nom: champNom.value });
});

socket.on('erreur', ({ message }) => {
  document.getElementById('erreur-choix').textContent = message;
  document.getElementById('erreur-jeu').textContent = message;
});

socket.on('duo-update', (etat) => {
  dernierEtat = etat;
  rendre(etat);
});

function rendre(etat) {
  if (!etat) {
    document.getElementById('carte-choix').innerHTML = `<p>Ce salon (${code}) n'existe pas ou n'est plus actif. <a class="retour" href="/">← Retour à l'accueil</a></p>`;
    return;
  }

  const estMot = etat.type === 'mots';
  const objet = estMot ? 'mot' : 'nombre';
  document.getElementById('info-choix').textContent = estMot
    ? `Mot secret de ${etat.digits} lettres (A à Z, sans accent ; une lettre peut se répéter).`
    : etat.repetition === 'unique'
      ? `Nombre secret de ${etat.digits} chiffres, tous différents.`
      : `Nombre secret de ${etat.digits} chiffres (les répétitions sont autorisées, ex: 1123).`;
  document.querySelector('#carte-choix h3').textContent = `Choisissez votre ${objet} secret`;
  document.getElementById('btn-valider-secret').textContent = `Valider mon ${objet}`;
  document.getElementById('mon-code').firstChild.textContent = estMot ? 'Mon mot : ' : 'Mon code : ';
  for (const id of ['champ-secret', 'champ-guess']) {
    const champ = document.getElementById(id);
    champ.setAttribute('inputmode', estMot ? 'text' : 'numeric');
    champ.setAttribute('autocomplete', 'off');
    champ.style.textTransform = estMot ? 'uppercase' : 'none';
  }

  const moiInfo = etat[moi];
  const advInfo = etat[adversaire];

  document.getElementById('badge-joueur').textContent = moiInfo.nom || (moi === 'joueur1' ? 'Joueur 1' : 'Joueur 2');
  if (!champNom.value && moiInfo.nom) champNom.value = moiInfo.nom;
  const nomAdversaire = advInfo.nom || (adversaire === 'joueur1' ? 'Joueur 1' : 'Joueur 2');

  const monCodeDiv = document.getElementById('mon-code');
  if (etat.monCode) {
    monCodeDiv.style.display = 'inline-block';
    document.getElementById('mon-code-valeur').textContent = etat.monCode;
  } else {
    monCodeDiv.style.display = 'none';
  }

  const carteChoix = document.getElementById('carte-choix');
  const carteJeu = document.getElementById('carte-jeu');
  const carteFin = document.getElementById('carte-fin');

  document.getElementById('legende').innerHTML = etat.difficulty === 'facile'
    ? `<span><span class="pastille-mini vert"></span> bon endroit</span>
       <span><span class="pastille-mini orange"></span> mauvais endroit</span>
       <span><span class="pastille-mini rouge"></span> absent</span>`
    : `<span><span class="pastille-mini vert"></span> présent</span>
       <span><span class="pastille-mini rouge"></span> absent</span>`;

  if (etat.status === 'choix') {
    carteChoix.style.display = 'block';
    carteJeu.style.display = 'none';
    carteFin.style.display = 'none';
    document.getElementById('champ-secret').maxLength = etat.digits;
    document.getElementById('champ-guess').maxLength = etat.digits;
    document.getElementById('champ-secret').placeholder = '?'.repeat(etat.digits);
    if (moiInfo.ready) {
      document.getElementById('champ-secret').disabled = true;
      document.getElementById('btn-valider-secret').disabled = true;
      document.getElementById('btn-alea').disabled = true;
      const attenteDiv = document.getElementById('etat-attente');
      attenteDiv.style.display = 'block';
      attenteDiv.textContent = advInfo.ready
        ? 'En attente...'
        : `En attente que ${nomAdversaire} choisisse son ${objet}...`;
    }
  } else if (etat.status === 'jeu') {
    carteChoix.style.display = 'none';
    carteJeu.style.display = 'block';
    carteFin.style.display = 'none';
    const monTour = etat.turn === moi;
    const statutDiv = document.getElementById('statut');
    statutDiv.className = `statut ${monTour ? 'mon-tour' : 'attente'}`;
    statutDiv.textContent = monTour
      ? `À vous de jouer ! Proposez un ${objet}.`
      : `En attente de la proposition de ${nomAdversaire}...`;
    document.getElementById('btn-guess').disabled = !monTour;
    document.getElementById('champ-guess').disabled = !monTour;
  } else if (etat.status === 'fini') {
    carteChoix.style.display = 'none';
    carteJeu.style.display = 'none';
    carteFin.style.display = 'block';
    const coups = moiInfo.historique.length;
    document.getElementById('titre-fin').textContent =
      etat.winner === moi
        ? `🎉 Vous avez gagné ! (en ${coups} coup${coups > 1 ? 's' : ''})`
        : `😔 ${nomAdversaire} a gagné.`;
  }

  redessinerHistorique(moiInfo.historique);
}

function redessinerHistorique(historique) {
  const conteneur = document.getElementById('historique');
  conteneur.innerHTML = '';
  historique.forEach((ligne, i) => {
    const div = document.createElement('div');
    div.className = 'ligne-historique';
    const num = document.createElement('span');
    num.className = 'numero-coup';
    num.textContent = `#${i + 1}`;
    const pastilles = document.createElement('div');
    pastilles.className = 'pastilles';
    ligne.guess.forEach((chiffre, idx) => {
      const p = document.createElement('div');
      p.className = `pastille ${ligne.resultat[idx]}`;
      p.textContent = chiffre;
      pastilles.appendChild(p);
    });
    div.appendChild(num);
    div.appendChild(pastilles);
    conteneur.prepend(div);
  });
}

// Mode mots : le serveur tire le mot au hasard dans son dictionnaire.
socket.on('mot-aleatoire', ({ mot }) => {
  document.getElementById('champ-secret').value = mot;
});

document.getElementById('btn-alea').addEventListener('click', () => {
  if (!dernierEtat) return;
  if (dernierEtat.type === 'mots') {
    socket.emit('mot-aleatoire', { code });
    return;
  }
  const n = dernierEtat.digits;
  let val;
  if (dernierEtat.repetition === 'unique') {
    const chiffres = [0,1,2,3,4,5,6,7,8,9];
    for (let i = chiffres.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chiffres[i], chiffres[j]] = [chiffres[j], chiffres[i]];
    }
    let selection = chiffres.slice(0, n);
    if (selection[0] === 0) {
      const idx = selection.findIndex((c) => c !== 0);
      if (idx > 0) [selection[0], selection[idx]] = [selection[idx], selection[0]];
    }
    val = selection.join('');
  } else {
    val = '';
    for (let i = 0; i < n; i++) {
      val += i === 0 ? String(1 + Math.floor(Math.random() * 9)) : String(Math.floor(Math.random() * 10));
    }
  }
  document.getElementById('champ-secret').value = val;
});

document.getElementById('btn-valider-secret').addEventListener('click', () => {
  const val = document.getElementById('champ-secret').value.trim();
  document.getElementById('erreur-choix').textContent = '';
  socket.emit('definir-secret', { code, joueur: moi, secret: val, nom: champNom.value });
});

document.getElementById('btn-guess').addEventListener('click', envoyerProposition);
document.getElementById('champ-guess').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') envoyerProposition();
});

function envoyerProposition() {
  const val = document.getElementById('champ-guess').value.trim();
  if (!val) return;
  document.getElementById('erreur-jeu').textContent = '';
  socket.emit('proposition', { code, joueur: moi, guess: val });
  document.getElementById('champ-guess').value = '';
}
