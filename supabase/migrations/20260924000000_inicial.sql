-- =====================================================================
-- Contas da Família — esquema inicial (Supabase / Postgres)
--
-- Conceitos:
--   * grupo       = a "sessão compartilhada" de registros (até 4 pessoas)
--   * lancamento  = um depósito (dinheiro enviado) ou um pagamento (conta)
--   * resumos_mensais = totais por mês, mantidos por trigger. Continuam
--     existindo depois que os lançamentos antigos são apagados, e é deles
--     que saem o saldo acumulado e o saldo do ano.
--
-- Pode ser rodado com `supabase db push` ou colado no SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuração
-- ---------------------------------------------------------------------
create or replace function public.limite_membros() returns int
language sql immutable as $$ select 4 $$;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table public.perfis (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text not null default '',
  email      text not null,
  created_at timestamptz not null default now()
);

create table public.grupos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (char_length(trim(nome)) between 1 and 60),
  dono_id    uuid not null references public.perfis (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.membros (
  grupo_id   uuid not null references public.grupos (id) on delete cascade,
  user_id    uuid not null references public.perfis (id) on delete cascade,
  papel      text not null default 'membro' check (papel in ('admin', 'membro')),
  created_at timestamptz not null default now(),
  primary key (grupo_id, user_id)
);
create index membros_user_idx on public.membros (user_id);

create table public.convites (
  id         uuid primary key default gen_random_uuid(),
  grupo_id   uuid not null references public.grupos (id) on delete cascade,
  email      text not null check (email = lower(trim(email))),
  criado_por uuid not null references public.perfis (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (grupo_id, email)
);
create index convites_email_idx on public.convites (email);

create table public.lancamentos (
  id               uuid primary key default gen_random_uuid(),
  grupo_id         uuid not null references public.grupos (id) on delete cascade,
  tipo             text not null check (tipo in ('deposito', 'pagamento')),
  descricao        text not null check (char_length(trim(descricao)) between 1 and 120),
  valor_centavos   bigint not null check (valor_centavos > 0),
  -- pago: data do pagamento/depósito | pendente: data de vencimento
  data             date not null,
  status           text not null default 'pago' check (status in ('pago', 'pendente')),
  comprovante_path text,
  criado_por       uuid default auth.uid() references public.perfis (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint deposito_sempre_pago check (tipo = 'pagamento' or status = 'pago')
);
create index lancamentos_grupo_data_idx on public.lancamentos (grupo_id, data);

create table public.resumos_mensais (
  grupo_id          uuid not null references public.grupos (id) on delete cascade,
  mes               date not null check (extract(day from mes) = 1),
  entradas_centavos bigint not null default 0,
  saidas_centavos   bigint not null default 0,
  primary key (grupo_id, mes)
);

-- ---------------------------------------------------------------------
-- Funções auxiliares de permissão (security definer evita recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_membro(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where grupo_id = g and user_id = auth.uid());
$$;

create or replace function public.is_admin(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros
                 where grupo_id = g and user_id = auth.uid() and papel = 'admin');
$$;

create or replace function public.compartilha_grupo(outro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membros eu
    join membros ele on ele.grupo_id = eu.grupo_id
    where eu.user_id = auth.uid() and ele.user_id = outro
  );
$$;

create or replace function public.meu_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- ---------------------------------------------------------------------
-- Perfil criado automaticamente no cadastro
-- ---------------------------------------------------------------------
create or replace function public.criar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, nome, email)
  values (new.id, coalesce(trim(new.raw_user_meta_data ->> 'nome'), ''), lower(new.email))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- ---------------------------------------------------------------------
-- Limite de pessoas por grupo (defesa extra além das RPCs)
-- ---------------------------------------------------------------------
create or replace function public.checar_limite_membros() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from membros where grupo_id = new.grupo_id) >= limite_membros() then
    raise exception 'O grupo já tem o limite de % pessoas.', limite_membros();
  end if;
  return new;
end $$;

create trigger membros_limite
  before insert on public.membros
  for each row execute function public.checar_limite_membros();

-- ---------------------------------------------------------------------
-- Resumo mensal mantido por trigger
--   Só lançamentos com status 'pago' entram nos totais.
--   Durante a limpeza automática (app.limpeza = on) o resumo NÃO é
--   alterado: os detalhes somem, os totais ficam.
-- ---------------------------------------------------------------------
create or replace function public.somar_resumo(g uuid, d date, t text, v bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into resumos_mensais (grupo_id, mes, entradas_centavos, saidas_centavos)
  select g, date_trunc('month', d)::date,
         case when t = 'deposito'  then v else 0 end,
         case when t = 'pagamento' then v else 0 end
  where exists (select 1 from grupos where id = g)   -- grupo sendo apagado
  on conflict (grupo_id, mes) do update set
    entradas_centavos = resumos_mensais.entradas_centavos + excluded.entradas_centavos,
    saidas_centavos   = resumos_mensais.saidas_centavos   + excluded.saidas_centavos;
end $$;
revoke execute on function public.somar_resumo(uuid, date, text, bigint) from public, anon, authenticated;

create or replace function public.atualizar_resumo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.limpeza', true), '') = 'on' then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'pago' then
    perform somar_resumo(old.grupo_id, old.data, old.tipo, -old.valor_centavos);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'pago' then
    perform somar_resumo(new.grupo_id, new.data, new.tipo, new.valor_centavos);
  end if;
  return null;
end $$;

create trigger lancamentos_resumo
  after insert or update or delete on public.lancamentos
  for each row execute function public.atualizar_resumo();

create or replace function public.tocar_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.grupo_id   := old.grupo_id;    -- lançamento não troca de grupo
  if new.criado_por is not null then
    new.criado_por := old.criado_por;  -- autoria não muda (exceto conta apagada)
  end if;
  return new;
end $$;

create trigger lancamentos_updated_at
  before update on public.lancamentos
  for each row execute function public.tocar_updated_at();

-- ---------------------------------------------------------------------
-- RPCs de grupo e convites
-- ---------------------------------------------------------------------
create or replace function public.criar_grupo(p_nome text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.'; end if;
  insert into grupos (nome, dono_id) values (trim(p_nome), auth.uid()) returning id into g;
  insert into membros (grupo_id, user_id, papel) values (g, auth.uid(), 'admin');
  return g;
end $$;

create or replace function public.convidar(p_grupo uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if not is_admin(p_grupo) then
    raise exception 'Só quem administra o grupo pode convidar.';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.';
  end if;
  perform 1 from grupos where id = p_grupo for update;  -- evita corrida
  if exists (select 1 from membros m join perfis p on p.id = m.user_id
             where m.grupo_id = p_grupo and p.email = e) then
    raise exception 'Essa pessoa já participa do grupo.';
  end if;
  if exists (select 1 from convites where grupo_id = p_grupo and email = e) then
    return;
  end if;
  if (select count(*) from membros  where grupo_id = p_grupo)
   + (select count(*) from convites where grupo_id = p_grupo) >= limite_membros() then
    raise exception 'O grupo já tem o limite de % pessoas (contando convites pendentes).', limite_membros();
  end if;
  insert into convites (grupo_id, email, criado_por) values (p_grupo, e, auth.uid());
end $$;

create or replace function public.meus_convites()
returns table (id uuid, grupo_id uuid, grupo_nome text, convidado_por text)
language sql stable security definer set search_path = public as $$
  select c.id, c.grupo_id, g.nome, coalesce(nullif(p.nome, ''), p.email)
  from convites c
  join grupos g on g.id = c.grupo_id
  join perfis p on p.id = c.criado_por
  where c.email = meu_email()
  order by c.created_at;
$$;

create or replace function public.aceitar_convite(p_convite uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c convites;
begin
  select * into c from convites where id = p_convite and email = meu_email();
  if not found then raise exception 'Convite não encontrado.'; end if;
  perform 1 from grupos where id = c.grupo_id for update;
  delete from convites where id = c.id;
  if not exists (select 1 from membros where grupo_id = c.grupo_id and user_id = auth.uid()) then
    insert into membros (grupo_id, user_id, papel) values (c.grupo_id, auth.uid(), 'membro');
  end if;
  return c.grupo_id;
end $$;

create or replace function public.remover_membro(p_grupo uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare dono uuid;
begin
  select dono_id into dono from grupos where id = p_grupo;
  if dono is null then raise exception 'Grupo não encontrado.'; end if;
  if p_user = dono then
    raise exception 'Quem criou o grupo não pode ser removido.';
  end if;
  if p_user <> auth.uid() and not is_admin(p_grupo) then
    raise exception 'Sem permissão.';
  end if;
  delete from membros where grupo_id = p_grupo and user_id = p_user;
end $$;

revoke execute on function public.criar_grupo(text)            from public, anon;
revoke execute on function public.convidar(uuid, text)         from public, anon;
revoke execute on function public.meus_convites()              from public, anon;
revoke execute on function public.aceitar_convite(uuid)        from public, anon;
revoke execute on function public.remover_membro(uuid, uuid)   from public, anon;
grant  execute on function public.criar_grupo(text)            to authenticated;
grant  execute on function public.convidar(uuid, text)         to authenticated;
grant  execute on function public.meus_convites()              to authenticated;
grant  execute on function public.aceitar_convite(uuid)        to authenticated;
grant  execute on function public.remover_membro(uuid, uuid)   to authenticated;

-- ---------------------------------------------------------------------
-- Limpeza: apaga lançamentos com mais de N meses (padrão 6, contando o
-- mês atual) sem mexer nos resumos. Retorna os caminhos dos comprovantes
-- para a Edge Function apagar os arquivos pelo Storage API.
-- ---------------------------------------------------------------------
create or replace function public.limpar_lancamentos_antigos(p_meses int default 6)
returns table (caminho text)
language plpgsql security definer set search_path = public as $$
declare
  corte date := (date_trunc('month', now() at time zone 'America/Sao_Paulo')
                 - make_interval(months => greatest(p_meses, 1) - 1))::date;
begin
  perform set_config('app.limpeza', 'on', true);
  return query
    with apagados as (
      delete from lancamentos l where l.data < corte returning l.comprovante_path
    )
    select a.comprovante_path from apagados a where a.comprovante_path is not null;
  perform set_config('app.limpeza', 'off', true);
end $$;
revoke execute on function public.limpar_lancamentos_antigos(int) from public, anon, authenticated;
grant  execute on function public.limpar_lancamentos_antigos(int) to service_role;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.perfis          enable row level security;
alter table public.grupos          enable row level security;
alter table public.membros         enable row level security;
alter table public.convites        enable row level security;
alter table public.lancamentos     enable row level security;
alter table public.resumos_mensais enable row level security;

-- perfis
create policy "perfis: ver o próprio e de quem divide grupo" on public.perfis
  for select to authenticated using (id = auth.uid() or compartilha_grupo(id));
create policy "perfis: editar o próprio" on public.perfis
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- grupos (criação via RPC criar_grupo)
create policy "grupos: membros veem" on public.grupos
  for select to authenticated using (is_membro(id));
create policy "grupos: admin renomeia" on public.grupos
  for update to authenticated using (is_admin(id)) with check (is_admin(id));
create policy "grupos: dono apaga" on public.grupos
  for delete to authenticated using (dono_id = auth.uid());

-- membros (entrada/saída via RPC)
create policy "membros: membros veem" on public.membros
  for select to authenticated using (is_membro(grupo_id));

-- convites (criação via RPC convidar)
create policy "convites: admin ou convidado veem" on public.convites
  for select to authenticated using (is_admin(grupo_id) or email = meu_email());
create policy "convites: admin cancela ou convidado recusa" on public.convites
  for delete to authenticated using (is_admin(grupo_id) or email = meu_email());

-- lançamentos
create policy "lancamentos: membros veem" on public.lancamentos
  for select to authenticated using (is_membro(grupo_id));
create policy "lancamentos: membros criam" on public.lancamentos
  for insert to authenticated
  with check (is_membro(grupo_id) and criado_por = auth.uid());
create policy "lancamentos: membros editam" on public.lancamentos
  for update to authenticated using (is_membro(grupo_id)) with check (is_membro(grupo_id));
create policy "lancamentos: membros apagam" on public.lancamentos
  for delete to authenticated using (is_membro(grupo_id));

-- resumos (somente leitura; escrita só pela trigger)
create policy "resumos: membros veem" on public.resumos_mensais
  for select to authenticated using (is_membro(grupo_id));

-- ---------------------------------------------------------------------
-- Storage: bucket privado de comprovantes
--   Caminho dos arquivos: <grupo_id>/<lancamento_id>-<timestamp>.<ext>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovantes', 'comprovantes', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public.pode_acessar_arquivo(p_nome text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare pasta text := split_part(p_nome, '/', 1);
begin
  if pasta !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return is_membro(pasta::uuid);
end $$;

create policy "comprovantes: membros leem" on storage.objects
  for select to authenticated
  using (bucket_id = 'comprovantes' and public.pode_acessar_arquivo(name));
create policy "comprovantes: membros enviam" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprovantes' and public.pode_acessar_arquivo(name));
create policy "comprovantes: membros substituem" on storage.objects
  for update to authenticated
  using (bucket_id = 'comprovantes' and public.pode_acessar_arquivo(name));
create policy "comprovantes: membros apagam" on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprovantes' and public.pode_acessar_arquivo(name));
