/** Mensagem curta de confirmação ("Salvo!") mostrada no topo da tela. */
const alvo = new EventTarget();

export function avisar(texto: string) {
  alvo.dispatchEvent(new CustomEvent("aviso", { detail: texto }));
}

export function ouvirAvisos(f: (texto: string) => void): () => void {
  const h = (e: Event) => f((e as CustomEvent<string>).detail);
  alvo.addEventListener("aviso", h);
  return () => alvo.removeEventListener("aviso", h);
}
