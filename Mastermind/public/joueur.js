const moi = window.location.pathname.includes('joueur2') ? 'joueur2' : 'joueur1';
const adversaire = moi === 'joueur1' ? 'joueur2' : 'joueur1';

document.getElementById('badge-joueur').textContent = moi === 'joueur1' ? 'Joueur 1' : 'Joueur 2';

// --- Nom mémorisé dans le navigateur d'une partie à l'autre ---
const champNom = document.getElementById('champ-nom');
champNom.value = localStorage.getItem('mastermind:nom') || '';
champNom.addEventListener('input', () => localStorage.setItem('mastermind:nom', champNom.value));

const socket = io();
let dernierEtat = null;

socket.on('connect', () => {
  socket.emit('rejoindre', { joueur: moi, nom: champNom.value });
});

champNom.addEventListener('change', () => {
  socket.emit('definir-nom', { joueur: moi, nom: champNom.value });
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
    document.getElementById('carte-choix').innerHTML = '<p>Aucune partie à 2 joueurs en cours. <a class="retour" href="/">← Retour à l\'accueil</a></p>';
    return;
  }

  document.getElementById('info-choix').textContent = etat.repetition === 'unique'
    ? `Nombre secret de ${etat.digits} chiffres, tous différents.`
    : `Nombre secret de ${etat.digits} chiffres (les répétitions sont autorisées, ex: 1123).`;

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
        : `En attente que ${nomAdversaire} choisisse son nombre...`;
    }
  } else if (etat.status === 'jeu') {
    carteChoix.style.display = 'none';
    carteJeu.style.display = 'block';
    carteFin.style.display = 'none';
    const monTour = etat.turn === moi;
    const statutDiv = document.getElementById('statut');
    statutDiv.className = `statut ${monTour ? 'mon-tour' : 'attente'}`;
    statutDiv.textContent = monTour
      ? 'À vous de jouer ! Proposez un nombre.'
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

document.getElementById('btn-alea').addEventListener('click', () => {
  if (!dernierEtat) return;
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
  socket.emit('definir-secret', { joueur: moi, secret: val, nom: champNom.value });
});

document.getElementById('btn-guess').addEventListener('click', envoyerProposition);
document.getElementById('champ-guess').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') envoyerProposition();
});

function envoyerProposition() {
  const val = document.getElementById('champ-guess').value.trim();
  if (!val) return;
  document.getElementById('erreur-jeu').textContent = '';
  socket.emit('proposition', { joueur: moi, guess: val });
  document.getElementById('champ-guess').value = '';
}
