const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {audit,PUBLIC_FILES}=require('../tools/privacy-gate.cjs');
test('public export accepts only generic source and rejects a real-shaped private key',()=>{
 const root=path.resolve(__dirname,'..');assert.equal(audit(root).public_files,PUBLIC_FILES.length);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'commute-privacy-test-'));
 try{for(const file of PUBLIC_FILES){const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);}fs.appendFileSync(path.join(temp,'Core.gs'),'\n'+'AIza'+'x'.repeat(35));assert.throws(()=>audit(temp),/release_private_value:Core.gs/);}finally{fs.rmSync(temp,{recursive:true,force:true});}
});
