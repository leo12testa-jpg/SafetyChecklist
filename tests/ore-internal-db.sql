begin;
do $$
declare sid uuid:=gen_random_uuid(); job uuid; uid text:='test-'||gen_random_uuid()::text; activity uuid; result jsonb; n bigint;
begin
 select id into job from public.ore_commesse limit 1;
 insert into public.ore_sessioni(id,commessa_id,tecnico_uid,data_lavoro,minuti_effettivi,origine)
 values(sid,job,uid,'2026-10-03',480,'manuale');
 result:=public.ore_salva_attivita_interna(null,uid,'Test','2026-10-03','amministrazione',120,uid,false);
 activity:=(result->>'id')::uuid;
 perform public.ore_salva_attivita_interna(null,uid,'Test','2026-10-03','assenza',240,uid,false);
 select sum(minuti_effettivi) into n from public.ore_rendicontazioni where tecnico_uid=uid and data_lavoro='2026-10-03';
 if n<>840 then raise exception 'TEST: totale unificato errato'; end if;
 select sum(minuti_effettivi) into n from public.ore_rendicontazioni where tecnico_uid=uid and data_lavoro='2026-10-03' and not assenza;
 if n<>600 then raise exception 'TEST: denominatore fatturabile errato'; end if;
 begin
  perform public.ore_salva_attivita_interna(null,uid,'Test','2026-10-03','amministrazione',601,uid,false);
  raise exception 'TEST: limite giornaliero interne ignorato';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 begin
  update public.ore_sessioni set minuti_effettivi=1200 where id=sid;
  raise exception 'TEST: limite giornaliero sessioni ignorato';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 begin
  perform public.ore_salva_attivita_interna(activity,uid,'Test','2026-10-03','amministrazione',60,'other-user',false);
  raise exception 'TEST: modifica altrui autorizzata';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 result:=public.ore_conferma_giornata(uid,'Test','2026-10-03');
 if (result->>'totalMinutes')::int<>840 or exists(select 1 from public.ore_rendicontazioni where tecnico_uid=uid and not confermata)
 then raise exception 'TEST: conferma unificata fallita'; end if;
 if exists(select 1 from information_schema.columns where table_name='ore_attivita_interne' and column_name in ('motivo','motivo_assenza','note'))
 then raise exception 'TEST: campo personale non necessario'; end if;
end $$;
rollback;
