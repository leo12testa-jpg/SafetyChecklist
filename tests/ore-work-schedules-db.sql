begin;
select set_config('ore.actor','sql-test-fixture',true),set_config('ore.reason','Fixture sintetiche con rollback',true);
do $$
declare uid text:='test-'||gen_random_uuid()::text; n integer;
begin
 perform public.ore_aggiungi_orario(uid,'Test','2026-01-01',array[240,240,240,240,240,0,0],'test-admin');
 perform public.ore_aggiungi_orario(uid,'Test','2026-09-01',array[360,360,360,360,360,0,0],'test-admin');
 select count(*) into n from public.ore_orari_tecnici where tecnico_uid=uid;
 if n<>2 then raise exception 'TEST: storico non preservato'; end if;
 if not exists(select 1 from public.ore_orari_tecnici where tecnico_uid=uid and valido_dal='2026-01-01' and settimana_minuti[1]=240)
 then raise exception 'TEST: orario precedente modificato'; end if;
 begin
  perform public.ore_aggiungi_orario(uid,'Test','2026-09-01',array[480,480,480,480,480,0,0],'test-admin');
  raise exception 'TEST: decorrenza sovrascritta';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 begin
  perform public.ore_aggiungi_orario(uid,'Test','2027-01-01',array[1441,240,240,240,240,0,0],'test-admin');
  raise exception 'TEST: minuti oltre limite accettati';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 if (select count(*) from public.ore_audit where azione='configura_orario' and dettagli->'dopo'->>'tecnico_uid'=uid)<>2
 then raise exception 'TEST: audit orario mancante'; end if;
end $$;
rollback;
