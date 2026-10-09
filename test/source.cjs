const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function sourcePath(file){return process.env.COMMUTE_MUTATION==='1'?path.join(root,'.mutation-src',file.replace(/\.gs$/,'.js')):path.join(root,file);}
function source(file){return fs.readFileSync(sourcePath(file),'utf8');}
module.exports={source,sourcePath};
