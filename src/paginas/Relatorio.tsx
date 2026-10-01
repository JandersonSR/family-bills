import { useEffect, useMemo, useState, type ReactNode } from "react";
import { mensagemErro } from "../lib/supabase";
import { useGrupo } from "../contexto/Grupo";
import { useAuth } from "../contexto/Auth";
import { navegar, useRota } from "../lib/rotas";
import { carregarPainel, type Painel } from "../lib/dados";
import {
  montarRelatorio, textoWhatsApp, carregarComprovantes, nomeArquivo, situacaoTexto, soma, autorDe,
  legendaComprovante, tamanhoNaPagina, type Comprovante, type DadosRelatorio, type OpcoesRelatorio,
} from "../lib/relatorio";
import { dataBR, diaMes, mesAtual, nomeMes, normalizarMes, primeiroMesComDetalhes, somarMeses } from "../lib/datas";
import { reais, reaisAbs } from "../lib/dinheiro";
import type { Lancamento } from "../lib/tipos";
import { Carregando, Erro, Topo } from "../componentes/comuns";
import { Pergunta } from "./Registro";

/** número sem "R$" para a tabela caber em telas pequenas */
const num = (c: number) =>
  (Math.abs(c) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function Relatorio() {
  const { grupo } = useGrupo();
  const { sessao } = useAuth();
  const { params } = useRota();
  const mes = normalizarMes(params.get("mes")) ?? mesAtual();

  const [opcoes, setOpcoes] = useState<OpcoesRelatorio>({ incluirFora: false, incluirFotos: true });
  const [painel, setPainel] = useState<Painel | null>(null);
  const [comprovantes, setComprovantes] = useState<Comprovante[] | null>(null);
  const [arquivo, setArquivo] = useState<Blob | null>(null);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!grupo) return;
    setPainel(null);
    carregarPainel(grupo.id, mes).then(setPainel).catch((e) => setErro(mensagemErro(e)));
  }, [grupo, mes]);

  const autor = (sessao?.user.user_metadata as { nome?: string } | undefined)?.nome || sessao?.user.email || "";
  const dados = useMemo(
    () => (painel && grupo ? montarRelatorio(painel, grupo.nome, autor, opcoes) : null),
    [painel, grupo, autor, opcoes],
  );

  // baixa as imagens dos comprovantes
  useEffect(() => {
    if (!dados) return;
    setComprovantes(null);
    if (!opcoes.incluirFotos) return setComprovantes([]);
    carregarComprovantes([...dados.enviados, ...dados.pagos, ...dados.fora]).then(setComprovantes);
  }, [dados, opcoes.incluirFotos]);

  // prepara o arquivo Word antes do toque, para o "Enviar" funcionar na hora
  useEffect(() => {
    if (!dados || !comprovantes) return;
    setArquivo(null);
    let cancelado = false;
    import("../lib/relatorioDocx")
      .then((m) => m.gerarDocx(dados, comprovantes))
      .then((b) => !cancelado && setArquivo(b))
      .catch((e) => !cancelado && setErro("Não foi possível montar o arquivo Word: " + mensagemErro(e)));
    return () => {
      cancelado = true;
    };
  }, [dados, comprovantes]);

  function baixar(b: Blob, nome: string) {
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function enviarArquivo() {
    if (!arquivo || !dados) return;
    setMsg("");
    const file = new File([arquivo], nomeArquivo(dados), { type: DOCX });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Relatório ${nomeMes(dados.mes)}` });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // a pessoa desistiu
    }
    baixar(arquivo, nomeArquivo(dados));
    setMsg("O arquivo foi baixado. Abra o WhatsApp, toque no clipe 📎 → Documento e escolha o arquivo “" + nomeArquivo(dados) + "”.");
  }

  function enviarTexto() {
    if (!dados) return;
    window.open("https://wa.me/?text=" + encodeURIComponent(textoWhatsApp(dados)), "_blank", "noopener,noreferrer");
  }

  const irPara = (m: string) => navegar(`/relatorio?mes=${m.slice(0, 7)}`, true);
  const pronto = Boolean(arquivo);
  const mudar = (k: keyof OpcoesRelatorio) => (v: string) => setOpcoes((o) => ({ ...o, [k]: v === "sim" }));

  return (
    <main className="pagina">
      <div className="nao-imprimir">
        <Topo titulo="Relatório do mês" voltarPara="/" />
        <div className="seletor-mes">
          <button className="btn-icone" onClick={() => irPara(somarMeses(mes, -1))} aria-label="Mês anterior">‹</button>
          <strong>{nomeMes(mes)}</strong>
          <button className="btn-icone" onClick={() => irPara(somarMeses(mes, 1))} aria-label="Próximo mês">›</button>
        </div>
        {mes < primeiroMesComDetalhes() && (
          <div className="alerta aviso-limpeza">Os detalhes deste mês já foram apagados. O relatório terá só os totais.</div>
        )}

        <section className="cartao">
          <Pergunta
            texto="Incluir as fotos dos comprovantes?"
            opcoes={[["sim", "Sim"], ["nao", "Não"]]}
            valor={opcoes.incluirFotos ? "sim" : "nao"}
            mudar={mudar("incluirFotos")}
          />
          <Pergunta
            texto="Incluir contas pagas fora do orçamento?"
            opcoes={[["nao", "Não"], ["sim", "Sim"]]}
            valor={opcoes.incluirFora ? "sim" : "nao"}
            mudar={mudar("incluirFora")}
          />
        </section>

        <Erro>{erro}</Erro>
        {msg && <div className="alerta ok">{msg}</div>}

        <div className="coluna-botoes acoes-relatorio">
          <button className="btn grande whatsapp" disabled={!pronto} onClick={enviarArquivo}>
            {pronto ? "📲 Enviar pelo WhatsApp (com comprovantes)" : "Preparando o relatório…"}
          </button>
          <button className="btn grande" disabled={!dados} onClick={enviarTexto}>
            💬 Enviar só o resumo em texto
          </button>
          <button className="btn grande" disabled={!dados || !comprovantes} onClick={() => window.print()}>
            🖨️ Imprimir ou salvar em PDF
          </button>
          <button className="btn texto" disabled={!pronto} onClick={() => arquivo && dados && baixar(arquivo, nomeArquivo(dados))}>
            Baixar o arquivo Word
          </button>
        </div>
        <h2 className="titulo-lista">Como vai ficar:</h2>
      </div>

      {!dados ? <Carregando /> : <RelatorioVisual d={dados} comprovantes={comprovantes ?? []} carregandoFotos={!comprovantes} />}
    </main>
  );
}

/** Versão em tela do relatório — é também o que sai na impressão. */
function RelatorioVisual({ d, comprovantes, carregandoFotos }: { d: DadosRelatorio; comprovantes: Comprovante[]; carregandoFotos: boolean }) {
  const c = d.calc;
  const s = d.seis;
  const ehAtual = d.mes === mesAtual();
  const Cor = ({ v, children }: { v: number; children: ReactNode }) => <span className={v >= 0 ? "positivo" : "negativo"}>{children}</span>;
  const sf = (v: number) => `${v >= 0 ? "sobrando" : "faltando"} ${reaisAbs(v)}`;

  return (
    <article className="relatorio-visual">
      <header className="rel-cabecalho">
        <small>RELATÓRIO MENSAL</small>
        <h1>{d.grupo}</h1>
        <h2>Mês de referência: {nomeMes(d.mes)}</h2>
        <p className="suave">Gerado em {d.geradoEm} por {d.geradoPor}</p>
      </header>

      <h3>1. Resumo do mês</h3>
      <table className="rel-tabela duas">
        <tbody>
          <tr><td>Dinheiro enviado</td><td className="positivo">{reais(c.entradas)}</td></tr>
          <tr><td>Contas pagas (no orçamento)</td><td>− {reais(c.saidas)}</td></tr>
          <tr className="forte"><td>{c.saldoMes >= 0 ? "Sobrou neste mês" : "Faltou neste mês"}</td><td><Cor v={c.saldoMes}>{reaisAbs(c.saldoMes)}</Cor></td></tr>
          <tr><td>Saldo que veio dos meses anteriores</td><td><Cor v={c.anterior}>{sf(c.anterior)}</Cor></td></tr>
          <tr className="forte"><td>{ehAtual ? "Saldo total até hoje" : `Saldo total no fim de ${nomeMes(d.mes, false).toLowerCase()}`}</td><td><Cor v={c.acumulado}>{sf(c.acumulado)}</Cor></td></tr>
          {(d.aPagarMes.total > 0 || d.aPagarMes.semValor > 0) && (
            <>
              <tr><td>Contas ainda a pagar neste mês</td><td>{reais(d.aPagarMes.total)}{d.aPagarMes.semValor > 0 && ` + ${d.aPagarMes.semValor} a confirmar`}</td></tr>
              <tr><td>Saldo depois de pagar</td><td><Cor v={c.acumulado - d.aPagarMes.total}>{sf(c.acumulado - d.aPagarMes.total)}</Cor></td></tr>
            </>
          )}
          {d.fora.length > 0 && (
            <tr className="suave"><td>Contas fora do orçamento (não entram no saldo)</td><td>{reais(soma(d.fora))}</td></tr>
          )}
        </tbody>
      </table>

      {d.contasDoMes.length > 0 && (
        <>
          <h3>2. Contas do mês</h3>
          <table className="rel-tabela">
            <thead><tr><th>Conta</th><th>Vence</th><th>Valor</th><th>Situação</th></tr></thead>
            <tbody>
              {d.contasDoMes.map((i) => (
                <tr key={i.chave}>
                  <td>{i.descricao}{!i.noOrcamento && <small className="suave"> (fora do orçamento)</small>}</td>
                  <td>{diaMes(i.vencimento)}</td>
                  <td>{i.valor_centavos != null ? reais(i.valor_centavos) : "a confirmar"}</td>
                  <td className={i.situacao === "paga" ? "positivo" : i.situacao === "atrasada" ? "negativo forte" : ""}>{situacaoTexto(i)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>3. Dinheiro enviado</h3>
      <TabelaLancamentos ls={d.enviados} rotulo="Como foi enviado" vazio="Nenhum depósito registrado neste mês." />

      <h3>4. Contas pagas</h3>
      <TabelaLancamentos ls={d.pagos} rotulo="Conta" vazio="Nenhuma conta paga registrada neste mês." />

      {d.fora.length > 0 && (
        <>
          <h3>4.1 Contas pagas fora do orçamento</h3>
          <p className="suave">Registradas, mas pagas com outro dinheiro: não entram no saldo.</p>
          <TabelaLancamentos ls={d.fora} rotulo="Conta" vazio="" />
        </>
      )}

      <h3>5. Situação dos últimos 6 meses (até hoje)</h3>
      <table className="rel-tabela seis">
        <caption>Valores em R$</caption>
        <thead><tr><th>Mês</th><th>Enviado</th><th>Pago</th><th>Saldo</th></tr></thead>
        <tbody>
          {s.linhas.map((l) => (
            <tr key={l.mes}>
              <td>{nomeMes(l.mes, false).slice(0, 3)}/{l.mes.slice(2, 4)}</td>
              <td>{num(l.entradas)}</td>
              <td>{num(l.saidas)}</td>
              <td className={l.saldo > 0 ? "positivo" : l.saldo < 0 ? "negativo" : ""}>{l.saldo < 0 ? "−" : "+"}{num(l.saldo)}</td>
            </tr>
          ))}
          <tr className="forte total">
            <td>Total</td>
            <td>{num(s.entradas)}</td>
            <td>{num(s.saidas)}</td>
            <td className={s.somaSaldos >= 0 ? "positivo" : "negativo"}>{s.somaSaldos < 0 ? "−" : "+"}{num(s.somaSaldos)}</td>
          </tr>
        </tbody>
      </table>
      <table className="rel-tabela duas fechamento">
        <tbody>
          <tr><td>Meses no positivo / no negativo</td><td>{s.positivos} / {s.negativos}</td></tr>
          {s.antes !== 0 && <tr><td>Saldo de antes desses 6 meses</td><td><Cor v={s.antes}>{sf(s.antes)}</Cor></td></tr>}
          <tr className="forte"><td>SALDO TOTAL HOJE</td><td><Cor v={s.saldoHoje}>{sf(s.saldoHoje)}</Cor></td></tr>
          <tr><td>Total de contas em aberto (a pagar)</td><td>{reais(s.totalEmAberto)}{s.emAbertoSemValor > 0 && ` + ${s.emAbertoSemValor} a confirmar`}</td></tr>
          <tr className="forte destaque-falta">
            <td>VALOR TOTAL FALTANTE PARA DEPÓSITO</td>
            <td className={s.faltaDepositar > 0 ? "negativo" : "positivo"}>{s.faltaDepositar > 0 ? reais(s.faltaDepositar) : "Nada"}</td>
          </tr>
          <tr className="forte">
            <td>Para zerar e pagar também as contas em aberto, depositar</td>
            <td className={s.faltaComContas > 0 ? "negativo" : "positivo"}>{s.faltaComContas > 0 ? reais(s.faltaComContas) : "Nada"}</td>
          </tr>
        </tbody>
      </table>
      {s.emAberto.length > 0 && (
        <table className="rel-tabela">
          <thead><tr><th>Conta em aberto</th><th>Vencimento</th><th>Valor</th></tr></thead>
          <tbody>
            {s.emAberto.map((a) => (
              <tr key={a.chave}>
                <td>{a.descricao}</td>
                <td>{dataBR(a.vencimento)}</td>
                <td>{a.valor_centavos != null ? reais(a.valor_centavos) : "a confirmar"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {d.opcoes.incluirFotos && (
        <section className="rel-comprovantes">
          <h3>6. Comprovantes</h3>
          {carregandoFotos ? (
            <Carregando texto="Carregando os comprovantes…" />
          ) : comprovantes.length === 0 ? (
            <p className="suave">Nenhum comprovante anexado neste mês.</p>
          ) : (
            comprovantes.map((cp) => (
              <figure key={cp.lancamento.id} className="rel-comprovante">
                <figcaption>{legendaComprovante(cp.lancamento)}</figcaption>
                {cp.tipo === "imagem" && cp.url ? (
                  <img src={cp.url} alt={legendaComprovante(cp.lancamento)} style={{ maxWidth: tamanhoNaPagina(cp).width }} />
                ) : (
                  <p className="suave">{cp.tipo === "pdf" ? "(Comprovante em PDF — abra pelo aplicativo para ver.)" : "(Não foi possível carregar a imagem.)"}</p>
                )}
              </figure>
            ))
          )}
        </section>
      )}
    </article>
  );
}

function TabelaLancamentos({ ls, rotulo, vazio }: { ls: Lancamento[]; rotulo: string; vazio: string }) {
  if (!ls.length) return <p className="suave">{vazio}</p>;
  return (
    <table className="rel-tabela">
      <thead><tr><th>Data</th><th>{rotulo}</th><th>Valor</th><th>Por</th></tr></thead>
      <tbody>
        {ls.map((l) => (
          <tr key={l.id}>
            <td>{diaMes(l.data)}</td>
            <td>{l.descricao}</td>
            <td>{reais(l.valor_centavos)}</td>
            <td>{autorDe(l)}</td>
          </tr>
        ))}
        <tr className="forte total"><td>Total</td><td></td><td>{reais(soma(ls))}</td><td></td></tr>
      </tbody>
    </table>
  );
}
