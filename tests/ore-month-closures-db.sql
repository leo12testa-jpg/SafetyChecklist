begin;
select set_config('ore.actor','sql-test-fixture',true),set_config('ore.admin','true',true),set_config('ore.reason','Fixture sintetica',true);
do $$
declare uid text:='month-test-'||gen_random_uuid();job uuid;sid uuid;
begin
 select id into job from ore_commesse limit 1;
 sid:=(ore_scrivi_sessione('insert',jsonb_build_object('commessa_id',job,'tecnico_uid',uid,'data_lavoro','2099-02-05','minuti_effettivi',60,'origine','manuale'),null,uid,false,null)->>'id')::uuid;
 perform ore_cambia_mese('2099-02-01',true,'admin-test',null);
 begin perform ore_scrivi_sessione('update','{"minuti_effettivi":90}',sid,'admin-test',true,'Motivo admin');raise exception 'TEST: admin changed closed month';exception when others then if sqlerrm not like 'Mese chiuso:%' then raise;end if;end;
 begin perform ore_salva_attivita_interna(null,uid,'Test','2099-02-05','amministrazione',30,'admin-test',true);raise exception 'TEST: internal write accepted';exception when others then if sqlerrm not like 'Mese chiuso:%' then raise;end if;end;
 begin perform ore_conferma_giornata(uid,'Test','2099-02-05');raise exception 'TEST: confirmation accepted';exception when others then if sqlerrm not like 'Mese chiuso:%' then raise;end if;end;
 begin perform ore_scrivi_sessione('upsert',jsonb_build_object('commessa_id',job,'tecnico_uid',uid,'data_lavoro','2099-02-06','minuti_effettivi',30,'origine','crm_agenda','crm_event_id','month-fixture'),null,'admin-test',true,null);raise exception 'TEST: CRM write accepted';exception when others then if sqlerrm not like 'Mese chiuso:%' then raise;end if;end;
 begin delete from ore_sessioni where id=sid;raise exception 'TEST: deletion accepted';exception when others then if sqlerrm not like 'Mese chiuso:%' then raise;end if;end;
 begin perform ore_cambia_mese('2099-02-01',false,'admin-test','');raise exception 'TEST: reopening without reason';exception when others then if sqlerrm not like 'Motivo obbligatorio%' then raise;end if;end;
 perform ore_cambia_mese('2099-02-01',false,'admin-test','Riapertura verificata');
 perform ore_scrivi_sessione('update','{"minuti_effettivi":90}',sid,uid,false,null);
 if not exists(select 1 from ore_audit where entita='mese' and entita_id='2099-02-01' and azione='riapri_mese' and dettagli->>'motivo'='Riapertura verificata')then raise exception 'TEST: missing audit';end if;
 if not exists(select 1 from ore_sessioni where id=sid and minuti_effettivi=90)then raise exception 'TEST: update after reopening failed';end if;
end $$;
rollback;
