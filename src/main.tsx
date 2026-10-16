import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { applyTheme, loadTheme } from "./ui/theme";
import { browserLocalStorage } from "./ui/browserStorage";
import "./styles.css";

applyTheme(loadTheme(browserLocalStorage()));

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
