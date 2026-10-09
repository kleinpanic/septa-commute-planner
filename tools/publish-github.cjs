/* Explicit allowlisted publication; never push a local Git branch or history. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {audit,PUBLIC_FILES}=require('./privacy-gate.cjs');
const root=path.resolve(__dirname,'..');
function api(endpoint,body){return JSON.parse(execFileSync('gh',['api',endpoint,...(body?['--method','POST','--input','-']:[])],{encoding:'utf8',...(body?{input:JSON.stringify(body)}:{}),maxBuffer:4*1024*1024}));}
function publish(repo){
 if(!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo))throw new Error('repository_invalid');
 const manifest=audit(root),info=api('repos/'+repo);if(info.private!==false)throw new Error('public_destination_required');
 const branch=info.default_branch,ref=api('repos/'+repo+'/git/ref/heads/'+encodeURIComponent(branch));
 const previous=api('repos/'+repo+'/git/trees/'+ref.object.sha+'?recursive=1');
 if(previous.tree.some(e=>e.type==='blob'&&!PUBLIC_FILES.includes(e.path)))throw new Error('destination_has_unmanaged_files');
 const tree=api('repos/'+repo+'/git/trees',{tree:PUBLIC_FILES.map(file=>({path:file,mode:'100644',type:'blob',content:fs.readFileSync(path.join(root,file),'utf8')}))});
 const author={name:repo.split('/')[0],email:repo.split('/')[0]+'@users.noreply.github.com'};
 const commit=api('repos/'+repo+'/git/commits',{message:'Release configurable Google-hosted SEPTA commute planner',tree:tree.sha,parents:[ref.object.sha],author,committer:author});
 execFileSync('gh',['api','repos/'+repo+'/git/refs/heads/'+encodeURIComponent(branch),'--method','PATCH','--input','-'],{encoding:'utf8',input:JSON.stringify({sha:commit.sha,force:false})});
 const persisted=api('repos/'+repo+'/git/trees/'+commit.sha+'?recursive=1').tree.filter(e=>e.type==='blob');assert.deepEqual(persisted.map(e=>e.path).sort(),PUBLIC_FILES.slice().sort());
 for(const f of persisted){const data=fs.readFileSync(path.join(root,f.path));const sha=crypto.createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');assert.equal(f.sha,sha,'public_blob_differs');}
 return {repository:info.html_url,private:false,commit:commit.sha,verified_files:persisted.length,manifest};
}
if(require.main===module){if(process.argv[2]!=='--publish'||!process.argv[3]){console.error('Usage: node tools/publish-github.cjs --publish OWNER/NEW_PUBLIC_REPOSITORY');process.exitCode=2;}else{try{console.log(JSON.stringify(publish(process.argv[3]),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}}
