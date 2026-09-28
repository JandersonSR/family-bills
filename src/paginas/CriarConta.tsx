import { useState, type FormEvent } from "react";
import { supabase, mensagemErro } from "../lib/supabase";
import { CampoSenha, Erro, Ok, Topo } from "../componentes/comuns";

export default function CriarConta() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (senha.length < 6) return setErro("A senha precisa ter pelo menos 6 caracteres.");
    if (senha !== senha2) return setErro("As duas senhas estão diferentes.");
    setEnviando(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha,
      options: {
        data: { nome: nome.trim() },
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    setEnviando(false);
    if (error) return setErro(mensagemErro(error));
    if (!data.session) {
      setOk(`Quase lá! Enviamos um e-mail para ${email.trim()}. Abra a mensagem e toque no link para confirmar sua conta.`);
    }
  }

  return (
    <main className="pagina estreita">
      <Topo titulo="Criar conta" voltarPara="/" />
      {ok ? (
        <>
          <Ok>{ok}</Ok>
          <a className="btn grande" href="#/">Voltar para entrar</a>
        </>
      ) : (
        <form onSubmit={criar} className="form">
          <label>
            Seu nome
            <input autoComplete="name" required value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
          <label>
            E-mail
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <small className="suave">Se você recebeu um convite, use o mesmo e-mail do convite.</small>
          </label>
          <label>
            Senha (mínimo 6 caracteres)
            <CampoSenha autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          </label>
          <label>
            Repita a senha
            <CampoSenha autoComplete="new-password" required value={senha2} onChange={(e) => setSenha2(e.target.value)} />
          </label>
          <Erro>{erro}</Erro>
          <button className="btn primario grande" disabled={enviando}>
            {enviando ? "Criando…" : "Criar conta"}
          </button>
        </form>
      )}
    </main>
  );
}
