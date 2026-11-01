#!/usr/bin/env node
/** Explicitly live: bounded CLI probes with existing credentials, no installs or saved settings writes. */
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{'confirm-live':{type:'boolean'},'tool-loop':{type:'boolean'},subagent:{type:'boolean'},'subagent-effort':{type:'boolean'},greeting:{type:'boolean'},role:{type:'string'}}});
if(!values['confirm-live'])throw Error('This spends real model/classifier allowance. Pass --confirm-live only after approval.');
const roleProbes={
 explanation:{option:'explanationModel',model:'claude-sonnet-5-5',effort:'medium',prompt:'Explain the C4 model in software development in two sentences. No tools or files.'},
 writing:{option:'writingModel',model:'gpt-6.1-terra',effort:'medium',prompt:'Draft a short customer email announcing a two-day delivery delay and the revised schedule. Do not create files.'},
 summarization:{option:'structuredTextModel',model:'gpt-6-luna',effort:'low',prompt:'Summarize these notes in one sentence without adding facts: Build A failed; retry B passed; release remains scheduled for Friday. No tools.'},
 translation:{option:'structuredTextModel',model:'gpt-6-luna',effort:'low',prompt:'Translate into Spanish: The meeting starts at noon. Return only the translation. No tools.'},
 extraction:{option:'structuredTextModel',model:'gpt-6-luna',effort:'low',prompt:'Extract JSON with name and date from: Mira signed on 2026-10-12. Return only the JSON. No tools or files.'},
 'data-analysis':{option:'analysisModel',model:'claude-sonnet-5-5',effort:'medium',prompt:'For the series 20, 30, 45, calculate successive percentage growth and explain the quantitative trend. No tools or code.'},
 planning:{option:'planningModel',model:'claude-opus-5-5',effort:'medium',prompt:'Propose a three-step plan for adding a user-facing CSV export. Do not implement anything, delegate or use tools.'},
 research:{option:'researchModel',model:'gpt-6.1-terra',effort:'medium',prompt:'Research the current official TypeSafe Choice option-count limit and cite the source. Do not edit files.'},
 operations:{option:'operationsModel',model:'gpt-6.1-terra',effort:'medium',bash:true,prompt:'Run exactly the Bash command printf ROUTER_TOOL_OK once. Do not author code, use other tools or edit files. Then reply only ROUTER_TOOL_OK.'},
};
if(values.role!==undefined&&!Object.hasOwn(roleProbes,values.role))throw Error('Unknown role probe; choose '+Object.keys(roleProbes).join(', '));
const root=fileURLToPath(new URL('../',import.meta.url));
const toolLoop=!!values['tool-loop'],subagent=!!values.subagent,subagentEffort=!!values['subagent-effort'],greeting=!!values.greeting,probe=values.role?roleProbes[values.role]:null;
if(subagentEffort&&!subagent)throw Error('--subagent-effort requires --subagent');
if(Number(toolLoop)+Number(subagent)+Number(greeting)+Number(!!probe)>1)throw Error('Choose one live case at a time');
const options={policyEngine:'v2',routeMainModel:true,routeMainEffort:true,routeSubagentModel:subagent,routeSubagentEffort:subagentEffort,reviewMode:'recommend',mechanicalModel:'claude-haiku-5-5',simpleAnswerModel:'claude-haiku-5-5',longHorizonModel:'claude-opus-5-5',logDecisions:true};
if(probe)options[probe.option]=probe.model;
const settings={pluginConfigs:{'jev-model-router':{options}}},env={...process.env,CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1'};delete env.CLAUDECODE;
const started=new Date().toISOString(),id=started.replaceAll(':','-'),logs=join(root,'test-results');await mkdir(logs,{recursive:true});
const prompt=probe?.prompt??(greeting?'Yo':subagent?'Use exactly one router-probe subagent in the foreground (run_in_background=false). Its entire task is to count the letters in cat and return only 3, with no tools or further agents. Wait for its result, then return only 3.':toolLoop?'Run exactly the Bash command printf ROUTER_TOOL_OK once. Do not use other tools or edit files. Then reply only ROUTER_TOOL_OK.':"Mechanical exact replacement: in the literal text 'red', replace red with blue. Return only blue. No tools or files.");
const bash=toolLoop||probe?.bash===true;
const extra=subagent?['--agents',JSON.stringify({'router-probe':{description:'Isolated single-answer routing probe',prompt:'Count the letters in cat and reply only 3. No tools, no delegation.',tools:[],model:'claude-opus-5-5',effort:subagentEffort?'high':'medium',maxTurns:1}}),'--allowedTools','Agent']:bash?['--allowedTools','Bash(printf *)']:[];
const result=spawnSync('claude',['--plugin-dir',root,'--strict-mcp-config','--setting-sources','user','--settings',JSON.stringify(settings),'--model',greeting||probe?'gpt-6.1-sol':'claude-opus-5-5','--effort',greeting||probe?'high':'medium','--permission-mode','dontAsk','--tools',subagent?'Agent':bash?'Bash':'',...extra,'--max-budget-usd','1','--session-id',randomUUID(),'--debug-file',join(logs,`${id}-live-debug.log`),'--output-format','json','-p',prompt],{cwd:root,env,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
const raw=result.stdout??'',errors=result.stderr??'';await writeFile(join(logs,`${id}-live-cli.log`),raw+'\n'+errors);
let response;for(const line of raw.split('\n'))try{const v=JSON.parse(line);if(v.type==='result')response=v}catch{}
const models=Object.keys(response?.modelUsage??{}),debug=await readFile(join(logs,`${id}-live-debug.log`),'utf8').catch(()=>'');
const effortApplied=probe?debug.includes(`[router] ${values.role} · ${probe.model} · effort ${probe.effort} · v2`):!(subagentEffort||greeting)||debug.includes('[router] simple-answer · claude-haiku-5-5 · effort low · v2');
const answerCorrect=bash?response?.result?.trim()==='ROUTER_TOOL_OK':greeting||probe?typeof response?.result==='string'&&!!response.result.trim():response?.result?.trim()===(subagent?'3':'blue');
const modelCorrect=probe?models.length===1&&models[0]===probe.model:toolLoop?models.length===1:models.includes('claude-haiku-5-5');
const passed=effortApplied&&result.status===0&&!result.error&&response?.is_error!==true&&answerCorrect&&modelCorrect&&(!bash||response?.num_turns>=2)&&(!subagent||response?.subagent_stats?.spawned===1)&&!response?.permission_denials?.length;
const report={startedAt:started,engine:'v2',case:values.role??(greeting?'greeting':subagentEffort?'subagent-effort':subagent?'subagent':toolLoop?'tool-loop':'literal'),scope:probe?'routing probe, not workload-quality validation':'bounded integration probe',cliExit:result.status,answer:response?.result??null,reportedModels:models,turns:response?.num_turns??null,subagents:response?.subagent_stats?.spawned??0,effortApplied,totalCostUsd:response?.total_cost_usd??null,passed,log:join(logs,`${id}-live-cli.log`)};
await writeFile(join(logs,`${id}-live-cli.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=passed?0:1;
