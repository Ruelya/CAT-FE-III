import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@translunar/ui/tokens.css";
import "@translunar/ui/components.css";
import "./app.css";

import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("renderer root element is missing");
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
