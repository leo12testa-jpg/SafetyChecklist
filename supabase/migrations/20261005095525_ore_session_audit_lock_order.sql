-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261005-before-audit-lock-order.json
do $$
declare definition text;
begin
 select pg_get_functiondef('public.ore_scrivi_sessione(text,jsonb,uuid,text,boolean,text)'::regprocedure) into definition;
 definition:=replace(definition,'select * into previous from ore_sessioni where id=p_id for update;','select * into previous from ore_sessioni where id=p_id;');
 definition:=replace(definition,'crm_event_id=p_payload->>''crm_event_id'' for update;','crm_event_id=p_payload->>''crm_event_id'';');
 definition:=replace(definition,'begin'||chr(10),'begin'||chr(10)||' perform pg_advisory_xact_lock_shared(hashtextextended(''ore-identita'',0));'||chr(10));
 definition:=replace(definition,' if previous.id is not null and previous.tecnico_uid',
 ' if previous.id is not null then'||chr(10)||
 '  perform pg_advisory_xact_lock(hashtextextended(ore_persona(previous.tecnico_uid)||'':''||previous.data_lavoro::text,0));'||chr(10)||
 '  if nullif(p_payload->>''tecnico_uid'','''') is not null and p_payload->>''tecnico_uid'' is distinct from previous.tecnico_uid then raise exception ''Tecnico sessione non modificabile con questo comando'';end if;'||chr(10)||
 '  if nullif(p_payload->>''data_lavoro'','''') is not null and (p_payload->>''data_lavoro'')::date is distinct from previous.data_lavoro then raise exception ''Data sessione cambiata: verifica il conflitto CRM'';end if;'||chr(10)||
 '  select * into previous from ore_sessioni where id=previous.id for update;'||chr(10)||
 ' end if;'||chr(10)||
 ' if previous.id is not null and previous.tecnico_uid');
 execute definition;
end $$;
