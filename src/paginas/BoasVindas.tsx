import { useEffect, useState, type FormEvent } from "react";
import { supabase, mensagemErro } from "../lib/supabase";
import { useGrupo } from "../contexto/Grupo";
import { useAuth } from "../contexto/Auth";
import { navegar } from "../lib/rotas";
import type { MeuConvite } from "../lib/tipos";
import { Erro, Topo } from "../componentes/comuns";

export default function BoasVindas() {
  const { sessao } = useAuth();
  const { grupos, recarregar, escolher } = useGrupo();
  const [convites, setConvites] = useState<MeuConvite[]>([]);
  const [nome, setNome] = useState("Contas da Mãe");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    const { data, error } = await supabase.rpc("meus_convites");
    if (error) setErro(mensagemErro(error));
    else setConvites((data ?? []) as MeuConvite[]);
  }
  useEffect(() => {
    carregar();
  }, []);

  async function aceitar(c: MeuConvite) {
    setOcupado(true);
    const { error } = await supabase.rpc("aceitar_convite", { p_convite: c.id });
    setOcupado(false);
    if (error) return setErro(mensagemErro(error));
    escolher(c.grupo_id);
    await recarregar();
    navegar("/", true);
  }

  async function recusar(c: MeuConvite) {
    if (!confirm(`Recusar o convite para "${c.grupo_nome}"?`)) return;
    const { error } = await supabase.from("convites").delete().eq("id", c.id);
    if (error) setErro(mensagemErro(error));
    carregar();
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    const { data, error } = await supabase.rpc("criar_grupo", { p_nome: nome });
    setOcupado(false);
    if (error) return setErro(mensagemErro(error));
    escolher(data as string);
    await recarregar();
    navegar("/grupo", true);
  }

  return (
    <main className="pagina estreita">
      <Topo titulo="Bem-vindo(a)!" voltarPara={grupos.length ? "/" : undefined} />
      <Erro>{erro}</Erro>

      {convites.length > 0 && (
        <section className="cartao">
          <h2>Você foi convidado(a)</h2>
          {convites.map((c) => (
            <div key={c.id} className="convite">
              <p>
                <strong>{c.convidado_por}</strong> chamou você para o grupo <strong>{c.grupo_nome}</strong>.
              </p>
              <div className="linha-botoes">
                <button className="btn primario" disabled={ocupado} onClick={() => aceitar(c)}>
                  Aceitar
                </button>
                <button className="btn" disabled={ocupado} onClick={() => recusar(c)}>
                  Recusar
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="cartao">
        <h2>{convites.length ? "Ou crie um grupo novo" : "Crie seu grupo"}</h2>
        <p className="suave">
          O grupo é onde ficam os registros. Depois você pode chamar até 3 pessoas para participar.
        </p>
        {convites.length === 0 && (
          <p className="suave">
            Estava esperando um convite? Peça para a pessoa convidar o e-mail <strong>{sessao?.user.email}</strong>{" "}
            e <button className="link" onClick={carregar}>toque aqui para atualizar</button>.
          </p>
        )}
        <form onSubmit={criar} className="form">
          <label>
            Nome do grupo
            <input required maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
          <button className="btn primario grande" disabled={ocupado}>
            Criar grupo
          </button>
        </form>
      </section>

      <button className="btn texto" onClick={() => supabase.auth.signOut()}>
        Sair da conta
      </button>
    </main>
  );
}
