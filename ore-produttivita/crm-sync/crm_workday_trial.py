"""Read-only workday/restart report; never contacts the CRM or imports events."""
import datetime,json,pathlib
from zoneinfo import ZoneInfo
ROME=ZoneInfo('Europe/Rome')
def workday_report(rows,day,now):
    start=datetime.datetime.fromisoformat(day+'T09:00:00').replace(tzinfo=ROME)
    end=datetime.datetime.fromisoformat(day+'T18:00:00').replace(tzinfo=ROME)
    window=[r for r in rows if start<=datetime.datetime.fromisoformat(r['updatedAt'])<=min(end,now)]
    success=[r for r in window if r['state']=='recovery_pending' and r.get('scanned')==r.get('total') and r.get('saved')==0]
    failures=[r for r in window if r['state'] in ('error','partial','login_required')]
    points=[start]+[datetime.datetime.fromisoformat(r['updatedAt']) for r in success]+[min(end,now)]
    gaps=[{'from':a.isoformat(),'to':b.isoformat(),'minutes':round((b-a).total_seconds()/60,2)} for a,b in zip(points,points[1:]) if (b-a).total_seconds()>7*60]
    following=next((r for r in rows if datetime.datetime.fromisoformat(r['updatedAt']).astimezone(ROME).date()>start.date() and r['state']=='recovery_pending' and r.get('scanned')==r.get('total')),None)
    recovery=None
    if following:
        prior=success[-1] if success else None
        expected=prior['updatedAt'][:10] if prior else None
        recovery={'readAt':following['updatedAt'],'ranges':following.get('readRanges',[]),'coversPriorDay':bool(expected) and all(r['from']<=expected and r['to']>=following['updatedAt'][:10] for r in following.get('readRanges',[])) and bool(following.get('readRanges')),'physicalShutdownVerified':None}
    return {'day':day,'period':'09:00–18:00 Europe/Rome','complete':now>=end,'successful':len(success),'failed':len(failures),'skipped':sum(r['state']=='skipped' for r in window),'gaps':gaps,'firstExpiration':next((r for r in failures if r['state']=='login_required'),None),'workdayPassed':now>=end and not failures and not gaps and bool(success),'restartRecovery':recovery,'imports':sum(r.get('saved') or 0 for r in window)}
def main():
    base=pathlib.Path(__import__('os').environ['LOCALAPPDATA'])/'ColligoOreProduttivita'
    config=json.loads((base/'workday-trial.json').read_text(encoding='utf-8'))
    rows=[json.loads(line) for line in (base/'company-agent-cycles.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    rows=sorted((r for r in rows if r.get('agentVersion')==config['agentVersion']),key=lambda r:r['updatedAt'])
    report=workday_report(rows,config['day'],datetime.datetime.now(ROME))
    (base/'workday-trial-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
