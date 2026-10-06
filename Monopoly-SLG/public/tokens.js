// Monopoly-SLG — pions officiels (formes SVG) et palette de couleurs.
// Fichier partagé : chargé par les pages (window.MPT) et par le serveur (require).
(function (root) {
  const COLORS = [
    { id: 'rouge',   name: 'Rouge',   hex: '#e63946' },
    { id: 'bleu',    name: 'Bleu',    hex: '#457b9d' },
    { id: 'turquoise', name: 'Turquoise', hex: '#2a9d8f' },
    { id: 'orange',  name: 'Orange',  hex: '#f4a261' },
    { id: 'violet',  name: 'Violet',  hex: '#8338ec' },
    { id: 'jaune',   name: 'Jaune',   hex: '#ffbe0b' },
    { id: 'menthe',  name: 'Menthe',  hex: '#06d6a0' },
    { id: 'rose',    name: 'Rose',    hex: '#ef476f' },
    { id: 'noir',    name: 'Noir',    hex: '#2b2b2b' },
    { id: 'blanc',   name: 'Blanc',   hex: '#fdfcf7' },
    { id: 'marron',  name: 'Marron',  hex: '#8d5a34' },
    { id: 'vert',    name: 'Vert',    hex: '#7cb518' },
  ];

  // Chaque pion est dessiné dans un carré de 64×64. Les formes principales utilisent la couleur du joueur
  // (currentColor) ; les détails sont en gris clair / sombre pour rester lisibles quelle que soit la couleur.
  const L = '#e8eef0', D = '#1c2b22';
  const TOKENS = [
    { id: 'chien', name: 'Chien', svg: `
      <path d="M13 29 L5 17 L10 14 L19 26 Z"/>
      <rect x="13" y="26" width="34" height="19" rx="9"/>
      <rect x="16" y="42" width="7" height="15" rx="2.5"/>
      <rect x="37" y="42" width="7" height="15" rx="2.5"/>
      <path d="M36 6 L48 11 L44 22 Z"/>
      <circle cx="47" cy="22" r="10"/>
      <rect x="49" y="22" width="13" height="8" rx="3.5"/>
      <circle cx="49" cy="19" r="2" fill="${D}" stroke="none"/>
      <circle cx="60" cy="24" r="1.8" fill="${D}" stroke="none"/>` },
    { id: 'bateau', name: 'Bateau', svg: `
      <rect x="31" y="6" width="3" height="14" fill="${D}" stroke="none"/>
      <path d="M34 7 L46 11 L34 15 Z"/>
      <rect x="25" y="20" width="14" height="9" rx="1.5"/>
      <rect x="13" y="29" width="38" height="11" rx="2"/>
      <rect x="43" y="14" width="5" height="12" rx="1"/>
      <path d="M4 40 H60 L51 55 H13 Z"/>
      <circle cx="22" cy="34.5" r="2" fill="${L}" stroke="none"/><circle cx="32" cy="34.5" r="2" fill="${L}" stroke="none"/><circle cx="42" cy="34.5" r="2" fill="${L}" stroke="none"/>
      <path d="M2 58 Q9 54 16 58 T30 58 T44 58 T58 58" fill="none" stroke="${D}" stroke-width="2.5"/>` },
    { id: 'canon', name: 'Canon', svg: `
      <path d="M10 33 L42 14 L52 29 L20 46 Z"/>
      <rect x="40" y="10" width="14" height="10" rx="2" transform="rotate(34 47 15)"/>
      <rect x="10" y="53" width="44" height="5" rx="2"/>
      <circle cx="30" cy="44" r="11"/>
      <circle cx="30" cy="44" r="4.5" fill="${L}"/>
      <path d="M30 33 V55 M19 44 H41" stroke="${D}" stroke-width="2"/>
      <circle cx="8" cy="40" r="3" fill="${D}" stroke="none"/>` },
    { id: 'voiture', name: 'Voiture', svg: `
      <path d="M4 44 L6 34 L18 31 L26 21 H42 L50 30 L60 33 L61 44 Z"/>
      <path d="M22 30 L28 24 H34 V30 Z M37 24 H42 L47 30 H37 Z" fill="${L}" stroke-width="2"/>
      <circle cx="19" cy="45" r="8" fill="${D}"/><circle cx="19" cy="45" r="3.2" fill="${L}" stroke="none"/>
      <circle cx="47" cy="45" r="8" fill="${D}"/><circle cx="47" cy="45" r="3.2" fill="${L}" stroke="none"/>
      <rect x="2" y="38" width="5" height="4" fill="${D}" stroke="none"/>` },
    { id: 'chapeau', name: 'Chapeau', svg: `
      <rect x="17" y="10" width="30" height="38" rx="4"/>
      <rect x="17" y="36" width="30" height="8" fill="${D}"/>
      <ellipse cx="32" cy="49" rx="26" ry="7"/>
      <ellipse cx="32" cy="10" rx="15" ry="3" fill="${L}" stroke-width="2"/>` },
    { id: 'fer', name: 'Fer à repasser', svg: `
      <path d="M17 33 Q17 14 31 14 H35 Q47 14 47 33 H40 Q40 22 34 22 H31 Q24 22 24 33 Z"/>
      <path d="M5 52 H61 L49 33 H13 Q5 35 5 45 Z"/>
      <rect x="5" y="49" width="56" height="7" rx="3" fill="${D}"/>
      <circle cx="22" cy="41" r="2.6" fill="${L}" stroke="none"/><circle cx="32" cy="41" r="2.6" fill="${L}" stroke="none"/><circle cx="42" cy="41" r="2.6" fill="${L}" stroke="none"/>` },
    { id: 'de', name: 'Dé à coudre', svg: `
      <path d="M17 52 L21 25 Q32 8 43 25 L47 52 Z"/>
      <rect x="14" y="49" width="36" height="8" rx="3"/>
      <circle cx="26" cy="27" r="2" fill="${D}" opacity=".5" stroke="none"/><circle cx="38" cy="27" r="2" fill="${D}" opacity=".5" stroke="none"/>
      <circle cx="21" cy="36" r="2" fill="${D}" opacity=".5" stroke="none"/><circle cx="32" cy="36" r="2" fill="${D}" opacity=".5" stroke="none"/><circle cx="43" cy="36" r="2" fill="${D}" opacity=".5" stroke="none"/>
      <circle cx="26" cy="44" r="2" fill="${D}" opacity=".5" stroke="none"/><circle cx="38" cy="44" r="2" fill="${D}" opacity=".5" stroke="none"/>
      <circle cx="32" cy="20" r="2" fill="${D}" opacity=".5" stroke="none"/>` },
    { id: 'brouette', name: 'Brouette', svg: `
      <path d="M40 28 L61 40 L58 45 L36 34 Z"/>
      <path d="M6 22 H44 L37 42 H17 Z"/>
      <rect x="35" y="42" width="5" height="14" rx="1.5"/>
      <path d="M22 56 L30 42 H36 L44 56 Z" fill="none" stroke="none"/>
      <circle cx="14" cy="47" r="9" fill="${D}"/><circle cx="14" cy="47" r="3.5" fill="${L}" stroke="none"/>
      <path d="M17 26 H40" stroke="${D}" stroke-width="2" opacity=".5"/>` },
  ];

  function tokenSvg(id, color, size) {
    const t = TOKENS.find((x) => x.id === id) || TOKENS[0];
    const s = size ? ` width="${size}" height="${size}"` : '';
    return `<svg class="tok" viewBox="0 0 64 64"${s} style="color:${color}" aria-label="${t.name}"><g fill="currentColor" stroke="${D}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">${t.svg}</g></svg>`;
  }
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function colorDistance(a, b) { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }

  const api = { COLORS, TOKENS, tokenSvg, colorDistance };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MPT = api;
})(typeof window !== 'undefined' ? window : globalThis);
