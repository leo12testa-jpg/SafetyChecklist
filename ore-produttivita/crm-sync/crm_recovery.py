"""Bounded read cursors and pending previews; never writes time records."""
from datetime import date,datetime,timedelta
from zoneinfo import ZoneInfo

def recovery_plan(resources,cursors,today,limit=30):
    if not 1<=limit<=30:raise ValueError('limite_recupero_non_valido')
    end=date.fromisoformat(today);earliest=end-timedelta(days=limit-1);plans=[]
    for r in resources:
        if r.get('agenda_crm_attiva') is False:continue
        sigla=r['sigla_crm'];cursor=cursors.get(sigla) or r.get('ultima_data_letta') or r.get('ultima_lettura_at')
        if cursor:
            try:
                old=datetime.fromisoformat(cursor.replace('Z','+00:00')).astimezone(ZoneInfo('Europe/Rome')).date() if 'T' in cursor else date.fromisoformat(cursor)
            except ValueError:raise ValueError('cursore_recupero_non_valido')
            if old>end:raise ValueError('cursore_recupero_futuro')
        else:old=earliest
        start=old;window_end=min(end,start+timedelta(days=limit-1));months=[];day=start
        while day<=window_end:
            month=day.strftime('%Y%m')
            if month not in months:months.append(month)
            day+=timedelta(days=1)
        plans.append({'sigla':sigla,'from':start.isoformat(),'to':window_end.isoformat(),'months':months,'remaining':{'from':(window_end+timedelta(days=1)).isoformat(),'to':today} if window_end<end else None})
    return plans

def combine_reads(plans,reads,today):
    failures={};events={};successful=[]
    for plan in plans:
        sigla=plan['sigla'];ok=True
        for month in plan['months']:
            read=reads[month]
            failure=next((f for f in read['failures'] if f['sigla']==sigla),None)
            if failure or sigla not in read['scanned']:
                failures[sigla]=failure or {'sigla':sigla,'reason':'mese_non_letto'};ok=False
        if not ok:continue
        successful.append(sigla)
        for month in plan['months']:
            for e in reads[month]['events']:
                if e['tecnicoSigla']==sigla and plan['from']<=e['date']<=plan['to']:
                    events[sigla,e['crmEventId']]=e
    return {'events':list(events.values()),'scanned':successful,'failures':list(failures.values()),'total':len(plans),'ranges':plans}

def merge_preview(previous,result):
    records={(e['tecnicoSigla'],e['crmEventId']):dict(e) for e in previous.get('events',[])}
    current={(e['tecnicoSigla'],e['crmEventId']):dict(e) for e in result['events']}
    ranges={p['sigla']:p for p in result['ranges'] if p['sigla'] in result['scanned']}
    changed_days=set()
    for key,e in records.items():
        window=ranges.get(e['tecnicoSigla'])
        if window and window['from']<=e['date']<=window['to'] and key not in current:
            e['recoveryState']='non_presente_nell_ultima_lettura';e['requiresReview']=True
            changed_days.add((e['tecnicoSigla'],e['date']))
    for key,e in current.items():
        e['recoveryState']='osservato'
        if (e['tecnicoSigla'],e['date']) in changed_days:e['requiresReview']=True
        records[key]=e
    return {**result,'events':list(records.values()),'currentEventCount':len(current),'imports':0}

def annotate_preview(preview,resources,constraints):
    by_sigla={r['sigla_crm']:r for r in resources}
    aliases=constraints.get('aliases',[]);sessions=constraints.get('sessions',[])
    locked_months={m['mese'][:7] for m in constraints.get('months',[]) if m['chiuso']}
    locked_days={(d['tecnico_uid'],d['data']) for d in constraints.get('days',[]) if d['stato']=='confermata'}
    for e in preview['events']:
        windows=constraints.get('windows',[{'from':constraints['from'],'to':constraints['to']}])
        if not any(w['from']<=e['date']<=w['to'] for w in windows):
            e['importReview']='fuori_finestra_da_verificare';continue
        r=by_sigla.get(e['tecnicoSigla'],{});uid=r.get('tecnico_uid')
        owners={uid}|{a['uid_storico'] for a in aliases if a['tecnico_uid']==uid}
        def same_time(s):
            try:return datetime.fromisoformat(s['inizio'].replace('Z','+00:00'))==datetime.fromisoformat(e['start'].replace('Z','+00:00')) and datetime.fromisoformat(s['fine'].replace('Z','+00:00'))==datetime.fromisoformat(e['end'].replace('Z','+00:00'))
            except (TypeError,KeyError,ValueError):return False
        exact=[s for s in sessions if s['tecnico_uid'] in owners and s.get('crm_event_id')==e['crmEventId']]
        matches=[s for s in sessions if s['tecnico_uid'] in owners and (s in exact or same_time(s))]
        e['existingSessionIds']=[s['id'] for s in matches]
        blocked=e['date'][:7] in locked_months or any((owner,e['date']) in locked_days for owner in owners) or any(s.get('confermata') for s in matches)
        if blocked:e['importReview']='giornata_confermata_o_mese_chiuso'
        elif exact:e['importReview']='sessione_gia_presente'
        elif matches:e['importReview']='possibile_doppione_da_verificare';e['requiresReview']=True
        elif e.get('requiresReview'):e['importReview']='variazione_da_verificare'
        elif not uid or uid.startswith('legacy:') or not r.get('collegamento_approvato_at'):e['importReview']='collegamento_da_approvare'
        else:e['importReview']='candidato_da_verificare'
    return preview
