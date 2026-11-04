#!/usr/bin/env node
/** Run actual registration in an isolated native host. All model/process/tool operations are stubbed by tests. */
import {mkdtemp,mkdir,cp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(join(tmpdir(),'router-native-'));
const work=join(temporary,'jev-model-router');await mkdir(work);
const reports=join(root,'test-results');await mkdir(reports,{recursive:true});
const log=join(reports,`${new Date().toISOString().replaceAll(':','-')}-native.log`);
try {
 for(const folder of ['hooks','catalog','types'])await cp(join(root,folder),join(work,folder),{recursive:true});
 await writeFile(join(work,'README.md'),'# Isolated native contracts\n\nThis temporary test plugin copies the actual router modules and supplies clearly synthetic catalog approvals and external enforcement facts. Its native tests stub all external model, tool and process operations. It is not a production plugin, must not be loaded interactively, and establishes no provider compatibility or workload quality.\n');
 await mkdir(join(work,'.claude-plugin'));await mkdir(join(work,'tests'));
 const manifest=JSON.parse(await readFile(join(root,'.claude-plugin/plugin.json'),'utf8'));
 await writeFile(join(work,'.claude-plugin/plugin.json'),JSON.stringify(manifest));
 await writeFile(join(work,'hooks/hooks.json'),JSON.stringify({modules:['./native-entry.ts']}));
 const data=JSON.parse(await readFile(join(root,'tests/fixtures/v2-decisions.json'),'utf8'));
 await writeFile(join(work,'hooks/native-data.ts'),`// Clearly synthetic qualification; never distributed as production approvals.\nexport default JSON.parse(${JSON.stringify(JSON.stringify(data))})\n`);
 await writeFile(join(work,'hooks/native-entry.ts'),`import type {Register} from 'claude-code'
import {registerWithAdapters} from './jev-model-router.ts'
import data from './native-data.ts'
import type {HarnessState} from './v2/harness.ts'
import {workflowCheckpoint} from './v2/review-harness.ts'
import production from '../catalog/model-data.ts'
import {parseCatalogV2} from './model-catalog.ts'
import {configuredPolicy,runtimeCatalog} from './v2/policy-data.ts'
export const register:Register=(on,options)=>{
 let runtime:HarnessState
 const sample=data.cases[0].snapshot
 const reviewer=data.synthetic.catalog.configurations.find(c=>c.modelId==='syn-astra')!.id
 registerWithAdapters(on,{...options,provider:'typesafe',typesafeApiKey:'synthetic-not-a-key',typesafeBaseUrl:'https://invalid.example',policyEngine:'v2',reviewMode:'automatic',routeMainModel:true}, {
  ...data.synthetic,onRuntimeReady:state=>{runtime=state},
  facts:async(request,native)=>({...native,routingAvailable:request.model!=='unsupported',modelOrigin:'inherited',effortOrigin:'inherited',requirements:sample.requirements,environment:sample.environment,resources:sample.resources}),
  workflow:{repairConfiguration:async()=>data.synthetic.catalog.configurations.find(c=>c.modelId==='syn-sonnet'&&c.effort.kind==='level'&&c.effort.value==='medium')!.id,configuration:async()=>({reviewerConfigurationId:reviewer,requireReview:false,requiredCheckIds:[],distinctFamily:true,authorFamily:'claude'}),
   authorize:async r=>({...r,origin:r.source==='user-command'?'composer':'trusted-coordinator',standing:true,allowedTools:['Read','Grep','Glob'],modelAllowance:{maxCalls:1,maxTokens:1000,timeoutMs:1000}})}
 })
 on('command.run',{command:'native-default-workflow'},async()=>{
  runtime.config.catalog=runtimeCatalog(parseCatalogV2(production));runtime.config.policy=configuredPolicy({},runtime.config.catalog)
  runtime.config.providerPolicies={claude:configuredPolicy({},runtime.config.catalog,'claude'),gpt:configuredPolicy({},runtime.config.catalog,'gpt')}
  if(runtime.config.adapters){delete runtime.config.adapters.workflow;delete runtime.config.adapters.facts}
  return {text:'native default workflow active'}
 })
 on('command.run',{command:'native-checkpoint'},async($,e)=>{
  const [candidateId,stage]=e.args.split(' ')
  const c=await workflowCheckpoint($,runtime,{candidateId,stage:stage as 'full'|'repair'|'targeted',source:'workflow-checkpoint',authorizationRef:'synthetic-standing'})
  return {text:JSON.stringify(c)}
 })
}
`);
 const suites=(await readdir(join(root,'tests/native-v2'))).filter(f=>f.endsWith('.test.ts')).sort();
 if(!suites.length)throw Error('native contract suite is empty');
 for(const file of (await readdir(join(root,'tests/native-v2'))).filter(f=>f.endsWith('.ts')))await cp(join(root,'tests/native-v2',file),join(work,'tests',file));
 const output=[];
 for(const args of [['plugin','validate',work],['plugin','test',work]]){
  const result=spawnSync('claude',args,{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
  output.push(result.stdout??'',result.stderr??'');
  if(result.error||result.status!==0){await writeFile(log,output.join('\n'));process.stderr.write(output.join('\n'));throw result.error??Error(`Native ${args[1]} failed (${result.status}); log: ${log}`)}
 }
 await writeFile(log,output.join('\n'));console.log(output.join('\n'));console.log(`Native log: ${log}`);
} finally {await rm(temporary,{recursive:true,force:true})}
