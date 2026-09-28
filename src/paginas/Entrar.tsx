import { useState, type FormEvent } from "react";
import { supabase, mensagemErro } from "../lib/supabase";
import { CampoSenha, Erro } from "../componentes/comuns";

export default function Entrar() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(false);
    if (error) setErro(mensagemErro(error));
  }

  return (
    <main className="pagina estreita">
      <div className="marca">
        <img src="./icone-192.png" alt="" width={72} height={72} />
        <h1>Contas da Família</h1>
        <p className="suave">Dinheiro enviado, contas pagas e o que sobrou.</p>
      </div>
      <form onSubmit={entrar} className="form">
        <label>
          E-mail
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Senha
          <CampoSenha autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        <Erro>{erro}</Erro>
        <button className="btn primario grande" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
      <nav className="links-rodape">
        <a href="#/esqueci-senha">Esqueci minha senha</a>
        <a href="#/criar-conta">Criar uma conta</a>
      </nav>
    </main>
  );
}
