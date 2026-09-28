import { supabase, BUCKET } from "./supabase";
import { calcular, type Calculo } from "./resumo";
import { aPagarNoOrcamento, somarAPagar, type Painel } from "./dados";
import { dataBR, diaMes, hoje, mesAtual, nomeMes, primeiroMesComDetalhes, somarMeses } from "./datas";
import { reais, reaisAbs } from "./dinheiro";
import type { ContaAPagar, ItemContaMes, Lancamento } from "./tipos";

export interface OpcoesRelatorio {
  /** incluir as contas pagas fora do orçamento (padrão: não) */
  incluirFora: boolean;
  /** incluir as fotos dos comprovantes (padrão: sim) */
  incluirFotos: boolean;
}

export interface LinhaMes {
  mes: string;
  entradas: number;
  saidas: number;
  saldo: number;
}

export interface DadosRelatorio {
  grupo: string;
  mes: string;
  geradoEm: string;
  geradoPor: string;
  calc: Calculo;
  enviados: Lancamento[];
  pagos: Lancamento[];
  fora: Lancamento[];
  contasDoMes: ItemContaMes[];
  aPagarMes: { total: number; semValor: number };
  seis: {
    linhas: LinhaMes[];
    /** saldo acumulado antes do primeiro dos 6 meses */
    antes: number;
    entradas: number;
    saidas: number;
    somaSaldos: number;
    saldoHoje: number;
    positivos: number;
    negativos: number;
    emAberto: ContaAPagar[];
    totalEmAberto: number;
    emAbertoSemValor: number;
    /** quanto falta depositar para zerar o saldo negativo */
    faltaDepositar: number;
    /** quanto depositar para zerar o saldo e ainda pagar as contas em aberto */
    faltaComContas: number;
  };
  opcoes: OpcoesRelatorio;
}

export function montarRelatorio(p: Painel, grupo: string, geradoPor: string, opcoes: OpcoesRelatorio): DadosRelatorio {
  const pagamentosPagos = p.itens.filter((i) => i.tipo === "pagamento" && i.status === "pago");
  const inicio = primeiroMesComDetalhes();
  const atual = mesAtual();

  const linhas: LinhaMes[] = [];
  for (let m = inicio; m <= atual; m = somarMeses(m, 1)) {
    const r = p.resumos.find((x) => x.mes === m);
    const e = Number(r?.entradas_centavos ?? 0);
    const s = Number(r?.saidas_centavos ?? 0);
    linhas.push({ mes: m, entradas: e, saidas: s, saldo: e - s });
  }
  const antes = calcular(p.resumos, inicio).anterior;
  const entradas = linhas.reduce((a, l) => a + l.entradas, 0);
  const saidas = linhas.reduce((a, l) => a + l.saidas, 0);
  const somaSaldos = entradas - saidas;
  const saldoHoje = antes + somaSaldos;
  const emAberto = p.emAberto.filter(aPagarNoOrcamento);
  const aberto = somarAPagar(emAberto);

  return {
    grupo,
    mes: p.mes,
    geradoEm: dataBR(hoje()),
    geradoPor,
    calc: p.calc,
    enviados: p.itens.filter((i) => i.tipo === "deposito").sort(porData),
    pagos: pagamentosPagos.filter((i) => i.no_orcamento).sort(porData),
    fora: opcoes.incluirFora ? pagamentosPagos.filter((i) => !i.no_orcamento).sort(porData) : [],
    contasDoMes: p.contasDoMes.filter((c) => opcoes.incluirFora || c.noOrcamento),
    aPagarMes: somarAPagar(p.contasDoMes.filter((c) => c.situacao !== "paga")),
    seis: {
      linhas,
      antes,
      entradas,
      saidas,
      somaSaldos,
      saldoHoje,
      positivos: linhas.filter((l) => l.saldo > 0).length,
      negativos: linhas.filter((l) => l.saldo < 0).length,
      emAberto,
      totalEmAberto: aberto.total,
      emAbertoSemValor: aberto.semValor,
      faltaDepositar: Math.max(0, -saldoHoje),
      faltaComContas: Math.max(0, aberto.total - saldoHoje),
    },
    opcoes,
  };
}

const porData = (a: Lancamento, b: Lancamento) => a.data.localeCompare(b.data) || a.created_at.localeCompare(b.created_at);

export const situacaoTexto = (c: ItemContaMes) =>
  c.situacao === "paga"
    ? `Paga em ${diaMes(c.pagamento!.data)}`
    : c.situacao === "atrasada"
      ? "ATRASADA"
      : c.situacao === "vence_hoje"
        ? "Vence hoje"
        : "A pagar";

export const nomeArquivo = (d: DadosRelatorio) => `Relatorio-Contas-${d.mes.slice(0, 7)}.docx`;
export const autorDe = (l: Lancamento) => l.autor?.nome || l.autor?.email || "—";
const sinal = (v: number) => (v < 0 ? "−" : "+");

// ---------------------------------------------------------------------
// Texto para WhatsApp (sem imagens)
// ---------------------------------------------------------------------
export function textoWhatsApp(d: DadosRelatorio): string {
  const c = d.calc;
  const L: string[] = [];
  L.push(`*${d.grupo} — ${nomeMes(d.mes)}*`);
  L.push("");
  L.push(`Dinheiro enviado: ${reais(c.entradas)}`);
  L.push(`Contas pagas: ${reais(c.saidas)}`);
  L.push(`*${c.saldoMes >= 0 ? "Sobrou" : "Faltou"} no mês: ${reaisAbs(c.saldoMes)}*`);
  if (d.fora.length) L.push(`(Fora do orçamento: ${reais(soma(d.fora))} — não entra no saldo)`);
  L.push("");
  if (d.contasDoMes.length) {
    L.push("*Contas do mês*");
    for (const i of d.contasDoMes) {
      const marca = i.situacao === "paga" ? "✅" : i.situacao === "atrasada" ? "⚠️" : "⏳";
      const valor = i.valor_centavos != null ? reais(i.valor_centavos) : "valor a confirmar";
      const quando = i.situacao === "paga" ? `paga em ${diaMes(i.pagamento!.data)}` : `vence ${diaMes(i.vencimento)}`;
      L.push(`${marca} ${i.descricao} — ${valor} — ${quando}`);
    }
    if (d.aPagarMes.total > 0) L.push(`Falta pagar no mês: ${reais(d.aPagarMes.total)}`);
    L.push("");
  }
  const s = d.seis;
  L.push("*Últimos 6 meses*");
  for (const l of s.linhas) {
    L.push(`${nomeMes(l.mes, false).slice(0, 3)}/${l.mes.slice(2, 4)}: ${sinal(l.saldo)}${reaisAbs(l.saldo)}`);
  }
  if (s.antes !== 0) L.push(`Antes disso: ${sinal(s.antes)}${reaisAbs(s.antes)}`);
  L.push(`Total enviado: ${reais(s.entradas)}`);
  L.push(`Total pago: ${reais(s.saidas)}`);
  L.push("");
  L.push(`*Saldo total hoje: ${s.saldoHoje >= 0 ? "sobrando" : "faltando"} ${reaisAbs(s.saldoHoje)}*`);
  if (s.totalEmAberto > 0) L.push(`Contas em aberto: ${reais(s.totalEmAberto)}`);
  if (s.faltaDepositar > 0) L.push(`*Falta depositar: ${reais(s.faltaDepositar)}*`);
  if (s.faltaComContas > s.faltaDepositar) L.push(`*Para pagar também as contas em aberto: depositar ${reais(s.faltaComContas)}*`);
  if (s.faltaComContas === 0) L.push("Não falta depósito. ✅");
  L.push("");
  L.push(`_Gerado em ${d.geradoEm} por ${d.geradoPor}_`);
  return L.join("\n");
}

export const soma = (ls: Lancamento[]) => ls.reduce((a, l) => a + l.valor_centavos, 0);

// ---------------------------------------------------------------------
// Comprovantes (imagens)
// ---------------------------------------------------------------------
export interface Comprovante {
  lancamento: Lancamento;
  tipo: "imagem" | "pdf" | "erro";
  dados?: ArrayBuffer; // JPEG
  url?: string; // para a prévia/impressão
  largura?: number;
  altura?: number;
}

const cache = new Map<string, Promise<Comprovante>>();

export function carregarComprovantes(lista: Lancamento[]): Promise<Comprovante[]> {
  return Promise.all(
    lista
      .filter((l) => l.comprovante_path)
      .map((l) => {
        const chave = l.comprovante_path!;
        if (!cache.has(chave)) cache.set(chave, baixarComprovante(l));
        return cache.get(chave)!.then((c) => ({ ...c, lancamento: l }));
      }),
  );
}

async function baixarComprovante(l: Lancamento): Promise<Comprovante> {
  const path = l.comprovante_path!;
  if (path.toLowerCase().endsWith(".pdf")) return { lancamento: l, tipo: "pdf" };
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) throw error;
    if (data.type === "application/pdf") return { lancamento: l, tipo: "pdf" };
    const bmp = await createImageBitmap(data);
    const MAX = 1400;
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k);
    const h = Math.round(bmp.height * k);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const jpg = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    if (!jpg) throw new Error("falha ao converter");
    return { lancamento: l, tipo: "imagem", dados: await jpg.arrayBuffer(), url: URL.createObjectURL(jpg), largura: w, altura: h };
  } catch {
    return { lancamento: l, tipo: "erro" };
  }
}

export function legendaComprovante(l: Lancamento): string {
  const tipo = l.tipo === "deposito" ? "Dinheiro enviado" : "Conta paga";
  return `${tipo} · ${l.descricao} · ${dataBR(l.data)} · ${reais(l.valor_centavos)}`;
}

/** Tamanho da imagem no documento (em pixels), cabendo na página. */
export function tamanhoNaPagina(c: Comprovante, maxL = 430, maxA = 560) {
  const k = Math.min(maxL / (c.largura || 1), maxA / (c.altura || 1), 1);
  return { width: Math.round((c.largura || 1) * k), height: Math.round((c.altura || 1) * k) };
}
