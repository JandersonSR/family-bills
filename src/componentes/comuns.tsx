import { useState, type ReactNode, type InputHTMLAttributes } from "react";
import { voltar } from "../lib/rotas";

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="centro">
      <div className="spinner" aria-hidden />
      <p className="suave">{texto}</p>
    </div>
  );
}

export function Topo({
  titulo,
  voltarPara,
  direita,
}: {
  titulo: string;
  voltarPara?: string;
  direita?: ReactNode;
}) {
  return (
    <header className="topo">
      {voltarPara !== undefined ? (
        <button className="btn-icone" onClick={() => voltar(voltarPara)} aria-label="Voltar">
          ‹
        </button>
      ) : (
        <span className="btn-icone-vazio" />
      )}
      <h1>{titulo}</h1>
      {direita ?? <span className="btn-icone-vazio" />}
    </header>
  );
}

export function Erro({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="alerta erro" role="alert">
      {children}
    </div>
  );
}

export function Ok({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="alerta ok" role="status">
      {children}
    </div>
  );
}

/** Campo de valor em reais: a pessoa digita só números, como no app do banco. */
export function CampoDinheiro({
  centavos,
  onChange,
  id,
}: {
  centavos: number;
  onChange: (c: number) => void;
  id?: string;
}) {
  const texto = (centavos / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <div className="campo-dinheiro">
      <span>R$</span>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={texto}
        onChange={(e) => {
          const digitos = e.target.value.replace(/\D/g, "").slice(0, 11);
          onChange(Number(digitos || "0"));
        }}
        onFocus={(e) => {
          const el = e.target;
          requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
        }}
      />
      {centavos > 0 && (
        <button type="button" className="limpar" aria-label="Apagar o valor" onClick={() => onChange(0)}>
          ✕
        </button>
      )}
    </div>
  );
}

export function CampoSenha(props: InputHTMLAttributes<HTMLInputElement>) {
  const [ver, setVer] = useState(false);
  return (
    <div className="campo-senha">
      <input {...props} type={ver ? "text" : "password"} />
      <button type="button" className="link" onClick={() => setVer(!ver)}>
        {ver ? "Esconder" : "Mostrar"}
      </button>
    </div>
  );
}
