/* PHOSPHOR art layer — the signal.
   A screen-blended noise field over the whole tube, redrawn at 12fps from a
   handful of pre-baked tiles rather than per-frame, plus an occasional
   horizontal tear. Alpha is deliberately tiny: this has to read as a tube
   under load, not as texture over the text. Lives on <body>, so #root can
   re-render as often as it likes. */

(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const TILE = 128;
  const TILES = 4;

  /* An emissive tube screens grain up; a reflective panel multiplies it
     down. The sheet decides which, so the light sibling reuses this layer
     unchanged. */
  const css = getComputedStyle(document.documentElement);
  const blend = (css.getPropertyValue("--crt-noise-blend") || "screen").trim();
  const alpha = (css.getPropertyValue("--crt-noise-alpha") || "0.05").trim();

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "9996",
    pointerEvents: "none",
    mixBlendMode: blend,
    opacity: alpha,
  });

  const bake = () => {
    const c = document.createElement("canvas");
    c.width = c.height = TILE;
    const g = c.getContext("2d");
    const img = g.createImageData(TILE, TILE);
    for (let i = 0; i < TILE * TILE; i++) {
      const v = Math.random() < 0.5 ? 0 : Math.random() * 255;
      img.data[i * 4] = v * 0.75;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v * 0.85;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  };

  const start = () => {
    document.body.appendChild(canvas);
    const g = canvas.getContext("2d");
    const tiles = Array.from({ length: TILES }, bake);
    let tear = null;
    let last = 0;
    let frame = 0;

    const size = () => {
      canvas.width = Math.ceil(innerWidth / 2);
      canvas.height = Math.ceil(innerHeight / 2);
      g.imageSmoothingEnabled = false;
    };
    size();
    addEventListener("resize", size, { passive: true });

    const draw = (t) => {
      requestAnimationFrame(draw);
      if (t - last < 82) return;
      last = t;
      frame++;

      const pat = g.createPattern(tiles[frame % TILES], "repeat");
      g.globalAlpha = 1;
      g.fillStyle = pat;
      g.setTransform(1, 0, 0, 1, (frame * 13) % TILE, (frame * 7) % TILE);
      g.fillRect(-TILE, -TILE, canvas.width + TILE * 2, canvas.height + TILE * 2);
      g.setTransform(1, 0, 0, 1, 0, 0);

      /* Tears are rare and short: a band of the raster arriving displaced. */
      if (!tear && Math.random() < 0.014) {
        tear = { y: Math.random() * canvas.height, h: 4 + Math.random() * 26, left: 12 };
      }
      if (tear) {
        g.globalAlpha = 0.5;
        g.fillStyle = "#9fffe0";
        g.fillRect(0, tear.y, canvas.width, 1);
        g.globalAlpha = 0.22;
        g.fillRect(20, tear.y, canvas.width, tear.h);
        if (--tear.left <= 0) tear = null;
      }
    };
    requestAnimationFrame(draw);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
