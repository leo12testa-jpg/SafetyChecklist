-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261004-before-identity-aliases.json
create table public.ore_identita_alias (
 uid_storico text primary key check(uid_storico like 'legacy:%'),
 tecnico_uid text not null check(tecnico_uid not like 'legacy:%'),
 tecnico_nome text, risorsa_crm_id uuid not null references public.ore_risorse_crm(id),
 approvato_da text not null, approvato_at timestamptz not null default clock_timestamp()
);
alter table public.ore_identita_alias enable row level security;
revoke all on public.ore_identita_alias from anon,authenticated;
grant all on public.ore_identita_alias to service_role;
create index ore_alias_account_idx on public.ore_identita_alias(tecnico_uid);
create function public.ore_persona(p_uid text) returns text language sql volatile security invoker set search_path=public as $$
 select coalesce((select tecnico_uid from ore_identita_alias where uid_storico=p_uid),p_uid)
$$;
revoke all on function public.ore_persona(text) from public,anon,authenticated;
grant execute on function public.ore_persona(text) to service_role;
create function public.ore_collega_identita(p_resource uuid,p_uid text,p_name text,p_actor text,p_previous_uid text,p_previous_approval timestamptz,p_previous_alias text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare resource public.ore_risorse_crm%rowtype; source_uid text; old_alias public.ore_identita_alias%rowtype; result jsonb;
begin
 select * into resource from ore_risorse_crm where id=p_resource and attiva for update;
 if not found then raise exception 'Risorsa non trovata'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ore-identita',0));
 source_uid:='legacy:'||resource.sigla_crm;
 perform pg_advisory_xact_lock(hashtextextended('identity:'||source_uid,0));
 select * into old_alias from ore_identita_alias where uid_storico=source_uid;
 if old_alias.tecnico_uid is distinct from p_previous_alias then raise exception 'Identita cambiata: ricarica anteprima'; end if;
 if exists(select 1 from ore_rendicontazioni where tecnico_uid=source_uid or ore_persona(tecnico_uid)=p_uid group by data_lavoro having sum(minuti_effettivi)>1440)
 then raise exception 'Identita con giorni oltre 24h: verificare prima del collegamento'; end if;
 result:=ore_approva_collegamento_crm(p_resource,p_uid,p_name,p_actor,p_previous_uid,p_previous_approval,'[]'::jsonb);
 insert into ore_identita_alias(uid_storico,tecnico_uid,tecnico_nome,risorsa_crm_id,approvato_da)
 values(source_uid,p_uid,p_name,p_resource,p_actor)
 on conflict(uid_storico) do update set tecnico_uid=excluded.tecnico_uid,tecnico_nome=excluded.tecnico_nome,risorsa_crm_id=excluded.risorsa_crm_id,approvato_da=excluded.approvato_da,approvato_at=clock_timestamp();
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli) values(p_actor,'collega_identita','identita',source_uid,jsonb_build_object('prima',old_alias.tecnico_uid,'dopo',p_uid,'risorsa',p_resource,'sessioni_riscritte',0));
 return jsonb_build_object('ok',true,'uidStorico',source_uid,'tecnicoUid',p_uid,'sessioniRiscritte',0);
end $$;
revoke all on function public.ore_collega_identita(uuid,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.ore_collega_identita(uuid,text,text,text,text,timestamptz,text) to service_role;
-- Identity-aware cap: a new account cannot exceed 24h by splitting hours across aliases.
create or replace function public.ore_verifica_limite_giornaliero() returns trigger
language plpgsql security invoker set search_path=public as $$
declare total bigint; record_type text; old_key text; new_key text; person text;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('ore-identita',0));
 if tg_op='UPDATE' and old.tecnico_uid like 'legacy:%' and new.tecnico_uid is distinct from old.tecnico_uid
 then raise exception 'UID storico immutabile: usa una identita approvata'; end if;
 record_type:=case when tg_table_name='ore_sessioni' then 'sessione' else 'interna' end;
 person:=ore_persona(new.tecnico_uid); new_key:=person||':'||new.data_lavoro::text;
 old_key:=case when tg_op='UPDATE' then ore_persona(old.tecnico_uid)||':'||old.data_lavoro::text else new_key end;
 perform pg_advisory_xact_lock(hashtextextended(least(old_key,new_key),0));
 if old_key<>new_key then perform pg_advisory_xact_lock(hashtextextended(greatest(old_key,new_key),0)); end if;
 if new.minuti_effettivi<0 or new.minuti_effettivi>1440 then raise exception 'Durata non valida: 0-1440 minuti'; end if;
 select coalesce(sum(minuti_effettivi),0) into total from ore_rendicontazioni
 where ore_persona(tecnico_uid)=person and data_lavoro=new.data_lavoro and not(id=new.id and tipo_record=record_type);
 if total+new.minuti_effettivi>1440 then raise exception 'La somma giornaliera supera 24 ore'; end if;
 return new;
end $$;
