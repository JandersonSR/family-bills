import { useEffect, useState } from "react";
import { supabase, mensagemErro } from "../lib/supabase";
import { useGrupo } from "../contexto/Grupo";
import { navegar, useRota } from "../lib/rotas";
import { reais, reaisAbs } from "../lib/dinheiro";
import { MESES, mesAtual } from "../lib/datas";
import type { ResumoMensal } from "../lib/tipos";
import { Carregando, Erro, Topo } from "../componentes/comuns";

/** valor sem "R$" para caber na tabela em telas pequenas */
const num = (c: number) =>
  (Math.abs(c) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Ano() {
  const { grupo } = useGrupo();
  const { params } = useRota();
  const anoAtual = Number(mesAtual().slice(0, 4));
  const ano = Number(params.get("ano")) || anoAtual;

  const [resumos, setResumos] = useState<ResumoMensal[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!grupo) return;
    supabase
      .from("resumos_mensais")
      .select("mes, entradas_centavos, saidas_centavos")
      .eq("grupo_id", grupo.id)
      .order("mes")
      .then(({ data, error }) => {
        if (error) setErro(mensagemErro(error));
        else setResumos((data ?? []) as ResumoMensal[]);
        setCarregando(false);
      });
  }, [grupo]);

  const inicioAno = `${ano}-01-01`;
  const veioAntes = resumos
    .filter((r) => r.mes < inicioAno)
    .reduce((s, r) => s + Number(r.entradas_centavos) - Number(r.saidas_centavos), 0);

  const linhas = MESES.map((nome, i) => {
    const mes = `${ano}-${String(i + 1).padStart(2, "0")}-01`;
    const r = resumos.find((x) => x.mes === mes);
    const e = Number(r?.entradas_centavos ?? 0);
    const s = Number(r?.saidas_centavos ?? 0);
    return { mes, nome, e, s, saldo: e - s, vazio: !r || (e === 0 && s === 0) };
  });
  const totE = linhas.reduce((a, l) => a + l.e, 0);
  const totS = linhas.reduce((a, l) => a + l.s, 0);
  const saldoAno = totE - totS;
  const saldoFinal = veioAntes + saldoAno;

  return (
    <main className="pagina">
      <Topo titulo="Resumo do ano" voltarPara="/" />
      <div className="seletor-mes">
        <button className="btn-icone" onClick={() => navegar(`/ano?ano=${ano - 1}`, true)} aria-label="Ano anterior">‹</button>
        <strong>{ano}</strong>
        <button className="btn-icone" onClick={() => navegar(`/ano?ano=${ano + 1}`, true)} aria-label="Próximo ano">›</button>
      </div>
      <Erro>{erro}</Erro>
      {carregando ? (
        <Carregando />
      ) : (
        <>
          <section className="cartao resumo">
            <div className="linha-valor">
              <span>Enviado no ano</span>
              <strong className="entrada">{reais(totE)}</strong>
            </div>
            <div className="linha-valor">
              <span>Pago no ano</span>
              <strong className="saida">− {reais(totS)}</strong>
            </div>
            <hr />
            <div className="linha-valor destaque">
              <span>{saldoAno >= 0 ? "Sobrou no ano" : "Faltou no ano"}</span>
              <strong className={saldoAno >= 0 ? "positivo" : "negativo"}>{reaisAbs(saldoAno)}</strong>
            </div>
            {veioAntes !== 0 && (
              <p className="explica">
                Com {reaisAbs(veioAntes)} que {veioAntes > 0 ? "sobrou" : "faltou"} de antes de {ano}, o saldo total{" "}
                {ano === anoAtual ? "hoje" : "no fim do ano"} é{" "}
                <strong className={saldoFinal >= 0 ? "positivo" : "negativo"}>
                  {saldoFinal >= 0 ? "sobrando" : "faltando"} {reaisAbs(saldoFinal)}
                </strong>
                .
              </p>
            )}
          </section>

          <table className="tabela-ano">
            <caption>Valores em R$</caption>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Enviado</th>
                <th>Pago</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr
                  key={l.mes}
                  className={l.vazio ? "vazia" : ""}
                  onClick={() => navegar(l.mes === mesAtual() ? "/" : `/?mes=${l.mes.slice(0, 7)}`)}
                >
                  <td>{l.nome.slice(0, 3)}</td>
                  <td>{l.vazio ? "—" : num(l.e)}</td>
                  <td>{l.vazio ? "—" : num(l.s)}</td>
                  <td className={l.vazio ? "" : l.saldo >= 0 ? "positivo" : "negativo"}>
                    {l.vazio ? "—" : `${l.saldo < 0 ? "−" : "+"}${num(l.saldo)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="suave centralizado">Toque num mês para ver os detalhes.</p>
        </>
      )}
    </main>
  );
}
