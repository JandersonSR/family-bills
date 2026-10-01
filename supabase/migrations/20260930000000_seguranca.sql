-- =====================================================================
-- Endurecimento de segurança (revisão de 2026-09-30)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Comprovante sempre na pasta do próprio grupo E com o id do próprio
-- lançamento: "<grupo_id>/<lancamento_id>-<timestamp>.<ext>".
--   Sem isso, um membro podia apontar um lançamento antigo para o arquivo
--   de outro registro (ou de OUTRO grupo) e a limpeza diária
--   (service_role) apagava esse arquivo.
-- ---------------------------------------------------------------------
alter table public.lancamentos
  add constraint comprovante_do_lancamento check (
    comprovante_path is null
    or comprovante_path ~ ('^' || grupo_id::text || '/' || id::text || '-[^/]+$')
  );

-- ---------------------------------------------------------------------
-- Fila de arquivos a apagar pela limpeza. Os caminhos entram na mesma
-- transação que apaga os lançamentos e só saem depois que o Storage
-- confirmou a remoção; se o Storage falhar, a próxima execução tenta de novo.
-- Sem políticas de RLS: só a service_role enxerga.
-- ---------------------------------------------------------------------
create table public.arquivos_a_apagar (
  caminho    text primary key,
  created_at timestamptz not null default now()
);
alter table public.arquivos_a_apagar enable row level security;
revoke all on public.arquivos_a_apagar from anon, authenticated;
grant  all on public.arquivos_a_apagar to service_role;

create or replace function public.limpar_lancamentos_antigos(p_meses int default 6)
returns table (caminho text)
language plpgsql security definer set search_path = public as $$
declare
  corte date := (date_trunc('month', now() at time zone 'America/Sao_Paulo')
                 - make_interval(months => greatest(p_meses, 1) - 1))::date;
begin
  if p_meses is null or p_meses < 1 or p_meses > 120 then
    raise exception 'Período de retenção inválido: %', p_meses;
  end if;
  perform set_config('app.limpeza', 'on', true);
  with apagados as (
    delete from lancamentos l where l.data < corte
    returning l.id, l.grupo_id, l.comprovante_path
  )
  insert into arquivos_a_apagar (caminho)
  select a.comprovante_path from apagados a
  where a.comprovante_path is not null
    and a.comprovante_path ~ ('^' || a.grupo_id::text || '/' || a.id::text || '-[^/]+$')
  on conflict do nothing;
  perform set_config('app.limpeza', 'off', true);
  -- devolve também o que ficou de execuções anteriores que falharam
  return query select f.caminho from arquivos_a_apagar f order by f.created_at;
end $$;
revoke execute on function public.limpar_lancamentos_antigos(int) from public, anon, authenticated;
grant  execute on function public.limpar_lancamentos_antigos(int) to service_role;

-- ---------------------------------------------------------------------
-- Convite só pode ser aceito por quem confirmou o e-mail
-- ---------------------------------------------------------------------
create or replace function public.email_confirmado() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users
                 where id = auth.uid() and email_confirmed_at is not null);
$$;

-- meu_email() é usado pelas políticas de convites e por meus_convites():
-- sem e-mail confirmado, a pessoa não vê nem recusa convites.
create or replace function public.meu_email() returns text
language sql stable as $$
  select case when public.email_confirmado()
              then lower(coalesce(auth.jwt() ->> 'email', ''))
              else '' end
$$;

create or replace function public.aceitar_convite(p_convite uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c convites;
begin
  if not email_confirmado() then
    raise exception 'Confirme seu e-mail antes de aceitar o convite.';
  end if;
  select * into c from convites where id = p_convite and email = meu_email();
  if not found then raise exception 'Convite não encontrado.'; end if;
  perform 1 from grupos where id = c.grupo_id for update;
  delete from convites where id = c.id;
  if not exists (select 1 from membros where grupo_id = c.grupo_id and user_id = auth.uid()) then
    insert into membros (grupo_id, user_id, papel) values (c.grupo_id, auth.uid(), 'membro');
  end if;
  return c.grupo_id;
end $$;

-- ---------------------------------------------------------------------
-- Colunas que o cliente pode alterar
--   perfis: só o nome (o e-mail vem do Auth e identifica a pessoa)
--   grupos: só o nome (dono_id não pode ser trocado)
-- ---------------------------------------------------------------------
revoke update on public.perfis from anon, authenticated;
grant  update (nome) on public.perfis to authenticated;
revoke update on public.grupos from anon, authenticated;
grant  update (nome) on public.grupos to authenticated;

create or replace function public.criar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, nome, email)
  values (new.id, left(coalesce(trim(new.raw_user_meta_data ->> 'nome'), ''), 80), lower(new.email))
  on conflict (id) do nothing;
  return new;
end $$;

alter table public.perfis
  add constraint perfis_nome_tamanho check (char_length(nome) <= 80) not valid;

-- ---------------------------------------------------------------------
-- Autoria: não pode ser apagada nem falsificada.
--   criado_por só vira null quando a conta da pessoa foi apagada
--   (on delete set null); aí o perfil antigo já não existe.
-- ---------------------------------------------------------------------
create or replace function public.tocar_updated_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.grupo_id   := old.grupo_id;    -- lançamento não troca de grupo
  if new.criado_por is distinct from old.criado_por
     and (new.criado_por is not null
          or exists (select 1 from perfis where id = old.criado_por)) then
    new.criado_por := old.criado_por;
  end if;
  return new;
end $$;

create or replace function public.proteger_conta_fixa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.criado_por := auth.uid();
    end if;
    return new;
  end if;
  new.grupo_id := old.grupo_id;
  if new.criado_por is distinct from old.criado_por
     and (new.criado_por is not null
          or exists (select 1 from perfis where id = old.criado_por)) then
    new.criado_por := old.criado_por;
  end if;
  return new;
end $$;

create trigger contas_fixas_protecao
  before insert or update on public.contas_fixas
  for each row execute function public.proteger_conta_fixa();

-- ---------------------------------------------------------------------
-- Storage: só nomes "<grupo_id>/<arquivo>.<ext>" com extensão permitida
-- ---------------------------------------------------------------------
create or replace function public.nome_arquivo_valido(p_nome text) returns boolean
language sql immutable as $$
  select p_nome ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+\.(jpg|jpeg|png|webp|heic|heif|pdf)$'
$$;

drop policy "comprovantes: membros enviam" on storage.objects;
create policy "comprovantes: membros enviam" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprovantes'
              and public.nome_arquivo_valido(name)
              and public.pode_acessar_arquivo(name));

drop policy "comprovantes: membros substituem" on storage.objects;
create policy "comprovantes: membros substituem" on storage.objects
  for update to authenticated
  using (bucket_id = 'comprovantes' and public.pode_acessar_arquivo(name))
  with check (bucket_id = 'comprovantes'
              and public.nome_arquivo_valido(name)
              and public.pode_acessar_arquivo(name));
