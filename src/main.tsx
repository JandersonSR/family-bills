import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./estilo.css";
import { aplicarTamanhoLetra, lerTamanhoLetra } from "./lib/preferencias";

aplicarTamanhoLetra(lerTamanhoLetra());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
