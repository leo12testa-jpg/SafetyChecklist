-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261005-before-day-unlocks.json
create table public.ore_richieste_sblocco(
 id uuid primary key default gen_random_uuid(),tecnico_uid text not null,data date not null,
 motivo text not null check(length(trim(motivo)) between 1 and 500),richiesto_da text not null,created_at timestamptz not null default now(),
 stato text not null default 'aperta' check(stato in ('aperta','approvata','rifiutata')),
 risolto_da text,risolto_at timestamptz,motivo_admin text
);
alter table public.ore_richieste_sblocco enable row level security;
revoke all on public.ore_richieste_sblocco from anon,authenticated;
grant all on public.ore_richieste_sblocco to service_role;
create unique index ore_sblocco_aperto_idx on public.ore_richieste_sblocco(tecnico_uid,data) where stato='aperta';
create function public.ore_blocca_confermata() returns trigger language plpgsql security invoker set search_path=public as $$
declare uid text; day date; confirmed boolean:=false; admin boolean:=coalesce(current_setting('ore.admin',true),'')='true'; reason text:=nullif(trim(current_setting('ore.reason',true)),'');
begin
 if tg_op<>'INSERT' then uid:=old.tecnico_uid;day:=old.data_lavoro;confirmed:=old.confermata;else uid:=new.tecnico_uid;day:=new.data_lavoro;end if;
 if tg_op='UPDATE' and coalesce(current_setting('ore.confirming',true),'')='on'
  and (to_jsonb(old)-array['updated_at','confermata','confermata_at']) is not distinct from (to_jsonb(new)-array['updated_at','confermata','confermata_at']) then return new;end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('ore-identita',0));
 perform pg_advisory_xact_lock(hashtextextended(ore_persona(uid)||':'||day::text,0));
 confirmed:=confirmed or exists(select 1 from ore_giornate where ore_persona(tecnico_uid)=ore_persona(uid) and data=day and stato='confermata');
 if tg_op<>'DELETE' then confirmed:=confirmed or exists(select 1 from ore_giornate where ore_persona(tecnico_uid)=ore_persona(new.tecnico_uid) and data=new.data_lavoro and stato='confermata');end if;
 if confirmed then
  if not admin then raise exception 'Giornata confermata: richiedi lo sblocco all amministratore';end if;
  if reason is null then raise exception 'Motivo obbligatorio per modificare una giornata confermata';end if;
 end if;
 return coalesce(new,old);
end $$;
revoke all on function public.ore_blocca_confermata() from public,anon,authenticated;
create trigger ore_sessioni_confirmed_guard before insert or update or delete on public.ore_sessioni for each row execute function public.ore_blocca_confermata();
create trigger ore_interne_confirmed_guard before insert or update or delete on public.ore_attivita_interne for each row execute function public.ore_blocca_confermata();
create function public.ore_richiedi_sblocco(p_uid text,p_day date,p_reason text,p_actor text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare saved ore_richieste_sblocco%rowtype;
begin
 if p_uid<>p_actor or length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Richiesta non valida';end if;
 perform pg_advisory_xact_lock(hashtextextended(ore_persona(p_uid)||':'||p_day::text,0));
 if not exists(select 1 from ore_giornate where tecnico_uid=p_uid and data=p_day and stato='confermata')
 and not exists(select 1 from ore_rendicontazioni where tecnico_uid=p_uid and data_lavoro=p_day and confermata)then raise exception 'Giornata non confermata';end if;
 insert into ore_richieste_sblocco(tecnico_uid,data,motivo,richiesto_da)values(p_uid,p_day,trim(p_reason),p_actor) returning * into saved;
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,'richiesta_sblocco','giornata',p_uid||':'||p_day::text,to_jsonb(saved));
 return to_jsonb(saved);
end $$;
revoke all on function public.ore_richiedi_sblocco(text,date,text,text) from public,anon,authenticated;
grant execute on function public.ore_richiedi_sblocco(text,date,text,text) to service_role;
create function public.ore_decidi_sblocco(p_id uuid,p_approve boolean,p_reason text,p_actor text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare request ore_richieste_sblocco%rowtype; stamp timestamptz:=clock_timestamp();
begin
 if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Indica il motivo della decisione';end if;
 select * into request from ore_richieste_sblocco where id=p_id;if not found then raise exception 'Richiesta non trovata';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('ore-identita',0));
 perform pg_advisory_xact_lock(hashtextextended(ore_persona(request.tecnico_uid)||':'||request.data::text,0));
 select * into request from ore_richieste_sblocco where id=p_id for update;
 if request.stato<>'aperta' then raise exception 'Richiesta gia decisa';end if;
 if p_approve then
  perform set_config('ore.actor',p_actor,true);perform set_config('ore.admin','true',true);perform set_config('ore.reason',trim(p_reason),true);
  update ore_giornate set stato='riaperta',confermata_at=null,updated_at=stamp where tecnico_uid=request.tecnico_uid and data=request.data;
  update ore_sessioni set confermata=false,confermata_at=null,updated_at=stamp where tecnico_uid=request.tecnico_uid and data_lavoro=request.data;
  update ore_attivita_interne set confermata=false,confermata_at=null,updated_at=stamp where tecnico_uid=request.tecnico_uid and data_lavoro=request.data;
 end if;
 update ore_richieste_sblocco set stato=case when p_approve then 'approvata' else 'rifiutata' end,risolto_da=p_actor,risolto_at=stamp,motivo_admin=trim(p_reason) where id=p_id;
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,case when p_approve then 'sblocco_giornata' else 'rifiuto_sblocco' end,'giornata',request.tecnico_uid||':'||request.data::text,jsonb_build_object('richiesta',to_jsonb(request),'motivo',trim(p_reason)));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.ore_decidi_sblocco(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.ore_decidi_sblocco(uuid,boolean,text,text) to service_role;
do $$
declare signature text; definition text;
begin
 foreach signature in array array['public.ore_scrivi_sessione(text,jsonb,uuid,text,boolean,text)','public.ore_salva_fase(uuid,text,text,boolean,timestamptz,text)','public.ore_salva_attivita_interna(uuid,text,text,date,text,integer,text,boolean)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  definition:=regexp_replace(definition,'\mbegin\M','begin'||chr(10)||' perform set_config(''ore.admin'',p_admin::text,true);'||chr(10),'i');execute definition;
  if signature like '%ore_salva_attivita_interna%' then
   definition:=regexp_replace(definition,'\mbegin\M','begin'||chr(10)||' perform pg_advisory_xact_lock_shared(hashtextextended(''ore-identita'',0));perform pg_advisory_xact_lock(hashtextextended(ore_persona(p_uid)||'':''||p_day::text,0));'||chr(10),'i');execute definition;
  end if;
  if signature like '%ore_salva_fase%' then
   definition:=replace(definition,'hashtextextended(previous.tecnico_uid||','hashtextextended(ore_persona(previous.tecnico_uid)||');execute definition;
  end if;
 end loop;
 select pg_get_functiondef('public.ore_conferma_giornata(text,text,date)'::regprocedure) into definition;
 definition:=regexp_replace(definition,'\mbegin\M','begin'||chr(10)||' perform set_config(''ore.confirming'',''on'',true);'||chr(10),'i');execute definition;
 definition:=replace(definition,'hashtextextended(p_uid||','hashtextextended(ore_persona(p_uid)||');
 definition:=regexp_replace(definition,'\mbegin\M','begin'||chr(10)||' perform pg_advisory_xact_lock_shared(hashtextextended(''ore-identita'',0));'||chr(10),'i');execute definition;
end $$;
