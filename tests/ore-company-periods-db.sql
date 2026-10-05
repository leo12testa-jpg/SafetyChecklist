begin;
do $$
declare period jsonb; row_id uuid; before_minutes bigint;
begin
 select sum(minuti_effettivi) into before_minutes from ore_sessioni;
 period:=ore_salva_periodo(null,'Estate test','2090-05-15','2090-08-31',array[540,540,540,540,240,0,0],'admin-test',null,null);
 row_id:=(period->>'id')::uuid;
 begin
  perform ore_salva_periodo(null,'Sovrapposto','2090-06-01','2090-06-30',array[480,480,480,480,480,0,0],'admin-test',null,null);raise exception 'TEST: overlap allowed';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform ore_salva_periodo(row_id,'Versione errata','2090-05-15','2090-08-31',array[540,540,540,540,240,0,0],'admin-test',now()-interval '1 day',null);raise exception 'TEST: stale version accepted';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 period:=ore_salva_periodo(row_id,'Estate aggiornata','2090-05-20','2090-08-31',array[540,540,540,540,240,0,0],'admin-test',(period->>'updated_at')::timestamptz,null);
 if not exists(select 1 from ore_audit where entita_id=row_id::text and dettagli->'prima'->>'nome'='Estate test' and dettagli->'dopo'->>'nome'='Estate aggiornata')then raise exception 'TEST: period audit missing';end if;
 if (select sum(minuti_effettivi) from ore_sessioni) is distinct from before_minutes then raise exception 'TEST: historical minutes changed';end if;
end $$;
rollback;
