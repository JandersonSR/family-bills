-- =====================================================================
-- Contas fixas mensais + "entra no orçamento?" + referência mensal
-- =====================================================================

-- ---------------------------------------------------------------------
-- Contas fixas (ex.: Luz, vence dia 10). Não são apagadas pela limpeza.
-- Cada mês elas aparecem como uma lista para "dar baixa".
-- ---------------------------------------------------------------------
create table public.contas_fixas (
  id              uuid primary key default gen_random_uuid(),
  grupo_id        uuid not null references public.grupos (id) on delete cascade,
  descricao       text not null check (char_length(trim(descricao)) between 1 and 120),
  -- valor aproximado; nulo quando varia muito (a pessoa digita ao pagar)
  valor_centavos  bigint check (valor_centavos is null or valor_centavos > 0),
  dia_vencimento  int not null check (dia_vencimento between 1 and 31),
  no_orcamento    boolean not null default true,
  desde_mes       date not null default date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
                  check (extract(day from desde_mes) = 1),
  ate_mes         date check (ate_mes is null or extract(day from ate_mes) = 1),
  criado_por      uuid default auth.uid() references public.perfis (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint periodo_valido check (ate_mes is null or ate_mes >= date_trunc('month', desde_mes)::date - interval '1 month')
);
create index contas_fixas_grupo_idx on public.contas_fixas (grupo_id);

alter table public.contas_fixas enable row level security;
create policy "contas_fixas: membros veem" on public.contas_fixas
  for select to authenticated using (is_membro(grupo_id));
create policy "contas_fixas: membros criam" on public.contas_fixas
  for insert to authenticated with check (is_membro(grupo_id));
create policy "contas_fixas: membros editam" on public.contas_fixas
  for update to authenticated using (is_membro(grupo_id)) with check (is_membro(grupo_id));
create policy "contas_fixas: membros apagam" on public.contas_fixas
  for delete to authenticated using (is_membro(grupo_id));

-- ---------------------------------------------------------------------
-- Novos campos nos lançamentos
-- ---------------------------------------------------------------------
alter table public.lancamentos
  -- "Incluir o valor desta conta no orçamento do mês?" (padrão: sim)
  add column no_orcamento boolean not null default true,
  -- baixa de uma conta fixa: qual conta e de qual mês (pode ser paga em outro mês)
  add column conta_fixa_id uuid references public.contas_fixas (id) on delete set null,
  add column mes_referencia date check (mes_referencia is null or extract(day from mes_referencia) = 1),
  add constraint deposito_sempre_no_orcamento check (tipo = 'pagamento' or no_orcamento),
  add constraint baixa_tem_mes check (conta_fixa_id is null or mes_referencia is not null);

-- a mesma conta fixa não pode ter duas baixas no mesmo mês
-- (evita que duas pessoas registrem o mesmo pagamento)
create unique index lancamentos_baixa_unica
  on public.lancamentos (conta_fixa_id, mes_referencia)
  where conta_fixa_id is not null;

-- ---------------------------------------------------------------------
-- Resumo: só entra quem está pago E no orçamento
-- ---------------------------------------------------------------------
create or replace function public.atualizar_resumo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.limpeza', true), '') = 'on' then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'pago' and old.no_orcamento then
    perform somar_resumo(old.grupo_id, old.data, old.tipo, -old.valor_centavos);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'pago' and new.no_orcamento then
    perform somar_resumo(new.grupo_id, new.data, new.tipo, new.valor_centavos);
  end if;
  return null;
end $$;

-- a conta fixa precisa ser do mesmo grupo do lançamento
create or replace function public.checar_conta_fixa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.conta_fixa_id is not null and not exists (
    select 1 from contas_fixas where id = new.conta_fixa_id and grupo_id = new.grupo_id
  ) then
    raise exception 'Conta fixa inválida para este grupo.';
  end if;
  return new;
end $$;

create trigger lancamentos_conta_fixa
  before insert or update of conta_fixa_id on public.lancamentos
  for each row execute function public.checar_conta_fixa();
