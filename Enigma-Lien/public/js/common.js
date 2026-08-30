/* Fonctions partagées de rendu (solo.html + joueur.html) */

const TYPE_COLOR = {
  Normal:"#A8A878",Feu:"#F08030",Eau:"#6890F0",Électrik:"#F8D030",Plante:"#78C850",
  Glace:"#98D8D8",Combat:"#C03028",Poison:"#A040A0",Sol:"#E0C068",Vol:"#A890F0",
  Psy:"#F85888",Insecte:"#A8B820",Roche:"#B8A038",Spectre:"#705898",Dragon:"#7038F8",
  Ténèbres:"#705848",Acier:"#B8B8D0",Fée:"#EE99AC"
};

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

function tagColor(tag) {
  return TYPE_COLOR[tag] || hashColor(tag);
}

function imgUrl(imageFolder, filename) {
  return `/images/${imageFolder}/${encodeURIComponent(filename)}`;
}

/**
 * Affiche le plateau (6 cartes) dans `container`.
 * display: [{name, types?, image}]
 * onMove(index, dir) : appelé quand on clique ◀ / ▶
 */
function renderBoard(container, display, imageFolder, onMove, disabled) {
  container.innerHTML = "";
  display.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "card";
    const initials = p.name.slice(0, 2).toUpperCase();
    const mainTag = p.types && p.types[0];
    const iconBg = mainTag ? tagColor(mainTag) : hashColor(p.name);
    const badges = (p.types || [])
      .map((t) => `<span class="badge" style="background:${tagColor(t)}">${t}</span>`)
      .join("");
    card.innerHTML = `
      <div class="icon" style="background:${iconBg}" data-fallback="${initials}">
        ${p.image ? `<img src="${imgUrl(imageFolder, p.image)}" alt="" onerror="this.parentElement.innerHTML=this.parentElement.dataset.fallback;">` : initials}
      </div>
      <div class="name">${p.name}</div>
      <div class="types">${badges}</div>
      <div class="movebtns">
        <button ${i === 0 || disabled ? "disabled" : ""} data-dir="-1" data-idx="${i}">◀</button>
        <button ${i === display.length - 1 || disabled ? "disabled" : ""} data-dir="1" data-idx="${i}">▶</button>
      </div>
    `;
    container.appendChild(card);
  });
  container.querySelectorAll("button[data-dir]").forEach((btn) => {
    btn.addEventListener("click", () => onMove(parseInt(btn.dataset.idx, 10), parseInt(btn.dataset.dir, 10)));
  });
}

/**
 * Affiche la rangée de liens.
 * links: [{cat,sym}], criteriaMeta: [{id,label,icon}], results: [bool] optionnel
 */
function renderLinks(container, links, criteriaMeta, results) {
  const metaById = {};
  (criteriaMeta || []).forEach((c) => (metaById[c.id] = c));
  container.innerHTML = "";
  links.forEach((l, i) => {
    const meta = metaById[l.cat] || { label: l.cat, icon: "?" };
    const div = document.createElement("div");
    div.className = "link";
    if (results) div.classList.add(results[i] ? "good" : "bad");
    div.innerHTML = `
      <div class="bracket"></div>
      <div class="chip">${meta.icon}</div>
      <div class="label">${meta.label} ${l.sym}</div>
    `;
    container.appendChild(div);
  });
}

function renderLives(container, livesLeft, livesMax) {
  container.innerHTML = "";
  for (let i = 0; i < livesMax; i++) {
    const b = document.createElement("div");
    b.className = "ball" + (i < livesLeft ? "" : " off");
    container.appendChild(b);
  }
}

function arraysEqualByName(a, b) {
  return a.length === b.length && a.every((x, i) => x.name === b[i].name);
}

function shuffleClientSide(display) {
  // simple mélange visuel local (le serveur ne renvoie qu'un seul ordre "display";
  // on ne mélange donc pas côté client — conservé pour usage éventuel futur)
  return display;
}
