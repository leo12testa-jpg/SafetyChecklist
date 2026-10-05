begin;
select set_config('ore.actor','sql-test-fixture',true),set_config('ore.reason','Fixture sintetiche con rollback',true);
do $$
declare job uuid:=gen_random_uuid(); stamp timestamptz; result jsonb;
begin
 insert into ore_commesse(id,cliente_id,codice_breve,descrizione,stato)select job,cliente_id,'TEST-'||job,'Test rollback','in_lavorazione'from ore_commesse limit 1;
 select updated_at into stamp from ore_commesse where id=job;
 begin
  perform ore_cambia_stato_pratica(job,true,'2026-10-01',null,null,'admin-test',stamp);
  raise exception 'TEST: revisioni mancanti accettate';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 result:=ore_cambia_stato_pratica(job,true,'2026-10-01',0,'Consegna confermata','admin-test',stamp);
 if not exists(select 1 from ore_commesse where id=job and stato='completata' and consegna_data='2026-10-01' and revisioni_cliente=0)then raise exception 'TEST: chiusura errata';end if;
 begin
  update ore_commesse set stato='in_lavorazione' where id=job;
  raise exception 'TEST: import puo sovrascrivere la chiusura';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform ore_cambia_stato_pratica(job,false,null,null,null,'admin-test',stamp);
  raise exception 'TEST: versione vecchia accettata';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 perform ore_cambia_stato_pratica(job,false,null,null,'Nuova richiesta cliente','admin-test',(result->>'updatedAt')::timestamptz);
 if not exists(select 1 from ore_commesse where id=job and stato='in_lavorazione' and consegna_data='2026-10-01')then raise exception 'TEST: riapertura o storico errati';end if;
 if(select count(*)from ore_pratiche_storia where commessa_id=job)<>2 then raise exception 'TEST: storico incompleto';end if;
end $$;
rollback;
