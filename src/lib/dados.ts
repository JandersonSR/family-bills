import { supabase } from "./supabase";
import { calcular, type Calculo } from "./resumo";
import { hoje, mesAtual, primeiroMesComDetalhes, somarMeses, ultimoDia, MESES_RETENCAO } from "./datas";
import type { ContaAPagar, ContaFixa, ItemContaMes, Lancamento, ResumoMensal } from "./tipos";

export const CAMPOS_LANCAMENTO =
  "id, grupo_id, tipo, descricao, valor_centavos, data, status, comprovante_path, criado_por, created_at, no_orcamento, conta_fixa_id, mes_referencia, autor:perfis(nome, email)";

/** Tudo o que a tela do mês e o relatório precisam. */
export interface Painel {
  mes: string;
  resumos: ResumoMensal[];
  calc: Calculo;
  /** registros com data dentro do mês */
  itens: Lancamento[];
  fixas: ContaFixa[];
  /** baixas de contas fixas dentro do período guardado (qualquer data de pagamento) */
  baixas: Lancamento[];
  /** contas avulsas "Ainda vou pagar" até o fim do mês atual */
  pendentesAvulsas: Lancamento[];
  /** lista "Contas do mês" (fixas + avulsas do mês) */
  contasDoMes: ItemContaMes[];
  /** contas ainda não pagas de meses anteriores ao mês atual */
  atrasadas: ContaAPagar[];
  /** tudo o que está em aberto até hoje (atrasadas + mês atual) */
  emAberto: ContaAPagar[];
}

export async function carregarPainel(grupoId: string, mes: string): Promise<Painel> {
  const inicioJanela = primeiroMesComDetalhes();
  const [r, l, f, b, p] = await Promise.all([
    supabase.from("resumos_mensais").select("mes, entradas_centavos, saidas_centavos").eq("grupo_id", grupoId).order("mes"),
    supabase
      .from("lancamentos")
      .select(CAMPOS_LANCAMENTO)
      .eq("grupo_id", grupoId)
      .gte("data", mes)
      .lte("data", ultimoDia(mes))
      .order("data", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("contas_fixas").select("*").eq("grupo_id", grupoId).order("dia_vencimento").order("descricao"),
    supabase
      .from("lancamentos")
      .select(CAMPOS_LANCAMENTO)
      .eq("grupo_id", grupoId)
      .not("conta_fixa_id", "is", null)
      .gte("mes_referencia", inicioJanela < mes ? inicioJanela : mes),
    supabase
      .from("lancamentos")
      .select(CAMPOS_LANCAMENTO)
      .eq("grupo_id", grupoId)
      .eq("status", "pendente")
      .lte("data", ultimoDia(mes > mesAtual() ? mes : mesAtual()))
      .order("data"),
  ]);
  const erro = r.error || l.error || f.error || b.error || p.error;
  if (erro) throw erro;

  const resumos = (r.data ?? []) as ResumoMensal[];
  const itens = (l.data ?? []) as unknown as Lancamento[];
  const fixas = (f.data ?? []) as ContaFixa[];
  const baixas = (b.data ?? []) as unknown as Lancamento[];
  const pendentesAvulsas = (p.data ?? []) as unknown as Lancamento[];

  const contasDoMes = montarContasDoMes(mes, fixas, baixas, pendentesAvulsas);
  const emAberto = contasEmAberto(fixas, baixas, pendentesAvulsas, mesAtual());
  const atrasadas = emAberto.filter((c) => c.mes_referencia < mesAtual());

  return { mes, resumos, calc: calcular(resumos, mes), itens, fixas, baixas, pendentesAvulsas, contasDoMes, atrasadas, emAberto };
}

/** A conta fixa vale para este mês? */
export function fixaAtivaNoMes(f: ContaFixa, mes: string): boolean {
  return f.desde_mes <= mes && (!f.ate_mes || f.ate_mes >= mes);
}

/** Data de vencimento da conta fixa no mês (dia 31 vira o último dia do mês). */
export function vencimentoNoMes(f: ContaFixa, mes: string): string {
  const ultimo = ultimoDia(mes);
  const dia = Math.min(f.dia_vencimento, Number(ultimo.slice(8)));
  return `${mes.slice(0, 8)}${String(dia).padStart(2, "0")}`;
}

function situacao(vencimento: string): ItemContaMes["situacao"] {
  const h = hoje();
  return vencimento < h ? "atrasada" : vencimento === h ? "vence_hoje" : "a_vencer";
}

export function montarContasDoMes(
  mes: string,
  fixas: ContaFixa[],
  baixas: Lancamento[],
  pendentesAvulsas: Lancamento[],
): ItemContaMes[] {
  const lista: ItemContaMes[] = [];
  for (const f of fixas) {
    if (!fixaAtivaNoMes(f, mes)) continue;
    const venc = vencimentoNoMes(f, mes);
    const pg = baixas.find((b) => b.conta_fixa_id === f.id && b.mes_referencia === mes) ?? null;
    lista.push({
      chave: `fixa-${f.id}`,
      descricao: f.descricao,
      vencimento: venc,
      valor_centavos: pg ? pg.valor_centavos : f.valor_centavos,
      situacao: pg ? "paga" : situacao(venc),
      pagamento: pg,
      aPagar: pg ? null : { chave: `fixa-${f.id}-${mes}`, descricao: f.descricao, vencimento: venc, valor_centavos: f.valor_centavos, mes_referencia: mes, fixa: f, avulsa: null },
      noOrcamento: pg ? pg.no_orcamento : f.no_orcamento,
    });
  }
  const fim = ultimoDia(mes);
  for (const a of pendentesAvulsas) {
    if (a.data < mes || a.data > fim) continue;
    lista.push({
      chave: `avulsa-${a.id}`,
      descricao: a.descricao,
      vencimento: a.data,
      valor_centavos: a.valor_centavos,
      situacao: situacao(a.data),
      pagamento: null,
      aPagar: { chave: `avulsa-${a.id}`, descricao: a.descricao, vencimento: a.data, valor_centavos: a.valor_centavos, mes_referencia: `${a.data.slice(0, 7)}-01`, fixa: null, avulsa: a },
      noOrcamento: a.no_orcamento,
    });
  }
  // não pagas primeiro (por vencimento), pagas no fim
  return lista.sort((x, y) => {
    const px = x.situacao === "paga" ? 1 : 0;
    const py = y.situacao === "paga" ? 1 : 0;
    return px - py || x.vencimento.localeCompare(y.vencimento) || x.descricao.localeCompare(y.descricao);
  });
}

/**
 * Contas não pagas até o mês `ate` (inclusive): fixas sem baixa dentro do
 * período guardado + avulsas pendentes.
 */
export function contasEmAberto(
  fixas: ContaFixa[],
  baixas: Lancamento[],
  pendentesAvulsas: Lancamento[],
  ate: string,
): ContaAPagar[] {
  const out: ContaAPagar[] = [];
  const inicio = somarMeses(mesAtual(), -(MESES_RETENCAO - 1));
  for (let m = inicio; m <= ate; m = somarMeses(m, 1)) {
    for (const i of montarContasDoMes(m, fixas, baixas, [])) if (i.aPagar) out.push(i.aPagar);
  }
  const fim = ultimoDia(ate);
  for (const a of pendentesAvulsas) {
    if (a.data > fim) continue;
    out.push({ chave: `avulsa-${a.id}`, descricao: a.descricao, vencimento: a.data, valor_centavos: a.valor_centavos, mes_referencia: `${a.data.slice(0, 7)}-01`, fixa: null, avulsa: a });
  }
  return out.sort((x, y) => x.vencimento.localeCompare(y.vencimento));
}

/** Soma o que tem valor; conta quantas estão "a confirmar". */
export function somarAPagar(contas: { valor_centavos: number | null; noOrcamento?: boolean }[]) {
  let total = 0;
  let semValor = 0;
  for (const c of contas) {
    if (c.noOrcamento === false) continue;
    if (c.valor_centavos == null) semValor++;
    else total += c.valor_centavos;
  }
  return { total, semValor };
}

/** Só as que entram no orçamento. */
export function aPagarNoOrcamento(c: ContaAPagar): boolean {
  return c.fixa ? c.fixa.no_orcamento : c.avulsa ? c.avulsa.no_orcamento : true;
}
