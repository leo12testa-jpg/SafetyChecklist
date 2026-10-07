import pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path('ore-produttivita/crm-sync').resolve()))
from crm_recovery import recovery_plan,combine_reads,merge_preview,annotate_preview
def resource(**extra):return {'sigla_crm':'LT','tecnico_uid':'real','collegamento_approvato_at':'2026-10-01',**extra}
def event(day='2026-10-07',key='e1'):return {'tecnicoSigla':'LT','crmEventId':key,'date':day,'start':day+'T07:00:00Z','end':day+'T08:00:00Z','minutes':60}
class RecoveryTests(unittest.TestCase):
 def test_restart_includes_last_read_day_and_missing_days(self):
  p=recovery_plan([resource()],{'LT':'2026-10-02'},'2026-10-07')[0];self.assertEqual((p['from'],p['to']),('2026-10-02','2026-10-07'))
 def test_month_boundary(self):
  self.assertEqual(recovery_plan([resource()],{'LT':'2026-09-30'},'2026-10-01')[0]['months'],['202609','202610'])
 def test_long_shutdown_drains_oldest_first_without_dropping_days(self):
  p=recovery_plan([resource()],{'LT':'2026-08-01'},'2026-10-07')[0];self.assertEqual((p['from'],p['to']),('2026-08-01','2026-08-30'));self.assertIsNotNone(p['remaining'])
  nxt=recovery_plan([resource()],{'LT':p['to']},'2026-10-07')[0];self.assertEqual(nxt['from'],'2026-08-30')
 def test_persisted_coverage_preferred_over_latest_attempt_timestamp(self):
  p=recovery_plan([resource(ultima_data_letta='2026-09-01',ultima_lettura_at='2026-10-07T10:00:00Z')],{},'2026-10-07')[0];self.assertEqual(p['from'],'2026-09-01')
 def test_manual_only_excluded_and_invalid_limit_rejected(self):
  self.assertEqual(recovery_plan([resource(agenda_crm_attiva=False)],{},'2026-10-07'),[])
  with self.assertRaises(ValueError):recovery_plan([resource()],{},'2026-10-07',31)
 def test_month_failure_prevents_cursor_success(self):
  p=recovery_plan([resource()],{'LT':'2026-09-30'},'2026-10-01')
  r=combine_reads(p,{'202609':{'scanned':[],'events':[],'failures':[{'sigla':'LT','reason':'failure'}]},'202610':{'scanned':['LT'],'events':[event('2026-10-01')],'failures':[]}},'2026-10-01')
  self.assertEqual(r['scanned'],[]);self.assertEqual(r['events'],[])
 def test_future_events_are_not_new_read_candidates(self):
  p=recovery_plan([resource()],{'LT':'2026-10-07'},'2026-10-07');r=combine_reads(p,{'202610':{'scanned':['LT'],'events':[event(),event('2026-10-08')],'failures':[]}},'2026-10-07');self.assertEqual(len(r['events']),1)
 def test_repeated_cycles_do_not_duplicate_pending_events(self):
  r={'events':[event()],'scanned':['LT'],'failures':[],'total':1,'ranges':recovery_plan([resource()],{'LT':'2026-10-07'},'2026-10-07')}
  first=merge_preview({},r);second=merge_preview(first,r);self.assertEqual(len(second['events']),1);self.assertEqual(second['imports'],0)
 def test_changed_or_removed_events_remain_in_review(self):
  r={'events':[event(key='changed')],'scanned':['LT'],'failures':[],'total':1,'ranges':recovery_plan([resource()],{'LT':'2026-10-07'},'2026-10-07')}
  p=merge_preview({'events':[event()]},r);self.assertEqual(len(p['events']),2);self.assertTrue(all(e['requiresReview'] for e in p['events']))
 def test_confirmed_days_and_closed_months_block_review_candidates(self):
  for constraints in [{'days':[{'tecnico_uid':'real','data':'2026-10-07','stato':'confermata'}]},{'months':[{'mese':'2026-10-01','chiuso':True}]}]:
   p={'events':[event()]};annotate_preview(p,[resource()],{'from':'2026-10-07','to':'2026-10-07',**constraints});self.assertEqual(p['events'][0]['importReview'],'giornata_confermata_o_mese_chiuso')
 def test_alias_existing_id_and_same_time_are_separate(self):
  s={'id':'s1','tecnico_uid':'legacy:LT','crm_event_id':'e1','confermata':False,'inizio':event()['start'],'fine':event()['end']}
  c={'from':'2026-10-07','to':'2026-10-07','aliases':[{'tecnico_uid':'real','uid_storico':'legacy:LT'}],'sessions':[s]}
  p={'events':[event()]};annotate_preview(p,[resource()],c);self.assertEqual(p['events'][0]['importReview'],'sessione_gia_presente')
  p={'events':[event(key='other')]};annotate_preview(p,[resource()],c);self.assertEqual(p['events'][0]['importReview'],'possibile_doppione_da_verificare')
if __name__=='__main__':unittest.main()
