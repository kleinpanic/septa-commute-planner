/* Public product defaults. All personal values are entered in the private Sheet. */
const SETTING_ROWS = [
  ['origin','', 'Home/work address or latitude,longitude. Kept in this private Sheet.'],
  ['source_calendar_ids','', 'Required attendance calendar IDs, separated with semicolons.'],
  ['optional_calendar_ids','', 'Optional extra campus commitments; a failed read is visibly degraded.'],
  ['include_title','lecture|class|exam|recitation|\\bICA\\b', 'Attendance title pattern; location terms can also include a commitment.'],
  ['exclude_title','deadline|\\bdue\\b|homework|office hours|reminder|wake.?up|preview', 'Exclude informational events and deadlines.'],
  ['campus_location_terms','', 'Optional location terms separated with semicolons.'],
  ['destination','Temple University, Philadelphia PA', 'Fallback destination; actual first/last commitment location takes priority.'],
  ['target_stop_id','90007','SEPTA destination stop. See Stations directory menu.'],
  ['main_calendar_id','', 'Existing commute calendar, or leave blank to create one during setup.'],
  ['options_calendar_id','', 'Separate train-options calendar created during setup.'],
  ['planning_days',7,'Rolling window, 1–21 days, limited to feed coverage. Increase only after checking daily provider budgets.'],
  ['options_per_station',3,'Train choices per station/direction/day, 1–6.'],
  ['refresh_minutes',60,'Hourly by default. Supported minutes: 5, 10, 15, 30, 60, 120, 240, 360, 480, 720. Run setup after changing.'],
  ['full_refresh_hours',24,'Rebuild the forward window daily during waking hours. Refresh now bypasses this wait.'],
  ['active_window_hours',4,'Refresh today only within this many hours before first or after last commitment.'],
  ['max_scheduled_runtime_seconds_per_day',1200,'Stop expensive scheduled work after 20 minutes/day. Other scripts share Google quotas. Refresh now remains available.'],
  ['arrival_buffer_minutes',15,'Arrive this far before the first commitment.'],
  ['parking_buffer_minutes',10,'Parking, boarding and recovery time at the origin station.'],
  ['departure_buffer_minutes',5,'Time after the final commitment before walking to the station.'],
  ['fallback_walk_minutes',12,'Conservative walking estimate if Google cannot route the campus walk.'],
  ['reminder_minutes','30;10','Explicit reminders for chosen journeys, separated with semicolons.'],
  ['main_writer_enabled',false,'Enable only after a healthy staged run and retiring the previous main writer.'],
  ['automatic_enabled',false,'Setup installs the trigger; this setting controls its work.'],
  ['quiet_start_hour',6,'Skip expensive today refresh outside this hour through quiet_end_hour.'],
  ['quiet_end_hour',22,'Local New York hour. Full refresh still runs when due.'],
  ['max_deletions_per_run',20,'Fail closed if reconciliation proposes excessive managed deletions.']
  ,['max_maps_requests_per_day',100,'Daily cap for built-in Google Maps requests; the free profile normally needs far fewer.']
  ,['max_routes_requests_per_day',0,'Paid Routes API is off by default. Set a positive budget only if opting in; billing/quota applies.']
  ,['routes_api_enabled',false,'Free profile uses built-in Google Maps without a key. Opt in to departure-specific traffic predictions only when wanted.']
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Commute planner')
    .addItem('Set up / repair automation','setupCommute')
    .addItem('Refresh now','refreshCommute')
    .addItem('Resolve origin and destination','resolvePlaces')
    .addItem('Load SEPTA station directory','loadStationDirectory')
    .addItem('Set traffic-aware Routes API key','setRoutesKey')
    .addItem('Pause automation','pauseCommute').addToUi();
}
function book_() {
  const id=PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id?SpreadsheetApp.openById(id):SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name) { const b=book_(); return b.getSheetByName(name) || b.insertSheet(name); }
function table_(name,rows) {
  const s=sheet_(name);s.clearContents();
  if(rows.length) s.getRange(1,1,rows.length,rows[0].length).setValues(rows);
  s.setFrozenRows(1);s.autoResizeColumns(1,Math.min(rows[0] ? rows[0].length:1,8));
  s.getRange(1,1,1,Math.max(1,rows[0] ? rows[0].length:1)).setBackground('#17334c').setFontColor('#ffffff').setFontWeight('bold');
  return s;
}
function settings_() {
  const rows=sheet_('Settings').getDataRange().getValues();const c={};
  rows.slice(1).forEach(r=>{if(r[0])c[String(r[0])]=r[1];});
  SETTING_ROWS.forEach(r=>{if(!(r[0] in c))c[r[0]]=r[1];});
  ['planning_days','options_per_station','refresh_minutes','full_refresh_hours','active_window_hours','max_scheduled_runtime_seconds_per_day','arrival_buffer_minutes','parking_buffer_minutes','departure_buffer_minutes','fallback_walk_minutes','quiet_start_hour','quiet_end_hour','max_deletions_per_run','max_maps_requests_per_day','max_routes_requests_per_day'].forEach(k=>{
    c[k]=Number(c[k]);if(!Number.isFinite(c[k])||c[k]<0||!Number.isInteger(c[k]))throw new Error('setting_invalid:'+k);
  });
  if(c.planning_days<1||c.planning_days>21||c.options_per_station<1||c.options_per_station>6||![5,10,15,30,60,120,240,360,480,720].includes(c.refresh_minutes)||c.full_refresh_hours<1||c.active_window_hours<1||c.active_window_hours>12||c.max_scheduled_runtime_seconds_per_day<60||c.quiet_start_hour>23||c.quiet_end_hour>24||c.quiet_start_hour>=c.quiet_end_hour)throw new Error('setting_bounds_invalid');
  ['automatic_enabled','main_writer_enabled','routes_api_enabled'].forEach(k=>c[k]=c[k]===true || String(c[k]).toLowerCase()==='true');
  ['source_calendar_ids','optional_calendar_ids','campus_location_terms','reminder_minutes'].forEach(k=>c[k]=String(c[k]||'').split(';').map(s=>s.trim()).filter(Boolean));
  c.reminder_minutes=c.reminder_minutes.map(Number);
  if(c.reminder_minutes.length>5||c.reminder_minutes.some(n=>!Number.isInteger(n)||n<0||n>40320))throw new Error('reminders_invalid');
  try { new RegExp(c.include_title);new RegExp(c.exclude_title); }catch(e){throw new Error('title_pattern_invalid');}
  return c;
}
function setting_(key,value) {
  const s=sheet_('Settings'),rows=s.getDataRange().getValues();
  const i=rows.findIndex(r=>r[0]===key);
  if(i>=0)s.getRange(i+1,2).setValue(value);else s.appendRow([key,value,'']);
}
function status_(values) {
  const s=sheet_('Status');const rows=s.getDataRange().getValues();
  const old=Object.fromEntries(rows.slice(1).filter(r=>r[0]).map(r=>[r[0],r[1]]));
  const merged=[['Measure','Value'],...Object.entries(Object.assign(old,values))];
  if(s.getLastRow()<1)table_('Status',merged);
  else s.getRange(1,1,merged.length,2).setValues(merged);
}
function initializeSheet_() {
  const p=PropertiesService.getScriptProperties(),b=SpreadsheetApp.getActiveSpreadsheet();
  if(b)p.setProperty('SHEET_ID',b.getId());
  book_().setSpreadsheetTimeZone('America/New_York');
  const s=sheet_('Settings');if(s.getLastRow()<2)table_('Settings',[['Setting','Value','Help'],...SETTING_ROWS]);
  const keys=new Set(s.getDataRange().getValues().slice(1).map(r=>String(r[0])));
  SETTING_ROWS.filter(r=>!keys.has(r[0])).forEach(r=>s.appendRow(r));
  if(sheet_('Stations').getLastRow()<2)table_('Stations',[
    ['Enabled','Stop ID','Station','Fallback drive minutes'],[true,'90538','Doylestown',33],[true,'90531','Lansdale',48]
  ]);
  if(sheet_('Selections').getLastRow()<1)table_('Selections',[
    ['Date','Direction','Option ID','Help'],['','outbound','','Copy an Option ID from Train options. Blank means automatic recommendation.']
  ]);
  table_('Start here',[
    ['SEPTA Commute Planner','Google-hosted commute choices'],
    ['1. Configure','Fill origin and required source calendar IDs in Settings. Choose enabled stations in Stations.'],
    ['2. Set up','Use Commute planner → Set up / repair automation. Authorize your own Google account.'],
    ['3. Compare','Train options shows several trains, leave-by times, distances, current status and recommendation.'],
    ['4. Choose','Copy an Option ID to Selections for a date and outbound/return direction. Blank selects the recommendation.'],
    ['5. Main journey','Enable main_writer_enabled after a successful staged run and retiring any old writer.'],
    ['Calendars','SEPTA Train Options shows alternatives; the main calendar shows only the chosen journey.'],
    ['Automatic work','Free profile: hourly checks, daily forward planning, expensive work only around commutes. Status shows runtime and request counts.'],
    ['Traffic','Set a Routes API key for explicit traffic-aware road predictions; Maps still supplies route distance/time without it.'],
    ['Freshness','Scheduled trains are not live predictions. Unmatched, unavailable and stale live information are labeled.'],
    ['Privacy','Keep the Sheet private. Origin and calendar IDs are personal. Keys are stored in Script Properties.'],
    ['Scope','SEPTA Regional Rail with driving to a station and walking to commitments; no phone or Pi required.']
  ]);
}
function setupCommute() {
  initializeSheet_();const c=settings_();
  if(!c.main_calendar_id)setting_('main_calendar_id',CalendarApp.createCalendar('SEPTA Commute',{timeZone:'America/New_York'}).getId());
  if(!c.options_calendar_id)setting_('options_calendar_id',CalendarApp.createCalendar('SEPTA Train Options',{timeZone:'America/New_York'}).getId());
  if(!c.origin||!c.source_calendar_ids.length) {
    status_({state:'SETUP REQUIRED',detail:'Fill origin and source_calendar_ids, then run setup again.'});return;
  }
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='commuteTick').forEach(t=>ScriptApp.deleteTrigger(t));
  const trigger=ScriptApp.newTrigger('commuteTick').timeBased();
  if(c.refresh_minutes>=60)trigger.everyHours(c.refresh_minutes/60);else trigger.everyMinutes(c.refresh_minutes);
  trigger.create();
  setting_('automatic_enabled',true);
  status_({trigger_installed_at:new Date().toISOString(),installed_refresh_minutes:c.refresh_minutes,trigger_count:ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='commuteTick').length});
  return runCommute_('setup',true);
}
function commuteTick() { return runCommute_('scheduled',false); }
function refreshCommute() { return runCommute_('manual',true); }
function pauseCommute() {
  setting_('automatic_enabled',false);
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='commuteTick').forEach(t=>ScriptApp.deleteTrigger(t));
  status_({state:'PAUSED',trigger_count:0});
}
function setRoutesKey() {
  const ui=SpreadsheetApp.getUi();const r=ui.prompt('Google Routes API key','Stored privately in Script Properties. Restrict it to Routes API; billing must already be enabled.',ui.ButtonSet.OK_CANCEL);
  if(r.getSelectedButton()!==ui.Button.OK)return;
  const key=r.getResponseText().trim();if(!key)throw new Error('routes_key_empty');
  PropertiesService.getScriptProperties().setProperty('ROUTES_KEY',key);
  status_({traffic_provider:'Google Routes key configured; next execution verifies it.'});
}
function resolvePlaces() {
  const c=settings_();const rows=[['Place','Resolved address','Latitude','Longitude']];
  [['Origin',c.origin],['Destination',c.destination]].forEach(([label,text])=>{
    const r=Maps.newGeocoder().geocode(String(text));if(r.status!=='OK'||!r.results.length)throw new Error('place_not_resolved:'+label);
    const first=r.results[0],point=first.geometry.location;rows.push([label,first.formatted_address,point.lat,point.lng]);
  });table_('Places',rows);status_({places_resolved_at:new Date().toISOString()});
}
function loadStationDirectory() {
  const tables=downloadRail_();table_('Station directory',[
    ['Stop ID','Station','Latitude','Longitude'],...tables.stops.map(s=>[s.stop_id,s.stop_name,Number(s.stop_lat),Number(s.stop_lon)])
  ]);
}
