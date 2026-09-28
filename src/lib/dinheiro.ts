const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 12345 -> "R$ 123,45" */
export function reais(centavos: number): string {
  return fmt.format(centavos / 100);
}

/** Valor sem sinal, para exibir junto de "Sobrou"/"Faltou". */
export function reaisAbs(centavos: number): string {
  return reais(Math.abs(centavos));
}
