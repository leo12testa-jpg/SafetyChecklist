"""CRM wall-clock times are Europe/Rome; transport instants are explicit UTC."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROME = ZoneInfo('Europe/Rome')

def crm_instant(day, hour, minute):
    local = datetime.fromisoformat(day).replace(hour=int(hour), minute=int(minute))
    candidates = set()
    for fold in (0, 1):
        instant = local.replace(tzinfo=ROME, fold=fold).astimezone(timezone.utc)
        if instant.astimezone(ROME).replace(tzinfo=None) == local:
            candidates.add(instant)
    if not candidates:
        raise ValueError('orario_crm_inesistente')
    if len(candidates) != 1:
        raise ValueError('orario_crm_ambiguo')
    return candidates.pop()

def utc_text(instant):
    return instant.isoformat(timespec='seconds').replace('+00:00', 'Z')

def crm_segments(day, sh, sm, eh, em):
    end_day = day
    if (eh, em) < (sh, sm):
        end_day = (datetime.fromisoformat(day) + timedelta(days=1)).date().isoformat()
    start, end = crm_instant(day, sh, sm), crm_instant(end_day, eh, em)
    if end <= start:
        return []
    segments = []
    cursor = start
    while cursor < end:
        local_day = cursor.astimezone(ROME).date()
        next_day = (local_day + timedelta(days=1)).isoformat()
        boundary = min(end, crm_instant(next_day, 0, 0))
        segments.append({'date':local_day.isoformat(), 'start':utc_text(cursor), 'end':utc_text(boundary), 'minutes':int((boundary-cursor).total_seconds()//60)})
        cursor = boundary
    return segments
