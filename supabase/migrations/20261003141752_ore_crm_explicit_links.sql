-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261003-before-crm-links.json
alter table public.ore_risorse_crm add column if not exists collegamento_approvato_at timestamptz;
alter table public.ore_risorse_crm add column if not exists collegamento_approvato_da text;
alter table public.ore_sessioni add column if not exists crm_risorsa_id uuid references public.ore_risorse_crm(id);
create index if not exists ore_sessioni_crm_risorsa_idx on public.ore_sessioni(crm_risorsa_id);

-- Invoker privileges; only the authenticated backend service role can call this transaction.
create or replace function public.ore_approva_collegamento_crm(
 p_resource uuid, p_uid text, p_name text, p_actor text, p_previous_uid text,
 p_previous_approval timestamptz, p_sessions jsonb default '[]'::jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 r public.ore_risorse_crm%rowtype;
 s public.ore_sessioni%rowtype;
 item jsonb; changed integer:=0; stamp timestamptz:=clock_timestamp();
begin
 select * into r from public.ore_risorse_crm where id=p_resource and attiva for update;
 if not found then raise exception 'Risorsa non trovata'; end if;
 if r.tecnico_uid is distinct from p_previous_uid or r.collegamento_approvato_at is distinct from p_previous_approval then
   raise exception 'Collegamento modificato nel frattempo: ricarica';
 end if;
 if p_uid is null or trim(p_uid)='' or p_uid like 'legacy:%' or p_actor is null then raise exception 'Account non valido'; end if;
 if jsonb_typeof(p_sessions)<>'array' or jsonb_array_length(p_sessions)>500 then raise exception 'Anteprima non valida'; end if;
 -- Lock the session rows and reject changes after the preview, including day confirmation.
 for item in select value from jsonb_array_elements(p_sessions) loop
   select * into s from public.ore_sessioni where id=(item->>'id')::uuid for update;
   if not found or s.crm_risorsa_id is distinct from p_resource or s.confermata
      or s.updated_at is distinct from (item->>'updated_at')::timestamptz
      or exists(select 1 from public.ore_giornate g where g.tecnico_uid=s.tecnico_uid and g.data=s.data_lavoro and g.stato='confermata')
   then raise exception 'Sessione non riassegnabile o cambiata: ricarica anteprima'; end if;
   -- Serialize competing changes for this destination/day; no silent exceeding of 24h.
   perform pg_advisory_xact_lock(hashtextextended(p_uid || ':' || s.data_lavoro::text,0));
   if s.tecnico_uid is distinct from p_uid and
     (select coalesce(sum(minuti_effettivi),0) from public.ore_sessioni where tecnico_uid=p_uid and data_lavoro=s.data_lavoro)+s.minuti_effettivi>1440
   then raise exception 'La riassegnazione supera 24 ore giornaliere'; end if;
   if exists(select 1 from public.ore_giornate where tecnico_uid=p_uid and data=s.data_lavoro and stato='confermata')
   then raise exception 'Giornata di destinazione confermata'; end if;
   insert into public.ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)
   values(p_actor,'riassegna_sessione_crm','sessione',s.id::text,jsonb_build_object('prima',to_jsonb(s),'dopo_uid',p_uid,'risorsa_id',p_resource));
   update public.ore_sessioni set tecnico_uid=p_uid,tecnico_nome=p_name,updated_at=stamp where id=s.id;
   changed:=changed+1;
 end loop;
 update public.ore_risorse_crm set tecnico_uid=p_uid,tecnico_nome=p_name,
   collegamento_approvato_at=stamp,collegamento_approvato_da=p_actor,updated_at=stamp where id=p_resource;
 insert into public.ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)
 values(p_actor,'approva_collegamento_crm','risorsa_crm',p_resource::text,
   jsonb_build_object('prima',to_jsonb(r),'dopo_uid',p_uid,'dopo_nome',p_name,'sessioni_riassegnate',changed));
 return jsonb_build_object('ok',true,'riassegnate',changed);
end; $$;
revoke all on function public.ore_approva_collegamento_crm(uuid,text,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.ore_approva_collegamento_crm(uuid,text,text,text,text,timestamptz,jsonb) to service_role;
