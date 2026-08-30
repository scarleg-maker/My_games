let etat = null;

async function chargerEtat() {
  const res = await fetch('/api/solo/state');
  if (!res.ok) {
    document.body.innerHTML = '<div class="carte"><p>Aucune partie en cours. <a class="retour" href="/">← Retour à l\'accueil</a></p></div>';
    return;
  }
  etat = await res.json();
  if (etat.nom) {
    const badge = document.getElementById('badge-nom');
    badge.textContent = etat.nom;
    badge.style.display = 'inline-block';
  }
  document.getElementById('titre').textContent = `Devinez le nombre secret (${etat.digits} chiffres)`;
  const legendeRep = document.createElement('p');
  legendeRep.className = 'info';
  legendeRep.textContent = etat.repetition === 'unique'
    ? 'Chiffres tous différents.'
    : 'Répétitions autorisées (ex : 1123).';
  document.getElementById('compteur').after(legendeRep);
  document.getElementById('champ-guess').maxLength = etat.digits;
  document.getElementById('champ-guess').placeholder = '?'.repeat(etat.digits);
  document.getElementById('legende-orange').style.display = etat.difficulty === 'facile' ? 'inline-flex' : 'none';
  majCompteur();
  redessinerHistorique();
  if (etat.gagne) afficherVictoire();
}

function majCompteur() {
  document.getElementById('compteur').textContent = `Coups joués : ${etat.tentatives}`;
}

function redessinerHistorique() {
  const conteneur = document.getElementById('historique');
  conteneur.innerHTML = '';
  etat.historique.forEach((ligne, i) => {
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

function afficherVictoire() {
  document.getElementById('carte-victoire').style.display = 'block';
  const nom = etat.nom && etat.nom !== 'Joueur' ? etat.nom : 'Vous avez';
  const verbe = nom === 'Vous avez' ? '' : ` (${nom})`;
  document.getElementById('texte-victoire').textContent =
    `Le nombre a été trouvé${verbe} en ${etat.tentatives} coup${etat.tentatives > 1 ? 's' : ''} !`;
  document.getElementById('btn-valider').disabled = true;
  document.getElementById('champ-guess').disabled = true;
}

document.getElementById('btn-valider').addEventListener('click', valider);
document.getElementById('champ-guess').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') valider();
});

async function valider() {
  const champ = document.getElementById('champ-guess');
  const erreurDiv = document.getElementById('erreur');
  erreurDiv.textContent = '';
  const guess = champ.value.trim();
  if (!guess) return;

  const res = await fetch('/api/solo/guess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guess }),
  });
  const data = await res.json();
  if (!res.ok) {
    erreurDiv.textContent = data.error;
    return;
  }

  etat.tentatives = data.tentatives;
  etat.historique.push({ guess: guess.split('').map(Number), resultat: data.resultat });
  etat.gagne = data.gagne;
  majCompteur();
  redessinerHistorique();
  champ.value = '';
  if (data.gagne) afficherVictoire();
}

chargerEtat();
