import ast,datetime,hashlib,html,pathlib,re,sys,unittest
sys.path.insert(0,str(pathlib.Path('ore-produttivita/crm-sync').resolve()))
from crm_time import crm_segments,crm_instant,utc_text
def reader(filename,names):
 tree=ast.parse(pathlib.Path(filename).read_text(encoding='utf-8'))
 env={'re':re,'html':html,'hashlib':hashlib,'crm_segments':crm_segments,'crm_instant':crm_instant,'utc_text':utc_text,'WORK_RE':re.compile(r'\b(\d{1,2}[A-IL-P])\b',re.I),'OLD_SHORT_RE':re.compile(r'\b(\d{2}\.\d{2})(?:-([A-Z]))?\b',re.I),'COMM_RE':re.compile(r'\b(CM\d{5,})\b',re.I)}
 exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[]),'reader-test','exec'),env)
 return env
class TimeTests(unittest.TestCase):
 def test_summer_and_winter_months(self):
  for day,expected in [('2026-01-15','08:30'),('2026-04-15','07:30'),('2026-07-15','07:30'),('2026-12-15','08:30')]:
   row=crm_segments(day,9,30,13,0)[0];self.assertEqual(row['start'][11:16],expected);self.assertEqual(row['date'],day);self.assertEqual(row['minutes'],210)
 def test_october_30_is_standard_time(self):self.assertEqual(crm_segments('2026-10-30',9,30,13,0)[0]['start'],'2026-10-30T08:30:00Z')
 def test_last_summer_day(self):self.assertEqual(crm_segments('2026-10-24',9,30,13,0)[0]['start'],'2026-10-24T07:30:00Z')
 def test_change_day_elapsed_time(self):self.assertEqual(crm_segments('2026-10-25',1,30,3,30)[0]['minutes'],180)
 def test_ambiguous_and_nonexistent_not_guessed(self):
  for day in ['2026-10-25','2026-03-29']:
   with self.assertRaises(ValueError):crm_segments(day,2,30,4,0)
 def test_late_event_keeps_local_date(self):
  row=crm_segments('2026-10-02',23,30,23,55)[0];self.assertEqual(row['date'],'2026-10-02');self.assertEqual(row['start'],'2026-10-02T21:30:00Z');self.assertEqual(row['minutes'],25)
 def test_midnight_split_preserves_total(self):
  rows=crm_segments('2026-10-02',23,30,0,30);self.assertEqual([r['date'] for r in rows],['2026-10-02','2026-10-03']);self.assertEqual(sum(r['minutes'] for r in rows),60);self.assertEqual(rows[0]['end'],rows[1]['start'])
 def test_company_parser_identity_stable_and_utc_correct(self):
  env=reader('ore-produttivita/crm-sync/crm_company_agent.py',{'clean_event_title','parse_day'})
  row=env['parse_day'](['Dalle 09:30 Alle 13:00 1B DVR'],'2026-10-02','LT')[0]
  stable=hashlib.sha1('LT|2026-10-02|2026-10-02T09:30:00|2026-10-02T13:00:00|1B DVR'.encode()).hexdigest()[:24]
  self.assertEqual(row['crmEventId'],'agenda-'+stable);self.assertEqual(row['start'],'2026-10-02T07:30:00Z');self.assertEqual(row['minutes'],210)
 def test_company_parser_midnight(self):
  env=reader('ore-produttivita/crm-sync/crm_company_agent.py',{'clean_event_title','parse_day'})
  rows=env['parse_day'](['Dalle 23:30 Alle 00:30 1B DVR'],'2026-10-02','LT');self.assertEqual(len(rows),2);self.assertEqual(sum(r['minutes'] for r in rows),60);self.assertEqual(len(set(r['crmEventId'] for r in rows)),2)
 def test_personal_parser_uses_same_conversion(self):
  env=reader('ore-produttivita/crm-sync/crm_agenda_sync.py',{'parse_date','iso_for','events_from_text'})
  env.update(ISO_DATE_RE=re.compile(r'(20\d{2})-(\d{2})-(\d{2})'),DATE_RE=re.compile(r'(\d{2})/(\d{2})/(20\d{2})'),TIME_RE=re.compile(r'\b([01]?\d|2[0-3]):([0-5]\d)\b'))
  rows=env['events_from_text']('Dalle 09:30 Alle 13:00 1B DVR','2026-10-02');self.assertEqual(rows[0]['start'],'2026-10-02T07:30:00Z');self.assertEqual(rows[0]['minutes'],210)
  self.assertEqual(len(env['events_from_text']('Dalle 23:30 Alle 00:30 1B DVR','2026-10-02')),2)
if __name__=='__main__':unittest.main()
