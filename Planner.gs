const TZ_='America/New_York';
let walkMemo_={};
let providerBudget_={};
let routesUnavailable_=false;
let driveMemo_={};
let providerUsage_={maps:0,routes:0};
function budget_(provider,warnings) {
  const p=PropertiesService.getScriptProperties(),key='USAGE_'+provider+'_'+localDate_(new Date());
  const n=Number(p.getProperty(key) || 0);
  if(n>=providerBudget_[provider]) { warnings.add(provider+'_daily_budget_reached');throw new Error('google_daily_budget_reached'); }
  p.setProperty(key,String(n+1));
  providerUsage_[provider]++;
}
function localDate_(d) { return Utilities.formatDate(d,TZ_,'yyyy-MM-dd'); }
function localTime_(d) { return Utilities.formatDate(d,TZ_,'HH:mm'); }
function epoch_(date,seconds) {
  const day=CommuteCore.addDays(date,Math.floor(seconds/86400));const n=seconds%86400;
  const clock=[Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(v=>String(v).padStart(2,'0')).join(':');
  return Utilities.parseDate(day+' '+clock,TZ_,'yyyy-MM-dd HH:mm:ss').getTime();
}
function minute_(n) { return Math.round(n/60000); }
function safeCode_(e) {
  const m=/^(?:setting_invalid:[a-z_]+|[a-z_]+(?:_http_\d+)?|calendar_[a-z_]+_http_\d+)$/.exec(String(e.message || ''));
  return m?m[0]:'unexpected_error';
}
function fetchJson_(url,options,label) {
  const response=UrlFetchApp.fetch(url,Object.assign({muteHttpExceptions:true},options || {}));
  if(response.getResponseCode()<200||response.getResponseCode()>299)throw new Error(label+'_http_'+response.getResponseCode());
  try{return JSON.parse(response.getContentText());}catch(e){throw new Error(label+'_json_invalid');}
}
function calendar_(method,path,body) {
  return fetchJson_('https://www.googleapis.com/calendar/v3/'+path,{
    method,headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},
    ...(body?{contentType:'application/json',payload:JSON.stringify(body)}:{})
  },'calendar_'+method);
}
function events_(id,start,end) {
  let rows=[],token='',seen=new Set();
  do {
    const q={timeMin:new Date(start).toISOString(),timeMax:new Date(end).toISOString(),singleEvents:true,maxResults:2500};
    if(token)q.pageToken=token;
    const query=Object.keys(q).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(q[k])).join('&');
    const page=calendar_('get','calendars/'+encodeURIComponent(id)+'/events?'+query);
    if(page.items!==undefined&&!Array.isArray(page.items))throw new Error('calendar_items_invalid');
    rows=rows.concat(page.items || []);token=page.nextPageToken || '';
    if(token&&seen.has(token))throw new Error('calendar_pagination_repeated');seen.add(token);
    if(seen.size>25)throw new Error('calendar_pagination_limit');
  }while(token);
  return rows;
}
function stations_() {
  const rows=sheet_('Stations').getDataRange().getValues().slice(1);
  const stations=rows.filter(r=>r[0]===true||String(r[0]).toLowerCase()==='true').map(r=>({id:String(r[1]),name:String(r[2]),fallback:Number(r[3])*60}));
  if(!stations.length||stations.length>8||new Set(stations.map(s=>s.id)).size!==stations.length||stations.some(s=>!s.id||!Number.isFinite(s.fallback)||s.fallback<=0))throw new Error('stations_invalid');
  return stations;
}
function parseCsv_(blob) {
  const rows=Utilities.parseCsv(blob.getDataAsString('UTF-8').replace(/^\uFEFF/,''));
  const headers=rows.shift();return rows.filter(r=>r.length===headers.length).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}
function downloadRail_() {
  const response=UrlFetchApp.fetch('https://www3.septa.org/developer/gtfs_public.zip',{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('gtfs_download_http_'+response.getResponseCode());
  const outer=Utilities.unzip(response.getBlob());const rail=outer.find(b=>b.getName()==='google_rail.zip');
  if(!rail)throw new Error('gtfs_rail_archive_missing');
  const blobs=Object.fromEntries(Utilities.unzip(rail).map(b=>[b.getName(),b]));
  const names={trips:'trips.txt',times:'stop_times.txt',routes:'routes.txt',stops:'stops.txt',calendar:'calendar.txt',exceptions:'calendar_dates.txt',info:'feed_info.txt'};
  const tables={};Object.keys(names).forEach(k=>{if(!blobs[names[k]])throw new Error('gtfs_table_missing');tables[k]=parseCsv_(blobs[names[k]]);});return tables;
}
function feed_(c,stations,now) {
  const p=PropertiesService.getScriptProperties(),signature=stations.map(s=>s.id).sort().join(',')+'>'+c.target_stop_id;
  const meta=JSON.parse(p.getProperty('GTFS_META') || 'null');
  if(meta&&meta.signature===signature&&now-meta.checked<86400000) {
    const data=Array.from({length:meta.chunks},(_,i)=>p.getProperty('FEED_'+meta.generation+'_'+i));
    if(data.every(x=>x!==null)) {
      const cached=JSON.parse(data.join('')),today=localDate_(new Date(now)).replace(/-/g,'');
      if(cached.start&&cached.end&&today>=cached.start&&today<=cached.end&&cached.legs.length)return cached;
    }
  }
  const f=CommuteCore.compileFeed(downloadRail_(),stations.map(s=>s.id),String(c.target_stop_id));
  f.checked=new Date(now).toISOString();
  const today=localDate_(new Date(now)).replace(/-/g,'');
  if(!f.start||!f.end||today<f.start||today>f.end||!f.legs.length)throw new Error('gtfs_coverage_invalid');
  const text=JSON.stringify(f);
  if(text.length>220000)throw new Error('gtfs_corridor_too_large');
  const generation=String(now),chunks=Math.ceil(text.length/7000),values={};
  for(let i=0;i<chunks;i++)values['FEED_'+generation+'_'+i]=text.slice(i*7000,(i+1)*7000);
  p.setProperties(values);p.setProperty('GTFS_META',JSON.stringify({signature,checked:now,generation,chunks}));
  if(meta&&meta.generation!==generation)for(let i=0;i<meta.chunks;i++)p.deleteProperty('FEED_'+meta.generation+'_'+i);
  return f;
}
function commitments_(c,start,end,warnings) {
  if(!c.source_calendar_ids.length)throw new Error('required_calendar_missing');
  let rows=[];
  c.source_calendar_ids.forEach(id=>{rows=rows.concat(events_(id,start,end));});
  c.optional_calendar_ids.forEach(id=>{
    try{rows=rows.concat(events_(id,start,end));}catch(e){warnings.add('optional_calendar_unavailable');}
  });
  const days={};
  rows.filter(e=>CommuteCore.isCommitment(e,c.include_title,c.exclude_title,c.campus_location_terms)).forEach(e=>{
    const from=new Date(e.start.dateTime).getTime(),to=new Date(e.end.dateTime).getTime();
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)throw new Error('commitment_time_invalid');
    const date=localDate_(new Date(from));
    if(date!==localDate_(new Date(to)))throw new Error('commitment_crosses_midnight');
    if(!days[date])days[date]={date,start:from,end:to,firstPlace:e.location || c.destination,lastPlace:e.location || c.destination,count:0};
    const d=days[date];d.count++;
    if(from<d.start){d.start=from;d.firstPlace=e.location || c.destination;}
    if(to>d.end){d.end=to;d.lastPlace=e.location || c.destination;}
  });return Object.values(days).sort((a,b)=>a.start-b.start);
}
function walk_(station,place,c,warnings) {
  const memo=station.stop_id+'>'+String(place);if(walkMemo_[memo])return walkMemo_[memo];
  try {
    budget_('maps',warnings);
    const r=Maps.newDirectionFinder().setOrigin(station.stop_lat+','+station.stop_lon).setDestination(String(place))
      .setMode(Maps.DirectionFinder.Mode.WALKING).getDirections();
    const leg=r.routes && r.routes[0] && r.routes[0].legs[0];if(!leg)throw new Error('walk_route_missing');
    return walkMemo_[memo]={seconds:leg.duration.value,meters:leg.distance.value,label:'Google walking route'};
  }catch(e){warnings.add('google_walk_fallback');return {seconds:c.fallback_walk_minutes*60,meters:null,label:'Configured walk fallback · Google unavailable'};}
}
function drive_(origin,station,departure,returning,fallback,warnings,routesEnabled=false) {
  const point=station.stop_lat+','+station.stop_lon;
  const from=returning?point:String(origin),to=returning?String(origin):point;
  const memo=from+'>'+to;
  const key=PropertiesService.getScriptProperties().getProperty('ROUTES_KEY');
  if(key&&routesEnabled&&!routesUnavailable_) {
    try {
      budget_('routes',warnings);
      const depart=new Date(Math.max(departure,Date.now()+60000)).toISOString();
      const r=fetchJson_('https://routes.googleapis.com/directions/v2:computeRoutes',{
        method:'post',contentType:'application/json',headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.duration,routes.staticDuration,routes.distanceMeters'},
        payload:JSON.stringify({origin:{address:from},destination:{address:to},travelMode:'DRIVE',routingPreference:'TRAFFIC_AWARE',departureTime:depart})
      },'google_routes');
      if(!r.routes||!r.routes[0])throw new Error('google_route_missing');
      const route=r.routes[0],duration=Number(String(route.duration).replace(/s$/,''));
      if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(route.distanceMeters)||route.distanceMeters<=0)throw new Error('google_route_invalid');
      return {seconds:duration,meters:route.distanceMeters,label:'Google traffic-aware forecast',observed:new Date().toISOString()};
    }catch(e){routesUnavailable_=true;warnings.add('google_traffic_unavailable');warnings.add(safeCode_(e));}
  }
  // Ordinary Google route duration is not a traffic forecast. Reuse it only within this execution.
  if(driveMemo_[memo])return driveMemo_[memo];
  try {
    budget_('maps',warnings);
    const finder=Maps.newDirectionFinder().setOrigin(from).setDestination(to).setMode(Maps.DirectionFinder.Mode.DRIVING);
    if(routesEnabled)finder.setDepart(new Date(Math.max(departure,Date.now()+60000)));
    const r=finder.getDirections();
    const leg=r.routes&&r.routes[0]&&r.routes[0].legs[0];if(!leg)throw new Error('google_route_missing');
    const traffic=routesEnabled&&leg.duration_in_traffic,duration=traffic||leg.duration;
    if(!Number.isFinite(duration.value)||duration.value<=0||!Number.isFinite(leg.distance.value)||leg.distance.value<=0)throw new Error('google_route_invalid');
    const result={seconds:duration.value,meters:leg.distance.value,
      label:traffic?'Google traffic forecast':'Google Maps route estimate · traffic not supplied',observed:new Date().toISOString()};
    if(!traffic)driveMemo_[memo]=result;
    return result;
  }catch(e){warnings.add('google_drive_unavailable');return {seconds:fallback,meters:null,label:'Configured drive fallback · Google unavailable',observed:null};}
}
function live_(stations,target,warnings) {
  const result={trains:[],arrivals:{},observedAt:0,requests:1};
  try{result.trains=fetchJson_('https://api.septa.org/api/TrainView/index.php',{},'septa_trainview');
    if(!Array.isArray(result.trains))throw new Error('septa_trainview_invalid');
  }catch(e){warnings.add('trainview_unavailable');result.trains=[];}
  stations.map(s=>s.id).concat([String(target)]).forEach(id=>{
    result.requests++;
    try{result.arrivals[id]=CommuteCore.flattenArrivals(fetchJson_('https://api.septa.org/api/Arrivals/index.php?req1='+encodeURIComponent(id)+'&req2=6',{},'septa_arrivals'));}
    catch(e){warnings.add('station_arrivals_unavailable');result.arrivals[id]=[];}
  });result.observedAt=Date.now();return result;
}
function selections_() {
  const rows=sheet_('Selections').getDataRange().getValues().slice(1);const out={};
  rows.forEach(r=>{
    if(!r[0]||!r[2])return;const date=r[0] instanceof Date?localDate_(r[0]):String(r[0]);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!['outbound','return'].includes(String(r[1])))throw new Error('selection_invalid');
    const k=date+':'+r[1];if(out[k])throw new Error('selection_duplicate');out[k]=String(r[2]).trim();
  });return out;
}
function planDay_(day,c,stations,feed,live,now,warnings,selections) {
  const target=feed.stops.find(s=>s.stop_id===String(c.target_stop_id));const options=[];
  const today=localDate_(new Date(now)),limit=c.options_per_station;
  stations.forEach(s=>{
    const stop=feed.stops.find(x=>x.stop_id===s.id);
    const inWalk=walk_(target,day.firstPlace,c,warnings),outWalk=walk_(target,day.lastPlace,c,warnings);
    ['outbound','return'].forEach(direction=>{
      const returning=direction==='return',walk=returning?outWalk:inWalk;
      const trainAfter=day.end+(c.departure_buffer_minutes*60+walk.seconds)*1000;
      const arriveBy=day.start-(c.arrival_buffer_minutes*60+walk.seconds)*1000;
      const candidates=CommuteCore.legsFor(feed,day.date,s.id,String(c.target_stop_id),direction).map(l=>{
        const departure=epoch_(day.date,l.departure),arrival=epoch_(day.date,l.arrival);
        const status=CommuteCore.liveFor(l.train,day.date,today,live.arrivals[returning?c.target_stop_id:s.id] || [],live.trains,live.observedAt,now);
        // Delay observations are not a guarantee of arrival. Never use a late train to justify leaving later.
        const projectedArrival=arrival+(status.delay || 0)*60000;
        return {leg:l,departure,arrival,live:status,feasible:!status.cancelled&&(returning?departure>=trainAfter:projectedArrival<=arriveBy)};
      }).filter(o=>o.feasible && (returning?o.departure<=trainAfter+4*3600000:o.arrival>=arriveBy-4*3600000))
        .sort((a,b)=>returning?a.departure-b.departure:b.departure-a.departure).slice(0,limit);
      candidates.forEach(o=>{
        const estimateDeparture=returning?o.arrival:o.departure-(s.fallback+c.parking_buffer_minutes*60)*1000;
        const road=estimateDeparture<now?{seconds:s.fallback,meters:null,label:'Departure passed · road time no longer refreshed',observed:null}:drive_(c.origin,stop,estimateDeparture,returning,s.fallback,warnings,c.routes_api_enabled);
        const leave=returning?o.departure-walk.seconds*1000-c.departure_buffer_minutes*60000:o.departure-(road.seconds+c.parking_buffer_minutes*60)*1000;
        const finish=returning?o.arrival+road.seconds*1000:o.arrival+walk.seconds*1000;
        const id=day.date+':'+direction+':'+s.id+':'+(o.leg.train || o.leg.trip);
        options.push({id,date:day.date,direction,station:s.id,stationName:stop.stop_name,train:o.leg.train,line:o.leg.line,
          departure:o.departure,arrival:o.arrival,leave,finish,drive:road,walk,live:o.live,cancelled:o.live.cancelled,
          feasible:!returning||leave>=now,departed:leave<now,score:returning?finish:-leave,chosen:false,dayStart:day.start,dayEnd:day.end});
      });
    });
  });
  const props=PropertiesService.getScriptProperties();
  const previousLeave=Number(props.getProperty('OUTBOUND_LEAVE_'+day.date));
  const remembered=previousLeave&&previousLeave<=now?props.getProperty('OUTBOUND_'+day.date):null;
  const outbound=CommuteCore.choose(options.filter(o=>o.direction==='outbound'),selections[day.date+':outbound'] || remembered);
  const returning=outbound && CommuteCore.choose(options.filter(o=>o.direction==='return'),selections[day.date+':return'],outbound.station);
  if(outbound){outbound.chosen=true;props.setProperty('OUTBOUND_'+day.date,outbound.id);props.setProperty('OUTBOUND_LEAVE_'+day.date,String(outbound.leave));}if(returning)returning.chosen=true;
  if(!outbound)warnings.add('no_feasible_outbound');if(outbound&&!returning&&day.end>now)warnings.add('no_paired_return');
  return {day,options,chosen:[outbound,returning].filter(Boolean)};
}
function hash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>(b&255).toString(16).padStart(2,'0')).join('');
}
function event_(o,c,main,owner) {
  const train=o.train?'#'+o.train:'number unavailable';
  const summary=main?(o.direction==='outbound'?'Leave '+localTime_(new Date(o.leave))+' · ':'Home '+localTime_(new Date(o.finish))+' · ')+o.stationName+' '+train:
    (o.chosen?'★ ':'')+o.stationName+' '+train+' · '+localTime_(new Date(o.departure))+' → '+localTime_(new Date(o.arrival));
  const description=[
    'SEPTA Regional Rail · '+o.line+' · '+o.direction,
    'Leave by '+Utilities.formatDate(new Date(o.leave),TZ_,'EEE MMM d HH:mm')+'; scheduled train '+localTime_(new Date(o.departure))+' → '+localTime_(new Date(o.arrival)),
    o.live.label+(o.live.track?' · track '+o.live.track:''),
    o.drive.label+'; drive '+Math.ceil(o.drive.seconds/60)+' min'+(o.drive.meters!==null?'; road distance '+(o.drive.meters/1609.344).toFixed(1)+' mi':''),
    o.walk.label+'; walk '+Math.ceil(o.walk.seconds/60)+' min',
    'Return must use the outbound parked-car station. Alternative stations represent paired journey choices.',
    'Planner: https://docs.google.com/spreadsheets/d/'+book_().getId()+'/edit',
    'Option ID: '+o.id
  ].join('\n');
  const key=main?o.date+':'+o.direction:o.id;
  const body={id:hash_(owner+':'+key).slice(0,40),summary,description,
    start:{dateTime:new Date(main?o.leave:o.departure).toISOString(),timeZone:TZ_},
    end:{dateTime:new Date(main?o.finish:o.arrival).toISOString(),timeZone:TZ_},
    reminders:{useDefault:false,overrides:main?c.reminder_minutes.map(minutes=>({method:'popup',minutes})):[]},
    extendedProperties:{private:{commuteOwner:owner,commuteKey:key}},colorId:o.chosen?'10':'8'};
  const digest=hash_(JSON.stringify(body));body.extendedProperties.private.commuteHash=digest;return body;
}
function conflictingInsert_(op,token) {
  const response=UrlFetchApp.fetch(op.url+'/'+op.body.id,{method:'get',muteHttpExceptions:true,headers:{Authorization:'Bearer '+token}});
  const code=response.getResponseCode();
  if(code===200) {
    let existing;try{existing=JSON.parse(response.getContentText());}catch(e){throw new Error('calendar_get_json_invalid');}
    const expected=op.body.extendedProperties.private,actual=existing.extendedProperties&&existing.extendedProperties.private;
    if(existing.status!=='cancelled'&&actual&&actual.commuteOwner===expected.commuteOwner&&actual.commuteKey===expected.commuteKey) {
      if(actual.commuteHash===expected.commuteHash)return null;
      const body={...op.body};delete body.id;return {url:op.url+'/'+op.body.id,method:'patch',body};
    }
  }else if(code!==404&&code!==410)throw new Error('calendar_get_http_'+code);
  // Deleted Calendar IDs remain reserved. Use a fresh ID, then retain it by the logical ownership key.
  return {...op,body:{...op.body,id:hash_(op.body.id+':'+Utilities.getUuid()).slice(0,40)}};
}
function calendarBatch_(operations,token) {
  let pending=operations;
  for(let attempt=0;pending.length;attempt++) {
    const replies=UrlFetchApp.fetchAll(pending.map(op=>({url:op.url,method:op.method,muteHttpExceptions:true,
      headers:{Authorization:'Bearer '+token},...(op.body?{contentType:'application/json',payload:JSON.stringify(op.body)}:{})})));
    const retry=[];
    replies.forEach((r,j)=>{
      const code=r.getResponseCode(),op=pending[j];
      if((code>=200&&code<300)||(op.method==='delete'&&(code===404||code===410)))return;
      if(code===409&&op.method==='post'&&attempt<3) {const next=conflictingInsert_(op,token);if(next)retry.push(next);return;}
      let reason='';try{reason=JSON.parse(r.getContentText()).error.errors[0].reason;}catch(e){}
      const throttled=code===403&&['rateLimitExceeded','userRateLimitExceeded'].includes(reason);
      if(attempt<3&&(throttled||[429,500,502,503,504].includes(code)))retry.push(op);
      else throw new Error('calendar_'+op.method+'_http_'+code);
    });
    pending=retry;
    if(pending.length)Utilities.sleep(1000*Math.pow(2,attempt));
  }
}
function reconcile_(id,desired,start,end,c,owner) {
  const existing=events_(id,start,end).filter(e=>e.extendedProperties&&e.extendedProperties.private&&e.extendedProperties.private.commuteOwner===owner);
  const byKey=Object.fromEntries(existing.map(e=>[e.extendedProperties.private.commuteKey,e]));
  if(Object.keys(byKey).length!==existing.length)throw new Error('calendar_duplicate_owned_key');
  const desiredKeys=new Set(desired.map(e=>e.extendedProperties.private.commuteKey));
  const deletes=existing.filter(e=>!desiredKeys.has(e.extendedProperties.private.commuteKey)&&new Date(e.start.dateTime).getTime()>Date.now());
  if(deletes.length>c.max_deletions_per_run)throw new Error('calendar_deletion_cap');
  const operations=[];
  desired.forEach(e=>{
    const old=byKey[e.extendedProperties.private.commuteKey];if(old&&old.extendedProperties.private.commuteHash===e.extendedProperties.private.commuteHash)return;
    if(old&&new Date(old.start.dateTime).getTime()<Date.now())return;
    if(!old&&new Date(e.start.dateTime).getTime()<Date.now())return;
    const body={...e};if(old)delete body.id;
    operations.push({url:'https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(id)+'/events'+(old?'/'+old.id:''),method:old?'patch':'post',body});
  });
  deletes.forEach(e=>operations.push({url:'https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(id)+'/events/'+e.id,method:'delete'}));
  const token=ScriptApp.getOAuthToken();
  for(let i=0;i<operations.length;i+=15) {
    if(i)Utilities.sleep(500);
    calendarBatch_(operations.slice(i,i+15),token);
  }
  return {changes:operations.length,events:desired.length};
}
function publishSheets_(plans,full,refreshDate) {
  const columns=['Date','Direction','Station','Train','Leave by','Train departs','Train arrives','Finish / home','Drive min','Road miles','Road estimate','SEPTA status','Track','Recommended','Option ID'];
  const optionRows=plans.flatMap(p=>p.options.map(o=>[o.date,o.direction,o.stationName,o.train || 'Unknown',localTime_(new Date(o.leave)),localTime_(new Date(o.departure)),localTime_(new Date(o.arrival)),localTime_(new Date(o.finish)),Math.ceil(o.drive.seconds/60),o.drive.meters===null?'Unknown':Number((o.drive.meters/1609.344).toFixed(1)),o.drive.label,o.live.label,o.live.track,o.chosen?'CHOSEN'+(o.departed?' · departure passed':''):o.departed?'Departure passed':'Alternative',o.id]));
  const dates=new Set(plans.map(p=>p.day.date));
  if(!full&&refreshDate)dates.add(refreshDate);
  if(!full) {
    const old=sheet_('Train options').getDataRange().getValues().slice(1);
    optionRows.push(...old.filter(r=>r[0]&&!dates.has(String(r[0]))));
  }
  optionRows.sort((a,b)=>String(a[0]).localeCompare(String(b[0]))||String(a[1]).localeCompare(String(b[1]))||String(a[5]).localeCompare(String(b[5])));
  const s=table_('Train options',[columns,...optionRows]);if(s.getLastRow()>1)s.getRange(2,1,s.getLastRow()-1,4).setNumberFormat('@');
  const dayRows=plans.map(p=>[p.day.date,localTime_(new Date(p.day.start)),localTime_(new Date(p.day.end)),p.day.count,p.options.length,p.chosen.filter(o=>o.direction==='outbound').map(o=>o.stationName+' #'+o.train).join(''),p.chosen.filter(o=>o.direction==='return').map(o=>o.stationName+' #'+o.train).join('')]);
  if(!full)dayRows.push(...sheet_('Days').getDataRange().getValues().slice(1).filter(r=>r[0]&&!dates.has(String(r[0]))));
  table_('Days',[['Date','First commitment','Last commitment','Commitments','Options','Selected outbound','Selected return'],...dayRows.sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
}
function runCommute_(kind,force) {
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {state:'busy'};
  const started=Date.now(),p=PropertiesService.getScriptProperties(),warnings=new Set();let stage='configuration',railRequests=0;
  providerUsage_={maps:0,routes:0};
  try {
    const c=settings_();
    walkMemo_={};driveMemo_={};routesUnavailable_=false;providerUsage_={maps:0,routes:0};providerBudget_={maps:c.max_maps_requests_per_day,routes:c.max_routes_requests_per_day};
    status_({last_attempt_at:new Date(started).toISOString(),last_attempt_kind:kind});
    if(!c.automatic_enabled&&kind==='scheduled')return {state:'paused'};
    if(!c.origin||!c.source_calendar_ids.length||!c.options_calendar_id)throw new Error('setup_incomplete');
    const sources=c.source_calendar_ids.concat(c.optional_calendar_ids);
    if(c.options_calendar_id===c.main_calendar_id||sources.includes(c.options_calendar_id)||(c.main_writer_enabled&&(!c.main_calendar_id||sources.includes(c.main_calendar_id))))throw new Error('calendar_roles_conflict');
    const today=localDate_(new Date(started)),lastFull=Number(p.getProperty('LAST_FULL') || 0);
    const signature=hash_(JSON.stringify({settings:c,stations:sheet_('Stations').getDataRange().getValues(),selections:sheet_('Selections').getDataRange().getValues()}));
    const hour=Number(Utilities.formatDate(new Date(started),TZ_,'H'));
    const quiet=hour<c.quiet_start_hour||hour>=c.quiet_end_hour;
    const due=started-lastFull>=c.full_refresh_hours*3600000||localDate_(new Date(lastFull))!==today;
    const full=force||p.getProperty('LAST_CONFIG')!==signature||(due&&!quiet);
    if(kind==='scheduled'&&Number(p.getProperty('RUNTIME_'+today)||0)>=c.max_scheduled_runtime_seconds_per_day) {
      status_({heartbeat_at:new Date().toISOString(),state:'IDLE · daily runtime budget',detail:'Scheduled runtime budget reached; prior output retained. Refresh now is available.'});return {state:'idle'};
    }
    if(!full&&(hour<c.quiet_start_hour||hour>=c.quiet_end_hour)) {status_({heartbeat_at:new Date().toISOString(),state:'IDLE · quiet hours'});return {state:'idle'};}
    const start=epoch_(today,0),end=epoch_(CommuteCore.addDays(today,full?c.planning_days:1),0);
    stage='source_calendars';const days=commitments_(c,start,end,warnings);
    const publishedToday=sheet_('Days').getDataRange().getValues().slice(1).some(r=>String(r[0])===today);
    if(!full&&((!days.length&&!publishedToday)||(days.length&&!days.some(d=>started>=d.start-c.active_window_hours*3600000&&started<=d.end+c.active_window_hours*3600000)))) {
      status_({heartbeat_at:new Date().toISOString(),state:'IDLE · outside commute window',detail:'Source calendars checked; expensive rail and Google routing work skipped.'});return {state:'idle'};
    }
    const stations=stations_();stage='static_schedule';const feed=days.length?feed_(c,stations,started):{version:'No commute days',start:'',end:'',checked:new Date().toISOString()};
    if(days.some(d=>d.date.replace(/-/g,'')<feed.start||d.date.replace(/-/g,'')>feed.end))throw new Error('gtfs_window_outside_coverage');
    stage='live_rail';const live=days.some(d=>d.date===today&&started>=d.start-c.active_window_hours*3600000&&started<=d.end+c.active_window_hours*3600000)?live_(stations,c.target_stop_id,warnings):{trains:[],arrivals:{},observedAt:0,requests:0};
    railRequests=live.requests;
    stage='google_routes_and_choices';const selections=selections_();
    const plans=days.map(d=>planDay_(d,c,stations,feed,live,started,warnings,selections));
    const owner='septa-commute:'+ScriptApp.getScriptId();
    const optionEvents=plans.flatMap(p=>p.options.map(o=>event_(o,c,false,owner)));
    const mainEvents=plans.flatMap(p=>p.chosen.map(o=>event_(o,c,true,owner)));
    const reconcileEnd=full?epoch_(CommuteCore.addDays(today,21),0):end;
    stage='options_calendar';const optionsResult=reconcile_(c.options_calendar_id,optionEvents,start,reconcileEnd,c,owner);
    let mainResult={changes:0,events:0};
    if(c.main_writer_enabled) {
      stage='main_calendar';mainResult=reconcile_(c.main_calendar_id,mainEvents,start,reconcileEnd,c,owner);
    }
    stage='planner_sheet';publishSheets_(plans,full,today);
    if(full){p.setProperty('LAST_FULL',String(started));p.setProperty('LAST_CONFIG',signature);}
    status_({state:warnings.size?'DEGRADED':'HEALTHY',detail:Array.from(warnings).join('; ') || 'Inputs read and outputs synchronized.',
      last_success_at:new Date().toISOString(),last_success_kind:kind,heartbeat_at:new Date().toISOString(),
      last_full_refresh_at:new Date(Number(p.getProperty('LAST_FULL'))).toISOString(),
      feed_version:feed.version,feed_coverage:feed.start+' → '+feed.end,feed_checked_at:feed.checked,
      planned_days:plans.length,options_in_run:optionEvents.length,main_events_in_run:mainResult.events,
      calendar_changes:optionsResult.changes+mainResult.changes,main_writer_enabled:c.main_writer_enabled,
      maps_requests_in_run:providerUsage_.maps,routes_requests_in_run:providerUsage_.routes,septa_live_requests_in_run:live.requests,
      runtime_seconds:Math.round((Date.now()-started)/1000),last_error_stage:'',last_error_code:'',
      trigger_count:ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='commuteTick').length});
    const result={state:warnings.size?'degraded':'healthy',kind,days:plans.length,options:optionEvents.length,main:mainResult.events};console.log(JSON.stringify(result));return result;
  }catch(e) {
    const code=safeCode_(e);status_({state:'FAILED',detail:'Failed at '+stage+': '+code,last_error_stage:stage,last_error_code:code,heartbeat_at:new Date().toISOString(),runtime_seconds:Math.round((Date.now()-started)/1000)});
    console.error(JSON.stringify({state:'failed',kind,stage,code}));throw new Error(stage+':'+code);
  }finally{
    try {
      const today=localDate_(new Date(started)),seconds=Math.max(0,Math.ceil((Date.now()-started)/1000));
      if(kind==='scheduled')p.setProperty('RUNTIME_'+today,String(Number(p.getProperty('RUNTIME_'+today)||0)+seconds));
      status_({runtime_seconds:seconds,scheduled_runtime_seconds_today:Number(p.getProperty('RUNTIME_'+today)||0),maps_requests_today:Number(p.getProperty('USAGE_maps_'+today)||0),routes_requests_today:Number(p.getProperty('USAGE_routes_'+today)||0),maps_requests_in_run:providerUsage_.maps,routes_requests_in_run:providerUsage_.routes,septa_live_requests_in_run:railRequests});
      const cutoff=CommuteCore.addDays(today,-7);
      Object.keys(p.getProperties()).forEach(k=>{const match=/^(?:USAGE_(?:maps|routes)_|RUNTIME_|OUTBOUND_LEAVE_|OUTBOUND_)(\d{4}-\d{2}-\d{2})$/.exec(k);if(match&&match[1]<cutoff)p.deleteProperty(k);});
    }finally{lock.releaseLock();}
  }
}
