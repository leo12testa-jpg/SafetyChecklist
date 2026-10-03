-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261003-before-session-phase.json
alter table public.ore_sessioni add column fase text
 check(fase is null or fase in ('sopralluogo','trasferta','redazione','revisione','riunione_cliente','misurazioni','formazione_erogata','altro'));
create function public.ore_salva_fase(p_id uuid,p_phase text,p_actor text,p_admin boolean,p_expected timestamptz,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare previous public.ore_sessioni%rowtype; day_confirmed boolean; stamp timestamptz:=clock_timestamp();
begin
 select * into previous from public.ore_sessioni where id=p_id;
 if not found then raise exception 'Sessione non trovata'; end if;
 perform pg_advisory_xact_lock(hashtextextended(previous.tecnico_uid||':'||previous.data_lavoro::text,0));
 select * into previous from public.ore_sessioni where id=p_id for update;
 if previous.tecnico_uid<>p_actor and not p_admin then raise exception 'Non autorizzato'; end if;
 if previous.updated_at is distinct from p_expected then raise exception 'Sessione cambiata nel frattempo: ricarica'; end if;
 select exists(select 1 from public.ore_giornate where tecnico_uid=previous.tecnico_uid and data=previous.data_lavoro and stato='confermata') into day_confirmed;
 if previous.confermata or day_confirmed then
  if not p_admin then raise exception 'Giornata confermata: serve sblocco amministratore'; end if;
  if trim(coalesce(p_reason,''))='' then raise exception 'Indica il motivo della modifica alla giornata confermata'; end if;
 end if;
 update public.ore_sessioni set fase=p_phase,confermata=false,confermata_at=null,updated_at=stamp where id=p_id;
 update public.ore_giornate set stato='riaperta',confermata_at=null,updated_at=clock_timestamp()
 where tecnico_uid=previous.tecnico_uid and data=previous.data_lavoro and stato='confermata';
 insert into public.ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)
 values(p_actor,'modifica_fase','sessione',p_id::text,jsonb_build_object('fase_prima',previous.fase,'fase_dopo',p_phase,'motivo',nullif(trim(p_reason),'')));
 return jsonb_build_object('ok',true,'updatedAt',stamp);
end $$;
revoke all on function public.ore_salva_fase(uuid,text,text,boolean,timestamptz,text) from public,anon,authenticated;
grant execute on function public.ore_salva_fase(uuid,text,text,boolean,timestamptz,text) to service_role;
