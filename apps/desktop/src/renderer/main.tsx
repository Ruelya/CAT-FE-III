import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { LocaleProvider } from "./i18n/LocaleProvider";
import "./styles.css";
import "./product-shell.css";

const root = document.getElementById("root");
if (!root) throw new Error("Renderer root is missing.");

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
