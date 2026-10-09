/* In-memory Apps Script host. Fixtures are invented; no production account data. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const {source:readSource,sourcePath}=require('./source.cjs');
function clone(v){return JSON.parse(JSON.stringify(v));}
function tables(){
 const stops=[['A','Station A','40','-75'],['B','Station B','40.2','-75.2'],['C','Campus','39.9','-75.1']].map(([stop_id,stop_name,stop_lat,stop_lon])=>({stop_id,stop_name,stop_lat,stop_lon}));
 const trips=[],times=[];
 for(const station of ['A','B'])for(const direction of ['outbound','return'])for(let i=0;i<4;i++){
  const train=String((station==='A'?500:600)+(direction==='outbound'?1:2)+i*2),trip_id='DYL'+train;
  trips.push({trip_id,trip_short_name:trip_id,service_id:'weekday',route_id:'DYL'});
  const dep=direction==='outbound'?10*3600+i*1800:16*3600+30*60+i*1800;
  const tm=n=>[Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,'0')).join(':');
  const from=direction==='outbound'?station:'C',to=direction==='outbound'?'C':station;
  times.push({trip_id,stop_id:from,stop_sequence:'1',departure_time:tm(dep),arrival_time:tm(dep)},
   {trip_id,stop_id:to,stop_sequence:'9',arrival_time:tm(dep+3600),departure_time:tm(dep+3600)});
 }
 return {stops,trips,times,routes:[{route_id:'DYL',route_long_name:'Fixture Rail'}],
  calendar:[{service_id:'weekday',start_date:'20261001',end_date:'20261130',monday:'1',tuesday:'1',wednesday:'1',thursday:'1',friday:'1',saturday:'0',sunday:'0'}],exceptions:[],
  info:[{feed_start_date:'20261001',feed_end_date:'20261130',feed_version:'fixture-1'}]};
}
function harness(options={}){
 let now=Date.parse(options.now || '2026-10-09T12:00:00Z');
 class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const sheets=new Map(),properties=new Map(),triggers=[],createdCalendars=[],writes=[],requests=[],logs=[],sleeps=[];
 const resources=new Map([['source',[
  {id:'lecture',summary:'Lecture',location:'Campus hall',start:{dateTime:'2026-10-09T13:20:00-04:00'},end:{dateTime:'2026-10-09T15:50:00-04:00'}},
  {id:'deadline',summary:'Deadline',start:{dateTime:'2026-10-09T17:00:00-04:00'},end:{dateTime:'2026-10-09T17:30:00-04:00'}}
 ]],['options',[]],['main',[]]]);
 const failures=new Map(),responses=new Map(),menus=[];let locked=false,busy=false;let pages=null,raw=tables(),mapReply=null;
 const blob=(name,rows)=>({getName:()=>name,getDataAsString:()=>JSON.stringify(rows)});
 const columns=v=>v.length?[Object.keys(v[0]),...v.map(r=>Object.keys(v[0]).map(k=>r[k]||''))]:[['service_id','date','exception_type']];
 function archive(){const names={trips:'trips.txt',times:'stop_times.txt',routes:'routes.txt',stops:'stops.txt',calendar:'calendar.txt',exceptions:'calendar_dates.txt',info:'feed_info.txt'};return Object.entries(names).filter(([k])=>raw[k]).map(([k,n])=>blob(n,columns(raw[k])));}
 function range(sheet,row,col,n=1,m=1){return {
  setValues(values){if(values.length!==n||values.some(r=>r.length!==m))throw new Error('mock_range_shape');values.forEach((r,i)=>r.forEach((v,j)=>{if(!sheet.rows[row+i-1])sheet.rows[row+i-1]=[];sheet.rows[row+i-1][col+j-1]=v;}));return this;},
  setValue(value){return this.setValues([[value]]);},setBackground(){return this;},setFontColor(){return this;},setFontWeight(){return this;},setNumberFormat(){return this;}
 };}
 function sheet(name){if(!sheets.has(name))sheets.set(name,{rows:[],getDataRange(){return {getValues:()=>{const width=Math.max(1,...this.rows.map(r=>r.length));return this.rows.map(r=>Array.from({length:width},(_,i)=>r[i]??''));}};},getRange(r,c,n,m){return range(this,r,c,n,m);},getLastRow(){return this.rows.length;},clearContents(){this.rows=[];},appendRow(r){this.rows.push(r.slice());},setFrozenRows(){},autoResizeColumns(){}});return sheets.get(name);}
 const book={getId:()=> 'fixture-sheet',getSheetByName:n=>sheets.get(n)||null,insertSheet:sheet,setSpreadsheetTimeZone:t=>{book.timezone=t;}};
 const props={getProperty:k=>properties.has(k)?properties.get(k):null,setProperty(k,v){properties.set(k,String(v));return this;},deleteProperty:k=>properties.delete(k),setProperties(v){Object.entries(v).forEach(([k,x])=>properties.set(k,String(x)));},getProperties:()=>Object.fromEntries(properties)};
 const response=(code,value)=>({getResponseCode:()=>code,getContentText:()=>JSON.stringify(value)});
 function fetch(url,opt={}){
  requests.push({url,...opt});if(failures.has(url))return response(failures.get(url),{});
  if(responses.has(url))return responses.get(url);
  if(url.includes('gtfs_public.zip'))return {getResponseCode:()=>200,getBlob:()=>({kind:'outer'})};
  if(url.includes('TrainView'))return response(200,[]);
  if(url.includes('Arrivals'))return response(200,{});
  if(url.includes('routes.googleapis.com'))return response(200,{routes:[{duration:'1200s',distanceMeters:16093.44}]});
  const u=new URL(url),m=/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(u.pathname);
  if(!m)throw new Error('mock_unknown_url');const id=decodeURIComponent(m[1]),eventId=m[2];
  if(opt.headers?.Authorization!=='Bearer fixture-token')throw new Error('mock_calendar_auth_missing');
  if(['post','patch'].includes(opt.method)&&opt.contentType!=='application/json')throw new Error('mock_calendar_json_type_missing');
  if(failures.has(id))return response(failures.get(id),{});
  if(!resources.has(id))return response(404,{});
  if(!opt.method||opt.method==='get'){
   if(pages){const i=Number(u.searchParams.get('pageToken')||0);return response(200,pages[i] || {});}
   const lo=Date.parse(u.searchParams.get('timeMin')),hi=Date.parse(u.searchParams.get('timeMax'));
   return response(200,{items:clone(resources.get(id).filter(e=>Date.parse(e.end?.dateTime)>lo&&Date.parse(e.start?.dateTime)<hi))});
  }
  const events=resources.get(id),body=opt.payload?JSON.parse(opt.payload):null,index=events.findIndex(e=>e.id===eventId);
  if(opt.method==='post'){if(events.some(e=>e.id===body.id))return response(409,{});events.push(clone(body));}
  else if(opt.method==='patch'){if(index<0)return response(404,{});events[index]={...events[index],...clone(body)};}
  else if(opt.method==='delete'){if(index<0)return response(404,{});events.splice(index,1);}
  else throw new Error('mock_method_unknown');writes.push({id,method:opt.method,eventId,body});return response(opt.method==='delete'?204:200,body || {});
 }
 function fmt(d,tz,pattern){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d).map(p=>[p.type,p.value]));
  if(pattern==='yyyy-MM-dd')return parts.year+'-'+parts.month+'-'+parts.day;
  if(pattern==='HH:mm')return parts.hour+':'+parts.minute;
  if(pattern==='H')return String(Number(parts.hour));return parts.year+'-'+parts.month+'-'+parts.day+' '+parts.hour+':'+parts.minute;
 }
 function parseDate(text,tz){
  const target=Date.parse(text.replace(' ','T')+'Z');let epoch=target;
  for(let i=0;i<3;i++){
   const p=new Intl.DateTimeFormat('sv-SE',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(epoch));
   epoch+=target-Date.parse(p.replace(' ','T')+'Z');
  }return new Clock(epoch);
 }
 const menu={addItem(label,handler){menus.push({label,handler});return this;},addToUi(){menus.push({shown:true});}};let prompt={getSelectedButton:()=> 'CANCEL',getResponseText:()=> ''};
 const ui={createMenu:()=>menu,prompt:()=>prompt,ButtonSet:{OK_CANCEL:'OK_CANCEL'},Button:{OK:'OK'}};
 const sandbox={process:{env:process.env},Date:Clock,console:{log:v=>logs.push(v),error:v=>logs.push(v)},
  PropertiesService:{getScriptProperties:()=>props},SpreadsheetApp:{getActiveSpreadsheet:()=>book,openById:id=>{if(id!==book.getId())throw new Error('mock_wrong_sheet');return book;},getUi:()=>ui},
  CalendarApp:{createCalendar(name){const id='created-'+createdCalendars.length;createdCalendars.push({name,id});resources.set(id,[]);return {getId:()=>id};}},
  ScriptApp:{getScriptId:()=> 'fixture-script',getOAuthToken:()=> 'fixture-token',getProjectTriggers:()=>triggers.slice(),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1),newTrigger(handler){const t={getHandlerFunction:()=>handler};return {timeBased(){return this;},everyMinutes(n){t.minutes=n;return this;},create(){triggers.push(t);return t;}};}},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(busy||locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},
  UrlFetchApp:{fetch,fetchAll:ops=>ops.map(o=>fetch(o.url,o))},
  Utilities:{sleep:n=>sleeps.push(n),formatDate:fmt,parseDate,parseCsv:JSON.parse,unzip:b=>b.kind==='outer'?[{kind:'rail',getName:()=> 'google_rail.zip'}]:archive(),computeDigest:(alg,s)=>[...crypto.createHash('sha256').update(s).digest()],DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'UTF-8'}},
  Maps:{DirectionFinder:{Mode:{WALKING:'WALKING',DRIVING:'DRIVING'}},newDirectionFinder(){const q={};return {setOrigin(v){q.origin=v;return this;},setDestination(v){q.destination=v;return this;},setMode(v){q.mode=v;return this;},setDepart(v){q.depart=v;return this;},getDirections(){requests.push({maps:clone(q)});if(failures.has('maps'))throw new Error('maps_unavailable');if(mapReply)return clone(mapReply);return {routes:[{legs:[{duration:{value:q.mode==='WALKING'?600:1200},distance:{value:q.mode==='WALKING'?700:16093.44}}]}]};}};},newGeocoder:()=>({geocode:t=>failures.has('geocode')?{status:'ZERO_RESULTS'}:{status:'OK',results:[{formatted_address:'Fixture address',geometry:{location:{lat:40,lng:-75}}}]}})}
 };
 const ctx=vm.createContext(sandbox);
 for(const file of ['Core.gs','Setup.gs','Planner.gs']){
  let source=readSource(file);
  if(options.mutation?.file===file){if(!source.includes(options.mutation.from))throw new Error('mutation_target_missing');source=source.replace(options.mutation.from,options.mutation.to);}
  vm.runInContext(source,ctx,{filename:sourcePath(file)});
 }
 if(!options.rawFeed)ctx.downloadRail_=()=>raw;
 function configure(overrides={}){
  ctx.initializeSheet_();Object.entries({origin:'Fixture origin',source_calendar_ids:'source',main_calendar_id:'main',options_calendar_id:'options',target_stop_id:'C',planning_days:1,...overrides}).forEach(([k,v])=>ctx.setting_(k,v));
  ctx.table_('Stations',[['Enabled','Stop ID','Station','Fallback drive minutes'],[true,'A','Station A',30],[true,'B','Station B',40]]);
 }
 return {ctx,sheets,properties,triggers,createdCalendars,resources,failures,responses,writes,requests,logs,menus,sleeps,configure,
  setFeed:v=>{raw=v;},setMaps:v=>{mapReply=v;},
  setNow:v=>{now=Date.parse(v);},setBusy:v=>{busy=v;},locked:()=>locked,setPages:v=>{pages=v;},setPrompt:v=>{prompt=v;},status:()=>Object.fromEntries((sheets.get('Status')?.rows || []).slice(1))};
}
module.exports={harness,tables,clone};
