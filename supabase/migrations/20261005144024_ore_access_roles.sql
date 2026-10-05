-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261005-before-access-roles.json
create table public.ore_ruoli_utenti(
 tecnico_uid text primary key,ruolo text not null check(ruolo in ('admin_operativo','direzione')),
 assegnato_da text not null,updated_at timestamptz not null default clock_timestamp()
);
alter table public.ore_ruoli_utenti enable row level security;
revoke all on public.ore_ruoli_utenti from anon,authenticated;
grant select,insert,update on public.ore_ruoli_utenti to service_role;
create function public.ore_assegna_ruolo(p_uid text,p_role text,p_actor text) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare previous ore_ruoli_utenti%rowtype; saved ore_ruoli_utenti%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('ore-roles',0));
 if not exists(select 1 from ore_ruoli_utenti where tecnico_uid=p_actor and ruolo='direzione')then raise exception 'Assegnazione riservata alla direzione';end if;
 if p_role not in ('admin_operativo','direzione') or p_role is null or length(trim(coalesce(p_uid,'')))=0 then raise exception 'Ruolo non valido';end if;
 select * into previous from ore_ruoli_utenti where tecnico_uid=p_uid for update;
 if previous.ruolo='direzione' and p_role<>'direzione' and (select count(*) from ore_ruoli_utenti where ruolo='direzione')<2 then raise exception 'Deve rimanere almeno un account direzione';end if;
 insert into ore_ruoli_utenti(tecnico_uid,ruolo,assegnato_da)values(p_uid,p_role,p_actor)
 on conflict(tecnico_uid)do update set ruolo=excluded.ruolo,assegnato_da=excluded.assegnato_da,updated_at=clock_timestamp()returning * into saved;
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,'assegna_ruolo_ore','ruolo_ore',p_uid,jsonb_build_object('prima',case when previous.tecnico_uid is null then null else to_jsonb(previous) end,'dopo',to_jsonb(saved)));
 return to_jsonb(saved);
end $$;
revoke all on function public.ore_assegna_ruolo(text,text,text) from public,anon,authenticated;
grant execute on function public.ore_assegna_ruolo(text,text,text) to service_role;
-- UID verificato dal collegamento esplicito esistente, non ricavato dal nome.
insert into ore_ruoli_utenti(tecnico_uid,ruolo,assegnato_da)values('iREKNAJuP6QjRDOIW3jFstWgYod2','direzione','iREKNAJuP6QjRDOIW3jFstWgYod2');
insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values('iREKNAJuP6QjRDOIW3jFstWgYod2','assegna_ruolo_ore','ruolo_ore','iREKNAJuP6QjRDOIW3jFstWgYod2',jsonb_build_object('prima',null,'dopo',jsonb_build_object('ruolo','direzione'),'motivo','Decisione Colligo F1 del 5 ottobre 2026'));
