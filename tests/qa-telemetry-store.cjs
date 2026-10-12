// Memory-only replica of the two existing telemetry tables for isolated browser tests.
function telemetryStore(){
  const usage=new Map(),events=[];
  async function request(input,options={}){
    const url=new URL(input),headers=new Headers(options.headers),table=url.pathname.split('/').pop();
    const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
    if(headers.get('authorization')!=='Bearer qa-service-only')return json({error:'QA backend-only RLS'},403);
    if(!['safety_app_usage','safety_app_access_events'].includes(table))return json({error:'Unknown QA table'},404);
    const method=options.method||'GET',body=JSON.parse(options.body||'{}');
    if(method==='POST'){
      if(table==='safety_app_usage')usage.set(body.uid,{...(usage.get(body.uid)||{}),...body});
      else events.push({id:events.length+1,...body});
      return new Response(null,{status:204});
    }
    if(method==='DELETE'){
      const uid=url.searchParams.get('uid')?.replace(/^eq\./,'');if(table==='safety_app_usage')usage.delete(uid);else for(let i=events.length-1;i>=0;i--)if(events[i].uid===uid)events.splice(i,1);
      return new Response(null,{status:204});
    }
    let rows=table==='safety_app_usage'?[...usage.values()]:[...events];
    const uid=url.searchParams.get('uid')?.replace(/^eq\./,'');if(uid)rows=rows.filter(r=>r.uid===uid);
    const since=url.searchParams.get('occurred_at')?.replace(/^gte\./,'');if(since)rows=rows.filter(r=>r.occurred_at>=since);
    const offset=Number(url.searchParams.get('offset')||0),limit=Math.min(Number(url.searchParams.get('limit')||1000),1000);return json(rows.slice(offset,offset+limit));
  }
  return{usage,events,request,clear(){usage.clear();events.length=0;}};
}
module.exports={telemetryStore};
