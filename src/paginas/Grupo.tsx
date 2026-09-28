import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase, mensagemErro } from "../lib/supabase";
import { useGrupo } from "../contexto/Grupo";
import { useAuth } from "../contexto/Auth";
import { navegar } from "../lib/rotas";
import type { Convite, Membro } from "../lib/tipos";
import { Erro, Ok, Topo } from "../componentes/comuns";
import { aplicarTamanhoLetra, lerTamanhoLetra, type TamanhoLetra } from "../lib/preferencias";

const LIMITE = 4;

export default function Grupo() {
  const { sessao } = useAuth();
  const { grupo, grupos, escolher, recarregar } = useGrupo();
  const eu = sessao!.user.id;
  const admin = grupo?.papel === "admin";

  const [membros, setMembros] = useState<Membro[]>([]);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState(grupo?.nome ?? "");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [letra, setLetra] = useState<TamanhoLetra>(lerTamanhoLetra());

  const carregar = useCallback(async () => {
    if (!grupo) return;
    const [m, c] = await Promise.all([
      supabase.from("membros").select("user_id, papel, perfil:perfis(nome, email)").eq("grupo_id", grupo.id).order("created_at"),
      admin
        ? supabase.from("convites").select("id, email, created_at").eq("grupo_id", grupo.id).order("created_at")
        : Promise.resolve({ data: [], error: null }),
    ]);
    const falha = m.error || c.error;
    if (falha) setErro(mensagemErro(falha));
    setMembros((m.data ?? []) as unknown as Membro[]);
    setConvites((c.data ?? []) as Convite[]);
  }, [grupo, admin]);

  useEffect(() => {
    carregar();
    setNome(grupo?.nome ?? "");
  }, [carregar, grupo]);

  if (!grupo) return null;
  const vagas = LIMITE - membros.length - convites.length;

  async function executar(
    acao: () => PromiseLike<{ error: unknown }>,
    sucesso: string,
    aoConcluir?: () => void,
  ) {
    setErro("");
    setOk("");
    setOcupado(true);
    const { error } = await acao();
    if (error) {
      setOcupado(false);
      setErro(mensagemErro(error));
      return false;
    }
    setOk(sucesso);
    aoConcluir?.();
    await carregar();
    setOcupado(false);
    return true;
  }

  async function convidar(e: FormEvent) {
    e.preventDefault();
    const alvo = email.trim().toLowerCase();
    await executar(
      () => supabase.rpc("convidar", { p_grupo: grupo!.id, p_email: alvo }),
      `Convite criado para ${alvo}. Avise a pessoa para criar uma conta (ou entrar) com esse e-mail — o convite vai aparecer para ela aceitar.`,
      () => setEmail(""),
    );
  }

  async function renomear(e: FormEvent) {
    e.preventDefault();
    if (await executar(() => supabase.from("grupos").update({ nome: nome.trim() }).eq("id", grupo!.id), "Nome salvo.")) {
      recarregar();
    }
  }

  async function remover(m: Membro) {
    const quem = m.perfil?.nome || m.perfil?.email || "esta pessoa";
    const sou = m.user_id === eu;
    if (!confirm(sou ? `Sair do grupo "${grupo!.nome}"? Você deixa de ver os registros.` : `Remover ${quem} do grupo?`)) return;
    const feito = await executar(() => supabase.rpc("remover_membro", { p_grupo: grupo!.id, p_user: m.user_id }), sou ? "Você saiu do grupo." : `${quem} foi removido(a).`);
    if (feito && sou) {
      await recarregar();
      navegar("/", true);
    }
  }

  return (
    <main className="pagina estreita">
      <Topo titulo="Pessoas e conta" voltarPara="/" />
      <Erro>{erro}</Erro>
      <Ok>{ok}</Ok>

      <section className="cartao">
        <h2>Grupo</h2>
        {admin ? (
          <form onSubmit={renomear} className="form linha">
            <input value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} aria-label="Nome do grupo" />
            <button className="btn" disabled={ocupado || !nome.trim() || nome.trim() === grupo.nome}>Salvar</button>
          </form>
        ) : (
          <p><strong>{grupo.nome}</strong></p>
        )}
        {grupos.length > 1 && (
          <label>
            Trocar de grupo
            <select value={grupo.id} onChange={(e) => { escolher(e.target.value); navegar("/", true); }}>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>{g.nome}</option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="cartao">
        <h2>
          Pessoas <span className="suave">({membros.length} de {LIMITE})</span>
        </h2>
        <ul className="lista-pessoas">
          {membros.map((m) => (
            <li key={m.user_id}>
              <div>
                <strong>{m.perfil?.nome || m.perfil?.email}</strong>
                {m.user_id === eu && <span className="etiqueta">você</span>}
                {m.user_id === grupo.dono_id && <span className="etiqueta">criou o grupo</span>}
                <div className="suave pequeno">{m.perfil?.email}</div>
              </div>
              {m.user_id !== grupo.dono_id && (m.user_id === eu || admin) && (
                <button className="btn texto perigo" disabled={ocupado} onClick={() => remover(m)}>
                  {m.user_id === eu ? "Sair" : "Remover"}
                </button>
              )}
            </li>
          ))}
          {convites.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{c.email}</strong>
                <span className="etiqueta aguardando">convite pendente</span>
              </div>
              <button
                className="btn texto perigo"
                disabled={ocupado}
                onClick={() => confirm(`Cancelar o convite para ${c.email}?`) && executar(() => supabase.from("convites").delete().eq("id", c.id), "Convite cancelado.")}
              >
                Cancelar
              </button>
            </li>
          ))}
        </ul>

        {admin &&
          (vagas > 0 ? (
            <form onSubmit={convidar} className="form">
              <label>
                Convidar pelo e-mail
                <input type="email" required placeholder="email@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <button className="btn primario" disabled={ocupado}>Convidar</button>
              <small className="suave">
                Ainda {vagas === 1 ? "cabe 1 pessoa" : `cabem ${vagas} pessoas`}.
              </small>
            </form>
          ) : (
            <p className="suave">O grupo está completo ({LIMITE} pessoas, contando convites pendentes).</p>
          ))}
      </section>

      <section className="cartao">
        <h2>Tamanho da letra</h2>
        <div className="segmentado tres" role="radiogroup" aria-label="Tamanho da letra">
          {([["normal", "A", "Normal"], ["grande", "A+", "Grande"], ["muito-grande", "A++", "Muito grande"]] as const).map(([v, r, nome]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={letra === v}
              aria-label={nome}
              className={`${letra === v ? "ativo" : ""} letra-${v}`}
              onClick={() => { aplicarTamanhoLetra(v); setLetra(v); }}
            >
              {r}
            </button>
          ))}
        </div>
        <p className="suave pequeno">Vale só para este celular.</p>
      </section>

      <section className="cartao">
        <h2>Contas de todo mês</h2>
        <p className="suave">Luz, água, aluguel… as contas que aparecem todo mês para marcar como pagas.</p>
        <a className="btn" href="#/contas-fixas">Ver e mudar a lista</a>
      </section>

      <section className="cartao">
        <h2>Minha conta</h2>
        <p className="suave">{sessao?.user.email}</p>
        <div className="coluna-botoes">
          <a className="btn" href="#/nova-senha">Trocar senha</a>
          <a className="btn" href="#/boas-vindas">Criar outro grupo / ver convites</a>
          <button className="btn perigo" onClick={() => supabase.auth.signOut()}>Sair da conta</button>
        </div>
      </section>
    </main>
  );
}
