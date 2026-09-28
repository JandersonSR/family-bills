import { useState, type FormEvent } from "react";
import { supabase, mensagemErro } from "../lib/supabase";
import { Erro, Ok, Topo } from "../componentes/comuns";

export default function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + window.location.pathname,
    });
    setEnviando(false);
    if (error) setErro(mensagemErro(error));
    else setOk("Pronto! Se existir uma conta com esse e-mail, vai chegar uma mensagem com um link para criar uma senha nova.");
  }

  return (
    <main className="pagina estreita">
      <Topo titulo="Esqueci a senha" voltarPara="/" />
      {ok ? (
        <>
          <Ok>{ok}</Ok>
          <a className="btn grande" href="#/">Voltar para entrar</a>
        </>
      ) : (
        <form onSubmit={enviar} className="form">
          <p>Digite seu e-mail. Vamos mandar um link para você criar uma senha nova.</p>
          <label>
            E-mail
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <Erro>{erro}</Erro>
          <button className="btn primario grande" disabled={enviando}>
            {enviando ? "Enviando…" : "Enviar link"}
          </button>
        </form>
      )}
    </main>
  );
}
