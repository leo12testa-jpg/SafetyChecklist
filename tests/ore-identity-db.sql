begin;
do $$
declare rid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); job uuid; sigla text:='TEST-'||rid::text; old_uid text; uid text:='test-'||gen_random_uuid(); result jsonb;
begin
 old_uid:='legacy:'||sigla;
 select id into job from ore_commesse limit 1;
 insert into ore_risorse_crm(id,sigla_crm,nome_crm,tecnico_uid)values(rid,sigla,'Test',old_uid);
 insert into ore_sessioni(id,commessa_id,tecnico_uid,data_lavoro,minuti_effettivi,origine,confermata)values(sid,job,old_uid,'2026-10-01',900,'import_storico',true);
 result:=ore_collega_identita(rid,uid,'Test','admin-test',old_uid,null,null);
 if not exists(select 1 from ore_sessioni where id=sid and tecnico_uid=old_uid and minuti_effettivi=900 and confermata)then raise exception 'TEST: storico riscritto';end if;
 if ore_persona(old_uid)<>uid then raise exception 'TEST: alias non attribuito';end if;
 if not exists(select 1 from ore_audit where entita_id=old_uid and dettagli->>'sessioni_riscritte'='0')then raise exception 'TEST: audit mancante';end if;
 begin
  update ore_sessioni set tecnico_uid=uid where id=sid;
  raise exception 'TEST: UID storico modificabile';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform ore_salva_attivita_interna(null,uid,'Test','2026-10-01','amministrazione',541,uid,false);
  raise exception 'TEST: limite diviso fra alias e account';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform ore_collega_identita(rid,'test-other','Altro','admin-test',uid,null,null);
  raise exception 'TEST: alias modificato senza anteprima';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
end $$;
rollback;
