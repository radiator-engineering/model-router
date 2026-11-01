#!/usr/bin/env node
/** Explicitly live: one bounded CLI request using existing credentials/settings; no installs or settings writes. */
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.slice(2).some(a=>!['--confirm-live','--tool-loop','--subagent','--subagent-effort','--greeting'].includes(a))||!process.argv.includes('--confirm-live'))throw Error('This spends real model/classifier allowance. Run node scripts/test-v2-live.mjs --confirm-live only after approval.');
const toolLoop=process.argv.includes('--tool-loop'),subagent=process.argv.includes('--subagent'),subagentEffort=process.argv.includes('--subagent-effort'),greeting=process.argv.includes('--greeting');
if(subagentEffort&&!subagent)throw Error('--subagent-effort requires --subagent');
if(Number(toolLoop)+Number(subagent)+Number(greeting)>1)throw Error('Choose one live case at a time');
const settings={pluginConfigs:{'jev-model-router':{options:{policyEngine:'v2',routeMainModel:true,routeMainEffort:true,routeSubagentModel:subagent,routeSubagentEffort:subagentEffort,reviewMode:'recommend',mechanicalModel:'claude-haiku-5-5',simpleAnswerModel:'claude-haiku-5-5',logDecisions:true}}}};
const env={...process.env,CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1'};delete env.CLAUDECODE;
const started=new Date().toISOString(),id=started.replaceAll(':','-'),logs=join(root,'test-results');await mkdir(logs,{recursive:true});
const prompt=greeting?'Yo':subagent?'Use exactly one router-probe subagent in the foreground (run_in_background=false). Its entire task is to count the letters in cat and return only 3, with no tools or further agents. Wait for its result, then return only 3.':toolLoop?'Run exactly the Bash command printf ROUTER_TOOL_OK once. Do not use other tools or edit files. Then reply only ROUTER_TOOL_OK.':"Mechanical exact replacement: in the literal text 'red', replace red with blue. Return only blue. No tools or files.";
const extra=subagent?['--agents',JSON.stringify({'router-probe':{description:'Isolated single-answer routing probe',prompt:'Count the letters in cat and reply only 3. No tools, no delegation.',tools:[],model:'claude-opus-5-5',effort:subagentEffort?'high':'medium',maxTurns:1}}),'--allowedTools','Agent']:toolLoop?['--allowedTools','Bash(printf *)']:[];
const result=spawnSync('claude',['--plugin-dir',root,'--strict-mcp-config','--setting-sources','user','--settings',JSON.stringify(settings),'--model',greeting?'gpt-6.1-sol':'claude-opus-5-5','--effort',greeting?'high':'medium','--permission-mode','dontAsk','--tools',subagent?'Agent':toolLoop?'Bash':'',...extra,'--max-budget-usd','1','--session-id',randomUUID(),'--debug-file',join(logs,`${id}-live-debug.log`),'--output-format','json','-p',prompt],{cwd:root,env,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
const raw=result.stdout??'',errors=result.stderr??'';
await writeFile(join(logs,`${id}-live-cli.log`),raw+'\n'+errors);
let response;for(const line of raw.split('\n')){try{const v=JSON.parse(line);if(v.type==='result')response=v}catch{}}
const models=Object.keys(response?.modelUsage??{});
const debug=await readFile(join(logs,`${id}-live-debug.log`),'utf8').catch(()=>'');
const effortApplied=!(subagentEffort||greeting)||debug.includes('[router] simple-answer · claude-haiku-5-5 · effort low · v2');
const passed=effortApplied&&result.status===0&&!result.error&&response?.is_error!==true&&(greeting?typeof response?.result==='string'&&response.result.trim().length>0:response?.result?.trim()===(subagent?'3':toolLoop?'ROUTER_TOOL_OK':'blue'))&&(toolLoop?models.length===1&&response?.num_turns>=2:models.includes('claude-haiku-5-5'))&&(!subagent||response?.subagent_stats?.spawned===1)&&!(response?.permission_denials?.length);
const report={startedAt:started,engine:'v2',case:greeting?'greeting':subagentEffort?'subagent-effort':subagent?'subagent':toolLoop?'tool-loop':'literal',cliExit:result.status,answer:response?.result??null,reportedModels:models,turns:response?.num_turns??null,subagents:response?.subagent_stats?.spawned??0,effortApplied,totalCostUsd:response?.total_cost_usd??null,passed,log:join(logs,`${id}-live-cli.log`)};
await writeFile(join(logs,`${id}-live-cli.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));process.exitCode=passed?0:1;
