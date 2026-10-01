/**
 * Reduz fotos de comprovante antes do envio (máx. 1600px, JPEG 80%).
 * Um comprovante de 4 MB da câmera vira ~200-400 KB, ainda bem legível.
 * PDFs e formatos que o navegador não consegue abrir vão como estão.
 */
export async function prepararArquivo(f: File): Promise<{ blob: Blob; ext: string; tipo: string }> {
  const original = extensaoPermitida(f);
  if (original === "pdf") return { blob: f, ext: "pdf", tipo: TIPOS.pdf };

  // qualquer imagem que o navegador abre (inclusive GIF, AVIF, BMP) vira JPEG
  if (original || f.type.startsWith("image/")) {
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
      if (blob && (blob.size < f.size || !original)) return { blob, ext: "jpg", tipo: TIPOS.jpg };
    } catch {
      // ex.: HEIC em navegador sem suporte — envia o original, se for aceito
    }
  }
  if (!original) throw new Error("mime type não aceito");
  return { blob: f, ext: original, tipo: TIPOS[original] };
}

/** Os mesmos formatos aceitos pelo bucket e pela política do Storage. */
const TIPOS: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

/**
 * A extensão sai do tipo do arquivo; quando o celular não informa um tipo
 * útil (vazio ou "application/octet-stream"), sai do nome.
 */
function extensaoPermitida(f: File): string | null {
  const tipo = f.type === "image/jpg" ? "image/jpeg" : f.type;
  const porTipo = Object.entries(TIPOS).find(([, t]) => t === tipo)?.[0];
  if (porTipo) return porTipo;
  if (tipo && tipo !== "application/octet-stream") return null;
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  const normal = ext === "jpeg" ? "jpg" : ext;
  return normal in TIPOS ? normal : null;
}

export const LIMITE_BYTES = 5 * 1024 * 1024;
