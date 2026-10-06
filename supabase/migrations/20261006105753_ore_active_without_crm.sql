-- Backup: private ore-db-backups/20261006-before-active-without-crm.json.
-- NULL preserves the existing reading behavior; false explicitly means manual only.
alter table public.ore_risorse_crm add column agenda_crm_attiva boolean;
