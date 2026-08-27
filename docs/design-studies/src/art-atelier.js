/* ATELIER art layer — the light in the room.
   Publishes the pointer as --mx/--my so the wall wash and every brass
   specular band point at it. The value is eased toward the pointer rather
   than snapped to it: heavy fittings do not chase a cursor. Written on
   <html>, outside #root, so a re-render never resets the lighting. */

(() => {
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let tx = 50;
  let ty = 26;
  let x = tx;
  let y = ty;
  let raf = 0;

  const write = () => {
    root.style.setProperty("--mx", x.toFixed(2) + "%");
    root.style.setProperty("--my", y.toFixed(2) + "%");
  };

  const tick = () => {
    x += (tx - x) * 0.06;
    y += (ty - y) * 0.06;
    write();
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.05 ? requestAnimationFrame(tick) : 0;
  };

  addEventListener(
    "pointermove",
    (e) => {
      tx = (e.clientX / innerWidth) * 100;
      ty = (e.clientY / innerHeight) * 100;
      if (reduce) return write();
      if (!raf) raf = requestAnimationFrame(tick);
    },
    { passive: true },
  );

  write();
})();
