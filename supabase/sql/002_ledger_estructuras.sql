-- =====================================================================
-- 002_ledger_estructuras.sql
-- Estructuras de grupo (fase 1, con la base para la fase 2):
--   configuración de grupo y calendario, empresas ampliadas, moneda
--   funcional, propiedad legal con fechas (grafo), estructuras de
--   consolidación con fechas, mapeo de cuentas, eventos y auditoría,
--   reglas que bloquean, avisos, perímetro a fecha con % efectivo y
--   minoritarios, y operaciones con fecha (RPC).
--
-- Convenciones (las de la 001):
--   company_id = el cliente (accounts.companies); entity = una sociedad
--   del grupo (CompanyShortName). Claves foráneas compuestas
--   (company_id, id) y RLS en todas las tablas con ledger.my_company_ids().
--   Rangos de fechas como daterange '[desde, hasta)': el día "hasta" ya no
--   está incluido; sin "hasta" = vigente sin fin.
--
-- Solo pueden escribir: administradores del cliente, consultores y super
-- admins, y solo si el cliente tiene nivel Pro o Max.
--
-- Errores para la interfaz: los bloqueos lanzan mensajes "ledger:<código>"
-- con el detalle en JSON (la app los traduce).
--
-- Se ejecuta una vez, en una transacción. La última consulta devuelve un
-- resumen en JSON de lo creado.
-- =====================================================================
begin;

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Acceso: la función de estructuras va con el nivel Pro o Max
-- ---------------------------------------------------------------------
create or replace function ledger.has_structures(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select accounts.is_super_admin()
      or exists (select 1 from accounts.companies c
                 where c.id = p_company_id and c.tier in ('pro', 'max'))
$$;

create or replace function ledger.can_edit_structures(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_company_id in (select ledger.my_company_ids())
     and ledger.can_manage(p_company_id)
     and ledger.has_structures(p_company_id)
$$;

revoke all on function ledger.has_structures(uuid)      from public, anon;
revoke all on function ledger.can_edit_structures(uuid) from public, anon;
grant execute on function ledger.has_structures(uuid)      to authenticated, service_role;
grant execute on function ledger.can_edit_structures(uuid) to authenticated, service_role;

-- Error con código y detalle para la interfaz
create or replace function ledger.fail(p_code text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'ledger:' || p_code, detail = p_detail::text;
end $$;

-- ---------------------------------------------------------------------
-- Configuración de grupo (una fila por cliente)
-- ---------------------------------------------------------------------
create table ledger.group_settings (
  company_id               uuid primary key references accounts.companies(id) on delete cascade,
  fiscal_year_end_month    smallint not null default 12 check (fiscal_year_end_month between 1 and 12),
  week_rule                text not null default 'iso_split'
                             check (week_rule in ('iso_split', '445', '454', '544')),
  week_start               smallint not null default 1 check (week_start between 1 and 7),  -- 1 = lunes … 7 = domingo
  close_granularity        text not null default 'month' check (close_granularity in ('month', 'week')),
  presentation_currency    char(3),
  extra_currencies         text[] not null default '{}',
  fx_rate_types            text[] not null default '{closing,average,historical}',
  fx_source                text not null default 'manual' check (fx_source in ('manual', 'import', 'auto')),
  number_scale             text not null default 'units' check (number_scale in ('units', 'thousands', 'millions')),
  decimals                 smallint not null default 2 check (decimals between 0 and 4),
  negative_style           text not null default 'parentheses' check (negative_style in ('parentheses', 'minus')),
  updated_at               timestamptz not null default now(),
  updated_by               uuid default auth.uid()
);

-- ---------------------------------------------------------------------
-- Empresas: se amplía ledger.entities (001)
-- ---------------------------------------------------------------------
alter table ledger.entities
  add column if not exists country      char(2),
  add column if not exists tax_id       text,
  add column if not exists entity_type  text not null default 'company',
  add column if not exists start_date   date,
  add column if not exists end_date     date,
  add column if not exists tags         text[] not null default '{}',
  add column if not exists data_owner   uuid,
  add column if not exists data_source  text,
  add column if not exists updated_at   timestamptz not null default now();

alter table ledger.entities
  add constraint entities_type_chk   check (entity_type in ('company', 'branch', 'adjustment')),
  add constraint entities_source_chk check (data_source is null or data_source in ('erp', 'excel', 'api')),
  add constraint entities_dates_chk  check (end_date is null or start_date is null or end_date >= start_date),
  add constraint entities_code_chk   check (length(btrim(code)) > 0);

-- Moneda funcional por fecha (sin solapes)
create table ledger.entity_currencies (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null,
  entity_id            uuid not null,
  functional_currency  char(3) not null,
  valid                daterange not null check (not isempty(valid) and lower(valid) is not null),
  created_at           timestamptz not null default now(),
  created_by           uuid default auth.uid(),
  foreign key (company_id, entity_id) references ledger.entities (company_id, id) on delete cascade,
  unique (company_id, id),
  exclude using gist (entity_id with =, valid with &&)
);

-- ---------------------------------------------------------------------
-- Propiedad legal: quién posee a quién (grafo, con fechas)
-- ---------------------------------------------------------------------
create table ledger.ownerships (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  holder_entity_id   uuid not null,
  held_entity_id     uuid not null,                       -- tenedora = participada: acciones propias
  economic_pct       numeric(9, 6) not null check (economic_pct > 0 and economic_pct <= 100),
  voting_pct         numeric(9, 6) not null check (voting_pct >= 0 and voting_pct <= 100),
  valid              daterange not null check (not isempty(valid) and lower(valid) is not null),
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  foreign key (company_id, holder_entity_id) references ledger.entities (company_id, id),
  foreign key (company_id, held_entity_id)   references ledger.entities (company_id, id),
  unique (company_id, id),
  exclude using gist (held_entity_id with =, holder_entity_id with =, valid with &&)
);
create index ownerships_held   on ledger.ownerships (company_id, held_entity_id);
create index ownerships_holder on ledger.ownerships (company_id, holder_entity_id);

-- Historial de operaciones (solo inserciones)
create table ledger.ownership_events (
  id                 bigint generated always as identity primary key,
  company_id         uuid not null references accounts.companies(id) on delete cascade,
  event_type         text not null check (event_type in (
                       'incorporation', 'purchase', 'additional_purchase', 'partial_sale',
                       'loss_of_control', 'sale', 'merger', 'liquidation', 'correction', 'import')),
  effective_date     date not null,
  holder_entity_id   uuid not null,
  held_entity_id     uuid not null,
  economic_before    numeric(9, 6) not null default 0,
  economic_after     numeric(9, 6) not null default 0,
  voting_before      numeric(9, 6) not null default 0,
  voting_after       numeric(9, 6) not null default 0,
  note               text,
  acquisition        jsonb not null default '{}'::jsonb,  -- fase 3: coste, valor razonable…
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  foreign key (company_id, holder_entity_id) references ledger.entities (company_id, id),
  foreign key (company_id, held_entity_id)   references ledger.entities (company_id, id)
);
create index ownership_events_held on ledger.ownership_events (company_id, held_entity_id, effective_date);

-- ---------------------------------------------------------------------
-- Estructuras de consolidación
-- ---------------------------------------------------------------------
create table ledger.structures (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references accounts.companies(id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  kind         text not null default 'legal' check (kind in ('legal', 'management', 'subconsolidation')),
  is_primary   boolean not null default false,
  description  text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  unique (company_id, name),
  unique (company_id, id)
);
create unique index structures_one_primary on ledger.structures (company_id) where is_primary;

-- Nodos agrupadores (regiones, divisiones…) para estructuras de gestión
create table ledger.structure_groups (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  structure_id  uuid not null,
  name          text not null,
  created_at    timestamptz not null default now(),
  foreign key (company_id, structure_id) references ledger.structures (company_id, id) on delete cascade,
  unique (company_id, id),
  unique (structure_id, name)
);

create table ledger.structure_nodes (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  structure_id      uuid not null,
  entity_id         uuid,                 -- empresa…
  group_id          uuid,                 -- …o nodo agrupador
  parent_entity_id  uuid,                 -- padre de consolidación (empresa)…
  parent_group_id   uuid,                 -- …o agrupador. Sin padre = cabecera
  classification    text not null default 'subsidiary' check (classification in (
                      'parent', 'subsidiary', 'joint_venture', 'associate', 'investment')),
  method            text not null default 'full' check (method in ('full', 'proportional', 'equity', 'none')),
  sub_method        text not null default 'full' check (sub_method in ('full', 'proportional')),
  assoc_method      text not null default 'equity' check (assoc_method in ('equity', 'proportional')),
  valid             daterange not null check (not isempty(valid) and lower(valid) is not null),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  check ((entity_id is null) <> (group_id is null)),
  check (parent_entity_id is null or parent_group_id is null),
  check (parent_entity_id is distinct from entity_id),
  foreign key (company_id, structure_id)     references ledger.structures (company_id, id) on delete cascade,
  foreign key (company_id, entity_id)        references ledger.entities (company_id, id),
  foreign key (company_id, parent_entity_id) references ledger.entities (company_id, id),
  foreign key (company_id, group_id)         references ledger.structure_groups (company_id, id) on delete cascade,
  foreign key (company_id, parent_group_id)  references ledger.structure_groups (company_id, id),
  unique (company_id, id),
  exclude using gist (structure_id with =, entity_id with =, valid with &&),
  exclude using gist (structure_id with =, group_id with =, valid with &&)
);
create index structure_nodes_struct on ledger.structure_nodes (company_id, structure_id);
create index structure_nodes_entity on ledger.structure_nodes (company_id, entity_id);

-- Historial de cambios en las estructuras (solo inserciones)
create table ledger.structure_events (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references accounts.companies(id) on delete cascade,
  structure_id    uuid not null,
  entity_id       uuid,
  event_type      text not null check (event_type in ('enter', 'move', 'change', 'exit', 'import')),
  effective_date  date not null,
  before          jsonb,
  after           jsonb,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  foreign key (company_id, structure_id) references ledger.structures (company_id, id) on delete cascade
);
create index structure_events_struct on ledger.structure_events (company_id, structure_id, effective_date);

-- ---------------------------------------------------------------------
-- Mapeo de cuentas locales → cuentas de grupo (por empresa y, si se
-- quiere, por estructura), con fechas. "Diseño de informe" sigue siendo
-- la tabla public.mappings.
-- ---------------------------------------------------------------------
create table ledger.account_mappings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  entity_id     uuid not null,
  structure_id  uuid,
  name          text,
  valid         daterange not null check (not isempty(valid) and lower(valid) is not null),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  foreign key (company_id, entity_id)    references ledger.entities (company_id, id) on delete cascade,
  foreign key (company_id, structure_id) references ledger.structures (company_id, id) on delete cascade,
  unique (company_id, id)
);
-- Sin solapes por empresa y estructura (estructura vacía = todas)
alter table ledger.account_mappings add constraint account_mappings_no_overlap
  exclude using gist (entity_id with =, (coalesce(structure_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =, valid with &&);

create table ledger.account_mapping_lines (
  id                  bigint generated always as identity primary key,
  company_id          uuid not null,
  mapping_id          uuid not null,
  local_account_code  text not null,
  group_account_code  text not null,
  sign                smallint not null default 1 check (sign in (1, -1)),
  foreign key (company_id, mapping_id) references ledger.account_mappings (company_id, id) on delete cascade,
  unique (mapping_id, local_account_code)
);

-- ---------------------------------------------------------------------
-- Auditoría: quién cambió qué y cuándo
-- ---------------------------------------------------------------------
create table ledger.audit_log (
  id          bigint generated always as identity primary key,
  company_id  uuid not null,
  table_name  text not null,
  row_id      text,
  entity_id   uuid,
  action      text not null check (action in ('insert', 'update', 'delete')),
  old_row     jsonb,
  new_row     jsonb,
  actor       uuid default auth.uid(),
  at          timestamptz not null default now()
);
create index audit_log_company on ledger.audit_log (company_id, at desc);
create index audit_log_entity  on ledger.audit_log (company_id, entity_id, at desc);

create or replace function ledger.tg_audit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  ent uuid;
begin
  ent := coalesce(
    nullif(r ->> 'held_entity_id', '')::uuid,
    nullif(r ->> 'entity_id', '')::uuid,
    case when tg_table_name = 'entities' then nullif(r ->> 'id', '')::uuid end);
  insert into ledger.audit_log (company_id, table_name, row_id, entity_id, action, old_row, new_row)
  values ((r ->> 'company_id')::uuid, tg_table_name, r ->> 'id', ent, lower(tg_op),
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['entities', 'entity_currencies', 'ownerships', 'structures',
                           'structure_nodes', 'account_mappings', 'group_settings'] loop
    execute format('create trigger %I after insert or update or delete on ledger.%I
                    for each row execute function ledger.tg_audit()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Reglas que bloquean
-- ---------------------------------------------------------------------

-- Períodos cerrados: una fecha de inicio o fin que cae en un mes cerrado
-- no se puede crear, mover ni borrar (hay que abrir el período antes).
create or replace function ledger.assert_open_range(p_company uuid, p_range daterange)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare d date;
begin
  if p_range is null or isempty(p_range) then return; end if;
  select p.start_date into d
  from ledger.periods p
  where p.company_id = p_company and p.is_locked
    and daterange(p.start_date, p.end_date, '[]') && p_range
  order by p.start_date
  limit 1;
  if d is not null then
    perform ledger.fail('period_locked', jsonb_build_object('date', d));
  end if;
end $$;

-- Crear o borrar una versión que toca un período cerrado reescribe el
-- pasado: se bloquea. Al mover una fecha, solo cuenta el tramo que cambia;
-- al cambiar los datos de una versión, toda la versión.
create or replace function ledger.tg_open_period()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  co uuid := coalesce(new.company_id, old.company_id);
begin
  if tg_op = 'INSERT' then
    perform ledger.assert_open_range(co, new.valid);
  elsif tg_op = 'DELETE' then
    perform ledger.assert_open_range(co, old.valid);
  else
    if to_jsonb(old) - 'valid' - 'created_at' - 'created_by' is distinct from to_jsonb(new) - 'valid' - 'created_at' - 'created_by' then
      perform ledger.assert_open_range(co, range_merge(new.valid, old.valid));
    else
      if lower(old.valid) is distinct from lower(new.valid) then
        perform ledger.assert_open_range(co, daterange(least(lower(old.valid), lower(new.valid)), greatest(lower(old.valid), lower(new.valid))));
      end if;
      if upper(old.valid) is distinct from upper(new.valid) then
        perform ledger.assert_open_range(co,
          case when upper(old.valid) is null or upper(new.valid) is null
               then daterange(coalesce(least(upper(old.valid), upper(new.valid)), upper(old.valid), upper(new.valid)), null)
               else daterange(least(upper(old.valid), upper(new.valid)), greatest(upper(old.valid), upper(new.valid))) end);
      end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger ownerships_open_period before insert or update or delete on ledger.ownerships
  for each row execute function ledger.tg_open_period();
create trigger structure_nodes_open_period before insert or update or delete on ledger.structure_nodes
  for each row execute function ledger.tg_open_period();
create trigger entity_currencies_open_period before insert or update or delete on ledger.entity_currencies
  for each row execute function ledger.tg_open_period();

-- La suma de % económicos sobre una participada no pasa del 100 % en
-- ninguna fecha (se comprueba al final de la transacción).
create or replace function ledger.check_ownership_total(p_company uuid, p_held uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare bad record;
begin
  select b.d, sum(o.economic_pct) as total into bad
  from (select distinct lower(valid) as d from ledger.ownerships
        where company_id = p_company and held_entity_id = p_held) b
  join ledger.ownerships o
    on o.company_id = p_company and o.held_entity_id = p_held and o.valid @> b.d
  group by b.d
  having sum(o.economic_pct) > 100.000001
  order by b.d
  limit 1;
  if found then
    perform ledger.fail('ownership_over_100', jsonb_build_object(
      'entity', (select code from ledger.entities where id = p_held), 'date', bad.d, 'total', bad.total));
  end if;
end $$;

create or replace function ledger.tg_ownership_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'DELETE' then
    perform ledger.check_ownership_total(new.company_id, new.held_entity_id);
  end if;
  return null;
end $$;

create constraint trigger ownerships_total_rule after insert or update on ledger.ownerships
  deferrable initially deferred
  for each row execute function ledger.tg_ownership_total();

-- Estructura: una sola cabecera, sin ciclos, el padre está en la
-- estructura en esa fecha y la primera consolidación no es anterior al
-- alta de la empresa. Se comprueba en cada fecha en la que algo cambia.
create or replace function ledger.check_structure(p_structure uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  d date;
  n int;
  bad record;
begin
  -- Primera consolidación ≥ fecha de alta
  select e.code, e.start_date, lower(sn.valid) as d into bad
  from ledger.structure_nodes sn
  join ledger.entities e on e.id = sn.entity_id
  where sn.structure_id = p_structure and e.start_date is not null and lower(sn.valid) < e.start_date
  limit 1;
  if found then
    perform ledger.fail('before_start_date', jsonb_build_object('entity', bad.code, 'date', bad.d, 'start_date', bad.start_date));
  end if;

  for d in
    select x from (
      select lower(valid) as x from ledger.structure_nodes where structure_id = p_structure
      union select upper(valid) from ledger.structure_nodes where structure_id = p_structure and upper(valid) is not null
    ) q order by x
  loop
    -- Una sola cabecera
    select count(*) into n from ledger.structure_nodes
    where structure_id = p_structure and valid @> d and entity_id is not null
      and parent_entity_id is null and parent_group_id is null;
    if n > 1 then
      perform ledger.fail('multiple_heads', jsonb_build_object('date', d, 'count', n,
        'entities', (select jsonb_agg(e.code order by e.code) from ledger.structure_nodes sn join ledger.entities e on e.id = sn.entity_id
                     where sn.structure_id = p_structure and sn.valid @> d and sn.parent_entity_id is null and sn.parent_group_id is null)));
    end if;

    -- El padre existe en la estructura en esa fecha
    select c.code as child, p.code as parent into bad
    from ledger.structure_nodes sn
    join ledger.entities c on c.id = sn.entity_id
    join ledger.entities p on p.id = sn.parent_entity_id
    where sn.structure_id = p_structure and sn.valid @> d
      and not exists (select 1 from ledger.structure_nodes pn
                      where pn.structure_id = p_structure and pn.entity_id = sn.parent_entity_id and pn.valid @> d)
    limit 1;
    if found then
      perform ledger.fail('parent_missing', jsonb_build_object('entity', bad.child, 'parent', bad.parent, 'date', d));
    end if;

    -- Sin ciclos
    with recursive up as (
      select sn.entity_id as start, sn.parent_entity_id as cur, array[sn.entity_id] as path, false as cyc
      from ledger.structure_nodes sn
      where sn.structure_id = p_structure and sn.valid @> d and sn.entity_id is not null
      union all
      select up.start, pn.parent_entity_id, up.path || up.cur, up.cur = any(up.path)
      from up
      join ledger.structure_nodes pn on pn.structure_id = p_structure and pn.entity_id = up.cur and pn.valid @> d
      where up.cur is not null and not up.cyc
    )
    select (select code from ledger.entities where id = up.start) as code into bad from up where up.cyc limit 1;
    if found then
      perform ledger.fail('cycle', jsonb_build_object('entity', bad.code, 'date', d));
    end if;
  end loop;
end $$;

create or replace function ledger.tg_structure_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform ledger.check_structure(coalesce(new.structure_id, old.structure_id));
  return null;
end $$;

create constraint trigger structure_nodes_rules after insert or update or delete on ledger.structure_nodes
  deferrable initially deferred
  for each row execute function ledger.tg_structure_check();

-- La moneda local no cambia si la empresa ya tiene datos
create or replace function ledger.tg_entity_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency
     and exists (select 1 from ledger.facts f where f.entity_id = old.id limit 1) then
    perform ledger.fail('currency_has_data', jsonb_build_object('entity', old.code));
  end if;
  if new.code is distinct from old.code
     and exists (select 1 from ledger.facts f where f.entity_id = old.id limit 1) then
    perform ledger.fail('code_has_data', jsonb_build_object('entity', old.code));
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger entities_guard before update on ledger.entities
  for each row execute function ledger.tg_entity_guard();

-- ---------------------------------------------------------------------
-- Privilegios y RLS
-- ---------------------------------------------------------------------
revoke all on ledger.group_settings, ledger.entity_currencies, ledger.ownerships, ledger.ownership_events,
              ledger.structures, ledger.structure_groups, ledger.structure_nodes, ledger.structure_events,
              ledger.account_mappings, ledger.account_mapping_lines, ledger.audit_log
  from public, anon;

grant select on ledger.group_settings, ledger.entity_currencies, ledger.ownerships, ledger.ownership_events,
               ledger.structures, ledger.structure_groups, ledger.structure_nodes, ledger.structure_events,
               ledger.account_mappings, ledger.account_mapping_lines, ledger.audit_log
  to authenticated;
grant insert, update, delete on ledger.group_settings, ledger.entity_currencies, ledger.ownerships,
                                ledger.structures, ledger.structure_groups, ledger.structure_nodes,
                                ledger.account_mappings, ledger.account_mapping_lines
  to authenticated;
grant insert on ledger.ownership_events, ledger.structure_events to authenticated;
grant all on ledger.group_settings, ledger.entity_currencies, ledger.ownerships, ledger.ownership_events,
             ledger.structures, ledger.structure_groups, ledger.structure_nodes, ledger.structure_events,
             ledger.account_mappings, ledger.account_mapping_lines, ledger.audit_log
  to service_role;
grant usage on all sequences in schema ledger to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['group_settings', 'entity_currencies', 'ownerships', 'ownership_events',
                           'structures', 'structure_groups', 'structure_nodes', 'structure_events',
                           'account_mappings', 'account_mapping_lines', 'audit_log'] loop
    execute format('alter table ledger.%I enable row level security', t);
    execute format(
      'create policy %I on ledger.%I for select to authenticated
         using (company_id in (select ledger.my_company_ids()))',
      t || '_select', t);
  end loop;

  foreach t in array array['group_settings', 'entity_currencies', 'ownerships', 'structures',
                           'structure_groups', 'structure_nodes', 'account_mappings', 'account_mapping_lines'] loop
    execute format(
      'create policy %I on ledger.%I for all to authenticated
         using      (ledger.can_edit_structures(company_id))
         with check (ledger.can_edit_structures(company_id))',
      t || '_manage', t);
  end loop;

  -- Historiales: solo se añaden filas, nunca se cambian ni se borran
  foreach t in array array['ownership_events', 'structure_events'] loop
    execute format(
      'create policy %I on ledger.%I for insert to authenticated
         with check (ledger.can_edit_structures(company_id) and created_by is not distinct from auth.uid())',
      t || '_insert', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Cálculos: % efectivo, perímetro a fecha y avisos
-- ---------------------------------------------------------------------

-- % efectivo del grupo en cada empresa a una fecha: suma, sobre todos los
-- caminos desde la cabecera, del producto de los % económicos. Las
-- acciones propias de una participada reducen sus acciones en circulación.
create or replace function ledger.effective_ownership(p_company uuid, p_head uuid, p_date date)
returns table (entity_id uuid, effective_pct numeric)
language sql stable
set search_path = ''
as $$
  with recursive own as (
    select o.holder_entity_id as holder, o.held_entity_id as held,
           o.economic_pct * 100 / nullif(100 - coalesce(ts.treasury, 0), 0) as pct
    from ledger.ownerships o
    left join lateral (
      select sum(t.economic_pct) as treasury from ledger.ownerships t
      where t.company_id = p_company and t.held_entity_id = o.held_entity_id
        and t.holder_entity_id = t.held_entity_id and t.valid @> p_date
    ) ts on true
    where o.company_id = p_company and o.valid @> p_date and o.holder_entity_id <> o.held_entity_id
  ),
  walk as (
    select p_head as ent, 100::numeric as pct, array[p_head] as path
    union all
    select own.held, walk.pct * own.pct / 100, walk.path || own.held
    from walk join own on own.holder = walk.ent
    where not own.held = any(walk.path) and array_length(walk.path, 1) < 40
  )
  select ent, least(round(sum(pct), 6), 100) from walk group by ent
$$;

-- Perímetro de una estructura a una fecha: el contrato que usan los
-- informes y, más adelante, el motor de consolidación.
create or replace function ledger.perimeter(p_structure uuid, p_date date default current_date)
returns table (
  entity_id uuid, code text, legal_name text, entity_type text, country char(2),
  parent_entity_id uuid, parent_code text, depth int,
  classification text, method text, sub_method text, assoc_method text,
  direct_pct numeric, voting_pct numeric, group_voting_pct numeric,
  effective_pct numeric, minority_pct numeric,
  local_currency char(3), functional_currency char(3),
  first_consolidation date, in_perimeter_since date, exit_date date, has_mapping boolean
)
language sql stable
set search_path = ''
as $$
  with recursive
  st as (select s.id, s.company_id from ledger.structures s where s.id = p_structure),
  nodes_at as (
    select sn.* from ledger.structure_nodes sn, st
    where sn.structure_id = st.id and sn.valid @> p_date and sn.entity_id is not null
  ),
  tree as (
    select n.entity_id, n.parent_entity_id, 0 as depth, array[n.entity_id] as path
    from nodes_at n where n.parent_entity_id is null and n.parent_group_id is null
    union all
    select c.entity_id, c.parent_entity_id, t.depth + 1, t.path || c.entity_id
    from nodes_at c join tree t on c.parent_entity_id = t.entity_id
    where not c.entity_id = any(t.path)
  ),
  head as (select entity_id from tree where depth = 0 limit 1),
  eff as (
    select e.* from head, st, ledger.effective_ownership(st.company_id, head.entity_id, p_date) e
  ),
  members as (select entity_id from nodes_at)
  select
    n.entity_id, e.code, e.legal_name, e.entity_type, e.country,
    n.parent_entity_id, pe.code,
    coalesce(t.depth, -1),
    n.classification, n.method, n.sub_method, n.assoc_method,
    dir.economic_pct, dir.voting_pct,
    (select sum(o.voting_pct) from ledger.ownerships o
     where o.held_entity_id = n.entity_id and o.valid @> p_date and o.holder_entity_id <> o.held_entity_id
       and o.holder_entity_id in (select entity_id from members)),
    case when n.parent_entity_id is null then 100 else coalesce(ef.effective_pct, 0) end,
    case when n.method = 'full' and n.parent_entity_id is not null
         then greatest(100 - coalesce(ef.effective_pct, 0), 0) end,
    e.currency,
    coalesce((select ec.functional_currency from ledger.entity_currencies ec
              where ec.entity_id = n.entity_id and ec.valid @> p_date), e.currency),
    (select min(lower(x.valid)) from ledger.structure_nodes x where x.structure_id = n.structure_id and x.entity_id = n.entity_id),
    lower(n.valid),
    upper(n.valid),
    exists (select 1 from ledger.account_mappings m
            where m.entity_id = n.entity_id and m.valid @> p_date
              and (m.structure_id is null or m.structure_id = n.structure_id))
  from nodes_at n
  join ledger.entities e on e.id = n.entity_id
  left join ledger.entities pe on pe.id = n.parent_entity_id
  left join tree t on t.entity_id = n.entity_id
  left join eff ef on ef.entity_id = n.entity_id
  left join ledger.ownerships dir
    on dir.holder_entity_id = n.parent_entity_id and dir.held_entity_id = n.entity_id and dir.valid @> p_date
  order by coalesce(t.depth, 99), e.code
$$;

-- Avisos de criterio (no bloquean: la decisión contable es del usuario)
create or replace function ledger.structure_warnings(p_structure uuid, p_date date default current_date)
returns table (severity text, code text, entity_id uuid, entity_code text, detail jsonb)
language sql stable
set search_path = ''
as $$
  with p as (select * from ledger.perimeter(p_structure, p_date)),
  co as (select company_id from ledger.structures where id = p_structure)
  -- Clasificación incoherente con el % de voto del grupo
  select 'warning', 'class_vs_voting', p.entity_id, p.code,
         jsonb_build_object('classification', p.classification, 'voting', coalesce(p.group_voting_pct, 0))
  from p
  where (p.classification = 'subsidiary' and coalesce(p.group_voting_pct, 0) <= 50)
     or (p.classification = 'associate' and coalesce(p.group_voting_pct, 0) > 50)
  union all
  -- Método que no corresponde a la clasificación
  select 'warning', 'method_vs_class', p.entity_id, p.code,
         jsonb_build_object('classification', p.classification, 'method', p.method)
  from p
  where (p.classification in ('parent', 'subsidiary') and p.method <> 'full')
     or (p.classification = 'associate' and p.method <> 'equity')
     or (p.classification = 'joint_venture' and p.method not in ('equity', 'proportional'))
     or (p.classification = 'investment' and p.method <> 'none')
  union all
  -- Participada sin % registrado por su padre de consolidación
  select 'warning', 'no_ownership', p.entity_id, p.code, jsonb_build_object('parent', p.parent_code)
  from p where p.parent_entity_id is not null and p.direct_pct is null
  union all
  -- Participaciones recíprocas
  select distinct 'warning', 'reciprocal', a.held_entity_id, e.code,
         jsonb_build_object('with', (select code from ledger.entities where id = a.holder_entity_id))
  from ledger.ownerships a
  join ledger.ownerships b on b.holder_entity_id = a.held_entity_id and b.held_entity_id = a.holder_entity_id
                          and b.valid @> p_date
  join ledger.entities e on e.id = a.held_entity_id
  where a.company_id = (select company_id from co) and a.valid @> p_date and a.holder_entity_id <> a.held_entity_id
  union all
  -- Sin mapeo de cuentas vigente (bloquea la subida de datos de esa empresa)
  select 'warning', 'no_mapping', p.entity_id, p.code, '{}'::jsonb
  from p where not p.has_mapping and p.entity_type <> 'adjustment'
  union all
  -- En el perímetro después de su fecha de baja
  select 'warning', 'after_end_date', p.entity_id, p.code, jsonb_build_object('end_date', e.end_date)
  from p join ledger.entities e on e.id = p.entity_id
  where e.end_date is not null and e.end_date < p_date
  union all
  -- Fuera del árbol (su padre no lleva a la cabecera)
  select 'warning', 'detached', p.entity_id, p.code, '{}'::jsonb
  from p where p.depth < 0
$$;

grant execute on function ledger.effective_ownership(uuid, uuid, date) to authenticated;
grant execute on function ledger.perimeter(uuid, date) to authenticated;
grant execute on function ledger.structure_warnings(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- Operaciones con fecha (la interfaz no edita filas: registra cambios)
-- Cada operación cierra la versión vigente en esa fecha y abre otra. Si
-- ya había una versión que empezaba ese mismo día, se corrige en su sitio.
-- ---------------------------------------------------------------------

-- Compra, venta, constitución… de una participación
create or replace function ledger.record_ownership(
  p_company uuid, p_holder uuid, p_held uuid, p_date date,
  p_economic numeric, p_voting numeric default null,
  p_event text default 'purchase', p_note text default null, p_acquisition jsonb default '{}'::jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  cur ledger.ownerships;
  nxt date;
  ev bigint;
  v numeric := coalesce(p_voting, p_economic);
begin
  if not ledger.can_edit_structures(p_company) then perform ledger.fail('forbidden'); end if;
  if p_date is null then perform ledger.fail('date_required'); end if;
  if p_economic < 0 or p_economic > 100 or v < 0 or v > 100 then perform ledger.fail('pct_range'); end if;

  select * into cur from ledger.ownerships
  where company_id = p_company and holder_entity_id = p_holder and held_entity_id = p_held and valid @> p_date
  for update;

  if found then
    if lower(cur.valid) = p_date then
      if p_economic = 0 then
        delete from ledger.ownerships where id = cur.id;
      else
        update ledger.ownerships set economic_pct = p_economic, voting_pct = v where id = cur.id;
      end if;
    else
      update ledger.ownerships set valid = daterange(lower(cur.valid), p_date) where id = cur.id;
      if p_economic > 0 then
        insert into ledger.ownerships (company_id, holder_entity_id, held_entity_id, economic_pct, voting_pct, valid)
        values (p_company, p_holder, p_held, p_economic, v, daterange(p_date, upper(cur.valid)));
      end if;
    end if;
  elsif p_economic > 0 then
    select min(lower(valid)) into nxt from ledger.ownerships
    where company_id = p_company and holder_entity_id = p_holder and held_entity_id = p_held and lower(valid) > p_date;
    insert into ledger.ownerships (company_id, holder_entity_id, held_entity_id, economic_pct, voting_pct, valid)
    values (p_company, p_holder, p_held, p_economic, v, daterange(p_date, nxt));
  end if;

  insert into ledger.ownership_events (company_id, event_type, effective_date, holder_entity_id, held_entity_id,
                                       economic_before, economic_after, voting_before, voting_after, note, acquisition)
  values (p_company, p_event, p_date, p_holder, p_held,
          coalesce(cur.economic_pct, 0), p_economic, coalesce(cur.voting_pct, 0), v, p_note, coalesce(p_acquisition, '{}'::jsonb))
  returning id into ev;
  return ev;
end $$;

-- Alta, movimiento o cambio de método de una empresa en una estructura
create or replace function ledger.set_node(
  p_structure uuid, p_entity uuid, p_date date,
  p_parent uuid, p_classification text, p_method text,
  p_sub_method text default 'full', p_assoc_method text default 'equity',
  p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  co uuid;
  cur ledger.structure_nodes;
  nxt date;
  new_id uuid;
  kind text;
begin
  select company_id into co from ledger.structures where id = p_structure;
  if co is null or not ledger.can_edit_structures(co) then perform ledger.fail('forbidden'); end if;
  if p_date is null then perform ledger.fail('date_required'); end if;

  select * into cur from ledger.structure_nodes
  where structure_id = p_structure and entity_id = p_entity and valid @> p_date
  for update;

  if found then
    kind := case when cur.parent_entity_id is distinct from p_parent then 'move' else 'change' end;
    if lower(cur.valid) = p_date then
      update ledger.structure_nodes
      set parent_entity_id = p_parent, classification = p_classification, method = p_method,
          sub_method = coalesce(p_sub_method, 'full'), assoc_method = coalesce(p_assoc_method, 'equity')
      where id = cur.id
      returning id into new_id;
    else
      update ledger.structure_nodes set valid = daterange(lower(cur.valid), p_date) where id = cur.id;
      insert into ledger.structure_nodes (company_id, structure_id, entity_id, parent_entity_id, classification,
                                          method, sub_method, assoc_method, valid)
      values (co, p_structure, p_entity, p_parent, p_classification, p_method,
              coalesce(p_sub_method, 'full'), coalesce(p_assoc_method, 'equity'), daterange(p_date, upper(cur.valid)))
      returning id into new_id;
    end if;
  else
    kind := 'enter';
    select min(lower(valid)) into nxt from ledger.structure_nodes
    where structure_id = p_structure and entity_id = p_entity and lower(valid) > p_date;
    insert into ledger.structure_nodes (company_id, structure_id, entity_id, parent_entity_id, classification,
                                        method, sub_method, assoc_method, valid)
    values (co, p_structure, p_entity, p_parent, p_classification, p_method,
            coalesce(p_sub_method, 'full'), coalesce(p_assoc_method, 'equity'), daterange(p_date, nxt))
    returning id into new_id;
  end if;

  insert into ledger.structure_events (company_id, structure_id, entity_id, event_type, effective_date, before, after, note)
  values (co, p_structure, p_entity, kind, p_date,
          case when cur.id is not null then jsonb_build_object('parent', cur.parent_entity_id, 'classification', cur.classification, 'method', cur.method) end,
          jsonb_build_object('parent', p_parent, 'classification', p_classification, 'method', p_method),
          p_note);
  return new_id;
end $$;

-- Salida del perímetro (venta, liquidación, fusión…) desde una fecha
create or replace function ledger.exit_node(p_structure uuid, p_entity uuid, p_date date, p_note text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  co uuid;
  cur ledger.structure_nodes;
begin
  select company_id into co from ledger.structures where id = p_structure;
  if co is null or not ledger.can_edit_structures(co) then perform ledger.fail('forbidden'); end if;
  if exists (select 1 from ledger.structure_nodes c where c.structure_id = p_structure and c.parent_entity_id = p_entity
             and c.valid && daterange(p_date, null)) then
    perform ledger.fail('has_children', jsonb_build_object('entity', (select code from ledger.entities where id = p_entity), 'date', p_date));
  end if;
  select * into cur from ledger.structure_nodes where structure_id = p_structure and entity_id = p_entity and valid @> p_date for update;
  if found then
    if lower(cur.valid) = p_date then delete from ledger.structure_nodes where id = cur.id;
    else update ledger.structure_nodes set valid = daterange(lower(cur.valid), p_date) where id = cur.id;
    end if;
  end if;
  delete from ledger.structure_nodes where structure_id = p_structure and entity_id = p_entity and lower(valid) > p_date;
  insert into ledger.structure_events (company_id, structure_id, entity_id, event_type, effective_date, before, note)
  values (co, p_structure, p_entity, 'exit', p_date,
          case when cur.id is not null then jsonb_build_object('parent', cur.parent_entity_id, 'classification', cur.classification, 'method', cur.method) end,
          p_note);
end $$;

-- Cambio de moneda funcional desde una fecha
create or replace function ledger.set_functional_currency(p_company uuid, p_entity uuid, p_date date, p_currency char(3))
returns void
language plpgsql
set search_path = ''
as $$
declare cur ledger.entity_currencies; nxt date;
begin
  if not ledger.can_edit_structures(p_company) then perform ledger.fail('forbidden'); end if;
  select * into cur from ledger.entity_currencies where entity_id = p_entity and valid @> p_date for update;
  if found then
    if lower(cur.valid) = p_date then
      update ledger.entity_currencies set functional_currency = p_currency where id = cur.id;
    else
      update ledger.entity_currencies set valid = daterange(lower(cur.valid), p_date) where id = cur.id;
      insert into ledger.entity_currencies (company_id, entity_id, functional_currency, valid)
      values (p_company, p_entity, p_currency, daterange(p_date, upper(cur.valid)));
    end if;
  else
    select min(lower(valid)) into nxt from ledger.entity_currencies where entity_id = p_entity and lower(valid) > p_date;
    insert into ledger.entity_currencies (company_id, entity_id, functional_currency, valid)
    values (p_company, p_entity, p_currency, daterange(p_date, nxt));
  end if;
end $$;

-- Importación completa (Konsolidator o Excel): empresas, propiedad,
-- nodos de una estructura y mapeos, en una sola transacción. Con
-- "replace", la propiedad de las empresas del archivo y los nodos de la
-- estructura se sustituyen por los del archivo.
create or replace function ledger.import_structure(p_company uuid, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s_id uuid;
  s jsonb := p_payload -> 'structure';
  repl boolean := coalesce((p_payload ->> 'replace')::boolean, false);
  src text := coalesce(p_payload ->> 'source', 'import');
  r jsonb;
  ent uuid;
  m_id uuid;
  n_ent int := 0; n_own int := 0; n_nodes int := 0; n_map int := 0;
  ids jsonb := '{}'::jsonb;
  held_ids uuid[] := '{}';
begin
  if not ledger.can_edit_structures(p_company) then perform ledger.fail('forbidden'); end if;

  -- Empresas (por código)
  for r in select * from jsonb_array_elements(coalesce(p_payload -> 'entities', '[]'::jsonb)) loop
    insert into ledger.entities (company_id, code, legal_name, currency, country, tax_id, entity_type,
                                 start_date, end_date, tags, data_source)
    values (p_company, btrim(r ->> 'code'), nullif(r ->> 'legal_name', ''), upper(coalesce(nullif(r ->> 'currency', ''), 'EUR')),
            nullif(upper(r ->> 'country'), ''), nullif(r ->> 'tax_id', ''), coalesce(nullif(r ->> 'entity_type', ''), 'company'),
            nullif(r ->> 'start_date', '')::date, nullif(r ->> 'end_date', '')::date,
            coalesce(array(select jsonb_array_elements_text(r -> 'tags')), '{}'), nullif(r ->> 'data_source', ''))
    on conflict (company_id, code) do update set
      legal_name  = coalesce(excluded.legal_name, ledger.entities.legal_name),
      currency    = case when r ? 'currency' and nullif(r ->> 'currency', '') is not null then excluded.currency else ledger.entities.currency end,
      country     = coalesce(excluded.country, ledger.entities.country),
      tax_id      = coalesce(excluded.tax_id, ledger.entities.tax_id),
      entity_type = case when r ? 'entity_type' then excluded.entity_type else ledger.entities.entity_type end,
      start_date  = coalesce(excluded.start_date, ledger.entities.start_date),
      end_date    = case when r ? 'end_date' then excluded.end_date else ledger.entities.end_date end,
      tags        = case when r ? 'tags' then excluded.tags else ledger.entities.tags end,
      data_source = coalesce(excluded.data_source, ledger.entities.data_source)
    returning id into ent;
    ids := ids || jsonb_build_object(btrim(r ->> 'code'), ent);
    n_ent := n_ent + 1;
  end loop;
  -- Códigos de todas las empresas del cliente
  select coalesce(jsonb_object_agg(code, id), '{}'::jsonb) into ids from ledger.entities where company_id = p_company;

  -- Estructura
  if s is not null then
    select id into s_id from ledger.structures where company_id = p_company and name = s ->> 'name';
    if s_id is null then
      if coalesce((s ->> 'is_primary')::boolean, false) then
        update ledger.structures set is_primary = false where company_id = p_company and is_primary;
      end if;
      insert into ledger.structures (company_id, name, kind, is_primary)
      values (p_company, s ->> 'name', coalesce(s ->> 'kind', 'legal'), coalesce((s ->> 'is_primary')::boolean, false))
      returning id into s_id;
    end if;
  end if;

  -- Propiedad. Con "replace" se quitan solo las versiones que no vienen en
  -- el paquete y se insertan solo las nuevas: lo que no cambia no se toca
  -- (así una reimportación sin cambios funciona aunque haya meses cerrados).
  if repl then
    select coalesce(array_agg((ids ->> (x ->> 'held'))::uuid), '{}') into held_ids
    from jsonb_array_elements(coalesce(p_payload -> 'ownerships', '[]'::jsonb)) x where ids ? (x ->> 'held');
    delete from ledger.ownerships o
    where o.company_id = p_company and o.held_entity_id = any(held_ids)
      and not exists (
        select 1 from jsonb_array_elements(coalesce(p_payload -> 'ownerships', '[]'::jsonb)) x
        where (ids ->> (x ->> 'holder'))::uuid = o.holder_entity_id
          and (ids ->> (x ->> 'held'))::uuid = o.held_entity_id
          and daterange((x ->> 'from')::date, nullif(x ->> 'to', '')::date) = o.valid
          and (x ->> 'economic')::numeric = o.economic_pct
          and coalesce(nullif(x ->> 'voting', '')::numeric, (x ->> 'economic')::numeric) = o.voting_pct);
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_payload -> 'ownerships', '[]'::jsonb)) loop
    if not ids ? (r ->> 'holder') or not ids ? (r ->> 'held') then
      perform ledger.fail('unknown_entity', jsonb_build_object('entity', case when ids ? (r ->> 'holder') then r ->> 'held' else r ->> 'holder' end));
    end if;
    continue when exists (
      select 1 from ledger.ownerships o
      where o.company_id = p_company
        and o.holder_entity_id = (ids ->> (r ->> 'holder'))::uuid and o.held_entity_id = (ids ->> (r ->> 'held'))::uuid
        and o.valid = daterange((r ->> 'from')::date, nullif(r ->> 'to', '')::date)
        and o.economic_pct = (r ->> 'economic')::numeric
        and o.voting_pct = coalesce(nullif(r ->> 'voting', '')::numeric, (r ->> 'economic')::numeric));
    insert into ledger.ownerships (company_id, holder_entity_id, held_entity_id, economic_pct, voting_pct, valid)
    values (p_company, (ids ->> (r ->> 'holder'))::uuid, (ids ->> (r ->> 'held'))::uuid,
            (r ->> 'economic')::numeric, coalesce(nullif(r ->> 'voting', '')::numeric, (r ->> 'economic')::numeric),
            daterange((r ->> 'from')::date, nullif(r ->> 'to', '')::date));
    insert into ledger.ownership_events (company_id, event_type, effective_date, holder_entity_id, held_entity_id,
                                         economic_after, voting_after, note)
    values (p_company, 'import', (r ->> 'from')::date, (ids ->> (r ->> 'holder'))::uuid, (ids ->> (r ->> 'held'))::uuid,
            (r ->> 'economic')::numeric, coalesce(nullif(r ->> 'voting', '')::numeric, (r ->> 'economic')::numeric), src);
    n_own := n_own + 1;
  end loop;

  -- Nodos de la estructura (con "replace", igual: solo lo que cambia)
  if s_id is not null then
    for r in select * from jsonb_array_elements(coalesce(p_payload -> 'nodes', '[]'::jsonb)) loop
      if not ids ? (r ->> 'entity') or (nullif(r ->> 'parent', '') is not null and not ids ? (r ->> 'parent')) then
        perform ledger.fail('unknown_entity', jsonb_build_object('entity', case when ids ? (r ->> 'entity') then r ->> 'parent' else r ->> 'entity' end));
      end if;
    end loop;
    if repl then
      with i as (
      select (ids ->> (r2 ->> 'entity'))::uuid as entity_id, (ids ->> nullif(r2 ->> 'parent', ''))::uuid as parent_entity_id,
             coalesce(nullif(r2 ->> 'classification', ''), case when nullif(r2 ->> 'parent', '') is null then 'parent' else 'subsidiary' end) as classification,
             coalesce(nullif(r2 ->> 'method', ''), 'full') as method, coalesce(nullif(r2 ->> 'sub_method', ''), 'full') as sub_method,
             coalesce(nullif(r2 ->> 'assoc_method', ''), 'equity') as assoc_method,
             daterange((r2 ->> 'from')::date, nullif(r2 ->> 'to', '')::date) as valid
      from jsonb_array_elements(coalesce(p_payload -> 'nodes', '[]'::jsonb)) r2)
      delete from ledger.structure_nodes n
      where n.structure_id = s_id
        and not exists (select 1 from i
                        where i.entity_id is not distinct from n.entity_id and i.parent_entity_id is not distinct from n.parent_entity_id
                          and i.classification = n.classification and i.method = n.method and i.sub_method = n.sub_method
                          and i.assoc_method = n.assoc_method and i.valid = n.valid);
    end if;
    with i as (
      select (ids ->> (r2 ->> 'entity'))::uuid as entity_id, (ids ->> nullif(r2 ->> 'parent', ''))::uuid as parent_entity_id,
             coalesce(nullif(r2 ->> 'classification', ''), case when nullif(r2 ->> 'parent', '') is null then 'parent' else 'subsidiary' end) as classification,
             coalesce(nullif(r2 ->> 'method', ''), 'full') as method, coalesce(nullif(r2 ->> 'sub_method', ''), 'full') as sub_method,
             coalesce(nullif(r2 ->> 'assoc_method', ''), 'equity') as assoc_method,
             daterange((r2 ->> 'from')::date, nullif(r2 ->> 'to', '')::date) as valid
      from jsonb_array_elements(coalesce(p_payload -> 'nodes', '[]'::jsonb)) r2)
    insert into ledger.structure_nodes (company_id, structure_id, entity_id, parent_entity_id, classification,
                                        method, sub_method, assoc_method, valid)
    select p_company, s_id, i.entity_id, i.parent_entity_id, i.classification, i.method, i.sub_method, i.assoc_method, i.valid
    from i
    where not exists (select 1 from ledger.structure_nodes n
                      where n.structure_id = s_id and n.entity_id is not distinct from i.entity_id
                        and n.parent_entity_id is not distinct from i.parent_entity_id and n.classification = i.classification
                        and n.method = i.method and n.sub_method = i.sub_method and n.assoc_method = i.assoc_method
                        and n.valid = i.valid);
    get diagnostics n_nodes = row_count;
    insert into ledger.structure_events (company_id, structure_id, event_type, effective_date, note, after)
    values (p_company, s_id, 'import', current_date, src, jsonb_build_object('nodes', n_nodes, 'ownerships', n_own, 'entities', n_ent));
  end if;

  -- Mapeos de cuentas
  for r in select * from jsonb_array_elements(coalesce(p_payload -> 'mappings', '[]'::jsonb)) loop
    if not ids ? (r ->> 'entity') then
      perform ledger.fail('unknown_entity', jsonb_build_object('entity', r ->> 'entity'));
    end if;
    -- La misma versión (empresa, ámbito y fecha de inicio) se sustituye
    delete from ledger.account_mappings
    where entity_id = (ids ->> (r ->> 'entity'))::uuid and lower(valid) = (r ->> 'from')::date
      and structure_id is not distinct from
          (case when coalesce((r ->> 'all_structures')::boolean, true) then null else s_id end);
    insert into ledger.account_mappings (company_id, entity_id, structure_id, name, valid)
    values (p_company, (ids ->> (r ->> 'entity'))::uuid,
            case when coalesce((r ->> 'all_structures')::boolean, true) then null else s_id end,
            nullif(r ->> 'name', ''), daterange((r ->> 'from')::date, nullif(r ->> 'to', '')::date))
    returning id into m_id;
    insert into ledger.account_mapping_lines (company_id, mapping_id, local_account_code, group_account_code, sign)
    select p_company, m_id, btrim(l ->> 'local'), btrim(l ->> 'group'), coalesce((l ->> 'sign')::smallint, 1)
    from jsonb_array_elements(coalesce(r -> 'lines', '[]'::jsonb)) l
    where nullif(btrim(l ->> 'local'), '') is not null and nullif(btrim(l ->> 'group'), '') is not null;
    n_map := n_map + 1;
  end loop;

  return jsonb_build_object('structure_id', s_id, 'entities', n_ent, 'ownerships', n_own, 'nodes', n_nodes, 'mappings', n_map);
end $$;

-- ---------------------------------------------------------------------
-- Calendario: genera meses y semanas según la configuración del grupo.
--   iso_split: meses naturales (desde el mes siguiente al cierre); las
--              semanas se parten a fin de mes (dos filas con el mismo nº).
--   445 / 454 / 544: años de 52 o 53 semanas que acaban el último
--              día de la semana del mes de cierre; los meses son de 4 o 5
--              semanas según el patrón (la semana 53 va al último mes).
-- No toca períodos cerrados ni con datos. Devuelve cuántos ha creado.
-- ---------------------------------------------------------------------
create or replace function ledger.generate_periods(p_company uuid, p_from_year int, p_to_year int, p_replace boolean default false)
returns int
language plpgsql
set search_path = ''
as $$
declare
  cfg ledger.group_settings;
  y int; k int; w int;
  fy_start date; fy_end date; m_start date; m_end date; ws date; wk0 date;
  month_id uuid;
  created int := 0;
  pattern int[];
  weeks_in_year int;
  wcount int;
  last_dow int;
  rc int;
begin
  if not ledger.can_edit_structures(p_company) then perform ledger.fail('forbidden'); end if;
  if p_to_year < p_from_year or p_to_year - p_from_year > 30 then perform ledger.fail('year_range'); end if;
  select * into cfg from ledger.group_settings where company_id = p_company;
  if not found then
    insert into ledger.group_settings (company_id) values (p_company) returning * into cfg;
  end if;

  if p_replace then
    -- Semanas y luego meses de esos años, si no están cerrados ni tienen datos
    delete from ledger.periods p
    where p.company_id = p_company and p.period_type = 'week' and p.fiscal_year between p_from_year and p_to_year
      and not p.is_locked and not exists (select 1 from ledger.uploads u where u.period_id = p.id);
    delete from ledger.periods p
    where p.company_id = p_company and p.period_type = 'month' and p.fiscal_year between p_from_year and p_to_year
      and not p.is_locked and not exists (select 1 from ledger.uploads u where u.period_id = p.id)
      and not exists (select 1 from ledger.periods c where c.parent_period_id = p.id);
  end if;

  pattern := case cfg.week_rule when '445' then array[4,4,5] when '454' then array[4,5,4] when '544' then array[5,4,4] else null end;
  last_dow := ((cfg.week_start + 5) % 7) + 1;    -- último día de la semana (ISO 1..7)

  for y in p_from_year .. p_to_year loop
    if pattern is null then
      -- Meses naturales
      fy_end   := (make_date(y, cfg.fiscal_year_end_month, 1) + interval '1 month - 1 day')::date;
      fy_start := (make_date(y, cfg.fiscal_year_end_month, 1) + interval '1 month' - interval '1 year')::date;
      wk0 := fy_start - ((extract(isodow from fy_start)::int - cfg.week_start + 7) % 7);
      for k in 1 .. 12 loop
        m_start := (fy_start + make_interval(months => k - 1))::date;
        m_end   := (m_start + interval '1 month - 1 day')::date;
        insert into ledger.periods (company_id, period_type, fiscal_year, fiscal_month, start_date, end_date)
        values (p_company, 'month', y, k, m_start, m_end)
        on conflict (company_id, period_type, start_date) do nothing
        returning id into month_id;
        get diagnostics rc = row_count; created := created + rc;
        if month_id is null then
          select id into month_id from ledger.periods where company_id = p_company and period_type = 'month' and start_date = m_start;
        end if;
        if cfg.close_granularity = 'week' then
          ws := m_start - ((extract(isodow from m_start)::int - cfg.week_start + 7) % 7);
          while ws <= m_end loop
            w := least((ws - wk0) / 7 + 1, 53);
            insert into ledger.periods (company_id, period_type, fiscal_year, fiscal_month, fiscal_week, start_date, end_date, parent_period_id)
            values (p_company, 'week', y, k, w, greatest(ws, m_start), least(ws + 6, m_end), month_id)
            on conflict (company_id, period_type, start_date) do nothing;
            get diagnostics rc = row_count; created := created + rc;
            ws := ws + 7;
          end loop;
        end if;
        month_id := null;
      end loop;
    else
      -- 4-4-5 y variantes: el año acaba el último día de la semana del mes de cierre
      fy_end := (make_date(y, cfg.fiscal_year_end_month, 1) + interval '1 month - 1 day')::date;
      fy_end := fy_end - ((extract(isodow from fy_end)::int - last_dow + 7) % 7);
      fy_start := (make_date(y - 1, cfg.fiscal_year_end_month, 1) + interval '1 month - 1 day')::date;
      fy_start := fy_start - ((extract(isodow from fy_start)::int - last_dow + 7) % 7) + 1;
      weeks_in_year := (fy_end - fy_start + 1) / 7;
      ws := fy_start;
      w := 1;
      for k in 1 .. 12 loop
        wcount := pattern[((k - 1) % 3) + 1];
        if k = 12 and weeks_in_year = 53 then wcount := wcount + 1; end if;
        m_start := ws;
        m_end := ws + wcount * 7 - 1;
        insert into ledger.periods (company_id, period_type, fiscal_year, fiscal_month, start_date, end_date)
        values (p_company, 'month', y, k, m_start, m_end)
        on conflict (company_id, period_type, start_date) do nothing
        returning id into month_id;
        get diagnostics rc = row_count; created := created + rc;
        if month_id is null then
          select id into month_id from ledger.periods where company_id = p_company and period_type = 'month' and start_date = m_start;
        end if;
        if cfg.close_granularity = 'week' then
          for k2 in 1 .. wcount loop
            insert into ledger.periods (company_id, period_type, fiscal_year, fiscal_month, fiscal_week, start_date, end_date, parent_period_id)
            values (p_company, 'week', y, k, least(w, 53), ws, ws + 6, month_id)
            on conflict (company_id, period_type, start_date) do nothing;
            get diagnostics rc = row_count; created := created + rc;
            ws := ws + 7; w := w + 1;
          end loop;
        else
          ws := m_end + 1; w := w + wcount;
        end if;
        month_id := null;
      end loop;
    end if;
  end loop;
  return created;
end $$;

grant execute on function ledger.record_ownership(uuid, uuid, uuid, date, numeric, numeric, text, text, jsonb) to authenticated;
grant execute on function ledger.set_node(uuid, uuid, date, uuid, text, text, text, text, text) to authenticated;
grant execute on function ledger.exit_node(uuid, uuid, date, text) to authenticated;
grant execute on function ledger.set_functional_currency(uuid, uuid, date, char) to authenticated;
grant execute on function ledger.import_structure(uuid, jsonb) to authenticated;
grant execute on function ledger.generate_periods(uuid, int, int, boolean) to authenticated;
revoke all on function ledger.fail(text, jsonb) from public, anon;
grant execute on function ledger.fail(text, jsonb) to authenticated, service_role;

-- Resumen de lo creado
select jsonb_build_object(
  'tables', (select jsonb_agg(table_name order by table_name) from information_schema.tables
             where table_schema = 'ledger' and table_name in ('group_settings', 'entity_currencies', 'ownerships',
               'ownership_events', 'structures', 'structure_groups', 'structure_nodes', 'structure_events',
               'account_mappings', 'account_mapping_lines', 'audit_log')),
  'rls_on', (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'ledger' and c.relkind = 'r'),
  'btree_gist', exists (select 1 from pg_extension where extname = 'btree_gist')
) as resultado;

commit;
