import { useSyncExternalStore } from "react";

/**
 * Roteador mínimo por hash (#/caminho?param=1).
 * Com hash, o app funciona em qualquer hospedagem estática (Vercel,
 * Netlify, HostGator…) sem configurar redirecionamentos no servidor.
 */
export interface Rota {
  caminho: string;
  partes: string[];
  params: URLSearchParams;
}

function ler(): Rota {
  let h = window.location.hash.replace(/^#/, "") || "/";
  // retorno dos links de e-mail do Supabase (#access_token=...&type=...)
  if (!h.startsWith("/")) h = "/";
  const [caminho, qs = ""] = h.split("?");
  return {
    caminho,
    partes: caminho.split("/").filter(Boolean),
    params: new URLSearchParams(qs),
  };
}

let atual = ler();
const ouvintes = new Set<() => void>();

window.addEventListener("hashchange", () => {
  atual = ler();
  ouvintes.forEach((f) => f());
  window.scrollTo(0, 0);
});

export function useRota(): Rota {
  return useSyncExternalStore(
    (cb) => {
      ouvintes.add(cb);
      return () => ouvintes.delete(cb);
    },
    () => atual,
  );
}

export function navegar(para: string, substituir = false) {
  const alvo = "#" + para;
  if (substituir) {
    history.replaceState(null, "", alvo);
    atual = ler();
    ouvintes.forEach((f) => f());
  } else {
    window.location.hash = para;
  }
}

export function voltar(padrao = "/") {
  if (history.length > 1) history.back();
  else navegar(padrao, true);
}
