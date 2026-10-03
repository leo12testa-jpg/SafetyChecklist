-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261003-before-internal-activities.json
create table public.ore_attivita_interne (
 id uuid primary key default gen_random_uuid(),
 tecnico_uid text not null, tecnico_nome text, data_lavoro date not null,
 categoria text not null check(categoria in ('formazione_interna','amministrazione','commerciale_preventivi','aggiornamento_normativo','riunioni_interne','altro_interno','assenza')),
 minuti_effettivi integer not null check(minuti_effettivi between 0 and 1440),
 confermata boolean not null default false, confermata_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.ore_attivita_interne enable row level security;
revoke all on public.ore_attivita_interne from anon,authenticated;
grant all on public.ore_attivita_interne to service_role;
create index ore_interne_tecnico_data_idx on public.ore_attivita_interne(tecnico_uid,data_lavoro);
alter table public.ore_sessioni add constraint ore_sessioni_minutes_upper_limit check(minuti_effettivi<=1440) not valid;
create view public.ore_rendicontazioni with (security_invoker=true) as
 select id,'sessione'::text as tipo_record,tecnico_uid,tecnico_nome,data_lavoro,minuti_effettivi,
  null::text as categoria,commessa_id,true as fatturabile,false as assenza,confermata,confermata_at,updated_at
 from public.ore_sessioni
 union all
 select id,'interna'::text,tecnico_uid,tecnico_nome,data_lavoro,minuti_effettivi,
  categoria,null::uuid,false,categoria='assenza',confermata,confermata_at,updated_at
 from public.ore_attivita_interne;
revoke all on public.ore_rendicontazioni from anon,authenticated;
grant select on public.ore_rendicontazioni to service_role;

create function public.ore_verifica_limite_giornaliero() returns trigger
language plpgsql security invoker set search_path=public as $$
declare total bigint; record_type text; old_key text; new_key text;
begin
 record_type:=case when tg_table_name='ore_sessioni' then 'sessione' else 'interna' end;
 new_key:=new.tecnico_uid||':'||new.data_lavoro::text;
 old_key:=case when tg_op='UPDATE' then old.tecnico_uid||':'||old.data_lavoro::text else new_key end;
 perform pg_advisory_xact_lock(hashtextextended(least(old_key,new_key),0));
 if old_key<>new_key then perform pg_advisory_xact_lock(hashtextextended(greatest(old_key,new_key),0)); end if;
 if new.minuti_effettivi<0 or new.minuti_effettivi>1440 then raise exception 'Durata non valida: 0-1440 minuti'; end if;
 select coalesce(sum(minuti_effettivi),0) into total from public.ore_rendicontazioni
 where tecnico_uid=new.tecnico_uid and data_lavoro=new.data_lavoro and not(id=new.id and tipo_record=record_type);
 if total+new.minuti_effettivi>1440 then raise exception 'La somma giornaliera supera 24 ore'; end if;
 return new;
end $$;
revoke all on function public.ore_verifica_limite_giornaliero() from public,anon,authenticated;
create trigger ore_sessioni_daily_limit before insert or update of minuti_effettivi,tecnico_uid,data_lavoro
 on public.ore_sessioni for each row execute function public.ore_verifica_limite_giornaliero();
create trigger ore_interne_daily_limit before insert or update of minuti_effettivi,tecnico_uid,data_lavoro
 on public.ore_attivita_interne for each row execute function public.ore_verifica_limite_giornaliero();

create function public.ore_salva_attivita_interna(p_id uuid,p_uid text,p_name text,p_day date,p_category text,p_minutes integer,p_actor text,p_admin boolean)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare previous public.ore_attivita_interne%rowtype; saved public.ore_attivita_interne%rowtype;
begin
 if p_id is not null then
  select * into previous from public.ore_attivita_interne where id=p_id for update;
  if not found then raise exception 'Attivita non trovata'; end if;
  if previous.tecnico_uid<>p_actor and not p_admin then raise exception 'Non autorizzato'; end if;
  if previous.tecnico_uid<>p_uid or previous.data_lavoro<>p_day then raise exception 'Tecnico e data non modificabili'; end if;
 end if;
 if p_uid<>p_actor and not p_admin then raise exception 'Non autorizzato'; end if;
 insert into public.ore_attivita_interne(id,tecnico_uid,tecnico_nome,data_lavoro,categoria,minuti_effettivi)
 values(coalesce(p_id,gen_random_uuid()),p_uid,p_name,p_day,p_category,p_minutes)
 on conflict(id) do update set categoria=excluded.categoria,minuti_effettivi=excluded.minuti_effettivi,
  confermata=false,confermata_at=null,updated_at=clock_timestamp()
 returning * into saved;
 update public.ore_giornate set stato='riaperta',confermata_at=null,updated_at=clock_timestamp()
 where tecnico_uid=p_uid and data=p_day and stato='confermata';
 insert into public.ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)
 values(p_actor,'salva_attivita_interna','attivita_interna',saved.id::text,jsonb_build_object('prima',case when p_id is null then null else to_jsonb(previous) end,'dopo',to_jsonb(saved)));
 return jsonb_build_object('ok',true,'id',saved.id);
end $$;
revoke all on function public.ore_salva_attivita_interna(uuid,text,text,date,text,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.ore_salva_attivita_interna(uuid,text,text,date,text,integer,text,boolean) to service_role;

create function public.ore_conferma_giornata(p_uid text,p_name text,p_day date)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare total bigint; stamp timestamptz:=clock_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended(p_uid||':'||p_day::text,0));
 if exists(select 1 from public.ore_sync_issues where tecnico_uid=p_uid and data_lavoro=p_day and stato='aperta')
 then raise exception 'Ci sono attivita CRM da verificare prima di confermare la giornata'; end if;
 select coalesce(sum(minuti_effettivi),0) into total from public.ore_rendicontazioni where tecnico_uid=p_uid and data_lavoro=p_day;
 if total>1440 then raise exception 'La somma giornaliera supera 24 ore'; end if;
 insert into public.ore_giornate(tecnico_uid,tecnico_nome,data,minuti_totali,stato,confermata_at,updated_at)
 values(p_uid,p_name,p_day,total,'confermata',stamp,stamp)
 on conflict(tecnico_uid,data) do update set minuti_totali=total,stato='confermata',confermata_at=stamp,updated_at=stamp;
 update public.ore_sessioni set confermata=true,confermata_at=stamp,updated_at=stamp where tecnico_uid=p_uid and data_lavoro=p_day;
 update public.ore_attivita_interne set confermata=true,confermata_at=stamp,updated_at=stamp where tecnico_uid=p_uid and data_lavoro=p_day;
 insert into public.ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)
 values(p_uid,'conferma_giornata','giornata',p_day::text,jsonb_build_object('minuti',total));
 return jsonb_build_object('ok',true,'totalMinutes',total);
end $$;
revoke all on function public.ore_conferma_giornata(text,text,date) from public,anon,authenticated;
grant execute on function public.ore_conferma_giornata(text,text,date) to service_role;
