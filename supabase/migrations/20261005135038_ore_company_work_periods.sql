-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261005-before-company-periods.json
create table public.ore_periodi_aziendali(
 id uuid primary key default gen_random_uuid(),nome text not null check(length(trim(nome)) between 1 and 80),
 data_inizio date not null,data_fine date not null check(data_fine>=data_inizio),
 settimana_minuti integer[] not null check(cardinality(settimana_minuti)=7 and array_position(settimana_minuti,null) is null and 0<=all(settimana_minuti) and 1440>=all(settimana_minuti)),
 creato_da text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.ore_periodi_aziendali enable row level security;
revoke all on public.ore_periodi_aziendali from anon,authenticated;
grant all on public.ore_periodi_aziendali to service_role;
create index ore_periodi_date_idx on public.ore_periodi_aziendali(data_inizio,data_fine);
create function public.ore_salva_periodo(p_id uuid,p_name text,p_start date,p_end date,p_week integer[],p_actor text,p_expected timestamptz,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare previous ore_periodi_aziendali%rowtype; saved ore_periodi_aziendali%rowtype; today date:=(now() at time zone 'Europe/Rome')::date;
begin
 if p_start is null or p_end is null or p_end<p_start or length(trim(coalesce(p_name,''))) not between 1 and 80
  or cardinality(p_week) is distinct from 7 or exists(select 1 from unnest(p_week) v where v is null or v<0 or v>1440)then raise exception 'Periodo non valido';end if;
 perform pg_advisory_xact_lock(hashtextextended('ore-periodi-aziendali',0));
 if p_id is not null then
  select * into previous from ore_periodi_aziendali where id=p_id for update;
  if not found or previous.updated_at is distinct from p_expected then raise exception 'Periodo cambiato: ricarica';end if;
 end if;
 if (p_start<today or previous.data_inizio<today) and nullif(trim(p_reason),'') is null then raise exception 'Motivo obbligatorio per un periodo passato';end if;
 if exists(select 1 from ore_periodi_aziendali where id is distinct from p_id and data_inizio<=p_end and data_fine>=p_start)then raise exception 'Il periodo si sovrappone a un altro periodo aziendale';end if;
 insert into ore_periodi_aziendali(id,nome,data_inizio,data_fine,settimana_minuti,creato_da)
 values(coalesce(p_id,gen_random_uuid()),trim(p_name),p_start,p_end,p_week,p_actor)
 on conflict(id) do update set nome=excluded.nome,data_inizio=excluded.data_inizio,data_fine=excluded.data_fine,settimana_minuti=excluded.settimana_minuti,updated_at=clock_timestamp()
 returning * into saved;
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,'salva_periodo_aziendale','periodo_aziendale',saved.id::text,jsonb_build_object('prima',case when p_id is null then null else to_jsonb(previous) end,'dopo',to_jsonb(saved),'motivo',nullif(trim(p_reason),''),'ore_registrate_modificate',false));
 return to_jsonb(saved);
end $$;
revoke all on function public.ore_salva_periodo(uuid,text,date,date,integer[],text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.ore_salva_periodo(uuid,text,date,date,integer[],text,timestamptz,text) to service_role;
