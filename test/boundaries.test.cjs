const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {harness,tables,clone}=require('./harness.cjs');
const host=(o={})=>{const h=harness(o);h.configure();return h;};
const core=h=>vm.runInContext('CommuteCore',h.ctx);
const json=v=>JSON.parse(JSON.stringify(v));
test('initial setup exposes working menu actions, private defaults and editable station configuration',()=>{
 const h=harness();h.ctx.onOpen();assert.deepEqual(h.menus.filter(x=>x.handler).map(x=>x.handler),['setupCommute','refreshCommute','resolvePlaces','loadStationDirectory','setRoutesKey','pauseCommute']);assert.equal(h.menus.at(-1).shown,true);
 h.ctx.initializeSheet_();assert.equal(h.ctx.settings_().automatic_enabled,false);assert.equal(h.ctx.settings_().main_writer_enabled,false);assert.equal(h.ctx.settings_().origin,'');assert.equal(h.createdCalendars.length,0);assert.equal(h.sheets.get('Start here').rows.length,12);assert.equal(h.ctx.stations_().length,2);assert.equal(h.sheets.get('Selections').rows[0][2],'Option ID');assert.equal(h.ctx.book_().timezone,'America/New_York');
 h.ctx.table_('Stations',[['Enabled','Stop ID','Name','Fallback'],[true,'A','Custom',2]]);h.ctx.initializeSheet_();assert.equal(h.ctx.stations_()[0].name,'Custom');
});
test('all setting boundaries accept valid endpoints and reject each independently invalid value',()=>{
 const invalid={planning_days:[0,22],options_per_station:[0,7],refresh_minutes:[0,7],full_refresh_hours:[0],quiet_start_hour:[24],quiet_end_hour:[25],arrival_buffer_minutes:[-1,NaN,1.5],reminder_minutes:['1;2;3;4;5;6','0.5','40321'],exclude_title:['[']};
 for(const [k,values]of Object.entries(invalid))for(const v of values){const h=host();h.ctx.setting_(k,v);assert.throws(()=>h.ctx.settings_(),undefined,k+'='+v);}
 const h=host();for(const [k,v]of Object.entries({planning_days:21,options_per_station:6,full_refresh_hours:1,quiet_start_hour:23,quiet_end_hour:24,arrival_buffer_minutes:0,reminder_minutes:'0;40320',automatic_enabled:'TrUe',main_writer_enabled:'true',routes_api_enabled:'false'}))h.ctx.setting_(k,v);
 const c=h.ctx.settings_();assert.equal(c.planning_days,21);assert.equal(c.options_per_station,6);assert.equal(c.automatic_enabled,true);assert.equal(c.main_writer_enabled,true);assert.equal(c.routes_api_enabled,false);assert.deepEqual(json(c.reminder_minutes),[0,40320]);
 h.ctx.setting_('source_calendar_ids',' a ; b ;; ');assert.deepEqual(json(h.ctx.settings_().source_calendar_ids),['a','b']);
});
test('station inputs reject no stations, duplicates, bad fallback, missing IDs and excess enabled stations',()=>{
 const bad=[[],[[false,'A','A',2]],[[true,'','A',2]],[[true,'A','A',0]],[[true,'A','A','bad']],[[true,'A','A',2],[true,'A','B',3]],Array.from({length:9},(_,i)=>[true,String(i),'S',1])];
 for(const rows of bad){const h=host();h.ctx.table_('Stations',[['Enabled','ID','Name','Fallback'],...rows]);assert.throws(()=>h.ctx.stations_(),/stations_invalid/);}
 const h=host();h.ctx.table_('Stations',[['Enabled','ID','Name','Fallback'],['TRUE','A','A',1],['false','B','B',1]]);assert.deepEqual(json(h.ctx.stations_()),[{id:'A',name:'A',fallback:60}]);
});
test('SEPTA download unpacks the rail archive, parses every table and supplies the station directory',()=>{
 const h=host({rawFeed:true});const t=json(h.ctx.downloadRail_());assert.equal(t.times.length,32);assert.equal(t.trips.length,16);assert.equal(t.stops[2].stop_name,'Campus');assert.equal(t.calendar[0].friday,'1');assert.equal(t.info[0].feed_version,'fixture-1');assert.deepEqual(t.exceptions,[]);
 h.ctx.loadStationDirectory();assert.deepEqual(h.sheets.get('Station directory').rows,[['Stop ID','Station','Latitude','Longitude'],['A','Station A',40,-75],['B','Station B',40.2,-75.2],['C','Campus',39.9,-75.1]]);
 h.failures.set('https://www3.septa.org/developer/gtfs_public.zip',503);assert.throws(()=>h.ctx.downloadRail_(),/gtfs_download_http_503/);h.failures.clear();
 const unzip=h.ctx.Utilities.unzip;h.ctx.Utilities.unzip=()=>[];assert.throws(()=>h.ctx.downloadRail_(),/gtfs_rail_archive_missing/);h.ctx.Utilities.unzip=unzip;
 const raw=tables();delete raw.info;h.setFeed(raw);assert.throws(()=>h.ctx.downloadRail_(),/gtfs_table_missing/);
});
test('CSV parsing removes BOM, keeps exact named fields and drops malformed rows',()=>{
 const h=host();let input;h.ctx.Utilities.parseCsv=text=>{input=text;return [['one','two'],['a','b'],['bad'],['c','d']];};
 assert.deepEqual(json(h.ctx.parseCsv_({getDataAsString:encoding=>{assert.equal(encoding,'UTF-8');return '\uFEFFone,two';}})),[{one:'a',two:'b'},{one:'c',two:'d'}]);assert.equal(input,'one,two');
});
test('GTFS cache reuses valid data, refreshes at expiry, repairs missing chunks and rejects expired coverage',()=>{
 const h=host({rawFeed:true}),c=h.ctx.settings_(),s=h.ctx.stations_(),now=Date.parse('2026-10-09T12:00:00Z');
 let f=h.ctx.feed_(c,s,now);assert.equal(f.legs.length,16);assert.equal(f.version,'fixture-1');let n=h.requests.length;assert.equal(h.ctx.feed_(c,s,now+1).version,'fixture-1');assert.equal(h.requests.length,n);
 const meta=JSON.parse(h.properties.get('GTFS_META'));h.properties.delete('FEED_'+meta.generation+'_0');h.ctx.feed_(c,s,now+2);assert.equal(h.requests.length,n+1);
 n=h.requests.length;h.ctx.feed_(c,s,now+86400002);assert.equal(h.requests.length,n+1);assert.equal(h.properties.has('FEED_'+meta.generation+'_0'),false);
 const raw=tables();raw.info[0].feed_end_date='20261009';h.setFeed(raw);h.properties.delete('GTFS_META');h.ctx.feed_(c,s,now);
 h.setNow('2026-10-10T05:00:00Z');assert.throws(()=>h.ctx.feed_(c,s,Date.parse('2026-10-10T05:00:00Z')),/gtfs_coverage_invalid/);
});
test('compilation respects service range, weekday, public identities, sequence and per-stop boarding restrictions',()=>{
 const h=host(),C=core(h),raw=tables();raw.times.reverse();const f=C.compileFeed(raw,['A','B'],'C');
 assert.equal(f.legs.length,16);assert.deepEqual(json(f.legs.find(x=>x.train==='501')),{trip:'DYL501',service:'weekday',train:'501',line:'Fixture Rail',from:'A',to:'C',departure:36000,arrival:39600,headsign:''});
 for(const d of ['2026-09-30','2026-12-01','2026-10-10'])assert.equal(C.legsFor(f,d,'A','C','outbound').length,0);
 assert.equal(C.legsFor(f,'2026-10-01','A','C','outbound').length,4);assert.equal(C.legsFor(f,'2026-11-30','A','C','return').length,4);assert.equal(C.legsFor(f,'2026-10-09','B','C','return')[0].from,'C');
 assert.throws(()=>C.compileFeed(raw,['missing'],'C'),/station_id_not_in_feed/);
 const bad=tables();bad.times[1].arrival_time='09:00:00';assert.throws(()=>C.compileFeed(bad,['A'],'C'),/gtfs_stop_times_invalid/);
 for(const t of ['48:00:00','123:00:00','12:60:00','12:00:60','12:00:00x','x12:00:00'])assert.throws(()=>C.seconds(t));assert.equal(C.seconds('47:59:59'),172799);assert.equal(C.seconds('00:00:00'),0);
});
test('live status validates freshness, exact train, cancellation, on-time syntax, track and numeric delay',()=>{
 const C=core(host()),live=(arr=[],trains=[],at=1000,now=1100)=>json(C.liveFor('501','2026-10-09','2026-10-09',arr,trains,at,now));
 assert.deepEqual(live([{train_id:'501',status:'on TIME',track:'3'}]),{label:'On time · SEPTA arrivals',delay:0,track:'3',cancelled:false});
 assert.equal(live([{train_id:'501',status:'12 minutes',track:'4'}]).delay,12);assert.equal(live([{train_id:'501',status:'12 minutes',track:'4'}]).track,'4');assert.equal(live([{train_id:'501',status:'On time tomorrow'}]).delay,null);
 assert.equal(live([{train_id:'501',status:'Cancelled',track:'5'}]).cancelled,true);assert.equal(live([{train_id:'501',status:'Cancelled',track:'5'}]).track,'5');assert.equal(live([],[{trainno:501,late:'3'}]).delay,3);assert.equal(live([],[{trainno:'999',late:3}]).delay,null);
 assert.equal(live([],[],0).label,'Live status unavailable or stale');assert.equal(live([{train_id:'501',status:'On time'}],[],1000,181000).delay,0);assert.equal(live([{train_id:'501',status:'On time'}],[],1000,181001).delay,null);
 assert.equal(C.isCommitment({status:'cancelled',summary:'Lecture',start:{dateTime:'x'},end:{dateTime:'y'}},'lecture','deadline',[]),false);assert.equal(C.isCommitment({summary:'Meeting',location:'CAMPUS HALL',start:{dateTime:'x'},end:{dateTime:'y'}},'lecture','deadline',['campus']),true);
 assert.equal(C.choose([],''),null);assert.equal(C.choose([{id:'b',score:1,feasible:true},{id:'a',score:1,feasible:true}],'').id,'a');
 assert.deepEqual(json(C.flattenArrivals({a:null,b:'ignored',c:[{train_id:'7',track:'2'},{other:9}]})),[{train_id:'7',track:'2'}]);
});
test('commitment days use earliest and latest actual locations, exclude deadlines and reject invalid time spans',()=>{
 const h=host(),c=h.ctx.settings_();h.resources.set('source',[
 {summary:'Lecture late',location:'Last hall',start:{dateTime:'2026-10-09T15:00:00-04:00'},end:{dateTime:'2026-10-09T16:00:00-04:00'}},
 {summary:'Exam early',location:'First hall',start:{dateTime:'2026-10-09T10:00:00-04:00'},end:{dateTime:'2026-10-09T11:00:00-04:00'}},
 {summary:'Lecture next',start:{dateTime:'2026-10-12T10:00:00-04:00'},end:{dateTime:'2026-10-12T11:00:00-04:00'}}]);
 const d=h.ctx.commitments_(c,0,1e13,new Set());assert.equal(d.length,2);assert.equal(d[0].count,2);assert.equal(d[0].start,Date.parse('2026-10-09T14:00:00Z'));assert.equal(d[0].end,Date.parse('2026-10-09T20:00:00Z'));assert.equal(d[0].firstPlace,'First hall');assert.equal(d[0].lastPlace,'Last hall');assert.equal(d[1].firstPlace,c.destination);
 h.ctx.events_=()=>[{summary:'Lecture',start:{dateTime:'bad'},end:{dateTime:'bad'}}];assert.throws(()=>h.ctx.commitments_(c,0,1e13,new Set()),/commitment_time_invalid/);
 h.ctx.events_=()=>[{summary:'Lecture',start:{dateTime:'2026-10-09T23:00:00-04:00'},end:{dateTime:'2026-10-10T01:00:00-04:00'}}];assert.throws(()=>h.ctx.commitments_(c,0,1e13,new Set()),/commitment_crosses_midnight/);
});
test('Google request contract preserves direction, forecast departure, traffic duration and actual road meters',()=>{
 const h=host(),s=tables().stops[0],w=new Set(),depart=Date.parse('2026-10-09T15:00:00Z');h.properties.set('ROUTES_KEY','fixture-key');
 assert.equal(h.ctx.drive_('Origin',s,depart,false,1800,w).seconds,1200);const q=h.requests.at(-1),body=JSON.parse(q.payload);assert.deepEqual(body.origin,{address:'Origin'});assert.deepEqual(body.destination,{address:'40,-75'});assert.equal(body.departureTime,'2026-10-09T15:00:00.000Z');assert.equal(body.routingPreference,'TRAFFIC_AWARE');assert.equal(q.headers['X-Goog-Api-Key'],'fixture-key');assert.match(q.headers['X-Goog-FieldMask'],/distanceMeters/);
 h.ctx.drive_('Origin',s,0,true,1800,w);const b=JSON.parse(h.requests.at(-1).payload);assert.deepEqual(b.origin,{address:'40,-75'});assert.deepEqual(b.destination,{address:'Origin'});assert.equal(b.departureTime,'2026-10-09T12:01:00.000Z');
 h.setMaps({routes:[{legs:[{duration:{value:1200},duration_in_traffic:{value:1800},distance:{value:10000}}]}]});const r=h.ctx.drive_('Origin',s,depart,true,1800,w,false);assert.equal(r.seconds,1800);assert.equal(r.meters,10000);assert.equal(r.label,'Google traffic forecast');assert.equal(h.requests.at(-1).maps.origin,'40,-75');assert.equal(h.requests.at(-1).maps.destination,'Origin');
});
test('invalid Google routes fail to explicit configured estimates; walk memo avoids duplicate calls',()=>{
 for(const reply of [{},{routes:[]},{routes:[{duration:'0s',distanceMeters:100}]},{routes:[{duration:'bad',distanceMeters:100}]},{routes:[{duration:'120s',distanceMeters:0}]}]){
 const h=host();h.properties.set('ROUTES_KEY','fixture-key');h.responses.set('https://routes.googleapis.com/directions/v2:computeRoutes',{getResponseCode:()=>200,getContentText:()=>JSON.stringify(reply)});h.failures.set('maps',true);const w=new Set(),r=h.ctx.drive_('O',tables().stops[0],0,false,1800,w);assert.equal(r.seconds,1800);assert.equal(r.meters,null);assert.match(r.label,/Configured/);assert.ok(w.has('google_traffic_unavailable'));assert.ok(w.has('google_drive_unavailable'));}
 const h=host(),w=new Set();assert.equal(h.ctx.walk_(tables().stops[2],'Hall',h.ctx.settings_(),w).seconds,600);assert.equal(h.ctx.walk_(tables().stops[2],'Hall',h.ctx.settings_(),w).meters,700);assert.equal(h.requests.length,1);
 h.failures.set('maps',true);const r=h.ctx.walk_(tables().stops[2],'Other',h.ctx.settings_(),w);assert.equal(r.seconds,720);assert.equal(r.meters,null);assert.ok(w.has('google_walk_fallback'));
});
test('planning arithmetic matches independent leave-by, walk, rail and home expectations',()=>{
 const h=host();h.ctx.refreshCommute();const rows=h.sheets.get('Train options').rows.slice(1);const out=rows.find(r=>r[14]==='2026-10-09:outbound:A:507'),ret=rows.find(r=>r[14]==='2026-10-09:return:A:502');
 assert.deepEqual(out.slice(3,10),['507','11:00','11:30','12:30','12:40',20,10]);assert.deepEqual(ret.slice(3,10),['502','16:15','16:30','17:30','17:50',20,10]);
 assert.deepEqual(h.sheets.get('Days').rows[1],['2026-10-09','13:20','15:50',1,12,'Station A #507','Station A #502']);
 const event=h.resources.get('options').find(e=>e.extendedProperties.private.commuteKey===out[14]);assert.match(event.description,/road distance 10.0 mi/);assert.match(event.description,/walk 10 min/);assert.match(event.summary,/#507 · 11:30 → 12:30/);assert.equal(event.start.dateTime,'2026-10-09T15:30:00.000Z');assert.equal(event.end.dateTime,'2026-10-09T16:30:00.000Z');assert.match(event.id,/^[0-9a-f]{40}$/);
});
test('live delay and cancellation remove impossible options without allowing later home departure',()=>{
 const h=host();h.responses.set('https://api.septa.org/api/Arrivals/index.php?req1=A&req2=6',{getResponseCode:()=>200,getContentText:()=>JSON.stringify({a:[{train_id:'507',status:'30 min'},{train_id:'505',status:'Cancelled'}]})});h.ctx.refreshCommute();const ids=h.sheets.get('Train options').rows.map(r=>r[14]);assert.ok(!ids.includes('2026-10-09:outbound:A:507'));assert.ok(!ids.includes('2026-10-09:outbound:A:505'));assert.ok(ids.includes('2026-10-09:outbound:A:503'));
});
test('usage: clearing a manual selection after departure keeps the same parked-car station before class begins',()=>{
 const h=host();h.ctx.table_('Selections',[['Date','Direction','Option ID'],['2026-10-09','outbound','2026-10-09:outbound:B:607']]);h.ctx.refreshCommute();h.ctx.table_('Selections',[['Date','Direction','Option ID']]);h.setNow('2026-10-09T15:10:00Z');h.ctx.refreshCommute();const chosen=h.sheets.get('Train options').rows.filter(r=>String(r[13]).startsWith('CHOSEN'));assert.equal(chosen.length,2);assert.ok(chosen.every(r=>r[2]==='Station B'));
});
test('selection validation rejects malformed dates, unsupported directions and duplicate choices',()=>{
 for(const rows of [[['bad','outbound','x']],[['2026-10-09','sideways','x']],[['2026-10-09','outbound','x'],['2026-10-09','outbound','y']]]){const h=host();h.ctx.table_('Selections',[['Date','Direction','Option ID'],...rows]);assert.throws(()=>h.ctx.selections_(),/selection_/);}
 const h=host();h.ctx.table_('Selections',[['Date','Direction','Option ID'],['2026-10-09','return',' x '],['2026-10-09','outbound','']]);assert.deepEqual(json(h.ctx.selections_()),{'2026-10-09:return':'x'});
});
test('safe failure codes never disclose arbitrary provider payloads or personal input',()=>{
 const h=host();assert.equal(h.ctx.safeCode_(new Error('API secret abc; origin private')),'unexpected_error');assert.equal(h.ctx.safeCode_(new Error('calendar_get_http_403')),'calendar_get_http_403');assert.equal(h.ctx.safeCode_(new Error('setting_invalid:planning_days')),'setting_invalid:planning_days');
 const url='https://example.invalid';h.responses.set(url,{getResponseCode:()=>200,getContentText:()=> 'not JSON'});assert.throws(()=>h.ctx.fetchJson_(url,{},'provider'),/provider_json_invalid/);
 for(const code of [199,300,500]){h.responses.set(url,{getResponseCode:()=>code,getContentText:()=> '{}'});assert.throws(()=>h.ctx.fetchJson_(url,{},'provider'),new RegExp('provider_http_'+code));}
});
test('reconciliation preserves past and foreign events and never inserts already departed journeys',()=>{
 const h=host();h.ctx.setting_('main_writer_enabled',true);h.ctx.refreshCommute();const old=clone(h.resources.get('main'));h.setNow('2026-10-09T18:00:00Z');h.resources.set('source',[]);h.ctx.refreshCommute();assert.equal(h.resources.get('main').length,1);assert.equal(h.resources.get('main')[0].id,old[0].id);
 const fresh=host({now:'2026-10-09T18:00:00Z'});fresh.ctx.setting_('main_writer_enabled',true);fresh.ctx.refreshCommute();assert.equal(fresh.resources.get('main').length,1);assert.match(fresh.resources.get('main')[0].extendedProperties.private.commuteKey,/:return$/);
});
test('init and recovery: missing origin, calendar, feed window and blank key fail with bounded effects',()=>{
 for(const [k,v]of [['origin',''],['source_calendar_ids',''],['options_calendar_id','']]){const h=host();h.ctx.setting_(k,v);assert.throws(()=>h.ctx.refreshCommute(),/setup_incomplete/);assert.equal(h.writes.length,0);assert.equal(h.locked(),false);}
 const h=host();const t=tables();t.info[0].feed_end_date='20261009';h.setFeed(t);h.ctx.events_=()=>[{summary:'Lecture',start:{dateTime:'2026-10-12T13:00:00-04:00'},end:{dateTime:'2026-10-12T14:00:00-04:00'}}];assert.throws(()=>h.ctx.refreshCommute(),/gtfs_window_outside_coverage/);assert.equal(h.writes.length,0);
 h.setPrompt({getSelectedButton:()=> 'OK',getResponseText:()=> ' '});assert.throws(()=>h.ctx.setRoutesKey(),/routes_key_empty/);
});
test('ordinary road estimates are reused within an execution; traffic forecasts retain their departure-specific requests',()=>{
 const h=host();h.ctx.refreshCommute();assert.equal(h.requests.filter(r=>r.maps?.mode==='DRIVING').length,4);h.ctx.refreshCommute();assert.equal(h.requests.filter(r=>r.maps?.mode==='DRIVING').length,8);
 const traffic=host();traffic.setMaps({routes:[{legs:[{duration:{value:1200},duration_in_traffic:{value:1800},distance:{value:10000}}]}]});traffic.ctx.refreshCommute();assert.equal(traffic.requests.filter(r=>r.maps?.mode==='DRIVING').length,12);
});
test('usage: shortening the planning horizon removes old future owned alternatives and preserves other calendar rows',()=>{
 const h=host();h.ctx.setting_('planning_days',7);const next=clone(h.resources.get('source')[0]);next.id='next';next.start.dateTime='2026-10-12T13:20:00-04:00';next.end.dateTime='2026-10-12T15:50:00-04:00';h.resources.get('source').push(next);h.ctx.refreshCommute();assert.equal(h.resources.get('options').length,24);
 h.resources.get('options').push({id:'foreign',start:{dateTime:'2026-10-12T14:00:00Z'},end:{dateTime:'2026-10-12T15:00:00Z'}});h.ctx.setting_('planning_days',1);h.ctx.refreshCommute();assert.equal(h.resources.get('options').length,13);assert.ok(h.resources.get('options').some(e=>e.id==='foreign'));assert.equal(h.sheets.get('Days').rows.length,2);
});
test('malformed calendar lists cannot erase previous output and excessive pagination fails closed',()=>{
 const h=host();h.ctx.refreshCommute();const old=clone(h.resources.get('options'));h.setPages([{items:{not:'a list'}}]);assert.throws(()=>h.ctx.refreshCommute(),/calendar_items_invalid/);assert.deepEqual(h.resources.get('options'),old);
 h.setPages(Array.from({length:26},(_,i)=>({nextPageToken:String(i+1)})));assert.throws(()=>h.ctx.events_('source',0,1e13),/calendar_pagination_limit/);
});
test('traffic request budget stops Routes calls at the configured cap while ordinary Google routing remains usable',()=>{
 const h=host();h.properties.set('ROUTES_KEY','fixture-key');h.ctx.setting_('max_routes_requests_per_day',1);assert.equal(h.ctx.refreshCommute().state,'degraded');assert.equal(h.requests.filter(r=>r.url?.includes('routes.googleapis.com')).length,1);assert.match(h.status().detail,/routes_daily_budget_reached/);assert.equal(h.properties.get('USAGE_routes_2026-10-09'),'1');
});
