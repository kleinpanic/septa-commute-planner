const {test}=require('node:test'),assert=require('node:assert/strict');
const {harness,clone}=require('./harness.cjs');
test('calendar throttling retries only failed operations, with bounded exponential backoff',()=>{
 for(const code of [403,429,500,502,503,504]){
  const h=harness(),calls=[];let round=0;
  h.ctx.UrlFetchApp.fetchAll=ops=>{calls.push(ops.map(o=>o.url));return ops.map(()=>({getResponseCode:()=>round++===0?code:204,getContentText:()=>JSON.stringify({error:{errors:[{reason:'rateLimitExceeded'}]}})}));};
  h.ctx.calendarBatch_([{url:'one',method:'delete'},{url:'two',method:'delete'}],'fixture-token');
  assert.deepEqual(clone(calls),[['one','two'],['one']]);assert.deepEqual(h.sleeps,[1000]);
 }
 const h=harness();let calls=0;h.ctx.UrlFetchApp.fetchAll=ops=>{calls++;return ops.map(()=>({getResponseCode:()=>429,getContentText:()=> '{}'}));};
 assert.throws(()=>h.ctx.calendarBatch_([{url:'one',method:'delete'}],'fixture-token'),/calendar_delete_http_429/);
 assert.equal(calls,4);assert.deepEqual(h.sleeps,[1000,2000,4000]);
});
test('calendar permission failures do not retry; missing deletes are idempotent; other missing writes fail',()=>{
 for(const [code,method,reason,ok] of [[403,'delete','forbidden',false],[403,'delete','userRateLimitExceeded',true],[404,'delete','',true],[410,'delete','',true],[404,'patch','',false],[199,'post','',false],[300,'post','',false]]){
  const h=harness();let calls=0;h.ctx.UrlFetchApp.fetchAll=ops=>{calls++;return ops.map(()=>({getResponseCode:()=>reason==='userRateLimitExceeded'&&calls===2?204:code,getContentText:()=>JSON.stringify({error:{errors:[{reason}]}})}));};
  const run=()=>h.ctx.calendarBatch_([{url:'one',method}],'fixture-token');if(ok)run();else assert.throws(run,new RegExp('calendar_'+method+'_http_'+code));
  assert.equal(calls,reason==='userRateLimitExceeded'?2:1);
 }
});
function host(){const h=harness();h.configure();return h;}
test('fresh initialization creates usable configuration and preserves selections on reinitialization',()=>{
 const h=harness();h.ctx.initializeSheet_();assert.equal(h.sheets.get('Settings').rows[0][0],'Setting');assert.equal(h.properties.get('SHEET_ID'),'fixture-sheet');
 h.ctx.setting_('origin','Saved private origin');h.sheets.get('Selections').appendRow(['2026-10-09','outbound','saved','']);h.ctx.initializeSheet_();
 assert.equal(h.ctx.settings_().origin,'Saved private origin');assert.equal(h.sheets.get('Selections').rows[2][2],'saved');assert.equal(h.createdCalendars.length,0);
});
test('schema repair adds new settings without resetting existing settings',()=>{
 const h=host();h.sheets.get('Settings').rows=h.sheets.get('Settings').rows.filter(r=>r[0]!=='max_maps_requests_per_day');h.ctx.initializeSheet_();
 assert.equal(h.ctx.settings_().origin,'Fixture origin');assert.equal(h.sheets.get('Settings').rows.filter(r=>r[0]==='max_maps_requests_per_day').length,1);
});
test('incomplete setup reports missing configuration and does not install a trigger',()=>{
 const h=harness();h.ctx.setupCommute();assert.equal(h.status().state,'SETUP REQUIRED');assert.equal(h.triggers.length,0);assert.equal(h.createdCalendars.length,2);
 h.ctx.setupCommute();assert.equal(h.createdCalendars.length,2);
});
test('setup and repair install exactly one owned trigger while preserving unrelated triggers',()=>{
 const h=host();h.triggers.push({getHandlerFunction:()=> 'unrelated'});h.ctx.setupCommute();h.ctx.setupCommute();
 assert.equal(h.triggers.filter(t=>t.getHandlerFunction()==='commuteTick').length,1);assert.equal(h.triggers[0].getHandlerFunction(),'unrelated');assert.equal(h.ctx.settings_().automatic_enabled,true);
 h.ctx.pauseCommute();assert.equal(h.triggers.length,1);assert.equal(h.status().state,'PAUSED');assert.equal(h.ctx.commuteTick().state,'paused');
});
test('invalid bounds, patterns and reminders fail before calendar writes',()=>{
 for(const [key,value] of [['planning_days',22],['refresh_minutes',7],['options_per_station',0],['include_title','['],['reminder_minutes','-1'],['max_maps_requests_per_day',1.2]]){
  const h=host();h.ctx.setting_(key,value);assert.throws(()=>h.ctx.refreshCommute());assert.equal(h.writes.length,0);assert.equal(h.locked(),false);
 }
});
test('output calendars cannot overwrite attendance calendars or each other',()=>{
 for(const overrides of [{options_calendar_id:'source'},{options_calendar_id:'main'},{main_calendar_id:'source',main_writer_enabled:true}]){
  const h=host();Object.entries(overrides).forEach(([k,v])=>h.ctx.setting_(k,v));assert.throws(()=>h.ctx.refreshCommute(),/calendar_roles_conflict/);assert.equal(h.writes.length,0);
 }
});
test('full workflow offers multiple trains, writes alternatives separately, and uses real road distances',()=>{
 const h=host();h.properties.set('ROUTES_KEY','fixture-key');const source=clone(h.resources.get('source'));const r=h.ctx.refreshCommute();
 assert.equal(r.state,'healthy');assert.equal(r.options,12);assert.equal(r.main,0);assert.equal(h.resources.get('main').length,0);assert.deepEqual(h.resources.get('source'),source);
 const rows=h.sheets.get('Train options').rows.slice(1);assert.equal(rows.length,12);assert.equal(rows.filter(r=>r[13]==='CHOSEN').length,2);assert.equal(rows[0][9],10);
 assert.ok(rows.every(r=>/unknown|stale/i.test(r[11])));assert.ok(h.resources.get('options').every(e=>e.reminders.overrides.length===0));
});
test('main journey contains only paired chosen trains with explicit popup reminders',()=>{
 const h=host();h.ctx.setting_('main_writer_enabled',true);h.ctx.refreshCommute();const events=h.resources.get('main');assert.equal(events.length,2);
 assert.ok(events.every(e=>e.reminders.useDefault===false&&e.reminders.overrides.map(x=>x.minutes).join(',')==='30,10'));
 assert.ok(events.every(e=>Date.parse(e.end.dateTime)>Date.parse(e.start.dateTime)));assert.ok(events.every(e=>e.description.includes('Station A')===false));
 const chosen=h.sheets.get('Train options').rows.slice(1).filter(r=>r[13]==='CHOSEN');assert.equal(chosen[0][2],chosen[1][2]);
});
test('repeated synchronization is idempotent and preserves unowned events',()=>{
 const h=host();h.resources.get('options').push({id:'user-event',summary:'Keep me',start:{dateTime:'2026-10-09T14:00:00Z'},end:{dateTime:'2026-10-09T15:00:00Z'}});
 h.ctx.refreshCommute();const n=h.writes.length;h.ctx.refreshCommute();assert.equal(h.writes.length,n);assert.ok(h.resources.get('options').some(e=>e.id==='user-event'));
});
test('usage: manual choice switches outward train and keeps return at parked-car station',()=>{
 const h=host();h.ctx.setting_('main_writer_enabled',true);h.ctx.refreshCommute();const alt=h.sheets.get('Train options').rows.find(r=>r[1]==='outbound'&&r[2]==='Station B');
 h.ctx.table_('Selections',[['Date','Direction','Option ID','Help'],['2026-10-09','outbound',alt[14],'']]);h.ctx.refreshCommute();
 const chosen=h.sheets.get('Train options').rows.filter(r=>r[13]==='CHOSEN');assert.equal(chosen.length,2);assert.ok(chosen.every(r=>r[2]==='Station B'));assert.equal(h.resources.get('main').length,2);
});
test('usage: unavailable manual selection fails without erasing published journeys',()=>{
 const h=host();h.ctx.refreshCommute();const old=clone(h.resources.get('options'));const success=h.status().last_success_at;
 h.ctx.table_('Selections',[['Date','Direction','Option ID'],['2026-10-09','outbound','not-a-train']]);assert.throws(()=>h.ctx.refreshCommute(),/selected_train_unavailable/);
 assert.deepEqual(h.resources.get('options'),old);assert.equal(h.status().last_success_at,success);assert.equal(h.status().state,'FAILED');
});
test('required calendar outage fails closed; optional outage produces explicit degraded output',()=>{
 const h=host();h.ctx.refreshCommute();const old=clone(h.resources.get('options'));h.failures.set('source',403);assert.throws(()=>h.ctx.refreshCommute(),/calendar_get_http_403/);assert.deepEqual(h.resources.get('options'),old);
 h.failures.delete('source');h.ctx.setting_('optional_calendar_ids','missing');assert.equal(h.ctx.refreshCommute().state,'degraded');assert.match(h.status().detail,/optional_calendar_unavailable/);
});
test('calendar pagination continues through empty pages and rejects repeated tokens',()=>{
 const h=host();h.setPages([{items:[{id:'a'}],nextPageToken:'1'},{items:[],nextPageToken:'2'},{items:[{id:'b'}]}]);assert.equal(h.ctx.events_('source',0,1e13).length,2);
 h.setPages([{nextPageToken:'1'},{nextPageToken:'1'}]);assert.throws(()=>h.ctx.events_('source',0,1e13),/pagination_repeated/);
});
test('deletion cap rejects all mutations before applying excessive deletions',()=>{
 const h=host();h.ctx.refreshCommute();h.resources.set('source',[]);h.ctx.setting_('max_deletions_per_run',1);const old=clone(h.resources.get('options'));const n=h.writes.length;
 assert.throws(()=>h.ctx.refreshCommute(),/calendar_deletion_cap/);assert.deepEqual(h.resources.get('options'),old);assert.equal(h.writes.length,n);
});
test('usage: removed commitment clears today calendar and sheet while preserving other dates',()=>{
 const h=host();h.ctx.setupCommute();h.sheets.get('Train options').appendRow(['2026-10-12','return','Other day']);h.sheets.get('Days').appendRow(['2026-10-12','09:00']);h.resources.set('source',[]);
 h.ctx.commuteTick();assert.equal(h.resources.get('options').length,0);assert.equal(h.sheets.get('Train options').rows.length,2);assert.equal(h.sheets.get('Train options').rows[1][0],'2026-10-12');assert.equal(h.sheets.get('Days').rows.length,2);
});
test('concurrent execution performs no work and quiet-hour execution records an idle heartbeat',()=>{
 const h=host();h.setBusy(true);assert.equal(h.ctx.refreshCommute().state,'busy');assert.equal(h.requests.length,0);h.setBusy(false);h.ctx.setting_('quiet_end_hour',20);h.ctx.setupCommute();h.setNow('2026-10-10T01:00:00Z');h.properties.set('LAST_FULL',String(Date.parse('2026-10-10T00:00:00Z')));
 const n=h.requests.length;assert.equal(h.ctx.commuteTick().state,'idle');assert.equal(h.requests.length,n);assert.ok(h.status().heartbeat_at);
});
test('provider budget enforces a daily cap and fallback reports missing Google estimates',()=>{
 const h=host();h.ctx.setting_('max_maps_requests_per_day',1);assert.equal(h.ctx.refreshCommute().state,'degraded');assert.match(h.status().detail,/maps_daily_budget_reached/);assert.equal(h.requests.filter(r=>r.maps).length,1);
 assert.ok(h.sheets.get('Train options').rows.slice(1).some(r=>r[9]==='Unknown'));
});
test('traffic API failure retains a Google Maps route and road distance with explicit provenance',()=>{
 const h=host();h.ctx.setting_('routes_api_enabled',true);h.ctx.setting_('max_routes_requests_per_day',10);h.properties.set('ROUTES_KEY','fixture-key');h.failures.set('https://routes.googleapis.com/directions/v2:computeRoutes',403);assert.equal(h.ctx.refreshCommute().state,'degraded');
 assert.match(h.status().detail,/google_routes_http_403/);assert.ok(h.sheets.get('Train options').rows.slice(1).every(r=>r[9]===10));assert.ok(h.sheets.get('Train options').rows.slice(1).every(r=>r[10].includes('traffic not supplied')));
});
test('configuration changes automatically refresh future days at the next scheduled execution',()=>{
 const h=host();h.ctx.setupCommute();const old=h.properties.get('LAST_CONFIG');h.ctx.setting_('arrival_buffer_minutes',20);h.ctx.commuteTick();assert.notEqual(h.properties.get('LAST_CONFIG'),old);assert.equal(h.status().last_success_kind,'scheduled');
});
test('transient calendar writes fail visibly then recover on next run without duplicates',()=>{
 const h=host();h.failures.set('options',503);assert.throws(()=>h.ctx.refreshCommute());assert.equal(h.status().last_error_stage,'options_calendar');assert.equal(h.locked(),false);
 h.failures.delete('options');h.ctx.refreshCommute();h.ctx.refreshCommute();assert.equal(h.resources.get('options').length,12);assert.equal(h.status().state,'HEALTHY');assert.equal(h.status().last_error_code,'');
});
test('service date and daylight saving conversion preserve New York train times',()=>{
 const h=host();assert.equal(h.ctx.epoch_('2026-10-09',13*3600),Date.parse('2026-10-09T17:00:00Z'));assert.equal(h.ctx.epoch_('2026-11-02',13*3600),Date.parse('2026-11-02T18:00:00Z'));
 assert.equal(h.ctx.epoch_('2026-10-09',25*3600),Date.parse('2026-10-10T05:00:00Z'));
});
test('place resolution uses Google and stores explicit resolved locations privately in the Sheet',()=>{
 const h=host();h.ctx.resolvePlaces();assert.equal(h.sheets.get('Places').rows.length,3);assert.ok(h.status().places_resolved_at);h.failures.set('geocode',true);assert.throws(()=>h.ctx.resolvePlaces(),/place_not_resolved/);
});
test('key prompt cancellation leaves key intact; acceptance stores only a Script Property',()=>{
 const h=host();h.ctx.setRoutesKey();assert.equal(h.properties.has('ROUTES_KEY'),false);
 h.setPrompt({getSelectedButton:()=> 'OK',getResponseText:()=> ' fixture-key '});h.ctx.setRoutesKey();assert.equal(h.properties.get('ROUTES_KEY'),'fixture-key');assert.ok(!JSON.stringify([...h.sheets.values()].map(s=>s.rows)).includes('fixture-key'));
});
