// Shared roulette wheel drawing + animation controller, used on master & player pages.
(function (global) {
  const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const SEG = 360 / WHEEL_ORDER.length;

  function colorOf(n) {
    if (n === 0) return 'green';
    return RED_NUMBERS.has(n) ? 'red' : 'black';
  }

  function drawFace(canvas) {
    const size = canvas.width;
    const ctx = canvas.getContext('2d');
    const cx = size / 2, cy = size / 2;
    const rOuter = size / 2 - 4;
    const rInner = rOuter * 0.42;

    ctx.clearRect(0, 0, size, size);

    // brass rim
    const rim = ctx.createRadialGradient(cx, cy, rOuter * 0.9, cx, cy, rOuter);
    rim.addColorStop(0, '#8a6a24');
    rim.addColorStop(1, '#f4dfa0');
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = rim;
    ctx.fill();

    const wheelR = rOuter - size * 0.025;

    WHEEL_ORDER.forEach((num, i) => {
      const startDeg = i * SEG - 90 - SEG / 2;
      const endDeg = startDeg + SEG;
      const start = (startDeg * Math.PI) / 180;
      const end = (endDeg * Math.PI) / 180;
      const col = colorOf(num);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, wheelR, start, end);
      ctx.closePath();
      ctx.fillStyle = col === 'red' ? '#a5293a' : col === 'black' ? '#1a1714' : '#0d7a44';
      ctx.fill();
      ctx.strokeStyle = 'rgba(216,178,92,.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // number label
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((i * SEG - 90) * Math.PI / 180);
      ctx.translate(wheelR * 0.78, 0);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#f3ead8';
      ctx.font = `${Math.max(9, size * 0.032)}px 'Barlow Condensed', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(num), 0, 0);
      ctx.restore();
    });

    // inner cone
    const cone = ctx.createRadialGradient(cx, cy, 0, cx, cy, rInner);
    cone.addColorStop(0, '#3a2f14');
    cone.addColorStop(1, '#171310');
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fillStyle = cone;
    ctx.fill();
    ctx.strokeStyle = 'rgba(216,178,92,.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function createController(canvas, opts) {
    opts = opts || {};
    const idleSpeed = opts.idleSpeed || 0.015; // deg per ms
    drawFace(canvas);

    let angle = 0;
    let mode = 'idle';
    let spinFrom = 0, spinTo = 0, spinStart = 0, spinDuration = 3000;
    let last = performance.now();
    let onDone = null;

    function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }

    function frame(now) {
      const dt = now - last;
      last = now;
      if (mode === 'idle') {
        angle += idleSpeed * dt;
      } else if (mode === 'spinning') {
        const t = Math.min(1, (now - spinStart) / spinDuration);
        angle = spinFrom + (spinTo - spinFrom) * easeOutQuint(t);
        if (t >= 1) {
          mode = 'idle';
          angle = spinTo;
          if (onDone) { const cb = onDone; onDone = null; cb(); }
        }
      }
      canvas.style.transform = `rotate(${angle}deg)`;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });

    return {
      spinTo(winNumber, durationMs, cb) {
        const idx = WHEEL_ORDER.indexOf(winNumber);
        const desired = ((360 - (idx * SEG) % 360) % 360);
        const base = Math.floor(angle / 360) * 360;
        let candidate = base + desired;
        while (candidate <= angle) candidate += 360;
        candidate += 5 * 360; // dramatic extra spins
        spinFrom = angle;
        spinTo = candidate;
        spinStart = performance.now();
        spinDuration = durationMs || 3000;
        mode = 'spinning';
        onDone = cb || null;
      }
    };
  }

  // Static radial "frequency dial": one bar per number (arranged in the
  // same physical order as the wheel), protruding outward from a baseline
  // ring. Bar length scales with how many times that number has been drawn;
  // color marks which quartile (coldest -> hottest) it falls into.
  function drawFrequencyDial(canvas, counts) {
    const size = canvas.width;
    const ctx = canvas.getContext('2d');
    const cx = size / 2, cy = size / 2;
    const outerR = size / 2 - size * 0.11; // leave room for number labels
    const baseR = outerR * 0.5;
    const maxBarLen = outerR - baseR;

    ctx.clearRect(0, 0, size, size);

    const safeCounts = (counts && counts.length === 37) ? counts : new Array(37).fill(0);
    const sorted = [...safeCounts].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(37 * 0.25)];
    const q2 = sorted[Math.floor(37 * 0.5)];
    const q3 = sorted[Math.floor(37 * 0.75)];
    const maxCount = Math.max(...safeCounts, 1);

    function colorFor(c) {
      if (c <= q1) return '#4a90d9';   // bleu : froids + quart le moins tire
      if (c <= q2) return '#3fae6b';   // vert : 2e quart
      if (c <= q3) return '#e0902f';   // orange : 3e quart
      return '#c0392b';                // rouge : chauds + quart le plus tire
    }

    // baseline ring
    ctx.beginPath();
    ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(244,223,160,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const barWidth = Math.max(2, size * 0.016);

    WHEEL_ORDER.forEach((num, i) => {
      const angle = (i * SEG - 90) * Math.PI / 180;
      const count = safeCounts[num] || 0;
      const barLen = maxCount > 0 ? maxBarLen * (count / maxCount) : 0;
      const color = colorFor(count);
      const cos = Math.cos(angle), sin = Math.sin(angle);

      if (barLen > 0.5) {
        ctx.beginPath();
        ctx.moveTo(cx + cos * baseR, cy + sin * baseR);
        ctx.lineTo(cx + cos * (baseR + barLen), cy + sin * (baseR + barLen));
        ctx.strokeStyle = color;
        ctx.lineWidth = barWidth;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // number label just outside the max bar extent
      const lx = cx + cos * (outerR + size * 0.055);
      const ly = cy + sin * (outerR + size * 0.055);
      ctx.fillStyle = '#f3ead8';
      ctx.font = `${Math.max(8, size * 0.03)}px 'Barlow Condensed', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(num), lx, ly);
    });

    // center count-total label (small, for context)
    const total = safeCounts.reduce((a, b) => a + b, 0);
    ctx.fillStyle = 'rgba(243,234,216,.6)';
    ctx.font = `${Math.max(8, size * 0.026)}px 'Barlow Condensed', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total > 0 ? `${total} tirages` : 'aucun tirage', cx, cy);
  }

  global.CasinoWheel = { WHEEL_ORDER, colorOf, drawFace, createController, drawFrequencyDial };
})(window);
