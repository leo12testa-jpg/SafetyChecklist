begin;
do $$
declare sid uuid:=gen_random_uuid(); job uuid; uid text:='test-'||gen_random_uuid()::text; stamp timestamptz; result jsonb;
begin
 select id into job from public.ore_commesse limit 1;
 insert into public.ore_sessioni(id,commessa_id,tecnico_uid,data_lavoro,minuti_effettivi,origine)
 values(sid,job,uid,'2026-10-03',60,'crm_agenda') returning updated_at into stamp;
 if exists(select 1 from public.ore_sessioni where id=sid and fase is not null) then raise exception 'TEST: fase dedotta'; end if;
 begin
  perform public.ore_salva_fase(sid,'redazione','other',false,stamp,null);
  raise exception 'TEST: modifica altrui';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 begin
  perform public.ore_salva_fase(sid,'inventata',uid,false,stamp,null);
  raise exception 'TEST: enum invalido';
 exception when check_violation then null; end;
 result:=public.ore_salva_fase(sid,'trasferta',uid,false,stamp,null);
 begin
  perform public.ore_salva_fase(sid,'redazione',uid,false,stamp,null);
  raise exception 'TEST: versione vecchia';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 stamp:=(result->>'updatedAt')::timestamptz;
 update public.ore_sessioni set confermata=true where id=sid;
 begin
  perform public.ore_salva_fase(sid,'redazione',uid,false,stamp,null);
  raise exception 'TEST: tecnico modifica confermata';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 begin
  perform public.ore_salva_fase(sid,'redazione','admin-test',true,stamp,null);
  raise exception 'TEST: motivo mancante';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 perform public.ore_salva_fase(sid,'redazione','admin-test',true,stamp,'Correzione confermata');
 if not exists(select 1 from public.ore_audit where entita_id=sid::text and dettagli->>'fase_prima'='trasferta' and dettagli->>'fase_dopo'='redazione') then raise exception 'TEST: audit mancante'; end if;
end $$;
rollback;
