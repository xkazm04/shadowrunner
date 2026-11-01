import "@sr/theme/halloween.css";
import "@sr/theme/baseline.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./Shell";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
