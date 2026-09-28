/**
 * Reduz fotos de comprovante antes do envio (máx. 1600px, JPEG 80%).
 * Um comprovante de 4 MB da câmera vira ~200-400 KB, ainda bem legível.
 * PDFs e formatos que o navegador não consegue abrir vão como estão.
 */
export async function prepararArquivo(f: File): Promise<{ blob: Blob; ext: string; tipo: string }> {
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  if (f.type === "application/pdf") return { blob: f, ext: "pdf", tipo: f.type };
  if (!f.type.startsWith("image/")) return { blob: f, ext: ext || "bin", tipo: f.type };

  try {
    const bmp = await createImageBitmap(f);
    const MAX = 1600;
    const escala = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * escala);
    const h = Math.round(bmp.height * escala);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.8));
    if (blob && blob.size < f.size) return { blob, ext: "jpg", tipo: "image/jpeg" };
  } catch {
    // ex.: HEIC em navegador sem suporte — envia o original
  }
  return { blob: f, ext: ext || "jpg", tipo: f.type };
}

export const LIMITE_BYTES = 5 * 1024 * 1024;
