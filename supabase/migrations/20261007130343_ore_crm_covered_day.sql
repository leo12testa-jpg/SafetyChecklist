-- Private backup: 20261007-before-crm-covered-day.json
alter table public.ore_risorse_crm add column ultima_data_letta date;
CREATE OR REPLACE FUNCTION public.ore_registra_esito_crm(p_actor text, p_details jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare resource ore_risorse_crm%rowtype; failure jsonb; stamp timestamptz:=clock_timestamp(); scanned boolean; reason text; coverage jsonb;
begin
 if nullif(trim(p_actor),'') is null then raise exception 'Attore mancante';end if;
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,'crm_agent_heartbeat','agent','company',p_details);
 if p_details->>'state' not in ('ok','partial','recovery_pending') then return;end if;
 for resource in select * from ore_risorse_crm where attiva and agenda_crm_attiva is distinct from false for update loop
  scanned:=coalesce(p_details->'scanned_resources','[]'::jsonb)?resource.sigla_crm;
  select value into failure from jsonb_array_elements(coalesce(p_details->'failure_details','[]'::jsonb))where value->>'sigla'=resource.sigla_crm limit 1;
  if not scanned and failure is null then continue;end if;
  reason:=failure->>'reason';
  select value into coverage from jsonb_array_elements(coalesce(p_details->'read_ranges','[]'::jsonb)) where value->>'sigla'=resource.sigla_crm limit 1;
  if coverage is not null and ((coverage->>'to')::date-(coverage->>'from')::date not between 0 and 29 or (coverage->>'to')::date>(clock_timestamp() at time zone 'Europe/Rome')::date) then raise exception 'Finestra lettura non valida';end if;
  update ore_risorse_crm set ultimo_tentativo_at=stamp,ultimo_errore_lettura=reason,
   ultima_data_letta=case when scanned and reason is null and coverage is not null then greatest(ultima_data_letta,(coverage->>'to')::date) else ultima_data_letta end,
   ultima_lettura_at=case when scanned and reason is null then stamp else ultima_lettura_at end where id=resource.id;
  insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,'lettura_risorsa_crm','risorsa_crm',resource.id::text,jsonb_build_object('sigla',resource.sigla_crm,'letto',scanned and reason is null,'motivo',reason,'preview',p_details->>'state'='recovery_pending','agent_version',p_details->>'agent_version'));
 end loop;
end $function$
;
