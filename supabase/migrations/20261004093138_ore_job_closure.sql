-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261004-before-job-closure.json
alter table public.ore_commesse add column consegna_data date,
 add column revisioni_cliente integer check(revisioni_cliente>=0), add column nota_chiusura text;
create table public.ore_pratiche_storia(
 id bigint generated always as identity primary key, commessa_id uuid not null references public.ore_commesse(id),
 azione text not null check(azione in ('chiusura','riapertura')), attore_uid text not null,
 created_at timestamptz not null default clock_timestamp(), prima jsonb not null, dopo jsonb not null, nota text
);
alter table public.ore_pratiche_storia enable row level security;
revoke all on public.ore_pratiche_storia from anon,authenticated;
grant all on public.ore_pratiche_storia to service_role;
grant usage,select on sequence public.ore_pratiche_storia_id_seq to service_role;
create index ore_pratiche_storia_job_idx on public.ore_pratiche_storia(commessa_id,created_at);
create function public.ore_cambia_stato_pratica(p_id uuid,p_close boolean,p_delivery date,p_revisions integer,p_note text,p_actor text,p_expected timestamptz)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare previous public.ore_commesse%rowtype; saved public.ore_commesse%rowtype; action text;
begin
 select * into previous from ore_commesse where id=p_id for update;
 if not found then raise exception 'Pratica non trovata';end if;
 if previous.updated_at is distinct from p_expected then raise exception 'Pratica cambiata: ricarica il dettaglio';end if;
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
 insert into ore_pratiche_storia(commessa_id,azione,attore_uid,prima,dopo,nota)values(p_id,action,p_actor,to_jsonb(previous),to_jsonb(saved),nullif(trim(p_note),''));
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,action||'_pratica','commessa',p_id::text,jsonb_build_object('prima',previous.stato,'dopo',saved.stato,'consegna',saved.consegna_data,'revisioni',saved.revisioni_cliente));
 return jsonb_build_object('ok',true,'updatedAt',saved.updated_at);
end $$;
revoke all on function public.ore_cambia_stato_pratica(uuid,boolean,date,integer,text,text,timestamptz)from public,anon,authenticated;
grant execute on function public.ore_cambia_stato_pratica(uuid,boolean,date,integer,text,text,timestamptz)to service_role;
