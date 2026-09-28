import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

export const configurado = Boolean(url && chave);

export const supabase: SupabaseClient = configurado
  ? createClient(url!, chave!, {
      auth: {
        // "implicit" em vez de PKCE: o link do e-mail (confirmar conta,
        // recuperar senha) funciona mesmo se for aberto em outro navegador,
        // como o navegador interno do app de e-mail. O roteador ignora o
        // #access_token=... que volta na URL.
        flowType: "implicit",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : (null as unknown as SupabaseClient);

export const BUCKET = "comprovantes";

/** Traduz as mensagens de erro mais comuns para português simples. */
export function mensagemErro(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  const mapa: [RegExp, string][] = [
    [/invalid login credentials/i, "E-mail ou senha incorretos."],
    [/email not confirmed/i, "Você ainda não confirmou seu e-mail. Veja a mensagem que enviamos para sua caixa de entrada."],
    [/already registered|already been registered/i, "Já existe uma conta com este e-mail. Tente entrar."],
    [/password should be at least|weak password/i, "A senha precisa ter pelo menos 6 caracteres."],
    [/rate limit|too many/i, "Muitas tentativas seguidas. Espere alguns minutos e tente de novo."],
    [/failed to fetch|network/i, "Sem conexão com a internet. Verifique e tente de novo."],
    [/payload too large|exceeded the maximum/i, "O arquivo é grande demais (máximo 5 MB)."],
    [/mime type/i, "Tipo de arquivo não aceito. Use foto (JPG/PNG) ou PDF."],
    [/row-level security|permission denied/i, "Você não tem permissão para fazer isso."],
    [/same_password|different from the old/i, "A nova senha precisa ser diferente da atual."],
    [/lancamentos_baixa_unica|duplicate key/i, "Essa conta já foi marcada como paga neste mês (talvez por outra pessoa). Volte e confira a lista."],
  ];
  for (const [re, txt] of mapa) if (re.test(msg)) return txt;
  return msg;
}
