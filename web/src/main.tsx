import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { initTheme } from "./chrome.ts";
import "./styles.css";
import "./v2.css";
import "./shift.css";

initTheme();
const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
