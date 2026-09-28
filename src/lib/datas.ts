// Datas tratadas como texto (YYYY-MM-DD) para não sofrer com fuso horário.

export const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Data de hoje no fuso do aparelho, ex.: 2026-09-24 */
export function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Primeiro dia do mês de uma data, ex.: 2026-09-01 */
export function mesDe(data: string): string {
  return `${data.slice(0, 7)}-01`;
}

export function mesAtual(): string {
  return mesDe(hoje());
}

export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
}

export function ultimoDia(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const dias = new Date(a, m, 0).getDate();
  return `${a}-${pad(m)}-${pad(dias)}`;
}

export function nomeMes(mes: string, comAno = true): string {
  const [a, m] = mes.split("-").map(Number);
  const nome = MESES[m - 1];
  const cap = nome[0].toUpperCase() + nome.slice(1);
  return comAno ? `${cap} de ${a}` : cap;
}

/** 24/09 */
export function diaMes(data: string): string {
  const [, m, d] = data.split("-");
  return `${d}/${m}`;
}

/** 24/09/2026 */
export function dataBR(data: string): string {
  const [a, m, d] = data.split("-");
  return `${d}/${m}/${a}`;
}

/** Aceita "2026-09" ou "2026-09-01" vindo da URL. */
export function normalizarMes(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}(-\d{2})?$/.test(v)) return null;
  const m = Number(v.slice(5, 7));
  if (m < 1 || m > 12) return null;
  return `${v.slice(0, 7)}-01`;
}

/** Meses guardados com detalhes (tem que bater com MESES_RETENCAO da limpeza). */
export const MESES_RETENCAO = 6;

export function primeiroMesComDetalhes(): string {
  return somarMeses(mesAtual(), -(MESES_RETENCAO - 1));
}
