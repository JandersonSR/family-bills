-- Testes da migração de segurança. Rodar depois de testes_2.sql.
\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function pg_temp.como(u uuid, email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'email', email)::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
create or replace function pg_temp.falha(sqltxt text, msg text) returns void language plpgsql as $$
begin
  begin execute sqltxt;
  exception when others then raise notice 'ok (erro esperado): % -> %', msg, sqlerrm; return; end;
  raise exception 'FALHOU: esperava erro em %', msg;
end $$;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
 ('20000000-0000-0000-0000-00000000000a', 'a3@ex.com', '{"nome":"A"}', now()),
 ('20000000-0000-0000-0000-00000000000b', 'b3@ex.com', '{"nome":"B"}', now()),
 ('20000000-0000-0000-0000-00000000000c', 'c3@ex.com', '{}', null);

-- grupo B com um comprovante
select pg_temp.como('20000000-0000-0000-0000-00000000000b', 'b3@ex.com');
create temp table gb as select criar_grupo('Grupo B') as g;
insert into lancamentos (id, grupo_id, tipo, descricao, valor_centavos, data, comprovante_path)
  select '40000000-0000-0000-0000-00000000000b', g, 'deposito', 'Pix B', 100, '2026-09-01',
         g::text || '/40000000-0000-0000-0000-00000000000b-1.jpg' from gb;
reset role;

-- grupo A
select pg_temp.como('20000000-0000-0000-0000-00000000000a', 'a3@ex.com');
create temp table ga as select criar_grupo('Grupo A') as g;
select pg_temp.falha($$insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, comprovante_path)
  select g, 'deposito', 'x', 1, '2025-01-01', (select g from gb)::text || '/40000000-0000-0000-0000-00000000000b-1.jpg' from ga$$,
  'comprovante de outro grupo bloqueado no insert');
insert into lancamentos (id, grupo_id, tipo, descricao, valor_centavos, data)
  select '40000000-0000-0000-0000-00000000000a', g, 'deposito', 'Velho A', 1, '2025-01-01' from ga;
insert into lancamentos (id, grupo_id, tipo, descricao, valor_centavos, data, comprovante_path)
  select '40000000-0000-0000-0000-0000000000a2', g, 'deposito', 'Novo A', 1, '2026-09-01',
         g::text || '/40000000-0000-0000-0000-0000000000a2-1.jpg' from ga;
select pg_temp.falha($$update lancamentos set comprovante_path = (select g from gb)::text || '/40000000-0000-0000-0000-00000000000b-1.jpg' where descricao = 'Velho A'$$,
  'comprovante de outro grupo bloqueado no update');
select pg_temp.falha($$update lancamentos set comprovante_path = (select g from ga)::text || '/40000000-0000-0000-0000-0000000000a2-1.jpg' where descricao = 'Velho A'$$,
  'comprovante de outro registro do mesmo grupo bloqueado');
select pg_temp.falha($$update lancamentos set comprovante_path = (select g from ga)::text || '/40000000-0000-0000-0000-00000000000a-/../x.jpg' where descricao = 'Velho A'$$,
  'comprovante em subpasta bloqueado');
update lancamentos set comprovante_path = (select g from ga)::text || '/40000000-0000-0000-0000-00000000000a-1.jpg' where descricao = 'Velho A';
select pg_temp.check((select comprovante_path from lancamentos where descricao = 'Velho A') like '%-1.jpg', 'comprovante do próprio registro aceito');

-- autoria
update lancamentos set criado_por = null where descricao = 'Velho A';
select pg_temp.check((select criado_por from lancamentos where descricao = 'Velho A') = '20000000-0000-0000-0000-00000000000a',
  'membro não apaga a autoria');
insert into contas_fixas (grupo_id, descricao, dia_vencimento, criado_por)
  select g, 'Água', 5, '20000000-0000-0000-0000-00000000000b' from ga;
select pg_temp.check((select criado_por from contas_fixas where descricao = 'Água') = '20000000-0000-0000-0000-00000000000a',
  'conta fixa não é criada em nome de outro');
update contas_fixas set criado_por = null where descricao = 'Água';
select pg_temp.check((select criado_por from contas_fixas where descricao = 'Água') = '20000000-0000-0000-0000-00000000000a',
  'autoria da conta fixa não muda');

-- colunas protegidas
select pg_temp.falha($$update perfis set email = 'falso@ex.com' where id = auth.uid()$$, 'não troca o próprio e-mail');
update perfis set nome = 'Ana' where id = auth.uid();
select pg_temp.check((select nome from perfis where id = auth.uid()) = 'Ana', 'troca o próprio nome');
select pg_temp.falha($$update grupos set dono_id = '20000000-0000-0000-0000-00000000000b' where id = (select g from ga)$$, 'não troca o dono do grupo');
update grupos set nome = 'Grupo A2' where id = (select g from ga);
select pg_temp.check((select nome from grupos where id = (select g from ga)) = 'Grupo A2', 'admin renomeia o grupo');

-- storage: extensão permitida
select pg_temp.falha($$insert into storage.objects (bucket_id, name) values ('comprovantes', (select g from ga)::text || '/a.html')$$,
  'arquivo .html bloqueado');
select pg_temp.falha($$insert into storage.objects (bucket_id, name) values ('comprovantes', (select g from ga)::text || '/sub/a.jpg')$$,
  'subpasta bloqueada');
insert into storage.objects (bucket_id, name) values ('comprovantes', (select g from ga)::text || '/a.pdf');
select pg_temp.check(exists (select 1 from storage.objects where name like '%/a.pdf'), 'PDF aceito');

-- convite exige e-mail confirmado
select convidar((select g from ga), 'c3@ex.com');
reset role;
select pg_temp.como('20000000-0000-0000-0000-00000000000c', 'c3@ex.com');
select pg_temp.check((select count(*) from convites) = 0 and (select count(*) from meus_convites()) = 0,
  'e-mail não confirmado não vê convites');
reset role;
select pg_temp.como('20000000-0000-0000-0000-00000000000c', 'c3@ex.com');
select pg_temp.falha(format('select aceitar_convite(%L)', (select id from convites where email = 'c3@ex.com')),
  'e-mail não confirmado não aceita convite');
reset role;
update auth.users set email_confirmed_at = now() where id = '20000000-0000-0000-0000-00000000000c';
select pg_temp.como('20000000-0000-0000-0000-00000000000c', 'c3@ex.com');
select aceitar_convite((select id from convites where email = 'c3@ex.com'));
select pg_temp.check((select count(*) from membros where grupo_id = (select g from ga)) = 2, 'e-mail confirmado aceita convite');
reset role;

-- limpeza só devolve caminhos do próprio grupo; arquivos do grupo B intactos
set role service_role;
create temp table apagados3 as select * from limpar_lancamentos_antigos(6);
reset role;
select pg_temp.check(not exists (select 1 from apagados3 where caminho like (select g from gb)::text || '/%'),
  'limpeza não devolve arquivo de outro grupo');
select pg_temp.check(exists (select 1 from apagados3 where caminho like '%/40000000-0000-0000-0000-00000000000a-1.jpg'), 'limpeza devolve o arquivo do grupo A');
select pg_temp.check(not exists (select 1 from apagados3 where caminho like '%0000a2-1.jpg'), 'limpeza não devolve arquivo de registro recente');
select pg_temp.check((select count(*) from arquivos_a_apagar) = (select count(*) from apagados3), 'caminhos ficam na fila até o Storage confirmar');
delete from arquivos_a_apagar where caminho like '%/40000000-0000-0000-0000-00000000000a-1.jpg';
set role service_role;
create temp table apagados4 as select * from limpar_lancamentos_antigos(6);
reset role;
select pg_temp.check(not exists (select 1 from apagados4 where caminho like '%0000000a-1.jpg'), 'arquivo confirmado sai da fila');
select pg_temp.check(exists (select 1 from apagados4), 'arquivo não confirmado volta na próxima limpeza');
set role service_role;
select pg_temp.falha($$select * from limpar_lancamentos_antigos(0)$$, 'retenção 0 recusada');
reset role;
select pg_temp.como('20000000-0000-0000-0000-00000000000a', 'a3@ex.com');
select pg_temp.falha($$select * from arquivos_a_apagar$$, 'cliente não vê a fila de arquivos');
reset role;

\echo TODOS OS TESTES DA MIGRACAO DE SEGURANCA PASSARAM
