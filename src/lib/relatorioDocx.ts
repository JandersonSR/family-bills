// Gera o relatório em Word (.docx). Carregado só quando necessário (import dinâmico).
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import { dataBR, diaMes, mesAtual, nomeMes } from "./datas";
import { reais, reaisAbs } from "./dinheiro";
import {
  autorDe, legendaComprovante, situacaoTexto, soma, tamanhoNaPagina,
  type Comprovante, type DadosRelatorio,
} from "./relatorio";
import type { Lancamento } from "./tipos";

const VERDE = "1F7A4D";
const VERMELHO = "B3261E";
const CINZA = "5F5E58";
const FUNDO_CAB = "ECEAE3";

type Cel = string | { t: string; cor?: string; negrito?: boolean; direita?: boolean };

function par(texto: string, o: { negrito?: boolean; cor?: string; tam?: number; centro?: boolean; depois?: number } = {}) {
  return new Paragraph({
    alignment: o.centro ? AlignmentType.CENTER : undefined,
    spacing: { after: o.depois ?? 120 },
    children: [new TextRun({ text: texto, bold: o.negrito, color: o.cor, size: o.tam ?? 22 })],
  });
}

function titulo(texto: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 120 },
    children: [new TextRun({ text: texto, bold: true, size: 28, color: "1D1D1B" })],
  });
}

const borda = { style: BorderStyle.SINGLE, size: 4, color: "DEDCD3" };

function tabela(cabecalho: string[] | null, linhas: Cel[][], larguras: number[]) {
  const celula = (c: Cel, i: number, cab = false) => {
    const o = typeof c === "string" ? { t: c } : c;
    const direita = o.direita ?? (i > 0 && /R\$/.test(o.t));
    return new TableCell({
      width: { size: larguras[i], type: WidthType.PERCENTAGE },
      shading: cab ? { type: ShadingType.CLEAR, color: "auto", fill: FUNDO_CAB } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [
        new Paragraph({
          alignment: direita ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text: o.t, bold: cab || o.negrito, color: o.cor, size: 21 })],
        }),
      ],
    });
  };
  const rows: TableRow[] = [];
  if (cabecalho) rows.push(new TableRow({ tableHeader: true, children: cabecalho.map((c, i) => celula(c, i, true)) }));
  for (const l of linhas) rows.push(new TableRow({ cantSplit: true, children: l.map((c, i) => celula(c, i)) }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: borda, bottom: borda, left: borda, right: borda, insideHorizontal: borda, insideVertical: borda },
    rows,
  });
}

const cor = (v: number) => (v >= 0 ? VERDE : VERMELHO);
const sobraFalta = (v: number, s = "Sobrando", f = "Faltando") => `${v >= 0 ? s : f} ${reaisAbs(v)}`;

function tabelaLancamentos(ls: Lancamento[], rotulo: string) {
  return tabela(
    ["Data", rotulo, "Valor", "Registrado por"],
    [
      ...ls.map((l) => [dataBR(l.data), l.descricao, reais(l.valor_centavos), autorDe(l)] as Cel[]),
      [{ t: "Total", negrito: true }, "", { t: reais(soma(ls)), negrito: true }, ""],
    ],
    [17, 43, 20, 20],
  );
}

export async function gerarDocx(d: DadosRelatorio, comprovantes: Comprovante[]): Promise<Blob> {
  const c = d.calc;
  const ehAtual = d.mes === mesAtual();
  const s = d.seis;
  const corpo: (Paragraph | Table)[] = [];

  // Cabeçalho
  corpo.push(par("RELATÓRIO MENSAL", { negrito: true, tam: 20, cor: CINZA, centro: true, depois: 40 }));
  corpo.push(par(d.grupo, { negrito: true, tam: 36, centro: true, depois: 40 }));
  corpo.push(par(`Mês de referência: ${nomeMes(d.mes)}`, { negrito: true, tam: 28, centro: true, depois: 40 }));
  corpo.push(par(`Gerado em ${d.geradoEm} por ${d.geradoPor}`, { tam: 20, cor: CINZA, centro: true, depois: 240 }));

  // 1. Resumo
  corpo.push(titulo("1. Resumo do mês"));
  const resumo: Cel[][] = [
    ["Dinheiro enviado", { t: reais(c.entradas), cor: VERDE }],
    ["Contas pagas (no orçamento)", { t: `− ${reais(c.saidas)}` , direita: true }],
    [{ t: c.saldoMes >= 0 ? "Sobrou neste mês" : "Faltou neste mês", negrito: true }, { t: reaisAbs(c.saldoMes), cor: cor(c.saldoMes), negrito: true }],
    ["Saldo que veio dos meses anteriores", { t: sobraFalta(c.anterior), cor: cor(c.anterior) }],
    [{ t: ehAtual ? "Saldo total até hoje" : `Saldo total no fim de ${nomeMes(d.mes, false).toLowerCase()}`, negrito: true }, { t: sobraFalta(c.acumulado), cor: cor(c.acumulado), negrito: true }],
  ];
  if (d.aPagarMes.total > 0 || d.aPagarMes.semValor > 0) {
    const depois = c.acumulado - d.aPagarMes.total;
    resumo.push(["Contas ainda a pagar neste mês", reais(d.aPagarMes.total) + (d.aPagarMes.semValor ? ` + ${d.aPagarMes.semValor} a confirmar` : "")]);
    resumo.push(["Saldo depois de pagar", { t: sobraFalta(depois), cor: cor(depois) }]);
  }
  if (d.fora.length) resumo.push([{ t: "Contas fora do orçamento (não entram no saldo)", cor: CINZA }, { t: reais(soma(d.fora)), cor: CINZA }]);
  corpo.push(tabela(null, resumo, [62, 38]));

  // 2. Contas do mês
  if (d.contasDoMes.length) {
    corpo.push(titulo("2. Contas do mês"));
    corpo.push(
      tabela(
        ["Conta", "Vencimento", "Valor", "Situação"],
        d.contasDoMes.map((i) => [
          i.descricao + (i.noOrcamento ? "" : " (fora do orçamento)"),
          diaMes(i.vencimento),
          i.valor_centavos != null ? reais(i.valor_centavos) : "a confirmar",
          { t: situacaoTexto(i), cor: i.situacao === "paga" ? VERDE : i.situacao === "atrasada" ? VERMELHO : undefined, negrito: i.situacao === "atrasada" },
        ]),
        [38, 17, 20, 25],
      ),
    );
  }

  // 3. Dinheiro enviado
  corpo.push(titulo("3. Dinheiro enviado"));
  corpo.push(d.enviados.length ? tabelaLancamentos(d.enviados, "Como foi enviado") : par("Nenhum depósito registrado neste mês.", { cor: CINZA }));

  // 4. Contas pagas
  corpo.push(titulo("4. Contas pagas"));
  corpo.push(d.pagos.length ? tabelaLancamentos(d.pagos, "Conta") : par("Nenhuma conta paga registrada neste mês.", { cor: CINZA }));

  if (d.fora.length) {
    corpo.push(titulo("4.1 Contas pagas fora do orçamento"));
    corpo.push(par("Estas contas foram registradas, mas pagas com outro dinheiro: NÃO entram no saldo.", { cor: CINZA, tam: 20 }));
    corpo.push(tabelaLancamentos(d.fora, "Conta"));
  }

  // 5. Últimos 6 meses
  corpo.push(titulo("5. Situação dos últimos 6 meses (até hoje)"));
  corpo.push(
    tabela(
      ["Mês", "Enviado", "Pago", "Saldo do mês"],
      [
        ...s.linhas.map((l) => [
          nomeMes(l.mes),
          reais(l.entradas),
          reais(l.saidas),
          { t: `${l.saldo < 0 ? "−" : "+"} ${reaisAbs(l.saldo)}`, cor: l.saldo === 0 ? undefined : cor(l.saldo), direita: true },
        ] as Cel[]),
        [
          { t: "Total dos 6 meses", negrito: true },
          { t: reais(s.entradas), negrito: true },
          { t: reais(s.saidas), negrito: true },
          { t: `${s.somaSaldos < 0 ? "−" : "+"} ${reaisAbs(s.somaSaldos)}`, negrito: true, cor: cor(s.somaSaldos), direita: true },
        ],
      ],
      [34, 22, 22, 22],
    ),
  );
  corpo.push(par("", { depois: 80 }));
  const fechamento: Cel[][] = [
    ["Meses que terminaram no positivo / no negativo", `${s.positivos} / ${s.negativos}`],
  ];
  if (s.antes !== 0) fechamento.push(["Saldo de antes desses 6 meses", { t: sobraFalta(s.antes), cor: cor(s.antes) }]);
  fechamento.push([{ t: "SALDO TOTAL HOJE", negrito: true }, { t: sobraFalta(s.saldoHoje), negrito: true, cor: cor(s.saldoHoje) }]);
  fechamento.push(["Total de contas em aberto (a pagar)", reais(s.totalEmAberto) + (s.emAbertoSemValor ? ` + ${s.emAbertoSemValor} a confirmar` : "")]);
  fechamento.push([
    { t: "VALOR TOTAL FALTANTE PARA DEPÓSITO", negrito: true },
    { t: s.faltaDepositar > 0 ? reais(s.faltaDepositar) : "Nada (não está faltando)", negrito: true, cor: s.faltaDepositar > 0 ? VERMELHO : VERDE, direita: true },
  ]);
  fechamento.push([
    { t: "Para zerar e pagar também as contas em aberto, depositar", negrito: true },
    { t: s.faltaComContas > 0 ? reais(s.faltaComContas) : "Nada", negrito: true, cor: s.faltaComContas > 0 ? VERMELHO : VERDE, direita: true },
  ]);
  corpo.push(tabela(null, fechamento, [62, 38]));

  if (s.emAberto.length) {
    corpo.push(par("Contas em aberto:", { negrito: true, depois: 60 }));
    corpo.push(
      tabela(
        ["Conta", "Vencimento", "Valor"],
        s.emAberto.map((a) => [a.descricao, dataBR(a.vencimento), a.valor_centavos != null ? reais(a.valor_centavos) : "a confirmar"]),
        [50, 25, 25],
      ),
    );
  }

  // 6. Comprovantes
  if (d.opcoes.incluirFotos && comprovantes.length) {
    corpo.push(new Paragraph({ children: [new PageBreak()] }));
    corpo.push(titulo("6. Comprovantes"));
    for (const cp of comprovantes) {
      corpo.push(par(legendaComprovante(cp.lancamento), { negrito: true, depois: 60 }));
      if (cp.tipo === "imagem" && cp.dados) {
        corpo.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 280 },
            keepLines: true,
            children: [new ImageRun({ type: "jpg", data: cp.dados, transformation: tamanhoNaPagina(cp) })],
          }),
        );
      } else {
        corpo.push(
          par(cp.tipo === "pdf" ? "(Comprovante em PDF — abra pelo aplicativo para ver.)" : "(Não foi possível carregar a imagem.)", {
            cor: CINZA,
            tam: 20,
            depois: 240,
          }),
        );
      }
    }
  }

  const doc = new Document({
    creator: d.geradoPor,
    title: `Relatório ${nomeMes(d.mes)} — ${d.grupo}`,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        children: corpo,
      },
    ],
  });
  return Packer.toBlob(doc);
}
