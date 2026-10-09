const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {source,sourcePath}=require('./source.cjs');
const core=vm.runInNewContext(source('Core.gs')+'\nCommuteCore',{process:{env:process.env}}, {filename:sourcePath('Core.gs')});
function fixture(){return {
  trips:[{trip_id:'DYL521_20261009',trip_short_name:'DYL521',service_id:'wk',route_id:'DYL'},
    {trip_id:'DYL524_20261009',trip_short_name:'DYL524',service_id:'wk',route_id:'DYL'}],
  routes:[{route_id:'DYL',route_long_name:'Lansdale/Doylestown'}],
  stops:[{stop_id:'home',stop_name:'Home station'},{stop_id:'campus',stop_name:'Campus station'}],
  times:[{trip_id:'DYL521_20261009',stop_id:'home',stop_sequence:'1',departure_time:'11:10:00',arrival_time:'11:10:00'},
    {trip_id:'DYL521_20261009',stop_id:'campus',stop_sequence:'5',departure_time:'12:15:00',arrival_time:'12:15:00'},
    {trip_id:'DYL524_20261009',stop_id:'campus',stop_sequence:'1',departure_time:'16:20:00',arrival_time:'16:20:00'},
    {trip_id:'DYL524_20261009',stop_id:'home',stop_sequence:'5',departure_time:'17:25:00',arrival_time:'17:25:00'}],
  calendar:[{service_id:'wk',start_date:'20261001',end_date:'20261031',monday:'1',tuesday:'1',wednesday:'1',thursday:'1',friday:'1',saturday:'0',sunday:'0'}],
  exceptions:[{date:'20261012',service_id:'wk',exception_type:'2'},{date:'20261011',service_id:'wk',exception_type:'1'}],
  info:[{feed_start_date:'20261001',feed_end_date:'20261031',feed_version:'fixture'}]
};}
test('service removals/additions override weekday calendar',()=>{
 const f=core.compileFeed(fixture(),['home'],'campus');
 assert.equal(core.legsFor(f,'2026-10-09','home','campus','outbound').length,1);
 assert.equal(core.legsFor(f,'2026-10-12','home','campus','outbound').length,0);
 assert.equal(core.legsFor(f,'2026-10-11','home','campus','outbound').length,1);
 assert.equal(core.legsFor(f,'2026-10-10','home','campus','outbound').length,0);
});
test('train identity strips SEPTA route prefix and never uses trip ID',()=>{
 const f=core.compileFeed(fixture(),['home'],'campus');assert.equal(f.legs[0].train,'521');
 const raw=fixture();raw.trips[0].trip_short_name='';assert.equal(core.compileFeed(raw,['home'],'campus').legs[0].train,null);
});
test('stop order separates outbound and return, respects pickup/dropoff',()=>{
 const raw=fixture();const f=core.compileFeed(raw,['home'],'campus');
 assert.equal(core.legsFor(f,'2026-10-09','home','campus','return')[0].train,'524');
 raw.times[0].pickup_type='1';assert.equal(core.compileFeed(raw,['home'],'campus').legs.length,1);
 raw.times[3].drop_off_type='1';assert.equal(core.compileFeed(raw,['home'],'campus').legs.length,0);
});
test('24+ service times and service dates are supported',()=>{
 assert.equal(core.seconds('25:10:00'),90600);assert.equal(core.addDays('2026-12-31',1),'2027-01-01');
 assert.throws(()=>core.seconds('12:99:00'),/gtfs_time_invalid/);
});
test('missing and stale realtime never imply on time',()=>{
 assert.equal(core.liveFor('521','2026-10-09','2026-10-09',[],[],1000,1100).delay,null);
 assert.equal(core.liveFor('521','2026-10-09','2026-10-09',[{train_id:'521',status:'On time'}],[],1000,200000).delay,null);
 assert.equal(core.liveFor('521','2026-10-10','2026-10-09',[{train_id:'521',status:'On time'}],[],1000,1100).delay,null);
});
test('SEPTA delay, track and cancellations require matching train',()=>{
 assert.equal(core.liveFor('521','2026-10-09','2026-10-09',[{train_id:'521',status:'7 min',track:'2'}],[],1000,1100).delay,7);
 assert.equal(core.liveFor('521','2026-10-09','2026-10-09',[{train_id:'521',status:'Cancelled'}],[],1000,1100).cancelled,true);
 assert.equal(core.liveFor('521','2026-10-09','2026-10-09',[],[{trainno:'521',late:0}],1000,1100).delay,0);
 assert.equal(core.liveFor('521','2026-10-09','2026-10-09',[],[{trainno:'999',late:0}],1000,1100).delay,null);
});
test('empty, null and invalid lateness remain unknown',()=>{
 for(const late of [null,undefined,'',' ', 'unknown',-1])assert.equal(core.liveFor('521','2026-10-09','2026-10-09',[],[{trainno:'521',late}],1000,1100).delay,null);
});
test('return choice keeps parked-car station and rejects impossible override',()=>{
 const rows=[{id:'a',station:'A',score:1,feasible:true},{id:'b',station:'B',score:0,feasible:true}];
 assert.equal(core.choose(rows,'','A').id,'a');assert.throws(()=>core.choose(rows,'b','A'),/selected_train_unavailable/);
});
test('cancelled or infeasible trains cannot be chosen',()=>{
 const rows=[{id:'a',score:0,feasible:true,cancelled:true},{id:'b',score:1,feasible:false},{id:'c',score:2,feasible:true}];
 assert.equal(core.choose(rows,'').id,'c');assert.throws(()=>core.choose(rows,'a'),/selected_train_unavailable/);
});
test('location-matched deadlines and office hours do not become commute days',()=>{
 const e={summary:'Medical Genetics · Lecture 18',location:'Campus',start:{dateTime:'2026-10-09T13:00:00-04:00'},end:{dateTime:'2026-10-09T14:00:00-04:00'}};
 assert.equal(core.isCommitment(e,'lecture|exam','deadline|office hours',['Campus']),true);
 assert.equal(core.isCommitment({...e,summary:'[DEADLINE] Submit'},'lecture|exam','deadline|office hours',['Campus']),false);
 assert.equal(core.isCommitment({...e,summary:'Office Hours'},'lecture|exam','deadline|office hours',['Campus']),false);
 assert.equal(core.isCommitment({...e,start:{date:'2026-10-09'}},'lecture|exam','deadline',[]),false);
});
test('nested arrival response yields all directions and trains',()=>{
 const r={'Station departures':[{Northbound:[{train_id:'1'}]},{Southbound:[{train_id:'2'}]}]};
 assert.equal(core.flattenArrivals(r).length,2);
});
