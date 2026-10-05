begin;
do $$
declare job uuid; saved jsonb; sid uuid; uid text:='audit-test-'||gen_random_uuid(); before_count bigint;
begin
 select id into job from ore_commesse limit 1;
 saved:=ore_scrivi_sessione('insert',jsonb_build_object('commessa_id',job,'tecnico_uid',uid,'data_lavoro','2026-10-05','minuti_effettivi',30,'origine','manuale','confermata',true),null,uid,false,null);
 sid:=(saved->>'id')::uuid;
 if not exists(select 1 from ore_sessioni_storia where sessione_id=sid and attore_uid=uid and azione='creazione')then raise exception 'TEST: creation audit missing';end if;
 begin
  perform ore_scrivi_sessione('update','{"minuti_effettivi":60}',sid,'admin-test',true,null);
  raise exception 'TEST: confirmed edit without reason allowed';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 if (select minuti_effettivi from ore_sessioni where id=sid)<>30 then raise exception 'TEST: failed edit changed data';end if;
 saved:=ore_scrivi_sessione('update','{"minuti_effettivi":60,"confermata":false}',sid,'admin-test',true,'Correzione confermata');
 if not exists(select 1 from ore_sessioni_storia where sessione_id=sid and attore_uid='admin-test' and prima->>'minuti_effettivi'='30' and dopo->>'minuti_effettivi'='60' and motivo='Correzione confermata')then raise exception 'TEST: before/after missing';end if;
 begin
  perform ore_scrivi_sessione('update','{"minuti_effettivi":90}',sid,'other-tech',false,null);
  raise exception 'TEST: foreign edit allowed';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 select count(*) into before_count from ore_sessioni_storia where sessione_id=sid;
 begin
  perform ore_scrivi_sessione('update','{"minuti_effettivi":1441}',sid,uid,false,null);
  raise exception 'TEST: invalid minutes accepted';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 if (select count(*) from ore_sessioni_storia where sessione_id=sid)<>before_count then raise exception 'TEST: failed transaction wrote audit';end if;
 perform ore_salva_fase(sid,'redazione',uid,false,(saved->>'updated_at')::timestamptz,null);
 if not exists(select 1 from ore_sessioni_storia where sessione_id=sid and dopo->>'fase'='redazione' and attore_uid=uid)then raise exception 'TEST: phase not audited';end if;
 perform ore_scrivi_sessione('delete','{}',sid,uid,false,'Duplicato test');
 if not exists(select 1 from ore_sessioni_storia where sessione_id=sid and azione='eliminazione' and dopo is null)then raise exception 'TEST: deletion not retained';end if;
end $$;
rollback;
