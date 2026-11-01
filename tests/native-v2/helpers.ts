import {mock} from 'claude-code/testing'
export const step={turnId:'turn',index:0,model:'syn-opus',effort:'medium' as const,messageCount:1}
export const command=(args:string,kind='composer')=>({command:'router',args,origin:{kind},presentation:{isFullscreen:false,columns:80}})
export async function drain(stream:any){const chunks:any[]=[];for(;;){const x=await stream.next();if(x.done)return {chunks,result:x.value};chunks.push(x.value)}}
export async function setup($:any,on:any){
 const clock=mock.clock(on,{now:Date.parse('2026-10-31T12:00:00Z')});const store=new Map<string,any>(),listeners:((v:any)=>void)[]=[]
 on('store.get',(_:any,e:any)=>({value:store.get(e.key)}));on('store.set',(_:any,e:any)=>{store.set(e.key,structuredClone(e.value));for(const fn of listeners)fn(e.value);return {value:undefined}});on('store.delete',(_:any,e:any)=>{store.delete(e.key);return {value:undefined}})
 const files=new Map<string,string>([['/repo/candidate.json',JSON.stringify({schemaVersion:1,baseRevision:'HEAD',files:['artifact'],contextFiles:[],requirements:[{id:'R',text:'Preserve invariant'}],checkIds:[],requireReview:true})],['/repo/artifact','abc']])
 const rows:any[]=[],settings:any={user:{},policy:{}};const calls={http:0,spawn:0,model:0,tools:0};const agents:any[]=[];let model='syn-opus'
 on('session.id',()=>({value:'native-conversation'}));on('session.cwd',()=>({value:'/repo'}));on('session.model',()=>({value:model}));on('session.version',()=>({value:{version:'2.1.316'}}))
 on('settings.read',(_:any,e:any)=>({value:settings[e.source]}));on('config.list',()=>({value:rows}));on('command.register',()=>({value:{command:'router'}}))
 on('fs.read',(_:any,e:any)=>{const text=files.get(e.path);if(text===undefined)throw Error('no fixture file');return {value:e.as==='bytes'?{base64:btoa(text)}:text}})
 on('fs.stat',(_:any,e:any)=>{if(e.path!=='/repo'&&!files.has(e.path))throw Error('ENOENT');return {value:{kind:e.path==='/repo'?'dir':'file',size:files.get(e.path)?.length??0,mtimeMs:0,isLink:false,realPath:e.path}}})
 on('fs.list',()=>({value:[...files.keys()].map(p=>({name:p.slice(6),kind:'file',size:1,mtimeMs:0,isLink:false}))}))
 on('process.run',()=>({value:{exitCode:0,stdout:'a'.repeat(40),stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}))
 on('http.fetch',()=>{calls.http++;return {value:{ok:true,status:200,headers:{},text:JSON.stringify({answers:{role:{choice:'implementation',confidence:.95},specification:{choice:'explicit',confidence:.95},verification:{choice:'executable',confidence:.95},executionSpan:{choice:'bounded',confidence:.95},consequence:{choice:'reversible',confidence:.95}}})}}})
 on('model.classify',()=>{calls.model++;throw Error('unexpected inference')});on('agent.list',()=>({value:agents}))
 on('tool.call',()=>{calls.tools++;return {result:{stdout:'PASS',stderr:'',interrupted:false},isError:false}})
 on('session.start',(_:any,e:any)=>({cwd:e.cwd}));on('prompt.submit',(_:any,e:any)=>({text:e.text}));on('turn.start',(_:any,e:any)=>({turnId:e.turnId}));on('turn.complete',()=>({text:''}))
 return {initialize:()=>$.session.start({surface:'terminal',isInteractive:true,cwd:'/repo'}),rows,settings,store,waitForWrite:(predicate:(v:any)=>boolean)=>{for(const v of store.values())if(predicate(v))return Promise.resolve();return new Promise<void>(resolve=>listeners.push(v=>{if(predicate(v))resolve()}))},clock,files,calls,agents,setModel:(v:string)=>{model=v}}
}
export async function start($:any){await $.prompt.submit({text:'Mechanical change',wait:false,origin:{kind:'composer'}});await $.turn.start({turnId:'turn',text:'Mechanical change'})}
