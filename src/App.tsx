import { AuthProvider, useAuth } from "./contexto/Auth";
import { GrupoProvider, useGrupo } from "./contexto/Grupo";
import { configurado } from "./lib/supabase";
import { useRota } from "./lib/rotas";
import { Carregando, Erro } from "./componentes/comuns";
import Entrar from "./paginas/Entrar";
import CriarConta from "./paginas/CriarConta";
import EsqueciSenha from "./paginas/EsqueciSenha";
import NovaSenha from "./paginas/NovaSenha";
import BoasVindas from "./paginas/BoasVindas";
import Mes from "./paginas/Mes";
import Registro from "./paginas/Registro";
import Ano from "./paginas/Ano";
import Grupo from "./paginas/Grupo";
import Relatorio from "./paginas/Relatorio";
import { ListaContasFixas, EditarContaFixa } from "./paginas/ContasFixas";
import { AvisoFlutuante } from "./componentes/AvisoFlutuante";

export default function App() {
  if (!configurado) {
    return (
      <main className="pagina">
        <h1>Falta configurar</h1>
        <p>
          Crie o arquivo <code>.env</code> com <code>VITE_SUPABASE_URL</code> e{" "}
          <code>VITE_SUPABASE_KEY</code> (veja <code>.env.example</code>) e rode o app de novo.
        </p>
      </main>
    );
  }
  return (
    <AuthProvider>
      <GrupoProvider>
        <Rotas />
        <AvisoFlutuante />
      </GrupoProvider>
    </AuthProvider>
  );
}

function Rotas() {
  const { sessao, carregando } = useAuth();
  const { partes } = useRota();
  const [p0, p1] = partes;

  if (carregando) return <Carregando />;

  if (!sessao) {
    if (p0 === "criar-conta") return <CriarConta />;
    if (p0 === "esqueci-senha") return <EsqueciSenha />;
    return <Entrar />;
  }

  if (p0 === "nova-senha") return <NovaSenha />;
  return <AreaLogada p0={p0} p1={p1} />;
}

function AreaLogada({ p0, p1 }: { p0?: string; p1?: string }) {
  const { grupo, carregando, erro } = useGrupo();
  const { params } = useRota();
  if (carregando) return <Carregando />;
  if (erro)
    return (
      <main className="pagina">
        <Erro>Não foi possível carregar seus dados: {erro}</Erro>
      </main>
    );
  if (!grupo || p0 === "boas-vindas") return <BoasVindas />;

  switch (p0) {
    case "novo":
      return <Registro key={`novo-${p1}-${params.get("fixa") ?? ""}-${params.get("ref") ?? ""}`} tipoNovo={p1 === "deposito" ? "deposito" : "pagamento"} />;
    case "registro":
      return <Registro key={p1} id={p1} />;
    case "ano":
      return <Ano />;
    case "grupo":
      return <Grupo />;
    case "relatorio":
      return <Relatorio />;
    case "contas-fixas":
      return p1 === "nova" ? <EditarContaFixa key="nova" /> : p1 ? <EditarContaFixa key={p1} id={p1} /> : <ListaContasFixas />;
    default:
      return <Mes />;
  }
}
