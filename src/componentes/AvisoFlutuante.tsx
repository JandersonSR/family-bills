import { useEffect, useState } from "react";
import { ouvirAvisos } from "../lib/aviso";

/** Mostra "✓ Salvo!" por alguns segundos depois de uma ação. */
export function AvisoFlutuante() {
  const [texto, setTexto] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const parar = ouvirAvisos((msg) => {
      setTexto(msg);
      clearTimeout(t);
      t = setTimeout(() => setTexto(null), 3500);
    });
    return () => {
      parar();
      clearTimeout(t);
    };
  }, []);
  if (!texto) return null;
  return (
    <div className="aviso-flutuante" role="status" aria-live="polite" onClick={() => setTexto(null)}>
      {texto}
    </div>
  );
}
