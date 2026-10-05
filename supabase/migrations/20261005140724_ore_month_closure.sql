-- Backup: C:/Users/Leonardo/.cache/ore-db-backups/20261005-before-month-close.json
create table public.ore_chiusure_mensili(
 mese date primary key check(extract(day from mese)=1),chiuso boolean not null,
 chiuso_da text,chiuso_at timestamptz,riaperto_da text,riaperto_at timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.ore_chiusure_mensili enable row level security;
revoke all on public.ore_chiusure_mensili from anon,authenticated;
grant all on public.ore_chiusure_mensili to service_role;
create function public.ore_blocca_mese() returns trigger language plpgsql security invoker set search_path=public as $$
declare dates date[]:='{}'; work_month date; date_field text:=case when tg_table_name='ore_giornate' then 'data' else 'data_lavoro' end;
begin
 if tg_op<>'INSERT' then dates:=array_append(dates,date_trunc('month',(to_jsonb(old)->>date_field)::date)::date);end if;
 if tg_op<>'DELETE' then dates:=array_append(dates,date_trunc('month',(to_jsonb(new)->>date_field)::date)::date);end if;
 for work_month in select distinct unnest(dates) order by 1 loop
  perform pg_advisory_xact_lock_shared(hashtextextended('ore-month:'||work_month::text,0));
  if exists(select 1 from ore_chiusure_mensili where mese=work_month and chiuso)then raise exception 'Mese chiuso: richiedi la riapertura all amministratore';end if;
 end loop;
 return coalesce(new,old);
end $$;
revoke all on function public.ore_blocca_mese() from public,anon,authenticated;
create trigger ore_sessioni_month_guard before insert or update or delete on public.ore_sessioni for each row execute function public.ore_blocca_mese();
create trigger ore_interne_month_guard before insert or update or delete on public.ore_attivita_interne for each row execute function public.ore_blocca_mese();
create trigger ore_giornate_month_guard before insert or update or delete on public.ore_giornate for each row execute function public.ore_blocca_mese();
create function public.ore_cambia_mese(p_month date,p_close boolean,p_actor text,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare previous ore_chiusure_mensili%rowtype; saved ore_chiusure_mensili%rowtype; stamp timestamptz:=clock_timestamp();
begin
 if p_month is null or extract(day from p_month)<>1 or p_actor is null or p_close is null then raise exception 'Mese non valido';end if;
 if not p_close and length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Motivo obbligatorio per riaprire il mese';end if;
 perform pg_advisory_xact_lock(hashtextextended('ore-month:'||p_month::text,0));
 select * into previous from ore_chiusure_mensili where mese=p_month for update;
 if p_close and previous.chiuso then raise exception 'Mese gia chiuso';end if;
 if not p_close and (previous.mese is null or not previous.chiuso)then raise exception 'Mese non chiuso';end if;
 insert into ore_chiusure_mensili(mese,chiuso,chiuso_da,chiuso_at,riaperto_da,riaperto_at,updated_at)
 values(p_month,p_close,case when p_close then p_actor else previous.chiuso_da end,case when p_close then stamp else previous.chiuso_at end,case when p_close then previous.riaperto_da else p_actor end,case when p_close then previous.riaperto_at else stamp end,stamp)
 on conflict(mese) do update set chiuso=excluded.chiuso,chiuso_da=excluded.chiuso_da,chiuso_at=excluded.chiuso_at,riaperto_da=excluded.riaperto_da,riaperto_at=excluded.riaperto_at,updated_at=stamp returning * into saved;
 insert into ore_audit(tecnico_uid,azione,entita,entita_id,dettagli)values(p_actor,case when p_close then 'chiudi_mese' else 'riapri_mese' end,'mese',p_month::text,jsonb_build_object('prima',case when previous.mese is null then null else to_jsonb(previous) end,'dopo',to_jsonb(saved),'motivo',nullif(trim(p_reason),'')));
 return to_jsonb(saved);
end $$;
revoke all on function public.ore_cambia_mese(date,boolean,text,text) from public,anon,authenticated;
grant execute on function public.ore_cambia_mese(date,boolean,text,text) to service_role;
