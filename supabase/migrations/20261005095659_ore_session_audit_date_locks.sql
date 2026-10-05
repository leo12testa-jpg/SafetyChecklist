-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261005-before-audit-date-locks.json
do $$
declare definition text;
begin
 select pg_get_functiondef('public.ore_scrivi_sessione(text,jsonb,uuid,text,boolean,text)'::regprocedure) into definition;
 definition:=replace(definition,
 '  perform pg_advisory_xact_lock(hashtextextended(ore_persona(previous.tecnico_uid)||'':''||previous.data_lavoro::text,0));',
 '  keys:=ore_persona(previous.tecnico_uid)||'':''||previous.data_lavoro::text;'||chr(10)||
 '  assignments:=ore_persona(previous.tecnico_uid)||'':''||coalesce(nullif(p_payload->>''data_lavoro'','''')::date,previous.data_lavoro)::text;'||chr(10)||
 '  perform pg_advisory_xact_lock(hashtextextended(least(keys,assignments),0));'||chr(10)||
 '  if keys<>assignments then perform pg_advisory_xact_lock(hashtextextended(greatest(keys,assignments),0));end if;');
 definition:=replace(definition,
 '  if nullif(p_payload->>''data_lavoro'','''') is not null and (p_payload->>''data_lavoro'')::date is distinct from previous.data_lavoro then raise exception ''Data sessione cambiata: verifica il conflitto CRM'';end if;','');
 execute definition;
end $$;
