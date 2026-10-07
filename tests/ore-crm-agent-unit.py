import ast,asyncio,hashlib,json,pathlib,re,unittest,tempfile,types
from urllib.parse import urlparse,parse_qs
source=pathlib.Path('ore-produttivita/crm-sync/crm_company_agent.py').read_text(encoding='utf-8')
names={'norm','agenda_fingerprint','scan_summary','scan_resources','select_resource','agenda_toolbar','discover_resources','select_month'}
namespace={'re':re,'hashlib':hashlib,'json':json,'urlparse':urlparse,'parse_qs':parse_qs}
tree=ast.parse(source)
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names],type_ignores=[]),'agent-test','exec'),namespace)

class AgentTests(unittest.IsolatedAsyncioTestCase):
 async def test_identical_agenda_guard_remains_active(self):
  async def selected(*args):return True
  async def month(*args):pass
  async def cells(*args):return {'20261001':['event']}
  namespace.update(select_resource=selected,select_month=month,month_cells=cells,iso_day=lambda d:'2026-10-01',parse_day=lambda *args:[{'date':'2026-10-01','start':'08:00','end':'09:00','title':'same'}])
  rows=[{'sigla_crm':str(i),'nome_crm':str(i)} for i in range(5)]
  result=await namespace['scan_resources'](None,rows,'202610')
  self.assertEqual(result['scanned'],['0','1','2'])
  self.assertEqual([f['reason'] for f in result['failures']],['agenda_identica_sospetta']*2)
  self.assertEqual(len(result['events']),3)
 async def test_empty_agendas_do_not_trigger_false_duplicate(self):
  async def selected(*args):return True
  async def month(*args):pass
  async def cells(*args):return {}
  namespace.update(select_resource=selected,select_month=month,month_cells=cells)
  rows=[{'sigla_crm':str(i),'nome_crm':str(i)} for i in range(5)]
  result=await namespace['scan_resources'](None,rows,'202610')
  self.assertEqual(len(result['scanned']),5);self.assertEqual(result['failures'],[])
 async def test_failed_selection_never_reads_agenda(self):
  async def selected(*args):return False
  async def forbidden(*args):self.fail('Agenda letta senza selezione verificata')
  namespace.update(select_resource=selected,month_cells=forbidden)
  result=await namespace['scan_resources'](None,[{'sigla_crm':'CP','nome_crm':'Carlo Padovan'}],'202610')
  self.assertEqual(result['events'],[]);self.assertEqual(result['failures'][0]['reason'],'risorsa_non_trovata')
 async def test_active_without_crm_is_not_scanned_or_failed(self):
  selected=[]
  async def select(*args):selected.append(args[2]);return True
  async def month(*args):pass
  async def cells(*args):return {}
  namespace.update(select_resource=select,select_month=month,month_cells=cells)
  result=await namespace['scan_resources'](None,[{'sigla_crm':'VD','attiva':True,'agenda_crm_attiva':False},{'sigla_crm':'LT','agenda_crm_attiva':None}],'202610')
  self.assertEqual(selected,['LT']);self.assertEqual(result['total'],1);self.assertEqual(result['scanned'],['LT']);self.assertEqual(result['failures'],[])
 async def test_errors_never_log_sensitive_exception_contents(self):
  async def selected(*args):raise RuntimeError('Appointment private text + token secret')
  namespace['select_resource']=selected
  result=await namespace['scan_resources'](None,[{'sigla_crm':'CP'}],'202610')
  self.assertNotIn('secret',json.dumps(result));self.assertEqual(result['failures'][0]['reason'],'errore_selezione_o_caricamento')
 def test_summary_reports_every_failure(self):
  result={'scanned':['LT'],'total':3,'failures':[{'sigla':'CP','reason':'risorsa_non_trovata'},{'sigla':'GC','reason':'agenda_identica_sospetta'}]}
  summary=namespace['scan_summary'](result)
  self.assertIn('Lette 1 su 3',summary);self.assertIn('CP',summary);self.assertIn('GC',summary)
 def test_setup_dependencies_are_pinned(self):
  requirements=pathlib.Path('ore-produttivita/crm-sync/requirements.txt').read_text()
  self.assertEqual(len(requirements.splitlines()),4)
  for line in requirements.splitlines():self.assertRegex(line,r'^[a-z]+==\d+\.\d+(?:\.\d+)?$')
  setup=pathlib.Path('ore-produttivita/crm-sync/SETUP_SYNC_BACKGROUND.bat').read_text()
  self.assertNotIn('--upgrade',setup);self.assertIn('requirements.txt',setup)
 def test_setup_allows_five_minute_cycles_on_battery(self):
  setup=pathlib.Path('ore-produttivita/crm-sync/SETUP_SYNC_BACKGROUND.bat').read_text()
  self.assertIn('-AllowStartIfOnBatteries',setup);self.assertIn('-DontStopIfGoingOnBatteries',setup)
  self.assertIn('-RepetitionInterval (New-TimeSpan -Minutes 5)',setup)
  self.assertNotIn('-ExecutionPolicy Bypass',setup)
 def test_recovery_defaults_to_preview_and_does_not_import_on_failures(self):
  self.assertIn("config.get('recovery_hold',True)",source)
  self.assertIn('if not failed and not preview:',source)
  self.assertIn('if failed:raise PartialReadError(message)',source)
 def test_expired_login_updates_backend_before_exiting(self):
  main=next(n for n in tree.body if isinstance(n,ast.If) and isinstance(n.test,ast.Compare) and isinstance(n.test.left,ast.Name) and n.test.left.id=='__name__')
  handler=next(n for n in main.body if isinstance(n,ast.Try)).handlers[0]
  calls=[]
  class Expired(RuntimeError):pass
  class Partial(RuntimeError):pass
  def stopped(code):raise SystemExit(code)
  with tempfile.TemporaryDirectory() as d:
   config=pathlib.Path(d)/'agent.json';config.write_text('{"username":"synthetic-admin"}')
   env={'exc':Expired('Sessione CRM scaduta'),'LoginRequiredError':Expired,'PartialReadError':Partial,'sys':types.SimpleNamespace(argv=['agent.py','--run'],exit=stopped),'write_status':lambda *args:None,'CONFIG_FILE':config,'json':json,'app_token':lambda *args,**kwargs:'synthetic-token','api':lambda *args,**kwargs:calls.append(kwargs),'AGENT_VERSION':'test'}
   with self.assertRaises(SystemExit) as exited:exec(compile(ast.Module(body=handler.body,type_ignores=[]),'agent-handler','exec'),env)
   self.assertEqual(exited.exception.code,2);self.assertEqual(calls[0]['state'],'login_required');self.assertEqual(calls[0]['agentVersion'],'test')
 def test_cycle_log_tracks_resources_and_elapsed_since_last_read_without_titles(self):
  node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='write_status')
  with tempfile.TemporaryDirectory() as d:
   env={'APP_DIR':pathlib.Path(d),'STATUS_FILE':pathlib.Path(d)/'status.json','json':json,'AGENT_VERSION':'test'}
   exec(compile(ast.Module(body=[node],type_ignores=[]),'status-test','exec'),env)
   env['write_status']('recovery_pending','not logged',{'scanned':1,'scannedResources':['LT'],'saved':0,'title':'private contents'})
   env['write_status']('login_required','not logged')
   text=(pathlib.Path(d)/'company-agent-cycles.jsonl').read_text();rows=[json.loads(line) for line in text.splitlines()]
   self.assertEqual(rows[0]['scannedResources'],['LT']);self.assertEqual(rows[1]['lastSuccessfulReadAt'],rows[0]['updatedAt']);self.assertGreaterEqual(rows[1]['minutesSinceLastSuccessfulRead'],0);self.assertNotIn('private contents',text)

if __name__=='__main__':unittest.main()
