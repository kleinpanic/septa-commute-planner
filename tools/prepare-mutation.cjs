/* Stryker parses JavaScript extensions. Copies are byte-identical derived inputs. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.mutation-src');fs.mkdirSync(dir,{recursive:true});
for(const file of ['Core.gs','Planner.gs','Setup.gs'])fs.copyFileSync(path.join(root,file),path.join(dir,file.replace(/\.gs$/,'.js')));
