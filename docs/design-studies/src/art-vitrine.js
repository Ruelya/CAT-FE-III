/* VITRINE art layer — the light behind the glass.
   Four large soft sources drift on slow, mutually prime periods and parallax
   against the pointer. Drawn at an eighth of the window and blown back up,
   which is both cheap and exactly the softness wanted — the panes are frosted,
   so resolution here would be thrown away anyway. Sits at z-index 0 under
   #root, on <body>, untouched by re-renders. */

(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "0",
    pointerEvents: "none",
  });

  /* Cold daylight, one warm rim. Warmth is the smallest and slowest source,
     so it reads as a reflection off something outside the frame. Painted
     normally, not additively — additive blending over a pale ground clips
     straight to white and the field disappears. */
  const GROUND = "#cddfe9";
  const LIGHTS = [
    { hue: "56,180,205", a: 0.62, r: 0.6, px: 0.16, py: 0.2, sx: 0.26, sy: 0.15, tx: 41, ty: 67 },
    { hue: "96,138,200", a: 0.5, r: 0.68, px: 0.8, py: 0.16, sx: 0.2, sy: 0.19, tx: 59, ty: 47 },
    { hue: "126,222,196", a: 0.55, r: 0.54, px: 0.5, py: 0.9, sx: 0.24, sy: 0.12, tx: 73, ty: 53 },
    { hue: "255,166,110", a: 0.6, r: 0.33, px: 0.93, py: 0.76, sx: 0.14, sy: 0.16, tx: 97, ty: 83 },
    { hue: "255,255,255", a: 0.34, r: 0.3, px: 0.35, py: 0.52, sx: 0.3, sy: 0.22, tx: 113, ty: 71 },
    { hue: "168,224,236", a: 0.5, r: 0.5, px: 0.06, py: 0.62, sx: 0.16, sy: 0.2, tx: 87, ty: 61 },
  ];

  const start = () => {
    document.body.prepend(canvas);
    const g = canvas.getContext("2d");
    let w = 0;
    let h = 0;
    let mx = 0.5;
    let my = 0.5;
    let cx = 0.5;
    let cy = 0.5;

    const size = () => {
      w = canvas.width = Math.max(2, Math.ceil(innerWidth / 8));
      h = canvas.height = Math.max(2, Math.ceil(innerHeight / 8));
    };
    size();
    addEventListener("resize", size, { passive: true });
    addEventListener(
      "pointermove",
      (e) => {
        mx = e.clientX / innerWidth;
        my = e.clientY / innerHeight;
      },
      { passive: true },
    );

    const paint = (t) => {
      cx += (mx - cx) * 0.04;
      cy += (my - cy) * 0.04;

      g.fillStyle = GROUND;
      g.fillRect(0, 0, w, h);

      const d = Math.max(w, h);
      LIGHTS.forEach((L, i) => {
        /* Parallax depth: the wider a source, the further away it reads, so
           it moves least when the pointer travels. */
        const depth = 0.06 - i * 0.009;
        const x =
          (L.px + Math.sin(t / (L.tx * 1000)) * L.sx + (cx - 0.5) * depth * 4) * w;
        const y =
          (L.py + Math.cos(t / (L.ty * 1000)) * L.sy + (cy - 0.5) * depth * 4) * h;
        const r = L.r * d * (0.9 + Math.sin(t / (L.tx * 1700)) * 0.12);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(${L.hue},${L.a})`);
        grad.addColorStop(0.55, `rgba(${L.hue},${L.a * 0.4})`);
        grad.addColorStop(1, `rgba(${L.hue},0)`);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      });
      if (!reduce) requestAnimationFrame(paint);
    };
    requestAnimationFrame(paint);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
