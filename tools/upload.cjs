/* Upload only this product's public source; never read private deployment inputs. */
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {spawnSync}=require('node:child_process');
const [scriptId,account]=process.argv.slice(2);
if(!scriptId||!account){process.stderr.write('Usage: node tools/upload.cjs SCRIPT_ID GOOGLE_ACCOUNT\n');process.exit(2);}
const root=path.join(__dirname,'..');
const files=['Core.gs','Planner.gs','Setup.gs','appsscript.json'].map(file=>({
 name:file.replace(/\.(gs|json)$/,''),type:file.endsWith('.gs')?'SERVER_JS':'JSON',source:fs.readFileSync(path.join(root,file),'utf8')
}));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'commute-upload-'));
const body=path.join(temp,'content.json');fs.writeFileSync(body,JSON.stringify({files}),{mode:0o600});
try{
 const r=spawnSync('gog',['--no-input','--force','-a',account,'api','call','script','v1','projects.updateContent','--params',JSON.stringify({scriptId}),'--body','@'+body,'--allow-write','--json'],{encoding:'utf8',timeout:60000});
 if(r.status!==0){process.stderr.write(r.stderr || 'upload_failed');process.exitCode=1;}
 else{const out=JSON.parse(r.stdout);process.stdout.write(JSON.stringify({uploaded:true,scriptId,files:(out.files || []).map(f=>f.name)})+'\n');}
}finally{fs.rmSync(temp,{recursive:true,force:true});}
