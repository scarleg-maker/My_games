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
 * Affiche le plateau (6 cartes) dans `container`. Seuls l'image et le nom
 * sont visibles — aucune information de type/critère n'est révélée sur la
 * carte elle-même, quel que soit le thème.
 * display: [{name, image?}]
 * onMove(index, dir) : appelé quand on clique ◀ / ▶ (échange avec le voisin)
 * onSwap(fromIndex, toIndex) : appelé quand on dépose une carte glissée sur
 *   une autre — échange simplement les deux positions (ex : la carte en
 *   position 4 déposée en position 2 échange sa place avec celle en 2).
 */
function renderBoard(container, display, imageFolder, onMove, onSwap, disabled) {
  container.innerHTML = "";
  display.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.idx = String(i);
    const initials = p.name.slice(0, 2).toUpperCase();
    const iconBg = hashColor(p.name);
    card.innerHTML = `
      <div class="icon" style="background:${iconBg}" data-fallback="${initials}">
        ${p.image ? `<img src="${imgUrl(imageFolder, p.image)}" alt="" draggable="false" onerror="this.parentElement.innerHTML=this.parentElement.dataset.fallback;">` : initials}
      </div>
      <div class="name">${p.name}</div>
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
  if (!disabled && onSwap) enableCardDragAndDrop(container, onSwap);
}

/**
 * Glisser-déposer (souris ET tactile, via Pointer Events) pour échanger deux
 * cartes. Poser la carte source sur une autre carte échange leurs positions ;
 * un simple clic/tap (sans déplacement notable) ne déclenche rien.
 */
function enableCardDragAndDrop(container, onSwap) {
  let drag = null; // {pointerId, sourceIdx, cardEl, moved, startX, startY}

  function clearDropHighlight() {
    container.querySelectorAll(".card.drop-target").forEach((c) => c.classList.remove("drop-target"));
  }

  function targetCardAt(clientX, clientY, exceptEl) {
    const el = document.elementFromPoint(clientX, clientY);
    const card = el && el.closest ? el.closest(".card") : null;
    if (!card || !container.contains(card) || card === exceptEl) return null;
    return card;
  }

  container.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      if (e.button !== undefined && e.button !== 0) return; // clic gauche / tactile uniquement
      drag = {
        pointerId: e.pointerId,
        sourceIdx: parseInt(card.dataset.idx, 10),
        cardEl: card,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
      };
      card.setPointerCapture(e.pointerId);
    });

    card.addEventListener("pointermove", (e) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (!drag.moved) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.hypot(dx, dy) < 8) return;
        drag.moved = true;
        drag.cardEl.classList.add("dragging");
      }
      clearDropHighlight();
      const target = targetCardAt(e.clientX, e.clientY, drag.cardEl);
      if (target) target.classList.add("drop-target");
    });

    function finishDrag(e) {
      if (!drag || drag.pointerId !== e.pointerId) return;
      drag.cardEl.classList.remove("dragging");
      clearDropHighlight();
      if (drag.moved) {
        const target = targetCardAt(e.clientX, e.clientY, drag.cardEl);
        if (target) {
          const targetIdx = parseInt(target.dataset.idx, 10);
          if (targetIdx !== drag.sourceIdx) onSwap(drag.sourceIdx, targetIdx);
        }
      }
      drag = null;
    }

    card.addEventListener("pointerup", finishDrag);
    card.addEventListener("pointercancel", finishDrag);
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
