-- Testes da migração 2 (contas fixas + orçamento). Rodar depois de testes.sql.
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

insert into auth.users (id, email, raw_user_meta_data) values
 ('10000000-0000-0000-0000-00000000000a', 'dono2@ex.com', '{"nome":"Dono"}'),
 ('10000000-0000-0000-0000-00000000000f', 'outro2@ex.com', '{}');

select pg_temp.como('10000000-0000-0000-0000-00000000000f', 'outro2@ex.com');
create temp table g_outro as select criar_grupo('Outro') as g;
insert into contas_fixas (grupo_id, descricao, dia_vencimento) select g, 'Luz do outro', 5 from g_outro;
reset role;

select pg_temp.como('10000000-0000-0000-0000-00000000000a', 'dono2@ex.com');
create temp table g2 as select criar_grupo('Casa') as g;
insert into contas_fixas (grupo_id, descricao, valor_centavos, dia_vencimento, desde_mes)
  select g, 'Luz', 18000, 10, '2026-09-01' from g2;
select pg_temp.check((select count(*) from contas_fixas) = 1, 'só vê contas fixas do próprio grupo');
select pg_temp.falha($$insert into contas_fixas (grupo_id, descricao, dia_vencimento) select g, 'x', 32 from g2$$, 'dia de vencimento inválido');

-- baixa da conta fixa
insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, conta_fixa_id, mes_referencia)
  select g, 'pagamento', 'Luz', 18550, '2026-09-10', (select id from contas_fixas where descricao='Luz'), '2026-09-01' from g2;
select pg_temp.falha($$insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, conta_fixa_id, mes_referencia)
  select g, 'pagamento', 'Luz', 18550, '2026-09-11', (select id from contas_fixas where descricao='Luz'), '2026-09-01' from g2$$,
  'baixa duplicada no mesmo mês bloqueada');
-- setembro pago em outubro (atrasado) é outra referência: permitido
insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, conta_fixa_id, mes_referencia)
  select g, 'pagamento', 'Luz', 17000, '2026-10-02', (select id from contas_fixas where descricao='Luz'), '2026-10-01' from g2;
select pg_temp.falha($$insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, conta_fixa_id)
  select g, 'pagamento', 'Luz', 1, '2026-09-11', (select id from contas_fixas where descricao='Luz') from g2$$, 'baixa exige mês de referência');
reset role;
select pg_temp.como('10000000-0000-0000-0000-00000000000a', 'dono2@ex.com');
select pg_temp.falha($$insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, conta_fixa_id, mes_referencia)
  select g, 'pagamento', 'x', 1, '2026-09-11', '00000000-0000-0000-0000-000000000000', '2026-09-01' from g2$$, 'conta fixa de outro grupo bloqueada');

-- orçamento
insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, no_orcamento)
  select g, 'pagamento', 'Presente', 5000, '2026-09-15', false from g2;
select pg_temp.check((select saidas_centavos from resumos_mensais where mes='2026-09-01' and grupo_id=(select g from g2)) = 18550,
  'fora do orçamento não entra no resumo');
update lancamentos set no_orcamento = true where descricao = 'Presente';
select pg_temp.check((select saidas_centavos from resumos_mensais where mes='2026-09-01' and grupo_id=(select g from g2)) = 23550,
  'passar para dentro do orçamento soma');
update lancamentos set no_orcamento = false where descricao = 'Presente';
select pg_temp.check((select saidas_centavos from resumos_mensais where mes='2026-09-01' and grupo_id=(select g from g2)) = 18550,
  'tirar do orçamento subtrai');
delete from lancamentos where descricao = 'Presente';
select pg_temp.check((select saidas_centavos from resumos_mensais where mes='2026-09-01' and grupo_id=(select g from g2)) = 18550,
  'apagar conta fora do orçamento não mexe no resumo');
select pg_temp.falha($$insert into lancamentos (grupo_id, tipo, descricao, valor_centavos, data, no_orcamento)
  select g, 'deposito', 'x', 1, '2026-09-01', false from g2$$, 'depósito sempre no orçamento');

-- parar de usar a conta fixa e apagar: baixas antigas continuam
update contas_fixas set ate_mes = '2026-10-01' where descricao = 'Luz';
delete from contas_fixas where descricao = 'Luz';
select pg_temp.check((select count(*) from lancamentos where descricao='Luz' and conta_fixa_id is null) = 2, 'apagar conta fixa mantém os pagamentos');
reset role;

\echo TODOS OS TESTES DA MIGRACAO 2 PASSARAM
