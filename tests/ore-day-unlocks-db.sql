begin;
select set_config('ore.actor','sql-test-fixture',true),set_config('ore.admin','true',true),set_config('ore.reason','Fixture test',true);
do $$
declare uid text:='unlock-test-'||gen_random_uuid(); job uuid; sid uuid; request jsonb;
begin
 select id into job from ore_commesse limit 1;
 sid:=(ore_scrivi_sessione('insert',jsonb_build_object('commessa_id',job,'tecnico_uid',uid,'data_lavoro','2026-10-05','minuti_effettivi',60,'origine','manuale'),null,uid,false,null)->>'id')::uuid;
 perform ore_conferma_giornata(uid,'Test','2026-10-05');
 perform set_config('ore.confirming','',true);
 begin
  perform ore_scrivi_sessione('update','{"minuti_effettivi":90}',sid,uid,false,'Tecnico non puo sbloccare');raise exception 'TEST: technician edited confirmed hours';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform ore_salva_attivita_interna(null,uid,'Test','2026-10-05','amministrazione',30,uid,false);raise exception 'TEST: technician added internal hours after confirmation';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform ore_scrivi_sessione('upsert',jsonb_build_object('commessa_id',job,'tecnico_uid',uid,'data_lavoro','2026-10-05','minuti_effettivi',30,'origine','crm_agenda','crm_event_id','test-event'),null,'admin-test',true,null);raise exception 'TEST: CRM added hours to confirmed day';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform ore_richiedi_sblocco(uid,'2026-10-05','Motivo','other-tech');raise exception 'TEST: requested foreign day';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 request:=ore_richiedi_sblocco(uid,'2026-10-05','Verifica ore',uid);
 perform ore_decidi_sblocco((request->>'id')::uuid,true,'Richiesta verificata','admin-test');
 if exists(select 1 from ore_sessioni where id=sid and confermata)then raise exception 'TEST: session still confirmed';end if;
 perform ore_scrivi_sessione('update','{"minuti_effettivi":90}',sid,uid,false,null);
 if not exists(select 1 from ore_audit where azione='sblocco_giornata' and tecnico_uid='admin-test' and entita_id=uid||':2026-10-05')then raise exception 'TEST: unlock audit missing';end if;
end $$;
rollback;
