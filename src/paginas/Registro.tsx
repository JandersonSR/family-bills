import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabase, mensagemErro, BUCKET } from "../lib/supabase";
import { useGrupo } from "../contexto/Grupo";
import { navegar, useRota } from "../lib/rotas";
import { avisar } from "../lib/aviso";
import { hoje, mesAtual, mesDe, normalizarMes, dataBR, diaMes, nomeMes, ultimoDia } from "../lib/datas";
import { reais } from "../lib/dinheiro";
import { prepararArquivo, LIMITE_BYTES } from "../lib/arquivo";
import { CAMPOS_LANCAMENTO } from "../lib/dados";
import type { ContaFixa, Lancamento, Status, Tipo } from "../lib/tipos";
import { CampoDinheiro, Carregando, Erro, Topo } from "../componentes/comuns";

const SUGESTOES: Record<Tipo, string[]> = {
  deposito: ["Pix", "Transferência", "Depósito no banco", "Dinheiro em mãos"],
  pagamento: [
    "Luz", "Água", "Internet", "Telefone", "Gás", "Aluguel", "Condomínio",
    "IPTU", "Cartão", "Plano de saúde", "Farmácia", "Mercado",
  ],
};

export default function Registro({ id, tipoNovo }: { id?: string; tipoNovo?: Tipo }) {
  const { grupo } = useGrupo();
  const { params } = useRota();
  const fixaId = id ? null : params.get("fixa");
  const refParam = normalizarMes(params.get("ref"));

  const [original, setOriginal] = useState<Lancamento | null>(null);
  const [fixa, setFixa] = useState<ContaFixa | null>(null);
  const [mesRef, setMesRef] = useState<string | null>(refParam);
  const [carregando, setCarregando] = useState(Boolean(id || fixaId));

  const [tipo, setTipo] = useState<Tipo>(tipoNovo ?? "pagamento");
  const [valor, setValor] = useState(0);
  const [descricao, setDescricao] = useState("");
  const [status, setStatus] = useState<Status>("pago");
  const [noOrcamento, setNoOrcamento] = useState(true);
  const [data, setData] = useState(() => {
    const m = normalizarMes(params.get("mes"));
    return m && m !== mesAtual() ? m : hoje();
  });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [removerComprovante, setRemoverComprovante] = useState(false);

  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const previa = useMemo(
    () => (arquivo && arquivo.type.startsWith("image/") ? URL.createObjectURL(arquivo) : null),
    [arquivo],
  );
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa); }, [previa]);

  // editar um registro existente
  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: l, error } = await supabase.from("lancamentos").select(CAMPOS_LANCAMENTO).eq("id", id).maybeSingle();
      if (error) setErro(mensagemErro(error));
      else if (!l) setErro("Registro não encontrado (pode ter sido apagado).");
      else {
        const x = l as unknown as Lancamento;
        setOriginal(x);
        setTipo(x.tipo);
        setValor(x.valor_centavos);
        setDescricao(x.descricao);
        setStatus(x.status);
        setNoOrcamento(x.no_orcamento);
        setData(x.data);
        setMesRef(x.mes_referencia);
        if (x.conta_fixa_id) {
          const { data: f } = await supabase.from("contas_fixas").select("*").eq("id", x.conta_fixa_id).maybeSingle();
          setFixa((f as ContaFixa) ?? null);
        }
      }
      setCarregando(false);
    })();
  }, [id]);

  // "Paguei" numa conta fixa: já vem preenchido
  useEffect(() => {
    if (!fixaId) return;
    (async () => {
      const { data: f, error } = await supabase.from("contas_fixas").select("*").eq("id", fixaId).maybeSingle();
      if (error || !f) setErro(error ? mensagemErro(error) : "Conta não encontrada.");
      else {
        const cf = f as ContaFixa;
        setFixa(cf);
        setTipo("pagamento");
        setDescricao(cf.descricao);
        setValor(cf.valor_centavos ?? 0);
        setNoOrcamento(cf.no_orcamento);
        setStatus("pago");
        setData(hoje());
        setMesRef(refParam ?? mesAtual());
      }
      setCarregando(false);
    })();
  }, [fixaId]);

  const voltarAoMes = (d: string) => {
    const m = mesDe(d);
    navegar(m === mesAtual() ? "/" : `/?mes=${m.slice(0, 7)}`, true);
  };

  /** Avisa se parece que o mesmo registro já foi feito (útil com várias pessoas). */
  async function parecidoJaExiste(dt: string): Promise<boolean> {
    if (original || fixa || !grupo) return false;
    const { data: ls } = await supabase
      .from("lancamentos")
      .select(CAMPOS_LANCAMENTO)
      .eq("grupo_id", grupo.id)
      .eq("tipo", tipo)
      .eq("valor_centavos", valor)
      .gte("data", mesDe(dt))
      .lte("data", ultimoDia(mesDe(dt)));
    const igual = ((ls ?? []) as unknown as Lancamento[]).find(
      (l) => l.descricao.trim().toLowerCase() === descricao.trim().toLowerCase(),
    );
    if (!igual) return false;
    const quem = igual.autor?.nome || igual.autor?.email || "alguém";
    return !confirm(
      `Parece que isso já foi registrado:\n\n${igual.descricao} · ${reais(igual.valor_centavos)} · ${dataBR(igual.data)} (por ${quem}).\n\nRegistrar de novo mesmo assim?`,
    );
  }

  async function salvar(e?: FormEvent, forcar?: { status: Status; data: string }) {
    e?.preventDefault();
    if (!grupo) return;
    setErro("");
    const st = forcar?.status ?? status;
    const dt = forcar?.data ?? data;
    if (valor <= 0) return setErro("Digite o valor.");
    if (!descricao.trim()) return setErro(tipo === "deposito" ? "Escreva como o dinheiro foi enviado." : "Escreva qual é a conta.");
    if (!dt) return setErro("Escolha a data.");

    setSalvando(true);
    if (await parecidoJaExiste(dt)) return setSalvando(false);

    const regId = original?.id ?? crypto.randomUUID();
    const caminhoAntigo = original?.comprovante_path ?? null;
    let caminhoNovo: string | null = null;

    try {
      if (arquivo) {
        const { blob, ext, tipo: mime } = await prepararArquivo(arquivo);
        if (blob.size > LIMITE_BYTES) throw new Error("O arquivo é grande demais (máximo 5 MB).");
        caminhoNovo = `${grupo.id}/${regId}-${Date.now()}.${ext}`;
        const up = await supabase.storage.from(BUCKET).upload(caminhoNovo, blob, { contentType: mime });
        if (up.error) throw up.error;
      }
      const caminhoFinal = arquivo ? caminhoNovo : removerComprovante ? null : caminhoAntigo;
      const campos = {
        tipo,
        descricao: descricao.trim(),
        valor_centavos: valor,
        data: dt,
        status: tipo === "deposito" || fixa ? "pago" : st,
        no_orcamento: tipo === "deposito" ? true : noOrcamento,
        comprovante_path: caminhoFinal,
        conta_fixa_id: fixa?.id ?? original?.conta_fixa_id ?? null,
        mes_referencia: fixa || original?.conta_fixa_id ? mesRef : null,
      };
      const res = original
        ? await supabase.from("lancamentos").update(campos).eq("id", regId)
        : await supabase.from("lancamentos").insert({ id: regId, grupo_id: grupo.id, ...campos });
      if (res.error) throw res.error;

      if (caminhoAntigo && caminhoAntigo !== caminhoFinal) {
        await supabase.storage.from(BUCKET).remove([caminhoAntigo]); // melhor esforço
      }
      avisar(fixa && !original ? `✓ ${descricao.trim()} marcada como paga!` : "✓ Salvo!");
      voltarAoMes(fixa && mesRef ? mesRef : dt);
    } catch (err) {
      if (caminhoNovo) await supabase.storage.from(BUCKET).remove([caminhoNovo]);
      setErro(mensagemErro(err));
      setSalvando(false);
    }
  }

  async function apagar() {
    if (!original) return;
    const pergunta = original.conta_fixa_id
      ? "Apagar este pagamento? A conta volta a aparecer como não paga."
      : "Apagar este registro? Isso não pode ser desfeito.";
    if (!confirm(pergunta)) return;
    setSalvando(true);
    const { error } = await supabase.from("lancamentos").delete().eq("id", original.id);
    if (error) {
      setSalvando(false);
      return setErro(mensagemErro(error));
    }
    if (original.comprovante_path) await supabase.storage.from(BUCKET).remove([original.comprovante_path]);
    avisar("Registro apagado.");
    voltarAoMes(original.data);
  }

  async function verComprovante() {
    if (!original?.comprovante_path) return;
    // abre a aba antes do await para o navegador não bloquear o pop-up
    const aba = window.open("", "_blank");
    const { data: s, error } = await supabase.storage.from(BUCKET).createSignedUrl(original.comprovante_path, 600);
    if (error || !s) {
      aba?.close();
      return setErro(mensagemErro(error));
    }
    if (aba) aba.location.href = s.signedUrl;
    else window.location.href = s.signedUrl;
  }

  if (carregando) return <Carregando />;

  const deposito = tipo === "deposito";
  const ehBaixa = Boolean(fixa || original?.conta_fixa_id);
  const titulo = fixa && !original
    ? `Pagar: ${fixa.descricao}`
    : original ? (deposito ? "Dinheiro enviado" : "Conta") : deposito ? "Registrar dinheiro enviado" : "Registrar conta paga";
  const temComprovante = Boolean(original?.comprovante_path) && !removerComprovante && !arquivo;

  return (
    <main className="pagina estreita">
      <Topo titulo={titulo} voltarPara="/" />

      {ehBaixa && mesRef && (
        <p className="faixa-info">
          Conta do mês de <strong>{nomeMes(mesRef).toLowerCase()}</strong>
          {fixa && <> · vence dia {fixa.dia_vencimento}</>}
        </p>
      )}

      {original && original.status === "pendente" && (
        <button className="btn primario grande" disabled={salvando} onClick={() => salvar(undefined, { status: "pago", data: hoje() })}>
          ✓ Paguei hoje
        </button>
      )}

      <form onSubmit={salvar} className="form">
        <label>
          {fixa && !original && fixa.valor_centavos == null ? "Valor que veio na conta" : "Valor"}
          <CampoDinheiro centavos={valor} onChange={setValor} />
          {fixa && !original && fixa.valor_centavos != null && (
            <small className="suave">Confira se o valor da conta deste mês é o mesmo.</small>
          )}
        </label>

        {!ehBaixa && (
          <>
            <label>
              {deposito ? "Como foi enviado?" : "Qual conta?"}
              <input
                maxLength={120}
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder={deposito ? "Ex.: Pix do filho" : "Ex.: Farmácia"}
              />
            </label>
            <div className="chips">
              {SUGESTOES[tipo].map((s) => (
                <button type="button" key={s} className={`chip ${descricao === s ? "ativo" : ""}`} onClick={() => setDescricao(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}

        {!deposito && !ehBaixa && (
          <Pergunta
            texto="Essa conta já foi paga?"
            opcoes={[["pago", "Sim, já paguei"], ["pendente", "Não, vou pagar"]]}
            valor={status}
            mudar={(v) => setStatus(v as Status)}
          />
        )}

        <label>
          {deposito ? "Data do envio" : status === "pago" || ehBaixa ? "Data do pagamento" : "Vence em"}
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </label>

        {!deposito && (
          <Pergunta
            texto="Incluir o valor desta conta no orçamento do mês?"
            opcoes={[["sim", "Sim"], ["nao", "Não"]]}
            valor={noOrcamento ? "sim" : "nao"}
            mudar={(v) => setNoOrcamento(v === "sim")}
            ajuda={
              noOrcamento
                ? "O valor sai do dinheiro enviado e entra na conta do saldo."
                : "Fica registrada, mas NÃO entra no saldo. Use quando a conta foi paga com outro dinheiro."
            }
          />
        )}

        <fieldset className="comprovante">
          <legend>{deposito ? "Comprovante do depósito" : status === "pago" || ehBaixa ? "Comprovante de pagamento" : "Boleto (opcional)"}</legend>
          <input
            ref={inputArquivo}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setArquivo(f);
              if (f) setRemoverComprovante(false);
            }}
          />
          {temComprovante ? (
            <div className="linha-botoes">
              <button type="button" className="btn" onClick={verComprovante}>📎 Ver comprovante</button>
              <button type="button" className="btn" onClick={() => inputArquivo.current?.click()}>Trocar</button>
              <button type="button" className="btn texto perigo" onClick={() => setRemoverComprovante(true)}>Remover</button>
            </div>
          ) : arquivo ? (
            <div className="arquivo-escolhido">
              {previa ? <img src={previa} alt="Prévia do comprovante" /> : <span>📄 {arquivo.name}</span>}
              <button type="button" className="btn texto" onClick={() => { setArquivo(null); if (inputArquivo.current) inputArquivo.current.value = ""; }}>
                Tirar
              </button>
            </div>
          ) : (
            <button type="button" className="btn grande tracejado" onClick={() => inputArquivo.current?.click()}>
              📷 Tirar foto ou escolher arquivo
            </button>
          )}
          {removerComprovante && (
            <p className="suave">
              O comprovante será removido ao salvar.{" "}
              <button type="button" className="link" onClick={() => setRemoverComprovante(false)}>Desfazer</button>
            </p>
          )}
        </fieldset>

        <Erro>{erro}</Erro>

        <button className="btn primario grande" disabled={salvando}>
          {salvando ? "Salvando…" : fixa && !original ? "✓ Confirmar pagamento" : "Salvar"}
        </button>
        <button type="button" className="btn grande" disabled={salvando} onClick={() => history.back()}>
          Cancelar
        </button>
      </form>

      {original && (
        <>
          <p className="suave centralizado">
            Registrado por {original.autor?.nome || original.autor?.email || "alguém que saiu do grupo"} em{" "}
            {diaMes(original.created_at.slice(0, 10))}
          </p>
          <button className="btn texto perigo" disabled={salvando} onClick={apagar}>
            Apagar registro
          </button>
        </>
      )}
    </main>
  );
}

/** Pergunta com respostas em botões grandes (mais fácil que um interruptor pequeno). */
export function Pergunta({
  texto, opcoes, valor, mudar, ajuda,
}: {
  texto: string;
  opcoes: [string, string][];
  valor: string;
  mudar: (v: string) => void;
  ajuda?: string;
}) {
  return (
    <div className="pergunta" role="radiogroup" aria-label={texto}>
      <span className="pergunta-texto">{texto}</span>
      <div className="segmentado">
        {opcoes.map(([v, rotulo]) => (
          <button type="button" key={v} role="radio" aria-checked={valor === v} className={valor === v ? "ativo" : ""} onClick={() => mudar(v)}>
            {rotulo}
          </button>
        ))}
      </div>
      {ajuda && <small className="suave">{ajuda}</small>}
    </div>
  );
}
