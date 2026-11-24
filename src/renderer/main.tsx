import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/lexend/wght.css";
import "@fontsource-variable/fredoka/wght.css";
import "./styles.css";
import "./theme-nova.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
