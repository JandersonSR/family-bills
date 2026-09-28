/** Preferências deste aparelho (não vão para o servidor). */
export type TamanhoLetra = "normal" | "grande" | "muito-grande";
const CHAVE = "contas.letra";

export function lerTamanhoLetra(): TamanhoLetra {
  try {
    const v = localStorage.getItem(CHAVE);
    if (v === "grande" || v === "muito-grande") return v;
  } catch {
    /* sem armazenamento */
  }
  return "normal";
}

export function aplicarTamanhoLetra(t: TamanhoLetra) {
  document.documentElement.dataset.letra = t;
  try {
    localStorage.setItem(CHAVE, t);
  } catch {
    /* sem armazenamento */
  }
}
