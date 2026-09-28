// Edge Function: limpeza diária
// 1) chama a RPC limpar_lancamentos_antigos (apaga lançamentos com mais de
//    MESES_RETENCAO meses, preservando os resumos mensais);
// 2) apaga os comprovantes desses lançamentos pelo Storage API.
//
// Deploy:  supabase functions deploy limpeza --no-verify-jwt
// Segredo: supabase secrets set LIMPEZA_SECRET=<um-texto-aleatorio-longo>
// Chamada: POST /functions/v1/limpeza  com header  x-limpeza-secret: <segredo>
import { createClient } from "npm:@supabase/supabase-js@2";

const MESES_RETENCAO = Number(Deno.env.get("MESES_RETENCAO") ?? "6");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const segredo = Deno.env.get("LIMPEZA_SECRET");
  if (!segredo || req.headers.get("x-limpeza-secret") !== segredo) {
    return json({ erro: "não autorizado" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase.rpc("limpar_lancamentos_antigos", {
    p_meses: MESES_RETENCAO,
  });
  if (error) return json({ erro: error.message }, 500);

  const caminhos = (data as { caminho: string }[]).map((r) => r.caminho);
  const falhas: string[] = [];
  let apagados = 0;
  for (let i = 0; i < caminhos.length; i += 100) {
    const lote = caminhos.slice(i, i + 100);
    const { data: removidos, error: e } = await supabase.storage
      .from("comprovantes")
      .remove(lote);
    if (e) falhas.push(e.message);
    else apagados += removidos?.length ?? 0;
  }

  return json({
    meses_retidos: MESES_RETENCAO,
    comprovantes_encontrados: caminhos.length,
    arquivos_apagados: apagados,
    falhas,
  }, falhas.length ? 500 : 200);
});
