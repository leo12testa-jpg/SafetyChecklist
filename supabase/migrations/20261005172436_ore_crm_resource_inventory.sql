-- Backup privato: 20261005-before-crm-resource-inventory.json
alter table public.ore_risorse_crm add column crm_id text;
alter table public.ore_risorse_crm add column ultima_lettura_at timestamptz,
 add column ultimo_tentativo_at timestamptz, add column ultimo_errore_lettura text;
create unique index ore_risorse_crm_source_id_idx on public.ore_risorse_crm(crm_id) where crm_id is not null;
create function public.ore_registra_inventario_crm(p_resources jsonb,p_actor text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare item jsonb; previous ore_risorse_crm%rowtype; saved ore_risorse_crm%rowtype; source_id text; source_name text; count_new integer:=0;
begin
 if nullif(trim(p_actor),'') is null or jsonb_typeof(p_resources)<>'array' or jsonb_array_length(p_resources)>100 then raise exception 'Inventario CRM non valido';end if;
 perform pg_advisory_xact_lock(hashtext('ore_crm_inventory'));
 for item in select value from jsonb_array_elements(p_resources) loop
  source_id:=item->>'crmId';source_name:=trim(item->>'nome');
  if source_id is null or source_id!~'^[0-9]{1,10}$' or source_name is null or length(source_name)<3 or length(source_name)>120 then raise exception 'Risorsa CRM non valida';end if;
  select * into previous from ore_risorse_crm where crm_id=source_id;
  if not found then
   if (select count(*) from ore_risorse_crm where lower(regexp_replace(trim(nome_crm),'\s+',' ','g'))=lower(regexp_replace(source_name,'\s+',' ','g')))>1 then raise exception 'Nome risorsa ambiguo: verifica amministratore';end if;
   select * into previous from ore_risorse_crm where lower(regexp_replace(trim(nome_crm),'\s+',' ','g'))=lower(regexp_replace(source_name,'\s+',' ','g'));
   if found and previous.crm_id is not null and previous.crm_id<>source_id then raise exception 'Nome CRM con ID diverso: verifica amministratore';end if;
  end if;
  if previous.id is null then
   insert into ore_risorse_crm(sigla_crm,nome_crm,tecnico_uid,tecnico_nome,attiva,crm_id)values('CRM'||source_id,source_name,null,null,true,source_id) returning * into saved;
   count_new:=count_new+1;
  elsif previous.crm_id is null then
   update ore_risorse_crm set crm_id=source_id,updated_at=clock_timestamp() where id=previous.id returning * into saved;
  else continue;
  end if;
  insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,'inventario_risorsa_crm','risorsa_crm',saved.id::text,jsonb_build_object('prima',case when previous.id is null then null else to_jsonb(previous)end,'dopo',to_jsonb(saved),'origine','selettore agenda CRM','sessioniRiscritte',0));
 end loop;
 return jsonb_build_object('ok',true,'created',count_new);
end $$;
revoke all on function public.ore_registra_inventario_crm(jsonb,text) from public,anon,authenticated;
grant execute on function public.ore_registra_inventario_crm(jsonb,text) to service_role;
create function public.ore_registra_esito_crm(p_actor text,p_details jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare resource ore_risorse_crm%rowtype; failure jsonb; stamp timestamptz:=clock_timestamp(); scanned boolean; reason text;
begin
 if nullif(trim(p_actor),'') is null then raise exception 'Attore mancante';end if;
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,'crm_agent_heartbeat','agent','company',p_details);
 if p_details->>'state' not in ('ok','partial','recovery_pending') then return;end if;
 for resource in select * from ore_risorse_crm where attiva for update loop
  scanned:=coalesce(p_details->'scanned_resources','[]'::jsonb)?resource.sigla_crm;
  select value into failure from jsonb_array_elements(coalesce(p_details->'failure_details','[]'::jsonb))where value->>'sigla'=resource.sigla_crm limit 1;
  if not scanned and failure is null then continue;end if;
  reason:=failure->>'reason';
  update ore_risorse_crm set ultimo_tentativo_at=stamp,ultimo_errore_lettura=reason,
   ultima_lettura_at=case when scanned and reason is null then stamp else ultima_lettura_at end where id=resource.id;
  insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,'lettura_risorsa_crm','risorsa_crm',resource.id::text,jsonb_build_object('sigla',resource.sigla_crm,'letto',scanned and reason is null,'motivo',reason,'preview',p_details->>'state'='recovery_pending','agent_version',p_details->>'agent_version'));
 end loop;
end $$;
revoke all on function public.ore_registra_esito_crm(text,jsonb) from public,anon,authenticated;
grant execute on function public.ore_registra_esito_crm(text,jsonb) to service_role;
