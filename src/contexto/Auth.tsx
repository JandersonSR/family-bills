import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { navegar } from "../lib/rotas";

interface AuthCtx {
  sessao: Session | null;
  carregando: boolean;
}

const Ctx = createContext<AuthCtx>({ sessao: null, carregando: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      setCarregando(false);
    });
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      // não chamar outras funções do supabase aqui dentro (pode travar)
      setSessao(s);
      setCarregando(false);
      if (evento === "PASSWORD_RECOVERY") setTimeout(() => navegar("/nova-senha", true), 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <Ctx.Provider value={{ sessao, carregando }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
