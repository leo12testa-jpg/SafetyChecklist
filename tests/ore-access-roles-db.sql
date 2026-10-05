begin;
do $$
declare uid text:='role-fixture-'||gen_random_uuid();actor text:='iREKNAJuP6QjRDOIW3jFstWgYod2';
begin
 perform ore_assegna_ruolo(uid,'admin_operativo',actor);
 begin perform ore_assegna_ruolo(uid,'direzione',uid);raise exception 'TEST: operational privilege escalation';exception when others then if sqlerrm not like 'Assegnazione riservata%'then raise;end if;end;
 begin perform ore_assegna_ruolo(actor,'admin_operativo',actor);raise exception 'TEST: removed last director';exception when others then if sqlerrm not like 'Deve rimanere%'then raise;end if;end;
 perform ore_assegna_ruolo(uid,'direzione',actor);
 if not exists(select 1 from ore_audit where azione='assegna_ruolo_ore' and entita_id=uid and dettagli->'prima'->>'ruolo'='admin_operativo' and dettagli->'dopo'->>'ruolo'='direzione')then raise exception 'TEST: role audit missing';end if;
end $$;
rollback;
