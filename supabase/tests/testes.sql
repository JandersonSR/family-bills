-- Testes da migração (rodar após _stub_supabase.sql + migração, como superusuário).
\set ON_ERROR_STOP 1
\set QUIET 1

create or replace function pg_temp.como(u uuid, email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'email', email)::text, false);
  execute 'set role authenticated';
end $$;

create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

create or replace function pg_temp.falha(sqltxt text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sqltxt;
  exception when others then
    raise notice 'ok (erro esperado): % -> %', msg, sqlerrm;
    return;
  end;
  raise exception 'FALHOU: esperava erro em %', msg;
end $$;

-- usuários
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a', 'Filho@Ex.com', '{"nome":"Filho"}'),
 ('00000000-0000-0000-0000-00000000000b', 'mae@ex.com',   '{"nome":"Mãe"}'),
 ('00000000-0000-0000-0000-00000000000c', 'irma@ex.com',  '{"nome":"Irmã"}'),
 ('00000000-0000-0000-0000-00000000000d', 'tio@ex.com',   '{}'),
 ('00000000-0000-0000-0000-00000000000e', 'extra@ex.com', '{}'),
 ('00000000-0000-0000-0000-00000000000f', 'intruso@ex.com', '{}');

select pg_temp.check((select count(*) from perfis) = 6, 'perfis criados no cadastro');
select pg_temp.check((select email from perfis where nome='Filho') = 'filho@ex.com', 'email do perfil em minúsculas');

-- Filho cria grupo e convida
select pg_temp.como('00000000-0000-0000-0000-00000000000a', 'filho@ex.com');
create temp table ctx as select criar_grupo('Contas da Mãe') as g;
select pg_temp.check((select count(*) from grupos) = 1, 'grupo visível ao criador');
select convidar((select g from ctx), 'MAE@ex.com ');
select convidar((select g from ctx), 'irma@ex.com');
select convidar((select g from ctx), 'tio@ex.com');
select convidar((select g from ctx), 'tio@ex.com'); -- repetido: ignora
select pg_temp.falha($$select convidar((select g from ctx), 'extra@ex.com')$$, 'limite de 4 conta convites');
select pg_temp.falha($$select convidar((select g from ctx), 'nao-e-email')$$, 'email inválido');
reset role;

-- Intruso não vê nada e não aceita convite alheio
select pg_temp.como('00000000-0000-0000-0000-00000000000f', 'intruso@ex.com');
select pg_temp.check((select count(*) from grupos) = 0, 'intruso não vê grupo');
select pg_temp.check((select count(*) from meus_convites()) = 0, 'intruso sem convites');
select pg_temp.falha($$select aceitar_convite((select id from convites limit 1))$$, 'intruso não aceita convite alheio');
select pg_temp.falha($$select convidar('00000000-0000-0000-0000-000000000000', 'x@y.com')$$, 'não-admin não convida');
reset role;

-- Mãe aceita
select pg_temp.como('00000000-0000-0000-0000-00000000000b', 'mae@ex.com');
select pg_temp.check((select count(*) from meus_convites()) = 1, 'mãe vê seu convite');
select aceitar_convite((select id from meus_convites() limit 1));
select pg_temp.check((select count(*) from membros) = 2, 'mãe vê os 2 membros');
select pg_temp.check((select count(*) from perfis) = 2, 'mãe vê perfis só de quem divide grupo');
select pg_temp.falha($$select convidar((select id from grupos limit 1), 'extra@ex.com')$$, 'membro comum não convida');

-- Lançamentos (setembro/2026)
insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data)
  select id, 'deposito', 'Pix do filho', 200000, '2026-09-05' from grupos;
insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data)
  select id, 'pagamento', 'Luz', 18550, '2026-09-10' from grupos;
insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, status)
  select id, 'pagamento', 'Internet', 9990, '2026-09-20', 'pendente' from grupos;
select pg_temp.check((select entradas_centavos from resumos_mensais where mes='2026-09-01') = 200000, 'resumo entradas');
select pg_temp.check((select saidas_centavos from resumos_mensais where mes='2026-09-01') = 18550, 'pendente não entra no resumo');
select pg_temp.check((select criado_por from lancamentos where descricao='Luz') = '00000000-0000-0000-0000-00000000000b', 'criado_por = mãe');
select pg_temp.falha($$insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, status)
  select id, 'deposito', 'x', 1, '2026-09-01', 'pendente' from grupos$$, 'depósito não pode ser pendente');
select pg_temp.falha($$insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, criado_por)
  select id, 'deposito', 'x', 1, '2026-09-01', '00000000-0000-0000-0000-00000000000a' from grupos$$, 'não lança em nome de outro');
select pg_temp.falha($$insert into resumos_mensais values ((select id from grupos), '2026-01-01', 1, 1)$$, 'cliente não escreve resumo');

-- Paga a internet -> entra no resumo; muda valor e mês da luz
update lancamentos set status='pago' where descricao='Internet';
select pg_temp.check((select saidas_centavos from resumos_mensais where mes='2026-09-01') = 28540, 'pagar pendente soma');
update lancamentos set valor_centavos=20000, data='2026-08-31' where descricao='Luz';
select pg_temp.check((select saidas_centavos from resumos_mensais where mes='2026-09-01') = 9990, 'mover luz tira de setembro');
select pg_temp.check((select saidas_centavos from resumos_mensais where mes='2026-08-01') = 20000, 'mover luz põe em agosto');
delete from lancamentos where descricao='Internet';
select pg_temp.check((select saidas_centavos from resumos_mensais where mes='2026-09-01') = 0, 'apagar desconta');
reset role;

-- Intruso não enxerga lançamentos nem arquivos, e não lança
select pg_temp.como('00000000-0000-0000-0000-00000000000f', 'intruso@ex.com');
select pg_temp.check((select count(*) from lancamentos) = 0, 'intruso não vê lançamentos');
select pg_temp.check((select count(*) from resumos_mensais) = 0, 'intruso não vê resumos');
select pg_temp.falha($$insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data)
  values ((select g from ctx), 'deposito', 'x', 1, '2026-09-01')$$, 'intruso não lança');
select pg_temp.falha($$insert into storage.objects (bucket_id, name)
  values ('comprovantes', (select g from ctx)::text || '/a.jpg')$$, 'intruso não envia arquivo');
reset role;

select pg_temp.como('00000000-0000-0000-0000-00000000000b', 'mae@ex.com');
insert into storage.objects (bucket_id, name) values ('comprovantes', (select g from ctx)::text || '/a.jpg');
select pg_temp.check((select count(*) from storage.objects) = 1, 'membro envia e vê arquivo');
select pg_temp.falha($$insert into storage.objects (bucket_id, name) values ('comprovantes', '../x/a.jpg')$$, 'caminho inválido bloqueado');
-- mãe sai do grupo? não; tenta remover o dono
select pg_temp.falha($$select remover_membro((select g from ctx), '00000000-0000-0000-0000-00000000000a')$$, 'não remove o dono');
reset role;

-- Limpeza: lançamento antigo some, resumo fica
insert into lancamentos (id, grupo_id, tipo, descricao, valor_centavos, data, criado_por, comprovante_path)
  select '30000000-0000-0000-0000-000000000001', g, 'deposito', 'Antigo', 50000, '2025-01-10', '00000000-0000-0000-0000-00000000000a',
         g::text || '/30000000-0000-0000-0000-000000000001-1.jpg' from ctx;
select pg_temp.check((select entradas_centavos from resumos_mensais where mes='2025-01-01') = 50000, 'resumo do antigo');
set role service_role;
create temp table apagados as select * from limpar_lancamentos_antigos(6);
reset role;
select pg_temp.check((select count(*) from apagados) = 1 and (select caminho from apagados) like '%/30000000-0000-0000-0000-000000000001-1.jpg', 'limpeza devolve caminho do arquivo');
select pg_temp.check(not exists (select 1 from lancamentos where descricao='Antigo'), 'antigo apagado');
select pg_temp.check(exists (select 1 from lancamentos where descricao='Luz'), 'agosto/2026 mantido (dentro de 6 meses)');
select pg_temp.check((select entradas_centavos from resumos_mensais where mes='2025-01-01') = 50000, 'resumo preservado após limpeza');
select pg_temp.check(coalesce(current_setting('app.limpeza', true), '') <> 'on', 'flag de limpeza desligada');

select pg_temp.como('00000000-0000-0000-0000-00000000000b', 'mae@ex.com');
select pg_temp.falha($$select * from limpar_lancamentos_antigos(6)$$, 'cliente não roda limpeza');
reset role;

-- Apagar conta de usuário e apagar grupo não quebram
delete from auth.users where id='00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select criado_por from lancamentos where descricao='Luz') is null, 'conta apagada: autoria vira null');
select pg_temp.como('00000000-0000-0000-0000-00000000000a', 'filho@ex.com');
delete from grupos;
reset role;
select pg_temp.check((select count(*) from lancamentos) = 0 and (select count(*) from resumos_mensais) = 0, 'apagar grupo limpa tudo');

-- limite também no aceite (4 membros)
select pg_temp.como('00000000-0000-0000-0000-00000000000a', 'filho@ex.com');
truncate ctx; insert into ctx select criar_grupo('G2');
select convidar((select g from ctx), 'irma@ex.com');
select convidar((select g from ctx), 'tio@ex.com');
select convidar((select g from ctx), 'extra@ex.com');
reset role;
select pg_temp.check((select count(*) from convites where grupo_id=(select g from ctx)) = 3, '3 convites + dono = 4');
select pg_temp.falha($$insert into membros select g, '00000000-0000-0000-0000-00000000000f', 'membro' from ctx;
  insert into membros select g, '00000000-0000-0000-0000-00000000000c', 'membro' from ctx;
  insert into membros select g, '00000000-0000-0000-0000-00000000000d', 'membro' from ctx;
  insert into membros select g, '00000000-0000-0000-0000-00000000000e', 'membro' from ctx;$$, 'trigger barra o 5º membro');

\echo TODOS OS TESTES PASSARAM
