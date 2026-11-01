// Self-hosted OFL fonts behind --sr-font-display / -body / -type (landing 1.2), weights the landing uses.
import "@fontsource/barlow-semi-condensed/400.css";
import "@fontsource/barlow-semi-condensed/700.css";
import "@fontsource/barlow-semi-condensed/800.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/400-italic.css";
import "@fontsource/courier-prime/700.css";
// costume 1.1: the prototypes' faces behind --sr-font-condensed / -hand / -old, at their weights.
import "@fontsource/barlow-condensed/300.css";
import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/700.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
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
