import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { SchoolService } from '../../src/server/school-service.ts';
import { FileSchoolRepository } from '../../src/server/repository.ts';
import { CodexMentorProvider, DemoMentorProvider } from '../../src/server/providers.ts';
import type { ProcessRunner } from '../../src/server/providers.ts';
import { SchoolError } from '../../src/server/errors.ts';
import { createSchoolServer } from '../../src/server/http.ts';
import type { MatrixOutcome, MatrixScaleProof } from '../../src/integrations/matrix-client.ts';

const position={x:1,y:0,z:2}, transform={position,rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const descriptor={kind:'block-scale',version:1,assetId:'block',supportedRoomModes:['white-room'],actions:['configure','reset'],requiresOperatorApply:true};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(t:test.TestContext){
  const directory=mkdtempSync(join(tmpdir(),'school-scale-'));
  let repository=new FileSchoolRepository(directory);
  const state={revision:4,claims:0,sent:[] as any[],outcomes:new Map<string,MatrixOutcome>(),failSend:false,failCancel:false,failGet:false,onScene:undefined as (()=>void)|undefined,onSend:undefined as (()=>void|Promise<void>)|undefined,
    descriptor:descriptor as unknown, snapshot:{roomContext:{mode:'white-room',state:'ready'},scene:{schemaVersion:1,roomId:'private-room',objects:[] as any[]},assets:[{assetId:'block',spawnScale:1}],anchors:[{anchorId:'floor',source:'virtual'}],selection:{anchorId:'floor',objectId:'',position}} as any};
  const fetcher:typeof fetch=async(input,init={})=>{
    const path=new URL(String(input)).pathname;
    if(path.endsWith('/discovery'))return json({protocolVersion:'1',service:'matrix-loading-operator',transport:'local-companion',pairingAvailable:true,capabilities:{'scene.read':true,'scene.propose_text':{modes:['offline-rules'],requiresOperatorApply:true},'request.read':true,'request.cancel_before_apply':true,'experiment.block-scale.v1':state.descriptor}});
    if(path.endsWith('/sessions')){state.claims++;return json({protocolVersion:'1',sessionId:`pair-${state.claims}`,runtimeSessionId:`runtime-${state.claims}`,clientToken:`private-token-${state.claims}-secret`,expiresInSeconds:3600});}
    const binding=/private-token-(\d+)-secret/.exec(new Headers(init.headers).get('Authorization')!)![1];
    const sessionId=`pair-${binding}`,runtimeSessionId=`runtime-${binding}`;
    if(path.endsWith('/scene')){state.onScene?.();return json({protocolVersion:'1',sessionId,runtimeSessionId,revision:state.revision,snapshot:state.snapshot,runtime:null});}
    if(path==='/api/v1/requests'){
      const body=JSON.parse(String(init.body));state.sent.push(body);assert.deepEqual(body.expected,{runtimeSessionId,revision:state.revision});
      let proposal:any={commands:[{op:'spawn',assetId:'block',anchorId:'floor',transform}]};
      let experiment:MatrixOutcome['experiment'];
      if(body.intent.kind==='block-scale'){
        const intent=body.intent, previous=intent.baselineRequestId?state.outcomes.get(intent.baselineRequestId)!.experiment:undefined;
        const baseline=previous?structuredClone(previous.baseline):{roomId:'private-room',objectId:'school-block',assetId:'block' as const,anchorId:'floor',transform:structuredClone(state.snapshot.scene.objects[0].transform)};
        const factors=intent.factors??{x:1,y:1,z:1},expectedTransform=structuredClone(baseline.transform);
        for(const axis of ['x','y','z'] as const)expectedTransform.scale[axis]*=factors[axis];
        const proof:MatrixScaleProof={action:intent.action,baseline,factors,expectedTransform};
        const metadata={...proof,capability:'experiment.block-scale.v1' as const,version:1 as const,interpretation:'Private-server-detail'};
        proposal={commands:[{op:'set_transform',objectId:'school-block',transform:expectedTransform}],experiment:metadata};
        experiment={...metadata,observation:null,observationState:'not-confirmed'};
      }
      const result:MatrixOutcome={protocolVersion:'1',sessionId,runtimeSessionId,requestId:body.requestId,correlationId:body.correlationId,sequence:1,status:'ready',requiresApply:true,proposal,commandIds:[],receipts:[],observed:null,error:null,...(experiment?{experiment}:{})};
      state.outcomes.set(body.requestId,result);await state.onSend?.();if(state.failSend)throw Error('private-network-error');return json(result);
    }
    const match=/\/requests\/([^/]+)(\/cancel)?$/.exec(path)!;const outcome=state.outcomes.get(match[1]);
    if(!outcome||outcome.sessionId!==sessionId)return json({protocolVersion:'1',code:'request_not_found'},404);
    if(match[2]){if(state.failCancel)throw Error('private-cancel-error');if(outcome.status==='ready')Object.assign(outcome,{status:'cancelled',sequence:outcome.sequence+1,requiresApply:false});}
    else if(state.failGet)throw Error('private-get-error');
    return json(outcome);
  };
  let service=new SchoolService(repository,new DemoMentorProvider(0),{matrix:{fetch:fetcher}});
  t.after(()=>{service.close();assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));rmSync(directory,{recursive:true,force:true});});
  const sessionId=service.start({requestId:randomUUID(),mentorId:'galileo',lessonId:'observation-and-scale'}).session.id;
  const current=()=>service.session(sessionId).session;
  const pair=()=>service.matrix.pair(sessionId,{requestId:randomUUID(),expectedRevision:current().revision,url:'http://127.0.0.1:18889',pairingCode:'private-one-use-code'});
  const body=(extra:Record<string,unknown>={})=>({requestId:randomUUID(),expectedRevision:current().revision,bindingId:current().matrix!.activeBindingId,expectedMatrixRevision:state.revision,demonstrationId:current().matrix!.demonstrations[0].id,action:'configure',factors:{x:2,y:2,z:2},...extra});
  const succeed=(id:string)=>{
    const item=state.outcomes.get(id)!, command=(item.proposal!.commands as any[])[0];
    const target={objectId:'school-block',assetId:'block',anchorId:'floor',transform:structuredClone(command.transform)};
    state.snapshot.scene.objects=[target];state.revision++;
    Object.assign(item,{status:'succeeded',sequence:item.sequence+1,requiresApply:false,commandIds:[`cmd-${id}`],receipts:[{requestId:`cmd-${id}`,ok:true,error:'',objectId:'school-block'}],observed:{revision:state.revision,snapshot:structuredClone(state.snapshot)}});
    if(item.experiment){const f=item.experiment.factors;item.experiment.observationState='confirmed';item.experiment.observation={source:'acknowledged-runtime-transform',revision:state.revision,relativeFactors:structuredClone(f),mathematicalVolumeRatio:f.x*f.y*f.z,units:'dimensionless ratio',physicalMeasurement:false};}
  };
  const placed=async()=>{await pair();const result=await service.matrix.request(sessionId,{requestId:randomUUID(),expectedRevision:current().revision,bindingId:current().matrix!.activeBindingId,expectedMatrixRevision:state.revision});succeed(result.demonstration!.id);await service.matrix.poll(sessionId,result.demonstration!.id);};
  return{state,directory,sessionId,current,pair,body,succeed,placed,get service(){return service;},get repository(){return repository;},restart(){service.close();repository=new FileSchoolRepository(directory);service=new SchoolService(repository,new DemoMentorProvider(0),{matrix:{fetch:fetcher}});}};
}
const code=(expected:string)=>(error:unknown)=>error instanceof SchoolError&&error.code===expected;

test('confirmed placement permits reviewed scale, original baseline chaining and separate reset; lesson and historical evidence unchanged',async t=>{
  const f=fixture(t);await f.placed();const original=structuredClone(f.current().matrix!.demonstrations[0]),before=f.current();
  const ready=await f.service.matrix.status(f.sessionId);assert.equal(ready.bridge.scale.available,true);
  const body=f.body(), result=await f.service.matrix.requestScale(f.sessionId,body);assert.equal(result.experiment!.status,'ready');assert.equal(result.experiment!.observed,null);assert.equal(result.experiment!.requiresApply,true);
  await f.service.matrix.requestScale(f.sessionId,body);assert.equal(f.state.sent.length,2);
  f.succeed(body.requestId);const checked=await f.service.matrix.pollScale(f.sessionId,body.requestId);assert.equal(checked.experiment!.observed!.mathematicalVolumeRatio,8);
  const second=f.body({factors:{x:2,y:.5,z:1}});await f.service.matrix.requestScale(f.sessionId,second);assert.equal(f.state.sent.at(-1).intent.baselineRequestId,body.requestId);f.succeed(second.requestId);await f.service.matrix.pollScale(f.sessionId,second.requestId);
  const reset=f.body({action:'reset',factors:undefined,baselineExperimentId:second.requestId});delete (reset as Record<string,unknown>).factors;
  await f.service.matrix.requestScale(f.sessionId,reset);f.succeed(reset.requestId);await f.service.matrix.pollScale(f.sessionId,reset.requestId);
  assert.deepEqual(f.current().matrix!.experiments!.map(item=>item.observed?.mathematicalVolumeRatio),[8,1,1]);
  assert.deepEqual(f.current().matrix!.demonstrations[0],original);assert.equal(f.current().stage,before.stage);assert.deepEqual(f.current().artifact,before.artifact);
  const count=f.current().messages.length;await f.service.matrix.pollScale(f.sessionId,reset.requestId);assert.equal(f.current().messages.length,count);
  const saved=readFileSync(join(f.directory,'school-store.json'),'utf8');for(const privateValue of ['private-token','private-one-use-code','Private-server-detail','selection','roomContext'])assert.equal(saved.includes(privateValue),false);
  f.restart();assert.equal(f.current().matrix!.experiments!.at(-1)!.observed!.mathematicalVolumeRatio,1);assert.equal((await f.service.matrix.status(f.sessionId)).bridge.scale.available,false);
});

test('missing capability, AR, replaced/deleted/moved block and active behavior reject without dispatch',async t=>{
  const f=fixture(t);await f.placed();const original=structuredClone(f.state.snapshot);
  const mutations=[()=>{f.state.descriptor=false;},()=>{f.state.snapshot.roomContext.mode='ar';},()=>{f.state.snapshot.scene.roomId='different-room';},()=>{f.state.snapshot.scene.objects=[];},()=>{f.state.snapshot.scene.objects[0].transform.position.x=5;},()=>{f.state.snapshot.scene.objects[0].behaviors=[{enabled:true}];},()=>{f.state.snapshot.assets[0].source='imported';}];
  for(const mutate of mutations){f.state.snapshot=structuredClone(original);f.state.descriptor=descriptor;mutate();assert.equal((await f.service.matrix.status(f.sessionId)).bridge.scale.available,false);await assert.rejects(f.service.matrix.requestScale(f.sessionId,f.body()),code('matrix_not_ready'));}
  assert.equal(f.state.sent.length,1);
});

test('pending and uncertain requests gate placement and scale globally; cancellation reconciles original request',async t=>{
  const f=fixture(t);await f.placed();f.state.failSend=true;const body=f.body();const result=await f.service.matrix.requestScale(f.sessionId,body);assert.equal(result.experiment!.status,'unconfirmed');
  await f.service.matrix.requestScale(f.sessionId,body);assert.equal(f.state.sent.length,2);
  await assert.rejects(f.service.matrix.requestScale(f.sessionId,f.body()),code('demonstration_pending'));
  await assert.rejects(f.service.matrix.request(f.sessionId,{requestId:randomUUID(),expectedRevision:f.current().revision,bindingId:f.current().matrix!.activeBindingId,expectedMatrixRevision:f.state.revision}),code('demonstration_pending'));
  f.state.failSend=false;assert.equal((await f.service.matrix.pollScale(f.sessionId,body.requestId)).experiment!.status,'ready');
  const cancellation={requestId:randomUUID()};assert.equal((await f.service.matrix.cancelScale(f.sessionId,body.requestId,cancellation)).experiment!.status,'cancelled');await f.service.matrix.cancelScale(f.sessionId,body.requestId,cancellation);
  assert.equal((await f.service.matrix.status(f.sessionId)).bridge.scale.available,true);
});

test('restart retains uncertain intent and new pairing cannot adopt old scale request',async t=>{
  const f=fixture(t);await f.placed();const body=f.body();await f.service.matrix.requestScale(f.sessionId,body);f.restart();assert.equal(f.current().matrix!.experiments![0].status,'unconfirmed');await f.pair();
  assert.equal((await f.service.matrix.pollScale(f.sessionId,body.requestId)).experiment!.status,'unconfirmed');assert.match((await f.service.matrix.pollScale(f.sessionId,body.requestId)).experiment!.checkError!,/original pairing/);
  await f.service.matrix.requestScale(f.sessionId,body);assert.equal(f.state.sent.length,2);await assert.rejects(f.service.matrix.requestScale(f.sessionId,f.body()),code('demonstration_pending'));
  assert.doesNotThrow(()=>f.service.experiment(f.sessionId,{requestId:randomUUID(),expectedRevision:f.current().revision,dimensions:[2,1,1]}));
});

test('stale School during readiness, stale Matrix revision, wrong demo and invalid factors are rejected before reserve',async t=>{
  const f=fixture(t);await f.placed();const body=f.body();f.state.onScene=()=>{f.state.onScene=undefined;f.service.experiment(f.sessionId,{requestId:randomUUID(),expectedRevision:f.current().revision,dimensions:[2,1,1]});};
  await assert.rejects(f.service.matrix.requestScale(f.sessionId,body),code('stale_revision'));
  await assert.rejects(f.service.matrix.requestScale(f.sessionId,f.body({expectedMatrixRevision:0})),code('matrix_revision_changed'));
  await assert.rejects(f.service.matrix.requestScale(f.sessionId,f.body({demonstrationId:'unrelated'})),code('matrix_not_ready'));
  for(const factors of [{x:NaN,y:1,z:1},{x:true,y:1,z:1},{x:5,y:1,z:1},{x:1,y:1,z:1,w:2}])await assert.rejects(f.service.matrix.requestScale(f.sessionId,f.body({factors})),code('invalid_request'));
  assert.equal(f.state.sent.length,1);
});

test('generic command success without experiment observation remains unconfirmed; forged proof and changed historical evidence are rejected',async t=>{
  const f=fixture(t);await f.placed();const body=f.body();await f.service.matrix.requestScale(f.sessionId,body);f.succeed(body.requestId);const outcome=f.state.outcomes.get(body.requestId)!;const good=structuredClone(outcome);
  outcome.experiment!.observation=null;outcome.experiment!.observationState='unconfirmed';assert.equal((await f.service.matrix.pollScale(f.sessionId,body.requestId)).experiment!.status,'unconfirmed');
  Object.assign(outcome,good);outcome.sequence++;const confirmed=await f.service.matrix.pollScale(f.sessionId,body.requestId);assert.equal(confirmed.experiment!.observed!.mathematicalVolumeRatio,8);
  outcome.sequence++;outcome.experiment!.observation!.mathematicalVolumeRatio=99;const preserved=await f.service.matrix.pollScale(f.sessionId,body.requestId);assert.equal(preserved.experiment!.status,'succeeded');assert.deepEqual(preserved.experiment!.observed,confirmed.experiment!.observed);assert.ok(preserved.experiment!.checkError);
});

test('durable reservation failure sends nothing; failed result save is flushed without replay',async t=>{
  const f=fixture(t);await f.placed();const mutate=f.repository.mutate.bind(f.repository);f.repository.mutate=()=>{throw new SchoolError(500,'persistence_failed','fixture');};const body=f.body();
  await assert.rejects(f.service.matrix.requestScale(f.sessionId,body),code('persistence_failed'));assert.equal(f.state.sent.length,1);f.repository.mutate=mutate;
  f.state.onSend=()=>{f.repository.mutate=()=>{throw new SchoolError(500,'persistence_failed','fixture');};};
  await assert.rejects(f.service.matrix.requestScale(f.sessionId,body),code('persistence_failed'));assert.equal(f.state.sent.length,2);f.repository.mutate=mutate;f.state.onSend=undefined;
  assert.equal((await f.service.matrix.requestScale(f.sessionId,body)).experiment!.status,'ready');assert.equal(f.state.sent.length,2);
});

test('experiment API routes preserve idempotence and local-origin boundary',async t=>{
  const f=fixture(t);await f.placed();const server=createSchoolServer({service:f.service});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());const port=(server.address() as {port:number}).port,base=`http://127.0.0.1:${port}/api/v1/sessions/${f.sessionId}/matrix/experiments`,body=f.body();
  let result=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(result.status,200);assert.equal((await result.json()).experiment.status,'ready');
  result=await fetch(base+'/'+body.requestId);assert.equal((await result.json()).experiment.id,body.requestId);
  result=await fetch(base+'/'+body.requestId+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID()})});assert.equal((await result.json()).experiment.status,'cancelled');
  result=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.invalid'},body:JSON.stringify(f.body())});assert.equal(result.status,403);
});

test('legacy virtual snapshots work, while old placement records without room identity remain readable but cannot scale',async t=>{
  const f=fixture(t);delete f.state.snapshot.roomContext;await f.placed();assert.equal((await f.service.matrix.status(f.sessionId)).bridge.scale.available,true);
  f.repository.mutate(store=>{delete store.sessions[f.sessionId].matrix!.demonstrations[0].observed!.roomId;});
  const result=await f.service.matrix.status(f.sessionId);assert.equal(result.bridge.scale.available,false);assert.match(result.bridge.scale.reason,/older placement/);
  await assert.rejects(f.service.matrix.requestScale(f.sessionId,f.body()),code('matrix_not_ready'));f.restart();assert.equal(f.current().matrix!.demonstrations[0].status,'succeeded');
});

test('concurrent repeated request reads reserved intent while another action cannot overtake dispatch',async t=>{
  const f=fixture(t);await f.placed();let started!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>started=resolve),hold=new Promise<void>(resolve=>release=resolve);
  f.state.onSend=()=>{started();return hold;};const body=f.body(),pending=f.service.matrix.requestScale(f.sessionId,body);await entered;
  assert.equal((await f.service.matrix.requestScale(f.sessionId,body)).experiment!.status,'submitting');
  await assert.rejects(f.service.matrix.requestScale(f.sessionId,f.body()),code('bridge_busy'));assert.equal(f.state.sent.length,2);
  release();assert.equal((await pending).experiment!.status,'ready');
});

test('uncertain cancellation is never retried and a changed reset source cannot replace the latest confirmed baseline',async t=>{
  const f=fixture(t);await f.placed();const first=f.body();await f.service.matrix.requestScale(f.sessionId,first);f.succeed(first.requestId);await f.service.matrix.pollScale(f.sessionId,first.requestId);
  const second=f.body({factors:{x:2,y:.5,z:1}});await f.service.matrix.requestScale(f.sessionId,second);f.succeed(second.requestId);await f.service.matrix.pollScale(f.sessionId,second.requestId);
  const reset:Record<string,unknown>=f.body({action:'reset',baselineExperimentId:first.requestId});delete reset.factors;await assert.rejects(f.service.matrix.requestScale(f.sessionId,reset),code('stale_baseline'));
  const next=f.body();await f.service.matrix.requestScale(f.sessionId,next);f.state.failCancel=true;const action={requestId:randomUUID()};assert.equal((await f.service.matrix.cancelScale(f.sessionId,next.requestId,action)).experiment!.status,'unconfirmed');
  f.state.failCancel=false;assert.equal((await f.service.matrix.cancelScale(f.sessionId,next.requestId,action)).experiment!.status,'unconfirmed');assert.equal(f.state.outcomes.get(next.requestId)!.status,'ready');
  assert.equal((await f.service.matrix.pollScale(f.sessionId,next.requestId)).experiment!.status,'ready');
});

test('durable allowlists reject private fields and forged historical scale arithmetic without corrupting saved evidence',async t=>{
  const f=fixture(t);await f.placed();const body=f.body();await f.service.matrix.requestScale(f.sessionId,body);f.succeed(body.requestId);await f.service.matrix.pollScale(f.sessionId,body.requestId);const before=f.current();
  for(const mutate of [(item:any)=>item.clientToken='secret',(item:any)=>item.observed.mathematicalVolumeRatio=900,(item:any)=>item.proof.baseline.roomId='another-room',(item:any)=>item.observed=null,(item:any)=>item.receipts[0].objectId='replacement'])assert.throws(()=>f.repository.mutate(store=>mutate(store.sessions[f.sessionId].matrix!.experiments![0])),code('invalid_store'));
  assert.deepEqual(f.current(),before);
});

test('mentor receives bounded historical scale evidence after transcript truncation and restart, without geometry or private IDs',async t=>{
  const f=fixture(t);await f.placed();const first=f.body();await f.service.matrix.requestScale(f.sessionId,first);f.succeed(first.requestId);await f.service.matrix.pollScale(f.sessionId,first.requestId);
  const second=f.body({factors:{x:4,y:4,z:4}});await f.service.matrix.requestScale(f.sessionId,second);
  f.repository.mutate(store=>{const value=store.sessions[f.sessionId];for(let i=0;i<22;i++)value.messages.push({id:randomUUID(),role:'learner',stage:value.stage,createdAt:new Date().toISOString(),text:'Explain geometry again.'});});f.restart();
  let context:any;const final=JSON.stringify({text:'The earlier virtual transform had ratio eight; the later request remains unconfirmed.'});
  const runner:ProcessRunner=async(_executable,args,options)=>{if(args[0]==='login')return{stdout:'Logged in using ChatGPT',stderr:''};context=JSON.parse(options.input!.slice(options.input!.indexOf('\n')+1));writeFileSync(args[args.indexOf('--output-last-message')+1],final);return{stdout:[{type:'thread.started'},{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:final}},{type:'turn.completed'}].map(value=>JSON.stringify(value)).join('\n'),stderr:''};};
  const provider=new CodexMentorProvider({executable:process.execPath,model:'fixture',runner});const current=f.current();
  await provider.respond({session:current,turn:{id:randomUUID(),requestId:randomUUID(),sessionId:f.sessionId,kind:'question',input:'What happened?',stage:current.stage,status:'running',createdAt:new Date().toISOString()},target:current.stageContent},new AbortController().signal);
  const evidence=context.historicalMatrixEvidence;assert.equal(context.recentMessages.length,18);assert.equal(evidence.lastConfirmedScale.mathematicalVolumeRatio,8);assert.equal(evidence.lastConfirmedScale.physicalMeasurement,false);assert.equal(evidence.latestScaleRequests.at(-1).status,'unconfirmed');assert.equal(evidence.latestScaleRequests.at(-1).mathematicalVolumeRatio,undefined);assert.equal(evidence.latestScaleRequests.at(-1).scaleEvidence,'not-confirmed');
  for(const privateValue of ['private-room','school-block','private-token','floor','baselineExperimentId','expectedTransform','position','http://'])assert.equal(JSON.stringify(evidence).includes(privateValue),false,privateValue);
  assert.match(evidence.scope,/Current connection and object presence have not been checked/);assert.ok(JSON.stringify(evidence).length<3500);
});
