import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { installCompositionGuard } from "./hooks/useComposition";
import { LocaleProvider } from "./i18n/LocaleProvider";
/* ORTHO design system — sole chrome source of truth */
import "./styles/index.css";
/* Panel/compat bridge: remaining unmigrated panel rules (not chrome). */
import "./styles.css";
/* Engine banner only */
import "./product-shell.css";

installCompositionGuard();

const root = document.getElementById("root");
if (!root) throw new Error("Renderer root is missing.");

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
