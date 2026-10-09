const {test}=require('node:test'),assert=require('node:assert/strict');
const {csv,midnight,newYorkTime,serviceActive}=require('../tools/verify-live.cjs');
test('independent provider verifier parses quoted CSV and New York summer, winter and transition dates',()=>{
 assert.deepEqual(csv('\uFEFFone,two\r\n"a,b","a""b"\r\n"multiline\nvalue",ok\r\n'),[{one:'a,b',two:'a"b'},{one:'multiline\nvalue',two:'ok'}]);
 assert.equal(midnight('2026-10-09'),'2026-10-09T04:00:00.000Z');assert.equal(midnight('2026-11-02'),'2026-11-02T05:00:00.000Z');assert.equal(newYorkTime('2026-03-08','13:00:00'),'2026-03-08T17:00:00.000Z');assert.equal(newYorkTime('2026-11-01','13:00:00'),'2026-11-01T18:00:00.000Z');
 const t={calendar:[{service_id:'a',start_date:'20261001',end_date:'20261031',friday:'1',saturday:'0'}],exceptions:[{service_id:'a',date:'20261009',exception_type:'2'},{service_id:'a',date:'20261010',exception_type:'1'}]};assert.equal(serviceActive(t,'a','2026-10-09'),false);assert.equal(serviceActive(t,'a','2026-10-10'),true);assert.equal(serviceActive(t,'a','2026-10-16'),true);assert.equal(serviceActive(t,'a','2026-11-06'),false);
});
