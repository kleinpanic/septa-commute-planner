/* Read-only provider verification. Output deliberately omits origins, IDs and keys. */
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [sheetId,scriptId,account]=process.argv.slice(2);
if(require.main===module&&(!sheetId||!scriptId||!account)){console.error('Usage: node tools/verify-live.cjs SHEET_ID SCRIPT_ID GOOGLE_ACCOUNT');process.exit(2);}
function gog(args){return JSON.parse(execFileSync('gog',['--readonly','--no-input','-a',account,...args,'--json'],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024}));}
function values(range){return gog(['sheets','get',sheetId,range]).values || [];}
function api(service,version,method,params){return gog(['api','call',service,version,method,'--params',JSON.stringify(params)]);}
function csv(s){
 const rows=[];let row=[],value='',quoted=false;
 for(let i=0;i<s.length;i++){const ch=s[i];if(ch==='"'){if(quoted&&s[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(value);value='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(value);if(row.some(Boolean))rows.push(row);row=[];value='';}else value+=ch;}
 if(value||row.length){row.push(value);rows.push(row);}const headers=rows.shift().map(h=>h.replace(/^\uFEFF/,''));return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
}
function newYorkTime(date,time='00:00:00'){
 const target=Date.parse(date+'T'+time+'Z');let epoch=target;
 for(let i=0;i<3;i++){const wall=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(epoch));epoch+=target-Date.parse(wall.replace(' ','T')+'Z');}
 return new Date(epoch).toISOString();
}
const midnight=date=>newYorkTime(date);
function serviceActive(tables,id,date){
 const d=date.replaceAll('-',''),week=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(date+'T12:00:00Z').getUTCDay()];
 const exception=tables.exceptions.find(e=>e.service_id===id&&e.date===d);
 if(exception)return exception.exception_type==='1';
 return tables.calendar.some(c=>c.service_id===id&&c.start_date<=d&&c.end_date>=d&&c[week]==='1');
}
function events(id,start,end){let rows=[],token='',seen=new Set();do{const p=api('calendar','v3','calendar.events.list',{calendarId:id,timeMin:start,timeMax:end,singleEvents:true,maxResults:2500,...(token?{pageToken:token}:{})});rows.push(...(p.items || []));token=p.nextPageToken || '';if(token&&seen.has(token))throw new Error('pagination_repeated');seen.add(token);}while(token);return rows;}
async function verify(){
 const settings=Object.fromEntries(values('Settings!A1:B80').slice(1)),status=Object.fromEntries(values('Status!A1:B80').slice(1));
 const rows=values("'Train options'!A1:O2000").slice(1),days=values('Days!A1:G100').slice(1),stations=values('Stations!A1:D20').slice(1).filter(r=>r[0]===true||r[0]==='TRUE').map(r=>String(r[1]));
 assert.ok(rows.length,'no_train_options');assert.ok(status.last_success_at,'no_success');
 assert.ok(status.state==='HEALTHY'||String(status.state).startsWith('IDLE'),'current_run_unhealthy');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'commute-live-'));
 let matchCount=0,feed;
 try{
  const response=await fetch('https://www3.septa.org/developer/gtfs_public.zip');assert.equal(response.status,200);const zip=path.join(temp,'outer.zip');fs.writeFileSync(zip,Buffer.from(await response.arrayBuffer()));
  const rail=path.join(temp,'rail.zip');fs.writeFileSync(rail,execFileSync('unzip',['-p',zip,'google_rail.zip'],{maxBuffer:30*1024*1024}));
  const tables={};for(const [key,file] of Object.entries({trips:'trips.txt',times:'stop_times.txt',routes:'routes.txt',stops:'stops.txt',calendar:'calendar.txt',exceptions:'calendar_dates.txt',info:'feed_info.txt'}))tables[key]=csv(execFileSync('unzip',['-p',rail,file],{encoding:'utf8',maxBuffer:8*1024*1024}));
  feed={version:tables.info[0].feed_version};
  const wanted=new Set(stations.concat([String(settings.target_stop_id)])),calls=new Map();
  for(const s of tables.times)if(wanted.has(s.stop_id)){if(!calls.has(s.trip_id))calls.set(s.trip_id,[]);calls.get(s.trip_id).push(s);}
  const clock=s=>{const m=/^(\d{1,2}):(\d{2})/.exec(String(s));assert.ok(m,'option_time_invalid');return Number(m[1])*3600+Number(m[2])*60;};
  for(const r of rows){const station=String(r[14]).split(':')[2],from=r[1]==='outbound'?station:String(settings.target_stop_id),to=r[1]==='outbound'?String(settings.target_stop_id):station;
   assert.ok(tables.trips.some(t=>{if(String(t.trip_short_name).replace(/^[A-Za-z]+/,'')!==String(r[3])||!serviceActive(tables,t.service_id,String(r[0])))return false;const stops=calls.get(t.trip_id)||[],a=stops.find(s=>s.stop_id===from),b=stops.find(s=>s.stop_id===to);return a&&b&&Number(a.stop_sequence)<Number(b.stop_sequence)&&a.pickup_type!=='1'&&b.drop_off_type!=='1'&&clock(a.departure_time)%86400===clock(r[5])&&clock(b.arrival_time)%86400===clock(r[6]);}),'option_not_in_official_service');matchCount++;
  }
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
 const dates=rows.map(r=>String(r[0])).sort(),start=midnight(dates[0]),end=new Date(Date.parse(dates.at(-1)+'T12:00:00Z')+86400000).toISOString();
 const owner='septa-commute:'+scriptId;
 const opts=events(settings.options_calendar_id,start,end).filter(e=>e.extendedProperties?.private?.commuteOwner===owner);
 const main=events(settings.main_calendar_id,start,end).filter(e=>e.extendedProperties?.private?.commuteOwner===owner);
 const optionIds=new Set(rows.map(r=>r[14]));assert.ok(opts.every(e=>optionIds.has(e.extendedProperties.private.commuteKey)),'calendar_option_not_in_sheet');
 assert.ok(opts.every(e=>e.reminders?.useDefault===false&&!(e.reminders.overrides || []).length),'alternative_reminders_spam');
 assert.ok(main.every(e=>e.reminders?.useDefault===false&&(e.reminders.overrides || []).length),'main_reminders_missing');
 assert.equal(new Set(opts.map(e=>e.extendedProperties.private.commuteKey)).size,opts.length,'duplicate_owned_options');
 const futureChosen=rows.filter(r=>String(r[13]).startsWith('CHOSEN')&&Date.parse(newYorkTime(String(r[0]),String(r[4])+':00'))>Date.now());
 if(String(settings.main_writer_enabled).toLowerCase()==='true')for(const r of futureChosen)assert.equal(main.filter(e=>e.extendedProperties.private.commuteKey===r[0]+':'+r[1]).length,1,'chosen_journey_missing_or_duplicate');
 for(const d of days){const chosen=rows.filter(r=>r[0]===d[0]&&String(r[13]).startsWith('CHOSEN'));const outward=chosen.find(r=>r[1]==='outbound'),back=chosen.find(r=>r[1]==='return');if(outward&&back)assert.equal(outward[2],back[2],'parked_car_station_mismatch');}
 const processes=api('script','v1','processes.listScriptProcesses',{scriptId,pageSize:30,'scriptProcessFilter.functionName':'commuteTick'}).processes || [];
 const scheduled=processes.filter(p=>p.processType==='TIME_DRIVEN'&&p.processStatus==='COMPLETED');assert.ok(scheduled.length,'no_completed_time_trigger');
 const measured=rows.filter(r=>Number.isFinite(Number(r[9]))&&r[9]!==''&&r[9]!=='Unknown');
 const cloud=api('script','v1','projects.getContent',{scriptId});const sourceHashes={};assert.equal(cloud.files.length,4,'unexpected_cloud_source');
 for(const name of ['Core','Planner','Setup','appsscript']){const file=cloud.files.find(f=>f.name===name);assert.ok(file,'cloud_source_missing');const local=fs.readFileSync(path.join(__dirname,'..',name+(name==='appsscript'?'.json':'.gs')),'utf8');if(name==='appsscript')assert.deepEqual(JSON.parse(file.source),JSON.parse(local));else assert.equal(file.source,local,'cloud_source_differs');sourceHashes[name]=crypto.createHash('sha256').update(local).digest('hex');}
 const places=values('Places!A1:D10').slice(1);assert.equal(places.length,2,'places_not_resolved');assert.ok(places.every(r=>r[1]&&Number.isFinite(Number(r[2]))&&Number.isFinite(Number(r[3]))),'resolved_place_invalid');
 const result={verified_at:new Date().toISOString(),state:status.state,detail:status.detail,last_success_at:status.last_success_at,last_success_kind:status.last_success_kind,runtime_seconds:Number(status.runtime_seconds),feed_version:feed.version,official_train_matches:matchCount,sheet_options:rows.length,planned_days:days.length,options_calendar_owned:opts.length,main_calendar_owned:main.length,future_chosen_journeys:futureChosen.length,google_distance_rows:measured.length,completed_time_trigger_runs:scheduled.length,latest_completed_time_trigger:scheduled[0]?.startTime,main_writer_enabled:settings.main_writer_enabled,resolved_places:places.length,cloud_source_matches:true,source_sha256:sourceHashes,example_trains:rows.slice(0,3).map(r=>({date:r[0],direction:r[1],station:r[2],train:r[3],departure:r[5],arrival:r[6]}))};console.log(JSON.stringify(result,null,2));
}
module.exports={csv,midnight,newYorkTime,serviceActive};
if(require.main===module)verify().catch(e=>{console.error(JSON.stringify({verification:'failed',code:/^[a-z_]+$/.test(e.message)?e.message:'live_check_failed'}));process.exitCode=1;});
