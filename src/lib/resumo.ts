import type { ResumoMensal } from "./tipos";

export interface Calculo {
  /** saldo que veio de todos os meses anteriores */
  anterior: number;
  entradas: number;
  saidas: number;
  /** entradas - saídas do mês */
  saldoMes: number;
  /** anterior + saldoMes: quanto sobra (ou falta) no total até este mês */
  acumulado: number;
  ano: { entradas: number; saidas: number; saldo: number };
}

/**
 * Calcula a situação de um mês a partir dos resumos mensais.
 * Os resumos existem mesmo para meses cujos detalhes já foram apagados,
 * então o saldo acumulado continua correto depois da limpeza.
 */
export function calcular(resumos: ResumoMensal[], mes: string): Calculo {
  const ano = mes.slice(0, 4);
  let anterior = 0;
  let entradas = 0;
  let saidas = 0;
  let anoE = 0;
  let anoS = 0;
  for (const r of resumos) {
    const e = Number(r.entradas_centavos);
    const s = Number(r.saidas_centavos);
    if (r.mes < mes) anterior += e - s;
    if (r.mes === mes) {
      entradas = e;
      saidas = s;
    }
    if (r.mes.startsWith(ano) && r.mes <= mes) {
      anoE += e;
      anoS += s;
    }
  }
  const saldoMes = entradas - saidas;
  return {
    anterior,
    entradas,
    saidas,
    saldoMes,
    acumulado: anterior + saldoMes,
    ano: { entradas: anoE, saidas: anoS, saldo: anoE - anoS },
  };
}
