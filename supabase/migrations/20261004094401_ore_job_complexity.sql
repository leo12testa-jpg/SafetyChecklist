-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261004-before-job-complexity.json
alter table public.ore_commesse
 add column fascia_lavoratori text check(fascia_lavoratori in ('1-9','10-49','50-249','250+')),
 add column numero_sedi integer check(numero_sedi between 1 and 100000),
 add column numero_mansioni integer check(numero_mansioni between 1 and 100000),
 add column tipo_intervento text check(tipo_intervento in ('prima_redazione','aggiornamento','revisione')),
 add column settore text check(length(settore)<=200);
create function public.ore_salva_complessita(p_id uuid,p_data jsonb,p_actor text,p_expected timestamptz)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare previous public.ore_commesse%rowtype; saved public.ore_commesse%rowtype;
begin
 select * into previous from ore_commesse where id=p_id for update;
 if not found then raise exception 'Pratica non trovata';end if;
 if previous.updated_at is distinct from p_expected then raise exception 'Pratica cambiata: ricarica';end if;
 update ore_commesse set fascia_lavoratori=p_data->>'fascia_lavoratori',numero_sedi=(p_data->>'numero_sedi')::integer,
 numero_mansioni=(p_data->>'numero_mansioni')::integer,tipo_intervento=p_data->>'tipo_intervento',settore=nullif(trim(p_data->>'settore'),''),updated_at=clock_timestamp()
 where id=p_id returning * into saved;
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,'complessita_pratica','commessa',p_id::text,
 jsonb_build_object('prima',jsonb_build_object('fascia_lavoratori',previous.fascia_lavoratori,'numero_sedi',previous.numero_sedi,'numero_mansioni',previous.numero_mansioni,'tipo_intervento',previous.tipo_intervento,'settore',previous.settore),'dopo',p_data));
 return jsonb_build_object('ok',true,'updatedAt',saved.updated_at);
end $$;
revoke all on function public.ore_salva_complessita(uuid,jsonb,text,timestamptz)from public,anon,authenticated;
grant execute on function public.ore_salva_complessita(uuid,jsonb,text,timestamptz)to service_role;
