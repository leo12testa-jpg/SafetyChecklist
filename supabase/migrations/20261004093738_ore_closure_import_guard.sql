-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261004-before-closure-import-guard.json
create or replace function public.ore_cambia_stato_pratica(p_id uuid,p_close boolean,p_delivery date,p_revisions integer,p_note text,p_actor text,p_expected timestamptz)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare previous public.ore_commesse%rowtype; saved public.ore_commesse%rowtype; action text; previous_flag text;
begin
 select * into previous from ore_commesse where id=p_id for update;
 if not found then raise exception 'Pratica non trovata';end if;
 if previous.updated_at is distinct from p_expected then raise exception 'Pratica cambiata: ricarica il dettaglio';end if;
 previous_flag:=current_setting('ore.chiusura_esplicita',true);
 perform set_config('ore.chiusura_esplicita','on',true);
 if p_close then
  if previous.stato not in ('in_lavorazione','sospesa')then raise exception 'Pratica non aperta';end if;
  if p_delivery is null or p_delivery>(clock_timestamp() at time zone 'Europe/Rome')::date or p_revisions is null or p_revisions<0 then raise exception 'Consegna o revisioni non valide';end if;
  action:='chiusura';
  update ore_commesse set stato='completata',consegna_data=p_delivery,data_completamento=p_delivery,revisioni_cliente=p_revisions,nota_chiusura=nullif(trim(p_note),''),updated_at=clock_timestamp() where id=p_id returning * into saved;
 else
  if previous.stato<>'completata' then raise exception 'Pratica non completata';end if;
  action:='riapertura';
  update ore_commesse set stato='in_lavorazione',updated_at=clock_timestamp() where id=p_id returning * into saved;
 end if;
 perform set_config('ore.chiusura_esplicita',coalesce(previous_flag,''),true);
 insert into ore_pratiche_storia(commessa_id,azione,attore_uid,prima,dopo,nota)values(p_id,action,p_actor,to_jsonb(previous),to_jsonb(saved),nullif(trim(p_note),''));
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,action||'_pratica','commessa',p_id::text,jsonb_build_object('prima',previous.stato,'dopo',saved.stato,'consegna',saved.consegna_data,'revisioni',saved.revisioni_cliente));
 return jsonb_build_object('ok',true,'updatedAt',saved.updated_at);
end $$;

create function public.ore_proteggi_chiusura() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if current_setting('ore.chiusura_esplicita',true) is distinct from 'on'
 and (new.stato,new.data_completamento,new.consegna_data,new.revisioni_cliente,new.nota_chiusura) is distinct from (old.stato,old.data_completamento,old.consegna_data,old.revisioni_cliente,old.nota_chiusura)
 and exists(select 1 from ore_pratiche_storia where commessa_id=old.id)
 then raise exception 'Pratica chiusa esplicitamente: import o modifica dello stato da verificare';end if;
 return new;
end $$;
revoke all on function public.ore_proteggi_chiusura()from public,anon,authenticated;
create trigger ore_commesse_closure_guard before update of stato,data_completamento,consegna_data,revisioni_cliente,nota_chiusura on public.ore_commesse for each row execute function public.ore_proteggi_chiusura();
