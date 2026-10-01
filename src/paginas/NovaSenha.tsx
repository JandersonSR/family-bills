import { useState, type FormEvent } from "react";
import { supabase, mensagemErro } from "../lib/supabase";
import { navegar } from "../lib/rotas";
import { CampoSenha, Erro, Topo } from "../componentes/comuns";

export default function NovaSenha() {
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (senha.length < 8) return setErro("A senha precisa ter pelo menos 8 caracteres.");
    if (senha !== senha2) return setErro("As duas senhas estão diferentes.");
    setEnviando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setEnviando(false);
    if (error) return setErro(mensagemErro(error));
    alert("Senha alterada!");
    navegar("/", true);
  }

  return (
    <main className="pagina estreita">
      <Topo titulo="Nova senha" voltarPara="/" />
      <form onSubmit={salvar} className="form">
        <label>
          Nova senha (mínimo 8 caracteres)
          <CampoSenha autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        <label>
          Repita a nova senha
          <CampoSenha autoComplete="new-password" required value={senha2} onChange={(e) => setSenha2(e.target.value)} />
        </label>
        <Erro>{erro}</Erro>
        <button className="btn primario grande" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar senha"}
        </button>
      </form>
    </main>
  );
}
