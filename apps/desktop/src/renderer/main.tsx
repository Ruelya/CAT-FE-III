import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@translunar/ui/fonts.css";
import "@translunar/ui/tokens.css";
import "@translunar/ui/components.css";
import "./app.css";
/* After app.css: a theme's material layer overrides the base surface rules,
   and equal-specificity ties have to fall the theme's way. */
import "@translunar/ui/themes.css";
import "@translunar/ui/theme-surfaces.css";
import "@translunar/ui/fx.css";

import { App } from "./App.js";
import { FxLayers } from "./lib/theme.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("renderer root element is missing");
}
createRoot(container).render(
  <StrictMode>
    <App />
    <FxLayers />
  </StrictMode>,
);
