-- Synthetic three-person pilot, rolled back in full. No Firebase accounts created.
begin;
select set_config('ore.actor','sql-test-fixture',true),set_config('ore.reason','Fixture sintetiche con rollback',true);
do $$
declare resource uuid; session uuid; job uuid; uid text; legacy text; sigla text; n integer; baseline bigint;
begin
 select count(*) into baseline from ore_identita_alias;
 select id into job from ore_commesse limit 1;
 for n in 1..3 loop
  resource:=gen_random_uuid();session:=gen_random_uuid();sigla:='PILOT-'||resource::text;
  legacy:='legacy:'||sigla;uid:='pilot-test-'||resource::text;
  insert into ore_risorse_crm(id,sigla_crm,nome_crm,tecnico_uid)values(resource,sigla,'Synthetic pilot',legacy);
  insert into ore_sessioni(id,commessa_id,tecnico_uid,data_lavoro,minuti_effettivi,origine,confermata)values(session,job,legacy,'2026-10-01',60,'import_storico',true);
  perform ore_collega_identita(resource,uid,'Synthetic pilot','test-admin',legacy,null,null);
  if ore_persona(legacy)<>uid then raise exception 'Pilot alias missing';end if;
  if not exists(select 1 from ore_sessioni where id=session and tecnico_uid=legacy and confermata)then raise exception 'Historical row changed';end if;
 end loop;
 if (select count(*) from ore_identita_alias)<>baseline+3 then raise exception 'Unexpected alias count';end if;
end $$;
rollback;
