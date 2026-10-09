/* Explicit public export: no old repository history, deployment config or evidence. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PUBLIC_FILES=[
 'Core.gs','Planner.gs','Setup.gs','appsscript.json','README.md','TESTING.md','LICENSE',
 'package.json','package-lock.json','stryker.config.json','.gitignore','.github/workflows/test.yml',
 'test/core.test.cjs','test/product.test.cjs','test/boundaries.test.cjs','test/free-profile.test.cjs','test/privacy.test.cjs','test/verifier.test.cjs','test/harness.cjs','test/source.cjs',
 'tools/upload.cjs','tools/verify-live.cjs','tools/prepare-mutation.cjs','tools/privacy-gate.cjs','tools/publish-github.cjs'
];
function audit(root=path.resolve(__dirname,'..')){
 const files=PUBLIC_FILES.map(name=>{
  const target=path.join(root,name);if(!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink())throw new Error('release_file_invalid:'+name);
  const content=fs.readFileSync(target,'utf8');
  const forbidden=[/AIza[0-9A-Za-z_-]{30,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/[a-f0-9]{20,}@group\.calendar\.google\.com/,/[A-Za-z0-9._%+-]+@(?:gmail|outlook)\.com/];
  if(forbidden.some(re=>re.test(content)))throw new Error('release_private_value:'+name);
  return {path:name,bytes:Buffer.byteLength(content),sha256:crypto.createHash('sha256').update(content).digest('hex')};
 });
 const setup=fs.readFileSync(path.join(root,'Setup.gs'),'utf8');
 for(const name of ['origin','source_calendar_ids','main_calendar_id','options_calendar_id'])if(!setup.includes("['"+name+"','',"))throw new Error('release_personal_default:'+name);
 return {public_files:files.length,files,distribution:'new-history allowlist; excludes .planning, legacy source, personal settings, credentials and reports'};
}
if(require.main===module){try{console.log(JSON.stringify(audit(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={audit,PUBLIC_FILES};
