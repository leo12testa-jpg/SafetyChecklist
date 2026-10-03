-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261003-before-work-schedules.json
create table public.ore_orari_tecnici(
 id uuid primary key default gen_random_uuid(), tecnico_uid text not null, tecnico_nome text,
 valido_dal date not null, settimana_minuti integer[] not null,
 creato_da text, created_at timestamptz not null default now(),
 unique(tecnico_uid,valido_dal),
 check(array_ndims(settimana_minuti)=1 and array_length(settimana_minuti,1)=7 and array_position(settimana_minuti,null) is null
   and 0<=all(settimana_minuti) and 1440>=all(settimana_minuti))
);
alter table public.ore_orari_tecnici enable row level security;
revoke all on public.ore_orari_tecnici from anon,authenticated;
grant all on public.ore_orari_tecnici to service_role;
create function public.ore_aggiungi_orario(p_uid text,p_name text,p_from date,p_week integer[],p_actor text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare previous public.ore_orari_tecnici%rowtype; saved public.ore_orari_tecnici%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('schedule:'||p_uid,0));
 select * into previous from public.ore_orari_tecnici where tecnico_uid=p_uid order by valido_dal desc limit 1;
 if previous.id is not null and p_from<=previous.valido_dal then
  raise exception 'La nuova decorrenza deve essere successiva all ultima configurazione: lo storico non viene sovrascritto';
 end if;
 insert into public.ore_orari_tecnici(tecnico_uid,tecnico_nome,valido_dal,settimana_minuti,creato_da)
 values(p_uid,p_name,p_from,p_week,p_actor) returning * into saved;
 insert into public.ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)
 values(p_actor,'configura_orario','orario_tecnico',saved.id::text,
  jsonb_build_object('prima',case when previous.id is null then null else to_jsonb(previous) end,'dopo',to_jsonb(saved)));
 return jsonb_build_object('ok',true,'id',saved.id);
end $$;
revoke all on function public.ore_aggiungi_orario(text,text,date,integer[],text) from public,anon,authenticated;
grant execute on function public.ore_aggiungi_orario(text,text,date,integer[],text) to service_role;
