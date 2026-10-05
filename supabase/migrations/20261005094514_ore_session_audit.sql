-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261005-before-session-audit.json
create table public.ore_sessioni_storia(
 id bigint generated always as identity primary key,
 sessione_id uuid not null, commessa_id uuid, tecnico_uid text not null,
 attore_uid text not null, created_at timestamptz not null default clock_timestamp(),
 azione text not null check(azione in ('creazione','modifica','eliminazione')),
 prima jsonb, dopo jsonb, motivo text
);
alter table public.ore_sessioni_storia enable row level security;
revoke all on public.ore_sessioni_storia from anon,authenticated;
grant select,insert on public.ore_sessioni_storia to service_role;
grant usage,select on sequence public.ore_sessioni_storia_id_seq to service_role;
create index ore_sessioni_storia_commessa_idx on public.ore_sessioni_storia(commessa_id,created_at);
create function public.ore_traccia_sessione() returns trigger language plpgsql security invoker set search_path=public as $$
declare previous jsonb; following jsonb; actor text:=nullif(current_setting('ore.actor',true),''); reason text:=nullif(trim(current_setting('ore.reason',true)),''); was_confirmed boolean; row_session ore_sessioni%rowtype;
begin
 if tg_op<>'INSERT' then previous:=to_jsonb(old);row_session:=old;end if;
 if tg_op<>'DELETE' then following:=to_jsonb(new);row_session:=new;end if;
 if tg_op='UPDATE' and (previous-array['updated_at','confermata','confermata_at']) is not distinct from (following-array['updated_at','confermata','confermata_at']) then return new;end if;
 if actor is null then raise exception 'Scrittura sessione senza attore verificato';end if;
 if tg_op<>'INSERT' then
  was_confirmed:=old.confermata or exists(select 1 from ore_giornate where tecnico_uid=old.tecnico_uid and data=old.data_lavoro and stato='confermata');
  if was_confirmed and reason is null then raise exception 'Motivo obbligatorio per modificare una giornata confermata';end if;
 end if;
 insert into ore_sessioni_storia(sessione_id,commessa_id,tecnico_uid,attore_uid,azione,prima,dopo,motivo)
 values(row_session.id,row_session.commessa_id,row_session.tecnico_uid,actor,case tg_op when 'INSERT' then 'creazione' when 'DELETE' then 'eliminazione' else 'modifica' end,previous,following,reason);
 -- Also retain the old practice when a session is moved to another practice.
 if tg_op='UPDATE' and old.commessa_id is distinct from new.commessa_id then
  insert into ore_sessioni_storia(sessione_id,commessa_id,tecnico_uid,attore_uid,azione,prima,dopo,motivo)
  values(old.id,old.commessa_id,old.tecnico_uid,actor,'modifica',previous,following,reason);
 end if;
 return coalesce(new,old);
end $$;
revoke all on function public.ore_traccia_sessione() from public,anon,authenticated;
create trigger ore_sessioni_audit after insert or update or delete on public.ore_sessioni for each row execute function public.ore_traccia_sessione();

create function public.ore_scrivi_sessione(p_operation text,p_payload jsonb,p_id uuid,p_actor text,p_admin boolean,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare previous ore_sessioni%rowtype; saved ore_sessioni%rowtype; keys text; assignments text; field text; actor_before text:=current_setting('ore.actor',true); reason_before text:=current_setting('ore.reason',true);
begin
 if p_operation not in ('insert','update','upsert','delete') or nullif(p_actor,'') is null then raise exception 'Scrittura non valida';end if;
 if p_operation in ('update','delete') then
  select * into previous from ore_sessioni where id=p_id for update;
  if not found then raise exception 'Sessione non trovata';end if;
 elsif p_operation='upsert' and nullif(p_payload->>'crm_event_id','') is not null then
  perform pg_advisory_xact_lock(hashtextextended('ore-event:'||(p_payload->>'tecnico_uid')||':'||(p_payload->>'crm_event_id'),0));
  select * into previous from ore_sessioni where tecnico_uid=p_payload->>'tecnico_uid' and crm_event_id=p_payload->>'crm_event_id' for update;
 end if;
 if previous.id is not null and previous.tecnico_uid<>p_actor and not p_admin then raise exception 'Non autorizzato';end if;
 if previous.id is null and p_payload->>'tecnico_uid' is distinct from p_actor and not p_admin then raise exception 'Non autorizzato';end if;
 perform set_config('ore.actor',p_actor,true);perform set_config('ore.reason',coalesce(p_reason,''),true);
 if p_operation='delete' then
  delete from ore_sessioni where id=previous.id returning * into saved;
 else
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload='{}'::jsonb then raise exception 'Dati sessione mancanti';end if;
  for field in select jsonb_object_keys(p_payload) loop
   if not exists(select 1 from pg_attribute where attrelid='public.ore_sessioni'::regclass and attname=field and attnum>0 and not attisdropped)
    or field in ('created_at','id') then raise exception 'Campo sessione non ammesso';end if;
  end loop;
  select string_agg(format('%I',key),',' order by key),string_agg(format('%1$I=r.%1$I',key),',' order by key)
   into keys,assignments from jsonb_object_keys(p_payload) key;
  if previous.id is null then
   execute format('insert into public.ore_sessioni(%s) select %s from jsonb_populate_record(null::public.ore_sessioni,$1) r returning *',keys,keys) into saved using p_payload;
  else
   execute format('update public.ore_sessioni s set %s from jsonb_populate_record(null::public.ore_sessioni,$1) r where s.id=$2 returning s.*',assignments) into saved using p_payload,previous.id;
  end if;
 end if;
 perform set_config('ore.actor',coalesce(actor_before,''),true);perform set_config('ore.reason',coalesce(reason_before,''),true);
 return to_jsonb(saved);
end $$;
revoke all on function public.ore_scrivi_sessione(text,jsonb,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.ore_scrivi_sessione(text,jsonb,uuid,text,boolean,text) to service_role;

-- Existing phase RPC participates in the same transaction-scoped audit.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.ore_salva_fase(uuid,text,text,boolean,timestamptz,text)'::regprocedure) into definition;
 definition:=regexp_replace(definition,'\mbegin\M','begin'||chr(10)||' perform set_config(''ore.actor'',p_actor,true);perform set_config(''ore.reason'',coalesce(p_reason,''''),true);'||chr(10),'i');
 execute definition;
 select pg_get_functiondef('public.ore_approva_collegamento_crm(uuid,text,text,text,text,timestamptz,jsonb)'::regprocedure) into definition;
 definition:=regexp_replace(definition,'\mbegin\M','begin'||chr(10)||' perform set_config(''ore.actor'',p_actor,true);perform set_config(''ore.reason'',''Riassegnazione esplicita approvata'',true);'||chr(10),'i');
 execute definition;
end $$;
