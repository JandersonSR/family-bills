#!/usr/bin/env bash
# Roda os testes do SQL num Postgres local (não precisa de Supabase).
# Uso: PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/tests/rodar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
P="psql -v ON_ERROR_STOP=1 -q -t"
$P -c "drop database if exists contas_teste" >/dev/null
$P -c "create database contas_teste" >/dev/null
$P -d contas_teste -f tests/_stub_supabase.sql >/dev/null
for m in migrations/*.sql; do $P -d contas_teste -f "$m" >/dev/null; done
$P -d contas_teste -f tests/testes.sql 2>&1 | grep -oE "(ok.*|FALHOU.*|TODOS.*|ERROR.*)"
$P -d contas_teste -f tests/testes_2.sql 2>&1 | grep -oE "(ok.*|FALHOU.*|TODOS.*|ERROR.*)"
$P -d contas_teste -f tests/testes_3.sql 2>&1 | grep -oE "(ok.*|FALHOU.*|TODOS.*|ERROR.*)"
