/* Pure scheduling rules. No account, origin, calendar ID, or credentials. */
const CommuteCore = (() => {
  function fail(code) { throw new Error(code); }
  function seconds(text) {
    const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(String(text));
    if (!m || Number(m[1]) > 47) fail('gtfs_time_invalid');
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  function addDays(date, n) {
    const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function activeServices(feed, date) {
    const compact = date.replace(/-/g, '');
    const weekday = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(date+'T12:00:00Z').getUTCDay()];
    const active = new Set(feed.calendar.filter(c => c.start_date <= compact && c.end_date >= compact && c[weekday] === '1').map(c => c.service_id));
    feed.exceptions.filter(e => e.date === compact).forEach(e => {
      if (e.exception_type === '1') active.add(e.service_id);
      if (e.exception_type === '2') active.delete(e.service_id);
    });
    return active;
  }
  function compileFeed(tables, stationIds, targetId) {
    const wanted = new Set(stationIds.concat([targetId]));
    const stops = tables.stops.filter(s => wanted.has(s.stop_id));
    if (stops.length !== wanted.size) fail('station_id_not_in_feed');
    const byTrip = {};
    tables.times.forEach(s => {
      if (wanted.has(s.stop_id)) (byTrip[s.trip_id] || (byTrip[s.trip_id] = [])).push(s);
    });
    const routes = Object.fromEntries(tables.routes.map(r => [r.route_id, r.route_long_name || r.route_short_name]));
    const trips = Object.fromEntries(tables.trips.map(t => [t.trip_id,t]));
    const legs = [];
    Object.keys(byTrip).forEach(id => {
      const t=trips[id]; if (!t) return;
      const calls=byTrip[id].sort((a,b)=>Number(a.stop_sequence)-Number(b.stop_sequence));
      for(let a=0;a<calls.length;a++) for(let b=a+1;b<calls.length;b++) {
        const from=calls[a], to=calls[b];
        if (from.pickup_type === '1' || to.drop_off_type === '1') continue;
        if (from.stop_id !== targetId && to.stop_id !== targetId) continue;
        const departure=seconds(from.departure_time),arrival=seconds(to.arrival_time);
        if(arrival <= departure) fail('gtfs_stop_times_invalid');
        // SEPTA's current feed uses trip_short_name; never expose trip_id as a train number.
        const short=String(t.trip_short_name || '').trim();
        const number=/^(?:[A-Za-z]+)?(\d+)$/.exec(short);
        const train=number ? number[1] : null;
        legs.push({trip:id,service:t.service_id,train:train || null,line:routes[t.route_id] || t.route_id,
          from:from.stop_id,to:to.stop_id,departure,arrival,headsign:t.trip_headsign || ''});
      }
    });
    const info=tables.info[0] || {};
    return {calendar:tables.calendar,exceptions:tables.exceptions,stops,legs,
      version:info.feed_version || '',start:info.feed_start_date || '',end:info.feed_end_date || ''};
  }
  function legsFor(feed,date,stationId,targetId,direction) {
    const active=activeServices(feed,date);
    const from=direction==='outbound'?stationId:targetId, to=direction==='outbound'?targetId:stationId;
    return feed.legs.filter(l=>active.has(l.service)&&l.from===from&&l.to===to);
  }
  function liveFor(train,date,today,arrivals,trains,observedAt,now) {
    if(date!==today) return {label:'Scheduled · live status not available yet',delay:null,track:'',cancelled:false};
    if(!observedAt || now-observedAt > 180000) return {label:'Live status unavailable or stale',delay:null,track:'',cancelled:false};
    const a=arrivals.find(x=>String(x.train_id)===String(train));
    const t=trains.find(x=>String(x.trainno)===String(train));
    if(a && /cancel/i.test(a.status || '')) return {label:'Cancelled · SEPTA live feed',delay:null,track:a.track || '',cancelled:true};
    if(a && /^on\s*time$/i.test(String(a.status).trim())) return {label:'On time · SEPTA arrivals',delay:0,track:a.track || '',cancelled:false};
    const m=a && /^\s*(\d+)\s*min(?:utes)?\s*$/i.exec(a.status || '');
    const delay=m ? Number(m[1]) : t && t.late!==null && t.late!==undefined && String(t.late).trim()!=='' && Number.isFinite(Number(t.late)) && Number(t.late)>=0 ? Number(t.late) : null;
    if(delay!==null) return {label:delay===0?'On time · SEPTA live feed':delay+' min late · SEPTA live feed',delay,track:a && a.track || '',cancelled:false};
    return {label:'Live status unknown · no matching train',delay:null,track:a && a.track || '',cancelled:false};
  }
  function choose(options,selection,inboundStation) {
    const eligible=options.filter(o=>!o.cancelled && o.feasible && (!inboundStation || o.station===inboundStation));
    if(selection) {
      const match=eligible.find(o=>o.id===selection);
      if(!match) fail('selected_train_unavailable');
      return match;
    }
    return eligible.sort((a,b)=>a.score-b.score || a.id.localeCompare(b.id))[0] || null;
  }
  function isCommitment(event,include,exclude,locations) {
    if(event.status==='cancelled' || !event.start || !event.start.dateTime || !event.end || !event.end.dateTime) return false;
    const title=String(event.summary || '');
    if(new RegExp(exclude,'i').test(title)) return false;
    if(new RegExp(include,'i').test(title)) return true;
    return locations.length>0 && locations.some(t=>String(event.location || '').toLowerCase().includes(t.toLowerCase()));
  }
  function flattenArrivals(value) {
    const out=[];
    function walk(v) {
      if(Array.isArray(v)) return v.forEach(walk);
      if(v && typeof v==='object') { if(v.train_id) out.push(v); else Object.values(v).forEach(walk); }
    }
    walk(value);return out;
  }
  return {seconds,addDays,activeServices,compileFeed,legsFor,liveFor,choose,isCommitment,flattenArrivals};
})();
