export type Tipo = "deposito" | "pagamento";
export type Status = "pago" | "pendente";

export interface Lancamento {
  id: string;
  grupo_id: string;
  tipo: Tipo;
  descricao: string;
  valor_centavos: number;
  data: string; // YYYY-MM-DD
  status: Status;
  comprovante_path: string | null;
  criado_por: string | null;
  created_at: string;
  /** false = conta paga com outro dinheiro; não entra no saldo */
  no_orcamento: boolean;
  /** baixa de uma conta fixa */
  conta_fixa_id: string | null;
  mes_referencia: string | null; // YYYY-MM-01
  autor?: { nome: string; email: string } | null;
}

export interface ContaFixa {
  id: string;
  grupo_id: string;
  descricao: string;
  valor_centavos: number | null; // null = valor muda todo mês
  dia_vencimento: number;
  no_orcamento: boolean;
  desde_mes: string;
  ate_mes: string | null;
}

/** Uma conta que precisa ser paga: fixa (ainda sem baixa) ou avulsa ("Ainda vou pagar"). */
export interface ContaAPagar {
  chave: string;
  descricao: string;
  vencimento: string; // YYYY-MM-DD
  valor_centavos: number | null;
  mes_referencia: string;
  fixa: ContaFixa | null;
  avulsa: Lancamento | null;
}

/** Linha da lista "Contas do mês". */
export interface ItemContaMes {
  chave: string;
  descricao: string;
  vencimento: string;
  valor_centavos: number | null;
  situacao: "paga" | "a_vencer" | "vence_hoje" | "atrasada";
  pagamento: Lancamento | null; // quando paga
  aPagar: ContaAPagar | null; // quando não paga
  noOrcamento: boolean;
}

export interface ResumoMensal {
  mes: string; // YYYY-MM-01
  entradas_centavos: number;
  saidas_centavos: number;
}

export interface GrupoInfo {
  id: string;
  nome: string;
  dono_id: string;
  papel: "admin" | "membro";
}

export interface Membro {
  user_id: string;
  papel: "admin" | "membro";
  perfil: { nome: string; email: string } | null;
}

export interface Convite {
  id: string;
  email: string;
  created_at: string;
}

export interface MeuConvite {
  id: string;
  grupo_id: string;
  grupo_nome: string;
  convidado_por: string;
}
