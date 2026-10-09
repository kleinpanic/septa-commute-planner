const {test}=require('node:test'),assert=require('node:assert/strict');
const {harness,clone}=require('./harness.cjs');
const host=()=>{const h=harness();h.configure();return h;};
test('free defaults install one hourly trigger; minute and multi-hour choices remain configurable',()=>{
 const h=host(),c=h.ctx.settings_();assert.equal(c.refresh_minutes,60);assert.equal(c.full_refresh_hours,24);assert.equal(c.routes_api_enabled,false);assert.equal(c.max_routes_requests_per_day,0);assert.equal(c.max_maps_requests_per_day,100);assert.equal(c.max_scheduled_runtime_seconds_per_day,1200);
 for(const minutes of [5,10,15,30,60,120,240,360,480,720]){h.ctx.setting_('refresh_minutes',minutes);h.ctx.setupCommute();assert.equal(h.triggers.length,1);assert.equal(minutes<60?h.triggers[0].minutes:h.triggers[0].hours,minutes<60?minutes:minutes/60);assert.equal(h.status().installed_refresh_minutes,minutes);}
 for(const [k,v] of [['refresh_minutes',90],['active_window_hours',0],['active_window_hours',13],['max_scheduled_runtime_seconds_per_day',59],['quiet_start_hour',22]]){const b=host();b.ctx.setting_(k,v);assert.throws(()=>b.ctx.settings_());}
});
test('free routing makes one ordinary request per road direction and shares walking estimates across all days',()=>{
 const h=host();h.properties.set('ROUTES_KEY','fixture-key');h.setMaps({routes:[{legs:[{duration:{value:1200},duration_in_traffic:{value:1800},distance:{value:10000}}]}]});
 h.ctx.setting_('planning_days',7);const next=clone(h.resources.get('source')[0]);next.start.dateTime='2026-10-12T13:20:00-04:00';next.end.dateTime='2026-10-12T15:50:00-04:00';h.resources.get('source').push(next);h.ctx.refreshCommute();
 const calls=h.requests.filter(r=>r.maps);assert.equal(calls.length,5);assert.ok(calls.every(r=>!r.maps.depart));assert.equal(h.requests.filter(r=>r.url?.includes('routes.googleapis.com')).length,0);assert.equal(h.status().maps_requests_in_run,5);assert.equal(h.status().routes_requests_in_run,0);assert.equal(h.status().septa_live_requests_in_run,0);assert.ok(h.sheets.get('Train options').rows.slice(1).every(r=>r[8]===20&&r[10].includes('traffic not supplied')));
 h.ctx.refreshCommute();assert.equal(h.requests.filter(r=>r.maps).length,10);
});
test('outside the commute window only source calendars are checked; an active-day tick updates live trains',()=>{
 const h=host();h.ctx.setupCommute();const n=h.requests.length,old=clone(h.resources.get('options'));assert.equal(h.ctx.commuteTick().state,'idle');assert.deepEqual(h.resources.get('options'),old);assert.equal(h.requests.length,n+1);assert.ok(h.requests.at(-1).url.includes('/calendars/source/'));
 h.setNow('2026-10-09T14:00:00Z');assert.equal(h.ctx.commuteTick().state,'healthy');assert.equal(h.status().septa_live_requests_in_run,4);assert.equal(h.status().maps_requests_in_run,5);
 h.setNow('2026-10-10T00:30:00Z');const count=h.requests.length;assert.equal(h.ctx.commuteTick().state,'idle');assert.equal(h.requests.length,count+1);
});
test('days without commitments skip rail and routing; removed commitments still clear owned output',()=>{
 const h=host();h.ctx.setupCommute();h.resources.set('source',[]);assert.equal(h.ctx.commuteTick().state,'healthy');assert.equal(h.resources.get('options').length,0);assert.equal(h.status().maps_requests_in_run,0);assert.equal(h.status().septa_live_requests_in_run,0);
 const n=h.requests.length;assert.equal(h.ctx.commuteTick().state,'idle');assert.equal(h.requests.length,n+1);
});
test('expired daily refresh waits through quiet hours and rebuilds on the first waking tick',()=>{
 const h=host();h.ctx.setupCommute();const original=h.properties.get('LAST_FULL');h.setNow('2026-10-10T05:00:00Z');const n=h.requests.length;assert.equal(h.ctx.commuteTick().state,'idle');assert.equal(h.requests.length,n);assert.equal(h.properties.get('LAST_FULL'),original);
 h.setNow('2026-10-10T11:00:00Z');assert.equal(h.ctx.commuteTick().state,'healthy');assert.notEqual(h.properties.get('LAST_FULL'),original);assert.equal(h.status().maps_requests_in_run,0);assert.equal(h.status().septa_live_requests_in_run,0);
});
test('scheduled runtime cap preserves output and performs no provider work; manual refresh remains available',()=>{
 const h=host();h.ctx.setupCommute();const old=clone(h.resources.get('options'));h.properties.set('RUNTIME_2026-10-09','1200');const n=h.requests.length;assert.equal(h.ctx.commuteTick().state,'idle');assert.equal(h.requests.length,n);assert.deepEqual(h.resources.get('options'),old);assert.match(h.status().state,/runtime budget/);assert.equal(h.status().scheduled_runtime_seconds_today,1200);assert.equal(h.ctx.refreshCommute().state,'healthy');
});
test('runtime and request counters measure actual scheduled work and prune only old application metrics',()=>{
 const h=host();h.ctx.setupCommute();h.setNow('2026-10-09T14:00:00Z');const fetch=h.ctx.UrlFetchApp.fetch;let timestamp=Date.parse('2026-10-09T14:00:00Z');h.ctx.UrlFetchApp.fetch=(...args)=>{timestamp+=1000;h.setNow(new Date(timestamp).toISOString());return fetch(...args);};h.properties.set('USAGE_maps_2026-09-01','20');h.properties.set('RUNTIME_2026-09-01','5');h.properties.set('OUTBOUND_2026-09-01','old');h.properties.set('unrelated','keep');
 assert.equal(h.ctx.commuteTick().state,'healthy');assert.ok(h.status().scheduled_runtime_seconds_today>0);assert.equal(h.status().runtime_seconds,h.status().scheduled_runtime_seconds_today);assert.equal(h.status().maps_requests_today,10);assert.equal(h.properties.has('USAGE_maps_2026-09-01'),false);assert.equal(h.properties.has('RUNTIME_2026-09-01'),false);assert.equal(h.properties.has('OUTBOUND_2026-09-01'),false);assert.equal(h.properties.get('unrelated'),'keep');assert.equal(h.locked(),false);
});
