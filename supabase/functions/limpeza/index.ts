// Edge Function: limpeza diária
// 1) chama a RPC limpar_lancamentos_antigos (apaga lançamentos com mais de
//    MESES_RETENCAO meses, preservando os resumos mensais). Os caminhos dos
//    comprovantes vão para a fila arquivos_a_apagar;
// 2) apaga esses arquivos pelo Storage API e tira da fila só o que foi
//    apagado. O que falhar volta na próxima execução.
//
// Deploy:  supabase functions deploy limpeza --no-verify-jwt
// Segredo: supabase secrets set LIMPEZA_SECRET="$(openssl rand -hex 32)"   (mínimo 32 caracteres)
// Chamada: POST /functions/v1/limpeza  com header  x-limpeza-secret: <segredo>
import { createClient } from "npm:@supabase/supabase-js@2";

const MESES_MAX = 120;
const LOTE = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Compara em tempo constante para não vazar o segredo pelo tempo de resposta. */
function segredoConfere(recebido: string | null, esperado: string): boolean {
  const a = new TextEncoder().encode(recebido ?? "");
  const b = new TextEncoder().encode(esperado);
  let diferenca = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diferenca |= (a[i] ?? 0) ^ b[i];
  return diferenca === 0;
}

/** Um erro de digitação (ex.: "6m" ou "0") apagaria quase todo o histórico: recusa. */
function mesesRetencao(): number | null {
  const bruto = (Deno.env.get("MESES_RETENCAO") ?? "6").trim();
  if (!/^\d+$/.test(bruto)) return null;
  const n = Number(bruto);
  return n >= 1 && n <= MESES_MAX ? n : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "método não permitido" }, 405);

  const segredo = Deno.env.get("LIMPEZA_SECRET");
  if (!segredo || segredo.length < 32) {
    console.error("LIMPEZA_SECRET ausente ou com menos de 32 caracteres: limpeza desativada.");
    return json({ erro: "função mal configurada" }, 500);
  }
  if (!segredoConfere(req.headers.get("x-limpeza-secret"), segredo)) {
    return json({ erro: "não autorizado" }, 401);
  }

  const meses = mesesRetencao();
  if (meses === null) {
    console.error(`MESES_RETENCAO inválido (use um inteiro entre 1 e ${MESES_MAX}): limpeza cancelada.`);
    return json({ erro: "função mal configurada" }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase.rpc("limpar_lancamentos_antigos", { p_meses: meses });
  if (error) {
    console.error("limpar_lancamentos_antigos:", error);
    return json({ erro: "falha na limpeza" }, 500);
  }

  const caminhos = (data as { caminho: string }[]).map((r) => r.caminho);
  let falhas = 0;
  let apagados = 0;
  for (let i = 0; i < caminhos.length; i += LOTE) {
    const lote = caminhos.slice(i, i + LOTE);
    const { error: e } = await supabase.storage.from("comprovantes").remove(lote);
    if (e) {
      console.error("storage.remove:", e);
      falhas++;
      continue;
    }
    // arquivo que já não existia também sai da fila
    const { error: eFila } = await supabase.from("arquivos_a_apagar").delete().in("caminho", lote);
    if (eFila) {
      console.error("arquivos_a_apagar:", eFila);
      falhas++;
      continue;
    }
    apagados += lote.length;
  }

  return json({
    meses_retidos: meses,
    comprovantes_na_fila: caminhos.length,
    arquivos_apagados: apagados,
    lotes_com_falha: falhas,
  }, falhas ? 500 : 200);
});
