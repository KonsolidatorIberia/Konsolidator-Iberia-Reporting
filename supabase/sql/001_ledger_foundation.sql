-- =====================================================================
-- 001_ledger_foundation.sql
-- Base del esquema ledger: datos maestros, períodos, cargas y hechos.
-- Hay que ejecutarlo ANTES de 002_ledger_estructuras.sql.
--
-- Convenciones (las mismas que el resto de la base):
--   company_id  = el cliente (tenant) -> accounts.companies(id)
--   entity      = una sociedad del grupo (CompanyShortName de Konsolidator)
--
-- Crea: el esquema ledger, datos maestros (empresas, escenarios, períodos,
-- dimensiones, cuentas locales), lotes de carga + filas en preparación,
-- la tabla de hechos, seguridad por filas (RLS) y un bucket privado de
-- Storage para los archivos originales.
--
-- Se puede ejecutar una sola vez. Todo va en una transacción; la última
-- consulta devuelve un JSON de comprobación.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Esquema y permisos base
-- ---------------------------------------------------------------------
create schema if not exists ledger;
revoke all on schema ledger from public, anon;
grant usage on schema ledger to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Ayudas de acceso
--   my_company_ids(): clientes que ve quien llama. Se usa como
--   "company_id in (select ledger.my_company_ids())" para que se evalúe
--   una vez por consulta y no una vez por fila.
-- ---------------------------------------------------------------------
create or replace function ledger.my_company_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select uc.company_id
  from accounts.user_companies uc
  where uc.user_id = auth.uid()
    and uc.is_active
  union
  select c.id
  from accounts.companies c
  where accounts.is_super_admin()
$$;

create or replace function ledger.can_manage(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select accounts.is_super_admin()
      or accounts.is_company_admin(p_company_id)
      or public.is_active_consultant()
$$;

revoke all on function ledger.my_company_ids()  from public, anon;
revoke all on function ledger.can_manage(uuid)  from public, anon;
grant execute on function ledger.my_company_ids() to authenticated, service_role;
grant execute on function ledger.can_manage(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Datos maestros
--   Todas las tablas llevan company_id y las hijas usan claves compuestas
--   (company_id, parent_id): una fila nunca puede apuntar a otro cliente.
-- ---------------------------------------------------------------------
create table ledger.entities (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references accounts.companies(id) on delete cascade,
  code        text not null,                 -- CompanyShortName
  legal_name  text,
  currency    char(3) not null,              -- moneda local
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, id)
);

create table ledger.sources (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references accounts.companies(id) on delete cascade,
  code        text not null,                 -- Actual, Budget, Forecast...
  name        text,
  created_at  timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, id)
);

-- Un calendario por cliente. Las semanas cuelgan de un mes fiscal
-- (parent_period_id), así el mes es exactamente la suma de sus semanas.
-- Una semana que cruza fin de mes se guarda en dos filas con el mismo nº.
create table ledger.periods (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references accounts.companies(id) on delete cascade,
  period_type       text not null check (period_type in ('week', 'month')),
  fiscal_year       smallint not null,
  fiscal_month      smallint not null check (fiscal_month between 1 and 12),
  fiscal_week       smallint check (fiscal_week between 1 and 53),
  start_date        date not null,
  end_date          date not null,
  parent_period_id  uuid,
  is_locked         boolean not null default false,
  created_at        timestamptz not null default now(),
  check (end_date >= start_date),
  check ((period_type = 'week') = (fiscal_week is not null)),
  unique (company_id, period_type, start_date),
  unique (company_id, id),
  foreign key (company_id, parent_period_id) references ledger.periods (company_id, id)
);

create table ledger.dimensions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references accounts.companies(id) on delete cascade,
  group_code  text not null,                 -- p. ej. Department
  code        text not null,                 -- p. ej. 5
  name        text,                          -- p. ej. Shared
  created_at  timestamptz not null default now(),
  unique (company_id, group_code, code)
);

-- Cada combinación de dimensiones se guarda una vez, p. ej.
-- {"Department":"5","Project":"P12"}. {} = sin dimensiones.
create table ledger.dimension_sets (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references accounts.companies(id) on delete cascade,
  dims        jsonb not null default '{}'::jsonb check (jsonb_typeof(dims) = 'object'),
  created_at  timestamptz not null default now(),
  unique (company_id, dims),
  unique (company_id, id)
);

create table ledger.local_accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  entity_id   uuid not null,
  code        text not null,                 -- LocalAccountCode
  name        text,                          -- LocalAccountName
  created_at  timestamptz not null default now(),
  foreign key (company_id, entity_id) references ledger.entities (company_id, id) on delete cascade,
  unique (entity_id, code),
  unique (company_id, id)
);

-- ---------------------------------------------------------------------
-- Cargas
--   Una fila por archivo subido para una empresa + escenario + período.
--   Solo una carga confirmada por empresa/escenario/período; volver a
--   subir sustituye la anterior y la conserva para auditoría.
-- ---------------------------------------------------------------------
create table ledger.uploads (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  entity_id     uuid not null,
  source_id     uuid not null,
  period_id     uuid not null,
  amount_mode   text not null check (amount_mode in ('ytd', 'movement')),
  status        text not null default 'pending'
                check (status in ('pending', 'validated', 'failed', 'committed', 'superseded')),
  file_name     text,
  storage_path  text,                        -- ledger-uploads/{company_id}/{upload_id}/{archivo}
  row_count     integer,
  errors        jsonb,
  uploaded_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  committed_at  timestamptz,
  foreign key (company_id, entity_id) references ledger.entities (company_id, id),
  foreign key (company_id, source_id) references ledger.sources  (company_id, id),
  foreign key (company_id, period_id) references ledger.periods  (company_id, id),
  unique (company_id, id),
  unique (id, company_id, entity_id, source_id, period_id)
);

create unique index uploads_one_committed
  on ledger.uploads (entity_id, source_id, period_id)
  where status = 'committed';

create index uploads_lookup
  on ledger.uploads (company_id, entity_id, source_id, period_id, status);

-- Filas leídas del archivo, antes de validar. No se usan en informes.
create table ledger.upload_rows (
  upload_id           uuid not null,
  company_id          uuid not null,
  line_no             integer not null,
  local_account_code  text,
  local_account_name  text,
  dims                jsonb not null default '{}'::jsonb,
  amount              numeric(20, 4),
  currency            char(3),
  raw                 jsonb,
  errors              text[],
  primary key (upload_id, line_no),
  foreign key (company_id, upload_id) references ledger.uploads (company_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Hechos (los datos buenos)
--   amount = MOVIMIENTO del período con signo contable (debe +, haber -).
--   Solo los escribe el paso de confirmación en el servidor.
-- ---------------------------------------------------------------------
create table ledger.facts (
  id                bigint generated always as identity primary key,
  company_id        uuid not null,
  upload_id         uuid not null,
  entity_id         uuid not null,
  source_id         uuid not null,
  period_id         uuid not null,
  local_account_id  uuid not null,
  dim_set_id        bigint not null,
  currency          char(3) not null,
  amount            numeric(20, 4) not null,
  foreign key (upload_id, company_id, entity_id, source_id, period_id)
    references ledger.uploads (id, company_id, entity_id, source_id, period_id) on delete cascade,
  foreign key (company_id, local_account_id) references ledger.local_accounts (company_id, id),
  foreign key (company_id, dim_set_id)       references ledger.dimension_sets (company_id, id),
  unique (upload_id, local_account_id, dim_set_id)
);

create index facts_read on ledger.facts (company_id, entity_id, source_id, period_id);

-- ---------------------------------------------------------------------
-- Permisos de tabla (RLS decide qué filas)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema ledger from public, anon;
revoke all on all sequences in schema ledger from public, anon;

grant select on all tables in schema ledger to authenticated;
grant insert, update, delete on ledger.entities, ledger.sources, ledger.periods,
                                ledger.dimensions, ledger.local_accounts to authenticated;
grant insert, update, delete on ledger.uploads     to authenticated;
grant insert, delete         on ledger.upload_rows to authenticated;

grant all on all tables    in schema ledger to service_role;
grant all on all sequences in schema ledger to service_role;

-- ---------------------------------------------------------------------
-- Seguridad por filas
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  -- Lectura: cualquier miembro activo del cliente
  foreach t in array array['entities', 'sources', 'periods', 'dimensions', 'dimension_sets',
                           'local_accounts', 'uploads', 'upload_rows', 'facts'] loop
    execute format('alter table ledger.%I enable row level security', t);
    execute format(
      'create policy %I on ledger.%I for select to authenticated
         using (company_id in (select ledger.my_company_ids()))',
      t || '_select', t);
  end loop;

  -- Datos maestros: administradores del cliente, consultores y superadmins
  foreach t in array array['entities', 'sources', 'periods', 'dimensions', 'local_accounts'] loop
    execute format(
      'create policy %I on ledger.%I for all to authenticated
         using      (company_id in (select ledger.my_company_ids()) and ledger.can_manage(company_id))
         with check (company_id in (select ledger.my_company_ids()) and ledger.can_manage(company_id))',
      t || '_manage', t);
  end loop;
end $$;

-- Cargas: cualquier miembro puede empezar una; nadie la confirma desde el cliente
create policy uploads_insert on ledger.uploads for insert to authenticated
  with check (
    company_id in (select ledger.my_company_ids())
    and uploaded_by = auth.uid()
    and status = 'pending'
  );

create policy uploads_update on ledger.uploads for update to authenticated
  using (
    company_id in (select ledger.my_company_ids())
    and status in ('pending', 'validated', 'failed')
    and (uploaded_by = auth.uid() or ledger.can_manage(company_id))
  )
  with check (status in ('pending', 'failed'));

create policy uploads_delete on ledger.uploads for delete to authenticated
  using (
    company_id in (select ledger.my_company_ids())
    and status in ('pending', 'validated', 'failed')
    and (uploaded_by = auth.uid() or ledger.can_manage(company_id))
  );

-- Filas en preparación: solo mientras su carga sigue pendiente
create policy upload_rows_insert on ledger.upload_rows for insert to authenticated
  with check (
    company_id in (select ledger.my_company_ids())
    and exists (select 1 from ledger.uploads u
                where u.id = upload_id and u.status = 'pending')
  );

create policy upload_rows_delete on ledger.upload_rows for delete to authenticated
  using (
    company_id in (select ledger.my_company_ids())
    and exists (select 1 from ledger.uploads u
                where u.id = upload_id and u.status = 'pending')
  );

-- dimension_sets y facts: sin políticas de escritura a propósito.

-- ---------------------------------------------------------------------
-- Storage: bucket privado para los archivos originales
--   Ruta: {company_id}/{upload_id}/{nombre_original}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ledger-uploads', 'ledger-uploads', false, 52428800,   -- 50 MB
  array[
    'text/csv', 'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

drop policy if exists "ledger uploads read" on storage.objects;
create policy "ledger uploads read" on storage.objects for select to authenticated
  using (
    bucket_id = 'ledger-uploads'
    and (storage.foldername(name))[1] in (
      select t.company_id::text from ledger.my_company_ids() as t(company_id))
  );

drop policy if exists "ledger uploads insert" on storage.objects;
create policy "ledger uploads insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ledger-uploads'
    and (storage.foldername(name))[1] in (
      select t.company_id::text from ledger.my_company_ids() as t(company_id))
  );

commit;

-- ---------------------------------------------------------------------
-- Comprobación
-- ---------------------------------------------------------------------
select jsonb_pretty(jsonb_build_object(
  'tables', (
    select jsonb_agg(jsonb_build_object(
      'table',          c.relname,
      'rls_enabled',    c.relrowsecurity,
      'anon_any_access', has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE'),
      'policies',       (select count(*) from pg_policies p
                         where p.schemaname = 'ledger' and p.tablename = c.relname)
    ) order by c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ledger' and c.relkind = 'r'
  ),
  'bucket', (
    select jsonb_build_object('id', id, 'public', public,
                              'file_size_limit', file_size_limit,
                              'allowed_mime_types', allowed_mime_types)
    from storage.buckets where id = 'ledger-uploads'
  ),
  'storage_policies', (
    select jsonb_agg(policyname) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'ledger%'
  )
)) as ledger_check;
