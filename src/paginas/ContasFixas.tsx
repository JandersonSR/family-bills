import { useEffect, useState, type FormEvent } from "react";
import { supabase, mensagemErro } from "../lib/supabase";
import { useGrupo } from "../contexto/Grupo";
import { navegar, voltar } from "../lib/rotas";
import { avisar } from "../lib/aviso";
import { reais } from "../lib/dinheiro";
import { hoje, mesAtual, nomeMes, somarMeses } from "../lib/datas";
import type { ContaFixa } from "../lib/tipos";
import { CampoDinheiro, Carregando, Erro, Topo } from "../componentes/comuns";
import { Pergunta } from "./Registro";

const SUGESTOES = ["Luz", "Água", "Internet", "Telefone", "Gás", "Aluguel", "Condomínio", "IPTU", "Plano de saúde", "Cartão"];

/** Lista de contas que chegam todo mês. */
export function ListaContasFixas() {
  const { grupo } = useGrupo();
  const [fixas, setFixas] = useState<ContaFixa[] | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!grupo) return;
    supabase
      .from("contas_fixas")
      .select("*")
      .eq("grupo_id", grupo.id)
      .order("dia_vencimento")
      .then(({ data, error }) => {
        if (error) setErro(mensagemErro(error));
        setFixas((data ?? []) as ContaFixa[]);
      });
  }, [grupo]);

  const atuais = (fixas ?? []).filter((f) => !f.ate_mes || f.ate_mes >= mesAtual());
  const antigas = (fixas ?? []).filter((f) => f.ate_mes && f.ate_mes < mesAtual());

  return (
    <main className="pagina estreita">
      <Topo titulo="Contas de todo mês" voltarPara="/" />
      <p className="suave">
        Estas contas aparecem todo mês na lista “Contas do mês”. Quando pagar, é só tocar em <strong>Paguei</strong>.
      </p>
      <Erro>{erro}</Erro>
      {!fixas ? (
        <Carregando />
      ) : (
        <>
          {atuais.length === 0 ? (
            <p className="vazio">Nenhuma conta cadastrada ainda.</p>
          ) : (
            <ul className="lista">
              {atuais.map((f) => (
                <li key={f.id}>
                  <a className="item item-fixa" href={`#/contas-fixas/${f.id}`}>
                    <span className="dia-venc" aria-label={`Vence dia ${f.dia_vencimento}`}>
                      <small>dia</small>
                      {f.dia_vencimento}
                    </span>
                    <span className="item-texto">
                      <span className="item-titulo">{f.descricao}</span>
                      <span className="item-sub">
                        {f.valor_centavos != null ? `mais ou menos ${reais(f.valor_centavos)}` : "valor muda todo mês"}
                        {!f.no_orcamento && <span className="etiqueta cinza">fora do orçamento</span>}
                        {f.ate_mes === mesAtual() && <span className="etiqueta">última vez este mês</span>}
                        {f.desde_mes > mesAtual() && (
                          <span className="etiqueta aguardando">começa em {nomeMes(f.desde_mes, false).toLowerCase()}</span>
                        )}
                      </span>
                    </span>
                    <span className="seta" aria-hidden>›</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <a className="btn primario grande" href="#/contas-fixas/nova" style={{ marginTop: 16 }}>
            ＋ Adicionar conta
          </a>
          {antigas.length > 0 && (
            <details className="antigas">
              <summary>Contas que não são mais pagas ({antigas.length})</summary>
              <ul className="lista">
                {antigas.map((f) => (
                  <li key={f.id}>
                    <a className="item item-fixa" href={`#/contas-fixas/${f.id}`}>
                      <span className="dia-venc"><small>dia</small>{f.dia_vencimento}</span>
                      <span className="item-texto"><span className="item-titulo">{f.descricao}</span></span>
                      <span className="seta" aria-hidden>›</span>
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </main>
  );
}

/** Criar ou editar uma conta fixa. */
export function EditarContaFixa({ id }: { id?: string }) {
  const { grupo } = useGrupo();
  const [original, setOriginal] = useState<ContaFixa | null>(null);
  const [carregando, setCarregando] = useState(Boolean(id));
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState(0);
  const [varia, setVaria] = useState(false);
  const [dia, setDia] = useState(10);
  const [noOrcamento, setNoOrcamento] = useState(true);
  const [comecaEsteMes, setComecaEsteMes] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase
      .from("contas_fixas")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) setErro(error ? mensagemErro(error) : "Conta não encontrada.");
        else {
          const f = data as ContaFixa;
          setOriginal(f);
          setDescricao(f.descricao);
          setValor(f.valor_centavos ?? 0);
          setVaria(f.valor_centavos == null);
          setDia(f.dia_vencimento);
          setNoOrcamento(f.no_orcamento);
        }
        setCarregando(false);
      });
  }, [id]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!grupo) return;
    setErro("");
    if (!descricao.trim()) return setErro("Escreva o nome da conta.");
    if (!varia && valor <= 0) return setErro("Digite o valor aproximado, ou marque que o valor muda todo mês.");
    setSalvando(true);
    const campos = {
      descricao: descricao.trim(),
      valor_centavos: varia ? null : valor,
      dia_vencimento: dia,
      no_orcamento: noOrcamento,
    };
    const { error } = original
      ? await supabase.from("contas_fixas").update(campos).eq("id", original.id)
      : await supabase.from("contas_fixas").insert({
          grupo_id: grupo.id,
          desde_mes: jaVenceu && !comecaEsteMes ? somarMeses(mesAtual(), 1) : mesAtual(),
          ...campos,
        });
    setSalvando(false);
    if (error) return setErro(mensagemErro(error));
    avisar("✓ Conta salva!");
    voltar("/contas-fixas");
  }

  /** Para de aparecer nos próximos meses. Se já foi paga este mês, continua neste mês. */
  async function pararDeUsar() {
    if (!original || !grupo) return;
    if (!confirm(`Você não paga mais "${original.descricao}"? Ela deixa de aparecer nos próximos meses. Os pagamentos já feitos continuam registrados.`)) return;
    setSalvando(true);
    const { data: pagaEsteMes } = await supabase
      .from("lancamentos")
      .select("id")
      .eq("conta_fixa_id", original.id)
      .eq("mes_referencia", mesAtual());
    const ate = (pagaEsteMes ?? []).length > 0 ? mesAtual() : somarMeses(mesAtual(), -1);
    const { error } = await supabase.from("contas_fixas").update({ ate_mes: ate }).eq("id", original.id);
    setSalvando(false);
    if (error) return setErro(mensagemErro(error));
    avisar("Conta retirada da lista.");
    navegar("/contas-fixas", true);
  }

  async function voltarAUsar() {
    if (!original) return;
    const { error } = await supabase.from("contas_fixas").update({ ate_mes: null }).eq("id", original.id);
    if (error) return setErro(mensagemErro(error));
    avisar("✓ A conta voltou para a lista.");
    navegar("/contas-fixas", true);
  }

  if (carregando) return <Carregando />;
  const parada = Boolean(original?.ate_mes && original.ate_mes < mesAtual());
  // conta nova cujo vencimento deste mês já passou: não mostrar como "atrasada" sem perguntar
  const jaVenceu = !original && dia < Number(hoje().slice(8));
  const esteMes = nomeMes(mesAtual(), false).toLowerCase();
  const proximo = nomeMes(somarMeses(mesAtual(), 1), false).toLowerCase();

  return (
    <main className="pagina estreita">
      <Topo titulo={original ? "Conta de todo mês" : "Nova conta de todo mês"} voltarPara="/contas-fixas" />
      <form onSubmit={salvar} className="form">
        <label>
          Nome da conta
          <input maxLength={120} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Luz" />
        </label>
        <div className="chips">
          {SUGESTOES.map((s) => (
            <button type="button" key={s} className={`chip ${descricao === s ? "ativo" : ""}`} onClick={() => setDescricao(s)}>{s}</button>
          ))}
        </div>

        <label>
          Vence todo dia
          <select value={dia} onChange={(e) => setDia(Number(e.target.value))} className="select-grande">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>Dia {d}</option>
            ))}
          </select>
        </label>

        <Pergunta
          texto="O valor é sempre parecido?"
          opcoes={[["fixo", "Sim"], ["varia", "Não, muda todo mês"]]}
          valor={varia ? "varia" : "fixo"}
          mudar={(v) => setVaria(v === "varia")}
          ajuda={varia ? "O valor será digitado na hora de marcar como paga." : undefined}
        />
        {!varia && (
          <label>
            Valor aproximado
            <CampoDinheiro centavos={valor} onChange={setValor} />
          </label>
        )}

        {jaVenceu && (
          <Pergunta
            texto={`O dia ${dia} de ${esteMes} já passou. A partir de quando esta conta entra na lista?`}
            opcoes={[["proximo", `A partir de ${proximo}`], ["este", `Já em ${esteMes}`]]}
            valor={comecaEsteMes ? "este" : "proximo"}
            mudar={(v) => setComecaEsteMes(v === "este")}
            ajuda={
              comecaEsteMes
                ? `A conta de ${esteMes} vai aparecer para marcar como paga.`
                : `Se a de ${esteMes} já foi paga, registre em “＋ Conta paga” na tela inicial.`
            }
          />
        )}

        <Pergunta
          texto="Incluir esta conta no orçamento do mês?"
          opcoes={[["sim", "Sim"], ["nao", "Não"]]}
          valor={noOrcamento ? "sim" : "nao"}
          mudar={(v) => setNoOrcamento(v === "sim")}
          ajuda={noOrcamento ? undefined : "Será registrada, mas não entra no saldo (paga com outro dinheiro)."}
        />

        <Erro>{erro}</Erro>
        <button className="btn primario grande" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
      </form>

      {original &&
        (parada ? (
          <button className="btn grande" onClick={voltarAUsar}>Voltar a pagar esta conta</button>
        ) : (
          <button className="btn texto perigo" disabled={salvando} onClick={pararDeUsar}>
            Não pago mais esta conta
          </button>
        ))}
    </main>
  );
}
