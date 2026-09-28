import { useCallback, useEffect, useState } from "react";
import { mensagemErro } from "../lib/supabase";
import { useGrupo } from "../contexto/Grupo";
import { navegar, useRota } from "../lib/rotas";
import { reais, reaisAbs } from "../lib/dinheiro";
import { carregarPainel, somarAPagar, aPagarNoOrcamento, type Painel } from "../lib/dados";
import {
  diaMes, mesAtual, nomeMes, normalizarMes, primeiroMesComDetalhes, somarMeses, dataBR,
} from "../lib/datas";
import type { ContaAPagar, ItemContaMes, Lancamento } from "../lib/tipos";
import { Carregando, Erro } from "../componentes/comuns";

export default function Mes() {
  const { grupo } = useGrupo();
  const { params } = useRota();
  const mes = normalizarMes(params.get("mes")) ?? mesAtual();
  const ehMesAtual = mes === mesAtual();

  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    if (!grupo) return;
    try {
      setPainel(await carregarPainel(grupo.id, mes));
      setErro("");
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }, [grupo, mes]);

  useEffect(() => {
    setPainel(null);
    carregar();
    // atualiza quando a pessoa volta para o app (outra pessoa pode ter lançado algo)
    const aoVoltar = () => document.visibilityState === "visible" && carregar();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [carregar]);

  if (!grupo) return null;
  const irPara = (m: string) => navegar(m === mesAtual() ? "/" : `/?mes=${m.slice(0, 7)}`, true);
  const semDetalhes = mes < primeiroMesComDetalhes();
  const ultimoMesGuardado = mes === primeiroMesComDetalhes() && !ehMesAtual;

  return (
    <main className="pagina com-barra">
      <header className="topo">
        <span className="btn-icone-vazio" />
        <h1>{grupo.nome}</h1>
        <a className="btn-icone" href="#/grupo" aria-label="Pessoas e configurações">⚙︎</a>
      </header>

      <div className="seletor-mes">
        <button className="btn-icone" onClick={() => irPara(somarMeses(mes, -1))} aria-label="Mês anterior">‹</button>
        <div>
          <strong>{nomeMes(mes)}</strong>
          {!ehMesAtual && (
            <button className="link pequeno" onClick={() => irPara(mesAtual())}>voltar para o mês atual</button>
          )}
        </div>
        <button className="btn-icone" onClick={() => irPara(somarMeses(mes, 1))} aria-label="Próximo mês">›</button>
      </div>

      <Erro>{erro}</Erro>
      {!painel ? (
        !erro && <Carregando />
      ) : (
        <Conteudo p={painel} mes={mes} ehMesAtual={ehMesAtual} semDetalhes={semDetalhes} ultimoMesGuardado={ultimoMesGuardado} />
      )}

      <nav className="barra-acoes">
        <a className="btn entrada-btn" href={`#/novo/deposito?mes=${mes.slice(0, 7)}`}>＋ Dinheiro enviado</a>
        <a className="btn saida-btn" href={`#/novo/pagamento?mes=${mes.slice(0, 7)}`}>＋ Conta paga</a>
      </nav>
    </main>
  );
}

function Conteudo({
  p, mes, ehMesAtual, semDetalhes, ultimoMesGuardado,
}: { p: Painel; mes: string; ehMesAtual: boolean; semDetalhes: boolean; ultimoMesGuardado: boolean }) {
  const c = p.calc;
  const naoPagasMes = p.contasDoMes.filter((i) => i.situacao !== "paga");
  const aPagarMes = somarAPagar(naoPagasMes);
  const aPagarAtrasadas = somarAPagar(p.atrasadas.filter(aPagarNoOrcamento));
  const totalAPagar = aPagarMes.total + (ehMesAtual ? aPagarAtrasadas.total : 0);
  const previsto = c.acumulado - totalAPagar;
  const foraOrcamento = p.itens.filter((i) => !i.no_orcamento && i.status === "pago");

  return (
    <>
      {ultimoMesGuardado && (
        <div className="alerta aviso-limpeza">
          ⚠︎ Os detalhes de {nomeMes(mes, false).toLowerCase()} serão apagados no dia 1º do próximo mês.
          Se quiser guardar, <a href={`#/relatorio?mes=${mes.slice(0, 7)}`}>envie ou imprima o relatório</a>.
        </div>
      )}

      <section className="cartao resumo">
        <div className="linha-valor">
          <span>Dinheiro enviado</span>
          <strong className="entrada">{reais(c.entradas)}</strong>
        </div>
        <div className="linha-valor">
          <span>Contas pagas</span>
          <strong className="saida">− {reais(c.saidas)}</strong>
        </div>
        <hr />
        <div className="linha-valor destaque">
          <span>{c.saldoMes >= 0 ? "Sobrou neste mês" : "Faltou neste mês"}</span>
          <strong className={c.saldoMes >= 0 ? "positivo" : "negativo"}>{reaisAbs(c.saldoMes)}</strong>
        </div>
        {foraOrcamento.length > 0 && (
          <p className="explica">
            + {reais(foraOrcamento.reduce((s, i) => s + i.valor_centavos, 0))} em contas fora do orçamento (não entram na conta).
          </p>
        )}
      </section>

      <section className={`cartao saldo ${c.acumulado >= 0 ? "fundo-positivo" : "fundo-negativo"}`}>
        <span className="rotulo">{c.acumulado >= 0 ? "Saldo total: sobrando" : "Saldo total: faltando"}</span>
        <strong className="valor-grande">{reaisAbs(c.acumulado)}</strong>
        <p className="explica">
          {c.acumulado >= 0
            ? "É o dinheiro enviado que ainda não foi usado para pagar contas."
            : "Foi pago mais do que foi enviado. Esse valor precisa ser depositado."}
          {c.anterior !== 0 && (
            <> Inclui {reaisAbs(c.anterior)} que {c.anterior > 0 ? "sobrou" : "faltou"} dos meses anteriores.</>
          )}
        </p>
      </section>

      {ehMesAtual && p.atrasadas.length > 0 && (
        <section className="cartao alerta-atraso">
          <h2>⚠︎ Contas atrasadas de meses anteriores</h2>
          <ul className="lista-contas">
            {p.atrasadas.map((a) => (
              <LinhaAPagar key={a.chave} a={a} />
            ))}
          </ul>
        </section>
      )}

      {!semDetalhes && (
        <ContasDoMes
          itens={p.contasDoMes}
          mes={mes}
          temFixas={p.fixas.length > 0}
          totalAPagar={totalAPagar}
          comAtrasadas={ehMesAtual && aPagarAtrasadas.total > 0}
          semValor={aPagarMes.semValor + (ehMesAtual ? aPagarAtrasadas.semValor : 0)}
          previsto={previsto}
        />
      )}


      <a className="btn grande relatorio-btn" href={`#/relatorio?mes=${mes.slice(0, 7)}`}>
        📄 Relatório do mês · WhatsApp ou imprimir
      </a>

      <a className="cartao ano-link" href={`#/ano?ano=${mes.slice(0, 4)}`}>
        <div>
          <span className="rotulo">Em {mes.slice(0, 4)} (até {nomeMes(mes, false).toLowerCase()})</span>
          <span className="mini">enviado {reais(c.ano.entradas)} · pago {reais(c.ano.saidas)}</span>
        </div>
        <strong className={c.ano.saldo >= 0 ? "positivo" : "negativo"}>
          {c.ano.saldo >= 0 ? "+" : "−"} {reaisAbs(c.ano.saldo)} ›
        </strong>
      </a>

      <h2 className="titulo-lista">Tudo o que foi registrado em {nomeMes(mes, false).toLowerCase()}</h2>
      {semDetalhes ? (
        <p className="vazio">
          Os registros deste mês já foram apagados (guardamos os detalhes só dos últimos 6 meses). Os totais acima continuam valendo.
        </p>
      ) : p.itens.length === 0 ? (
        <p className="vazio">Nada registrado neste mês ainda. Use os botões abaixo.</p>
      ) : (
        <ul className="lista">
          {p.itens.map((i) => (
            <ItemLista key={i.id} i={i} mes={mes} />
          ))}
        </ul>
      )}
    </>
  );
}

function ContasDoMes({
  itens, mes, temFixas, totalAPagar, comAtrasadas, semValor, previsto,
}: {
  itens: ItemContaMes[]; mes: string; temFixas: boolean; totalAPagar: number;
  comAtrasadas: boolean; semValor: number; previsto: number;
}) {
  const pagas = itens.filter((i) => i.situacao === "paga").length;
  return (
    <section className="cartao contas-mes">
      <div className="cabecalho-cartao">
        <h2>Contas do mês</h2>
        {itens.length > 0 && <span className="contador">{pagas} de {itens.length} pagas</span>}
      </div>
      {itens.length === 0 ? (
        <div className="vazio-contas">
          <p>
            {temFixas
              ? "Nenhuma conta para este mês."
              : "Cadastre as contas que chegam todo mês (luz, água, aluguel…). Assim é só marcar aqui quando pagar."}
          </p>
        </div>
      ) : (
        <ul className="lista-contas">
          {itens.map((i) =>
            i.situacao === "paga" ? (
              <li key={i.chave} className="conta paga">
                <a href={`#/registro/${i.pagamento!.id}`} className="conta-link">
                  <span className="marca-ok" aria-hidden>✓</span>
                  <span className="conta-texto">
                    <strong>{i.descricao}</strong>
                    <span className="conta-sub">
                      Paga em {diaMes(i.pagamento!.data)}
                      {!i.noOrcamento && " · fora do orçamento"}
                    </span>
                  </span>
                  <strong className="conta-valor">{reais(i.pagamento!.valor_centavos)}</strong>
                </a>
              </li>
            ) : (
              <LinhaAPagar key={i.chave} a={i.aPagar!} situacao={i.situacao} />
            ),
          )}
        </ul>
      )}
      {itens.length > 0 && itens.every((i) => i.situacao === "paga") && (
        <p className="explica positivo"><strong>✓ Todas as contas deste mês estão pagas.</strong></p>
      )}
      {(totalAPagar > 0 || semValor > 0) && (
        <div className="falta-pagar">
          <div className="linha-valor">
            <span>Falta pagar{comAtrasadas ? " (com atrasadas)" : ""}</span>
            <strong>{reais(totalAPagar)}</strong>
          </div>
          {semValor > 0 && (
            <p className="explica">+ {semValor} {semValor === 1 ? "conta" : "contas"} com valor a confirmar.</p>
          )}
          <p className="explica">
            Depois de pagar, o saldo total fica{" "}
            <strong className={previsto >= 0 ? "positivo" : "negativo"}>
              {previsto >= 0 ? "sobrando" : "faltando"} {reaisAbs(previsto)}
            </strong>
            .{previsto < 0 && <> É preciso depositar <strong>{reaisAbs(previsto)}</strong> para pagar tudo.</>}
          </p>
        </div>
      )}
      <a className="btn texto" href={`#/contas-fixas?mes=${mes.slice(0, 7)}`}>
        {temFixas ? "Mudar a lista de contas do mês" : "＋ Cadastrar contas do mês"}
      </a>
    </section>
  );
}

function LinhaAPagar({ a, situacao }: { a: ContaAPagar; situacao?: ItemContaMes["situacao"] }) {
  const s = situacao ?? "atrasada";
  const destino = a.fixa
    ? `#/novo/pagamento?fixa=${a.fixa.id}&ref=${a.mes_referencia.slice(0, 7)}`
    : `#/registro/${a.avulsa!.id}`;
  const texto =
    s === "atrasada" ? `Atrasada · venceu ${dataBR(a.vencimento)}` : s === "vence_hoje" ? "Vence hoje" : `Vence dia ${a.vencimento.slice(8)}`;
  return (
    <li className={`conta ${s}`}>
      <span className="marca-pendente" aria-hidden>{s === "atrasada" ? "!" : ""}</span>
      <span className="conta-texto">
        <strong>{a.descricao}</strong>
        <span className="conta-sub">
          {texto} · {a.valor_centavos != null ? reais(a.valor_centavos) : "valor a confirmar"}
        </span>
      </span>
      <a className="btn paguei" href={destino}>Paguei</a>
    </li>
  );
}

function ItemLista({ i, mes }: { i: Lancamento; mes: string }) {
  const deposito = i.tipo === "deposito";
  const fora = !deposito && !i.no_orcamento;
  const refOutroMes = i.mes_referencia && i.mes_referencia !== mes;
  return (
    <li>
      <a className={`item ${fora ? "fora" : ""}`} href={`#/registro/${i.id}`}>
        <span className={`icone-tipo ${deposito ? "entrada" : "saida"}`} aria-hidden>{deposito ? "↓" : "↑"}</span>
        <span className="item-texto">
          <span className="item-titulo">
            {i.descricao}
            {i.comprovante_path && <span title="Tem comprovante"> 📎</span>}
          </span>
          <span className="item-sub">
            {i.status === "pendente" ? (
              <span className="etiqueta">A pagar · vence {diaMes(i.data)}</span>
            ) : (
              <>{deposito ? "Enviado" : "Pago"} em {diaMes(i.data)}</>
            )}
            {refOutroMes && <> · conta de {nomeMes(i.mes_referencia!, false).toLowerCase()}</>}
            {fora && <span className="etiqueta cinza">fora do orçamento</span>}
            {i.autor && <> · {i.autor.nome || i.autor.email}</>}
          </span>
        </span>
        <strong className={`item-valor ${deposito ? "entrada" : i.status === "pendente" ? "pendente" : fora ? "suave" : "saida"}`}>
          {deposito ? "+" : "−"} {reais(i.valor_centavos)}
        </strong>
      </a>
    </li>
  );
}
