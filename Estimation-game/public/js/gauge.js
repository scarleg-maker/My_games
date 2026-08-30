// Dessine une jauge en demi-cercle (0% à gauche -> 100% à droite)
// value : valeur affichée par l'aiguille (0-100)
// opts.target : si fourni, affiche la réponse avec des zones de points autour de cette valeur
function drawGauge(containerEl, value, opts = {}) {
  const val = Math.max(0, Math.min(100, Number(value) || 0));
  const cx = 150, cy = 150;
  const r = 120;                 // rayon de l'arc principal (dégradé de valeur)
  const circumference = Math.PI * r;

  const angleDeg = 180 - (val / 100) * 180; // 180° = 0%, 0° = 100%
  const rad = (angleDeg * Math.PI) / 180;
  const needleX = cx + r * Math.cos(rad);
  const needleY = cy - r * Math.sin(rad);

  const hasTarget = opts.target !== undefined && opts.target !== null;
  const zonesSvg = hasTarget ? buildZonesArc(opts.target, cx, cy) : '';
  const answerLabel = hasTarget
    ? `<text x="150" y="188" text-anchor="middle" font-size="15" font-weight="700" fill="#0d5c48">Réponse : ${opts.target}%</text>`
    : '';

  containerEl.innerHTML = `
    <svg viewBox="0 0 300 205" class="gauge-svg">
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#2f6fed"/>
          <stop offset="50%" stop-color="#ffd23f"/>
          <stop offset="100%" stop-color="#ef3f3f"/>
        </linearGradient>
      </defs>
      <path d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="url(#gaugeGrad)" stroke-width="22" stroke-linecap="round"/>
      ${zonesSvg}
      <line x1="${cx}" y1="${cy}" x2="${needleX}" y2="${needleY}" stroke="#111111" stroke-width="4" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="8" fill="#111111"/>
      <text x="150" y="150" text-anchor="middle" font-size="46" font-weight="900" fill="#000000">${val}%</text>
      <text x="15" y="168" text-anchor="start" font-size="12" fill="#5b5b5b">0</text>
      <text x="285" y="168" text-anchor="end" font-size="12" fill="#5b5b5b">100</text>
      ${answerLabel}
    </svg>
    ${hasTarget ? buildZonesLegend() : ''}`;
}

// Construit l'arc intérieur représentant les zones de points autour de la réponse (target)
function buildZonesArc(target, cx, cy) {
  const r = 88;                     // rayon de l'arc des zones (à l'intérieur de l'arc principal)
  const circ = Math.PI * r;
  const pathD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  const track = `<path d="${pathD}" fill="none" stroke="#e7e7e7" stroke-width="16" stroke-linecap="round"/>`;

  const segment = (delta, color) => {
    const start = Math.max(0, target - delta);
    const end = Math.min(100, target + delta);
    if (end <= start) return '';
    const startLen = (start / 100) * circ;
    const segLen = ((end - start) / 100) * circ;
    return `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="16"
              stroke-dasharray="${segLen} ${circ - segLen}" stroke-dashoffset="-${startLen}"/>`;
  };

  // Du plus large (1 pt) au plus étroit (5 pts, réponse exacte) pour un effet "cible"
  return track
    + segment(8, '#cfe3ff')   // ±8 -> 1 pt
    + segment(5, '#ffe08a')   // ±5 -> 2 pts
    + segment(2, '#ff9f43')   // ±2 -> 3 pts
    + segment(0.6, '#ff4757'); // exact -> 5 pts
}

function buildZonesLegend() {
  return `
    <div class="gauge-legend">
      <span><i style="background:#ff4757"></i>Exact = 5 pts</span>
      <span><i style="background:#ff9f43"></i>±2 = 3 pts</span>
      <span><i style="background:#ffe08a"></i>±5 = 2 pts</span>
      <span><i style="background:#cfe3ff"></i>±8 = 1 pt</span>
    </div>`;
}
