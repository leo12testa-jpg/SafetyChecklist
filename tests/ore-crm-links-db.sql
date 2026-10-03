-- Integration checks are rolled back: no permanent changes or historical corrections.
begin;
do $$
declare rid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); job uuid;
 stamp timestamptz; result jsonb; approval timestamptz;
begin
 select id into job from public.ore_commesse limit 1;
 insert into public.ore_risorse_crm(id,sigla_crm,nome_crm,tecnico_uid)
 values(rid,'TEST-'||rid::text,'test rollback','test-old');
 insert into public.ore_sessioni(id,commessa_id,tecnico_uid,data_lavoro,minuti_effettivi,origine,confermata,crm_risorsa_id)
 values(sid,job,'test-old','2026-10-03',60,'crm_agenda',true,rid);
 select updated_at into stamp from public.ore_sessioni where id=sid;
 begin
  perform public.ore_approva_collegamento_crm(rid,'test-new','Test','test-admin','test-old',null,
    jsonb_build_array(jsonb_build_object('id',sid,'updated_at',stamp)));
  raise exception 'TEST: sessione confermata spostata';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 update public.ore_sessioni set confermata=false,updated_at=stamp+interval '1 second' where id=sid;
 begin
  perform public.ore_approva_collegamento_crm(rid,'test-new','Test','test-admin','test-old',null,
    jsonb_build_array(jsonb_build_object('id',sid,'updated_at',stamp)));
  raise exception 'TEST: anteprima scaduta accettata';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 select updated_at into stamp from public.ore_sessioni where id=sid;
 result:=public.ore_approva_collegamento_crm(rid,'test-new','Test','test-admin','test-old',null,
    jsonb_build_array(jsonb_build_object('id',sid,'updated_at',stamp)));
 if (result->>'riassegnate')::int<>1 or not exists(select 1 from public.ore_sessioni where id=sid and tecnico_uid='test-new')
 then raise exception 'TEST: riassegnazione fallita'; end if;
 if (select count(*) from public.ore_audit where entita_id in (rid::text,sid::text))<>2
 then raise exception 'TEST: audit incompleto'; end if;
 begin
  perform public.ore_approva_collegamento_crm(rid,'test-third','Test','test-admin','test-old',null,'[]');
  raise exception 'TEST: conflitto collegamento accettato';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
end $$;
rollback;
