import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import type { GrupoInfo } from "../lib/tipos";
import { useAuth } from "./Auth";

interface GrupoCtx {
  grupos: GrupoInfo[];
  grupo: GrupoInfo | null;
  carregando: boolean;
  erro: string | null;
  escolher: (id: string) => void;
  recarregar: () => Promise<void>;
}

const Ctx = createContext<GrupoCtx>(null as unknown as GrupoCtx);
const CHAVE = "contas.grupoAtual";

function lerPreferido(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export function GrupoProvider({ children }: { children: ReactNode }) {
  const { sessao } = useAuth();
  const uid = sessao?.user.id;
  const [grupos, setGrupos] = useState<GrupoInfo[]>([]);
  const [atualId, setAtualId] = useState<string | null>(lerPreferido());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    if (!uid) {
      setGrupos([]);
      setCarregando(false);
      return;
    }
    const { data, error } = await supabase
      .from("membros")
      .select("papel, grupos(id, nome, dono_id)")
      .eq("user_id", uid);
    if (error) {
      setErro(error.message);
    } else {
      setErro(null);
      type Linha = { papel: GrupoInfo["papel"]; grupos: Omit<GrupoInfo, "papel"> | null };
      const lista = ((data ?? []) as unknown as Linha[])
        .filter((l) => l.grupos)
        .map((l) => ({ ...l.grupos!, papel: l.papel }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setGrupos(lista);
    }
    setCarregando(false);
  }, [uid]);

  useEffect(() => {
    setCarregando(true);
    recarregar();
  }, [recarregar]);

  const escolher = (id: string) => {
    setAtualId(id);
    try {
      localStorage.setItem(CHAVE, id);
    } catch {
      /* sem armazenamento: tudo bem */
    }
  };

  const grupo = grupos.find((g) => g.id === atualId) ?? grupos[0] ?? null;

  return (
    <Ctx.Provider value={{ grupos, grupo, carregando, erro, escolher, recarregar }}>
      {children}
    </Ctx.Provider>
  );
}

export const useGrupo = () => useContext(Ctx);
