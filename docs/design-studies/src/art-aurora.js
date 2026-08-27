/* AURORA light field, ported from the Fable study's fx.js onto the Opus art
   layer convention: the canvas is created here and attached to <body>, never
   inside #root, because the renderer replaces #root wholesale on every state
   change and the field has to survive a keystroke.

   Five radial lights drift on mutually unrelated periods and blend additively
   into a very small canvas that CSS then upscales — cheap, and the upscale is
   exactly the softness wanted. Reduced motion renders one static frame. */
(() => {
  const SCALE = 0.18;
  const canvas = document.createElement("canvas");
  canvas.id = "aurora";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "0",
    pointerEvents: "none",
  });
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const LIGHTS = [
    { h: 168, s: 90, l: 42, r: 0.62, x: 0.18, y: 0.22, vx: 0.021, vy: 0.017, p: 0.0 },
    { h: 196, s: 95, l: 45, r: 0.55, x: 0.82, y: 0.14, vx: 0.016, vy: 0.023, p: 1.9 },
    { h: 152, s: 80, l: 38, r: 0.7, x: 0.7, y: 0.85, vx: 0.019, vy: 0.014, p: 3.7 },
    { h: 262, s: 70, l: 40, r: 0.48, x: 0.1, y: 0.88, vx: 0.014, vy: 0.02, p: 5.1 },
    { h: 214, s: 85, l: 44, r: 0.44, x: 0.5, y: 0.5, vx: 0.011, vy: 0.026, p: 2.6 },
  ];

  function resize() {
    canvas.width = Math.max(160, Math.round(innerWidth * SCALE));
    canvas.height = Math.max(100, Math.round(innerHeight * SCALE));
  }
  addEventListener("resize", resize);
  resize();

  function frame(t) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#060a10";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (const L of LIGHTS) {
      const x = (L.x + 0.16 * Math.sin(t * L.vx + L.p)) * w;
      const y = (L.y + 0.14 * Math.cos(t * L.vy + L.p * 1.3)) * h;
      const r = L.r * Math.max(w, h);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${L.h}, ${L.s}%, ${L.l}%, 0.42)`);
      g.addColorStop(1, "hsla(0, 0%, 0%, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
