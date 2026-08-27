/* RISO art layer — the paper.
   Paints one tile of newsprint fibre and hands it to CSS as a repeating
   background. Generated rather than shipped so the grain is real noise with
   fibre structure, not a lossy photo of some other sheet. Runs once; it
   lives on <body>, so a re-render of #root never disturbs it. */

(() => {
  const SIZE = 220;

  function paperTile() {
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    const g = c.getContext("2d");
    const img = g.createImageData(SIZE, SIZE);
    const d = img.data;

    /* Base speckle: uncoated stock is mostly light with dark flecks. */
    for (let i = 0; i < SIZE * SIZE; i++) {
      const n = Math.random();
      const v = 236 + (n < 0.94 ? n * 20 : -70 * (n - 0.94) * 16);
      const k = Math.max(150, Math.min(255, v));
      d[i * 4] = k;
      d[i * 4 + 1] = k - 3;
      d[i * 4 + 2] = k - 10;
      d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);

    /* Fibres: short pale strokes at shallow random angles. */
    g.globalAlpha = 0.16;
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * SIZE;
      const y = Math.random() * SIZE;
      const a = Math.random() * Math.PI;
      const len = 3 + Math.random() * 11;
      g.strokeStyle = Math.random() > 0.45 ? "#ffffff" : "#a9a08a";
      g.lineWidth = Math.random() * 0.9 + 0.25;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    g.globalAlpha = 1;
    return c.toDataURL("image/png");
  }

  const apply = () => {
    document.documentElement.style.setProperty("--paper-grain", `url(${paperTile()})`);

    /* Set the second-pull echo used by the heading misregistration rule. */
    const echo = () => {
      document.querySelectorAll(".railsec__head h2, .panel__head h3").forEach((h) => {
        if (!h.dataset.echo) h.dataset.echo = "";
      });
    };
    echo();
    new MutationObserver(echo).observe(document.getElementById("root"), {
      childList: true,
      subtree: true,
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
})();
