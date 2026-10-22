-- Análises salvas do MARK na Supabase.
--
-- Rode uma vez no SQL Editor do projeto (Supabase > SQL Editor > New query).
-- O script pode ser rodado de novo sem perder dados: tudo usa IF NOT EXISTS,
-- CREATE OR REPLACE ou ON CONFLICT.
--
-- Quem acessa é só o backend, com a chave service_role, que ignora o RLS.
-- O RLS fica ligado e sem nenhuma política: com a chave pública (anon) não se
-- lê nem se grava nada destas tabelas nem do bucket.

-- Uma linha por análise. Versão numerada dentro de empresa + competência.
-- Sem empresa definida, empresa_cnpj fica '' (e não null), para a regra de
-- unicidade valer também nesse caso.
--
-- `completa` só vira true depois que todas as notas foram gravadas. O
-- backend lista, abre e numera só as completas: uma gravação interrompida
-- fica invisível em vez de aparecer com notas faltando.
create table if not exists public.analises (
  id uuid primary key default gen_random_uuid(),
  empresa_cnpj text not null default '',
  empresa_nome text,
  competencia text not null,
  versao integer not null check (versao > 0),
  criado_por text not null,
  criado_em timestamptz not null default now(),
  total_notas integer not null default 0,
  resumo jsonb not null default '{}'::jsonb,
  versao_tabela text,
  zip_path text,
  zip_bytes bigint not null default 0,
  completa boolean not null default false
);

-- Bancos criados por uma versão anterior deste script: a coluna nasce true
-- para as análises que já existiam e passa a ter padrão false.
alter table public.analises add column if not exists completa boolean not null default true;
alter table public.analises alter column completa set default false;

-- A versão é única só entre as completas. Uma versão anterior deste script
-- criou a regra como restrição da tabela; ela sai e vira índice parcial.
alter table public.analises drop constraint if exists analises_empresa_competencia_versao_unica;
create unique index if not exists analises_empresa_competencia_versao_unica
  on public.analises (empresa_cnpj, competencia, versao)
  where completa;

create index if not exists analises_empresa_idx on public.analises (empresa_cnpj, criado_em desc);
create index if not exists analises_competencia_idx on public.analises (competencia);

-- Resultado por nota: o documento completo, como a sessão o usa.
create table if not exists public.analise_notas (
  analise_id uuid not null references public.analises (id),
  ordem integer not null,
  documento jsonb not null,
  primary key (analise_id, ordem)
);

alter table public.analises enable row level security;
alter table public.analise_notas enable row level security;

-- Empresas com análise completa, com a quantidade e o nome mais recente.
-- Função, e não select na tabela, porque o PostgREST corta em 1.000 linhas.
create or replace function public.empresas_com_analises()
returns table (cnpj text, nome text, quantidade bigint)
language sql
stable
security definer
set search_path = public
as $$
  select a.empresa_cnpj,
         (array_agg(a.empresa_nome order by a.criado_em desc)
            filter (where a.empresa_nome is not null))[1],
         count(*)
  from public.analises a
  where a.completa
  group by a.empresa_cnpj
  order by 2 nulls last, 1;
$$;

-- Totais para a tela mostrar o uso do espaço gratuito. Os bytes de ZIP
-- contam todas as linhas, porque o ZIP de uma gravação interrompida também
-- ocupa o bucket.
create or replace function public.uso_armazenamento()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'analises', (select count(*) from public.analises where completa),
    'bytesZips', (select coalesce(sum(zip_bytes), 0) from public.analises),
    'bytesBanco', pg_database_size(current_database())
  );
$$;

revoke all on function public.empresas_com_analises() from public, anon, authenticated;
revoke all on function public.uso_armazenamento() from public, anon, authenticated;
grant execute on function public.empresas_com_analises() to service_role;
grant execute on function public.uso_armazenamento() to service_role;

-- Bucket privado para os ZIPs, em <cnpj>/<competência>/<id da análise>.zip.
-- O nome é fixo no backend.
insert into storage.buckets (id, name, public)
values ('lotes', 'lotes', false)
on conflict (id) do nothing;
