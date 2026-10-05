begin;
select set_config('ore.actor','sql-test-fixture',true),set_config('ore.reason','Fixture sintetiche con rollback',true);
do $$
declare job uuid:=gen_random_uuid(); stamp timestamptz; result jsonb;
begin
 insert into ore_commesse(id,cliente_id,codice_breve,descrizione)select job,cliente_id,'TEST-'||job,'Test rollback'from ore_commesse limit 1;
 select updated_at into stamp from ore_commesse where id=job;
 if exists(select 1 from ore_commesse where id=job and fascia_lavoratori is not null)then raise exception 'TEST: valore inventato';end if;
 begin
  perform ore_salva_complessita(job,'{"numero_sedi":0}','admin-test',stamp);
  raise exception 'TEST: numero sedi non valido accettato';
 exception when check_violation then null;end;
 result:=ore_salva_complessita(job,'{"fascia_lavoratori":"10-49","numero_sedi":2,"numero_mansioni":3,"tipo_intervento":"aggiornamento","settore":"ATECO 41"}','admin-test',stamp);
 if not exists(select 1 from ore_commesse where id=job and numero_sedi=2 and fascia_lavoratori='10-49')then raise exception 'TEST: salvataggio errato';end if;
 begin
  perform ore_salva_complessita(job,'{}','admin-test',stamp);raise exception 'TEST: versione vecchia accettata';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 if not exists(select 1 from ore_audit where entita_id=job::text and azione='complessita_pratica' and dettagli->'prima'->>'fascia_lavoratori' is null and dettagli->'dopo'->>'fascia_lavoratori'='10-49')then raise exception 'TEST: audit errato';end if;
end $$;
rollback;
