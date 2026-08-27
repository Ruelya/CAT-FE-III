/* Daylight aurora. Same drifting light field as the dark study, drawn as
   pastel color on a warm white sky so the frosted sheet above reads as
   morning glass. Static frame when the user prefers reduced motion. */
(() => {
  const canvas = document.getElementById("aurora");
  const ctx = canvas.getContext("2d");
  const SCALE = 0.18;

  const LIGHTS = [
    { h: 164, s: 72, l: 78, r: 0.64, x: 0.16, y: 0.20, vx: 0.021, vy: 0.017, p: 0.0 },
    { h: 198, s: 82, l: 80, r: 0.56, x: 0.84, y: 0.14, vx: 0.016, vy: 0.023, p: 1.9 },
    { h: 148, s: 62, l: 76, r: 0.72, x: 0.70, y: 0.86, vx: 0.019, vy: 0.014, p: 3.7 },
    { h: 258, s: 60, l: 82, r: 0.50, x: 0.10, y: 0.88, vx: 0.014, vy: 0.020, p: 5.1 },
    { h: 212, s: 74, l: 80, r: 0.46, x: 0.50, y: 0.50, vx: 0.011, vy: 0.026, p: 2.6 },
  ];

  function resize() {
    canvas.width = Math.max(160, Math.round(innerWidth * SCALE));
    canvas.height = Math.max(100, Math.round(innerHeight * SCALE));
  }
  addEventListener("resize", resize);
  resize();

  function frame(t) {
    const w = canvas.width, h = canvas.height;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#f6f6f1";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "multiply";
    for (const L of LIGHTS) {
      const x = (L.x + 0.16 * Math.sin(t * L.vx + L.p)) * w;
      const y = (L.y + 0.14 * Math.cos(t * L.vy + L.p * 1.3)) * h;
      const r = L.r * Math.max(w, h);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${L.h}, ${L.s}%, ${L.l}%, 0.5)`);
      g.addColorStop(1, "hsla(0, 0%, 100%, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    frame(40);
  } else {
    let start = null;
    const loop = (ms) => {
      if (start == null) start = ms;
      frame((ms - start) / 1000 + 40);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
})();
