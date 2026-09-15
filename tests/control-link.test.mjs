import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {LINK_PROTOCOL_VERSION} from '../packages/client/dist/index.js';
const {startLink,pollLink,openBrowser,linkOrigin,SCOPE_NAMES}=await tsImport('../packages/control/link.ts',import.meta.url);

const ORIGIN='https://zenith.test';
const DEVICE=`zl_${'A'.repeat(43)}`;
const TOKEN=`za_${'T'.repeat(43)}`;
const START={deviceCode:DEVICE,userCode:'K7QM-3XRB',verificationUri:`${ORIGIN}/agent/link`,verificationUriComplete:`${ORIGIN}/agent/link?code=K7QM-3XRB`,interval:5,expiresIn:600,protocolVersion:LINK_PROTOCOL_VERSION};
const ISSUED={status:'issued',token:TOKEN,credentialId:'cred_1',origin:ORIGIN,workspaceId:'ws_1',projectIds:['prj_a','prj_b'],environmentIds:null,scopes:['read','plan','write','logs'],expiresAt:new Date(Date.now()+7*86400000).toISOString(),label:'tarun-laptop'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

function harness(respond,{expiresIn=600,interval=5}={}){
  let clock=0;const sleeps=[],calls=[],diagnostics=[];
  return {
    sleeps,calls,diagnostics,
    now:()=>clock,
    sleep:async ms=>{sleeps.push(ms);clock+=ms;},
    diagnostic:record=>diagnostics.push(record),
    fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url:String(url),body});return respond(calls.length,body);},
    poll(extra={}){return pollLink({origin:ORIGIN,deviceCode:DEVICE,interval,expiresIn,fetch:this.fetch,sleep:this.sleep,now:this.now,diagnostic:this.diagnostic,...extra});},
  };
}
const start=(respond,extra={})=>startLink({origin:ORIGIN,clientName:'Claude Code',clientVersion:'2.1.4',label:'tarun-laptop',fetch:respond,...extra});

test('start sends the frozen protocol version and returns only validated fields',async()=>{
  let sent;
  const result=await start(async(url,options)=>{sent={url:String(url),body:JSON.parse(options.body),headers:options.headers,redirect:options.redirect,credentials:options.credentials};return json(START,201);});
  assert.equal(sent.url,`${ORIGIN}/api/agent/link/start`);
  assert.equal(sent.body.protocolVersion,LINK_PROTOCOL_VERSION);
  assert.equal(sent.body.clientName,'Claude Code');
  assert.deepEqual(sent.body.requestedScopes,['read','plan','write','logs']);
  assert.equal(sent.redirect,'error');assert.equal(sent.credentials,'omit');
  assert.equal(sent.headers.authorization,undefined);
  assert.equal(result.userCode,'K7QM-3XRB');assert.equal(result.deviceCode,DEVICE);
  assert.equal(result.interval,5);assert.equal(result.expiresIn,600);
});

test('start clamps a hostile interval and expiry instead of trusting them',async()=>{
  const result=await start(async()=>json({...START,interval:100000,expiresIn:999999},201));
  assert.equal(result.interval,30);assert.equal(result.expiresIn,900);
});

test('start refuses a verification URL that points at another origin or drops the code',async()=>{
  for(const change of [{verificationUriComplete:'https://evil.test/agent/link?code=K7QM-3XRB'},{verificationUri:'https://evil.test/agent/link'},{verificationUriComplete:`${ORIGIN}/agent/link`}])
    await assert.rejects(start(async()=>json({...START,...change},201)),{code:'invalid_response'});
});

test('start refuses malformed device and user codes and a different protocol version',async()=>{
  await assert.rejects(start(async()=>json({...START,deviceCode:'zl_short'},201)),{code:'invalid_response'});
  await assert.rejects(start(async()=>json({...START,userCode:'ILOU-1234'},201)),{code:'invalid_response'});
  await assert.rejects(start(async()=>json({...START,protocolVersion:2},201)),{code:'protocol_mismatch'});
});

test('start refuses unknown requested scopes and unusable client descriptors before any request',async()=>{
  const network=()=>assert.fail('network reached');
  await assert.rejects(start(network,{requestedScopes:['read','root']}),{code:'invalid_request'});
  await assert.rejects(start(network,{clientName:'bad\nname'}),{code:'invalid_request'});
  await assert.rejects(start(network,{label:'has spaces'}),{code:'invalid_request'});
  assert.deepEqual([...SCOPE_NAMES],['read','plan','write','logs','export','publish']);
});

test('authorization_pending loops at the server interval and issued ends the loop',async()=>{
  const h=harness(n=>n<3?json({status:'authorization_pending',interval:5}):json(ISSUED));
  const credential=await h.poll();
  assert.equal(h.calls.length,3);
  assert.deepEqual(h.sleeps,[5000,5000,5000]);
  assert.equal(credential.token,TOKEN);
  assert.deepEqual(credential.scopes,['read','plan','write','logs']);
  assert.deepEqual(credential.projectIds,['prj_a','prj_b']);
  assert.equal(credential.label,'tarun-laptop');
  for(const call of h.calls){assert.equal(call.url,`${ORIGIN}/api/agent/link/token`);assert.equal(call.body.protocolVersion,LINK_PROTOCOL_VERSION);}
});

test('slow_down raises the interval and the raised interval is honoured',async()=>{
  const h=harness(n=>n===1?json({status:'slow_down',interval:12}):n===2?json({status:'authorization_pending'}):json(ISSUED));
  await h.poll();
  assert.deepEqual(h.sleeps,[5000,12000,12000]);
});

test('slow_down can never make the client poll faster',async()=>{
  const h=harness(n=>n<=2?json({status:'slow_down',interval:1}):json(ISSUED));
  await h.poll();
  assert.deepEqual(h.sleeps,[5000,6000,7000]);
});

test('access_denied and expired_token are terminal and keep the server explanation',async()=>{
  const denied=harness(()=>json({error:{code:'access_denied',message:'The request was denied in the browser.',requestId:'r1'}},403));
  await assert.rejects(denied.poll(),e=>e.code==='access_denied'&&e.message.includes('denied in the browser'));
  assert.equal(denied.calls.length,1);
  const expired=harness(()=>json({error:{code:'expired_token',message:'This link request expired or was already used.',requestId:'r2'}},410));
  await assert.rejects(expired.poll(),{code:'expired_token'});
  assert.equal(expired.calls.length,1);
});

test('a hostile error body cannot rewrite the terminal or smuggle an unbounded message',async()=>{
  const h=harness(()=>json({error:{code:'ACCESS DENIED; rm -rf /',message:`line\u0000one\u001b[2Jline two ${'x'.repeat(5000)}`}},403));
  await assert.rejects(h.poll(),e=>{
    assert.equal(e.code,'http_403');
    assert.equal(/[\u0000-\u001f]/.test(e.message),false);
    assert.ok(e.message.length<=320);
    return true;
  });
});

test('the deadline ends the loop even while the server keeps saying pending',async()=>{
  const h=harness(()=>json({status:'authorization_pending'}),{interval:30});
  await assert.rejects(h.poll(),{code:'expired_token'});
  assert.equal(h.calls.length,20);
});

test('the hard request cap holds before the deadline when the interval is short',async()=>{
  const h=harness(()=>json({status:'authorization_pending'}),{interval:1,expiresIn:900});
  await assert.rejects(h.poll(),{code:'link_poll_limit'});
  assert.equal(h.calls.length,200);
});
test('an explicit lower request cap is honoured',async()=>{
  const h=harness(()=>json({status:'authorization_pending'}),{interval:1,expiresIn:900});
  await assert.rejects(h.poll({maxRequests:3}),{code:'link_poll_limit'});
  assert.equal(h.calls.length,3);
});

test('the device code never reaches a printed line or a diagnostic record',async()=>{
  const printed=[];
  const h=harness(n=>n<2?json({status:'authorization_pending'}):json(ISSUED));
  await h.poll({onWait:seconds=>{assert.equal(typeof seconds,'number');printed.push(`waiting ${seconds}s`);}});
  assert.ok(h.diagnostics.length>=2);
  for(const record of h.diagnostics){
    assert.deepEqual(Object.keys(record).sort(),['component','durationMs','method','requestId','responseBytes','status']);
    assert.equal(record.component,'zenith-link');
  }
  assert.equal(JSON.stringify(h.diagnostics).includes(DEVICE),false);
  assert.equal(JSON.stringify(h.diagnostics).includes(TOKEN),false);
  assert.equal(printed.join('\n').includes(DEVICE),false);
  // The secret travels in the request body only, never in a URL.
  for(const call of h.calls)assert.equal(call.url.includes(DEVICE),false);
});

test('an issued credential is validated before it can be stored',async()=>{
  const bad=[
    {token:'not-a-token'},
    {token:`za_${'T'.repeat(42)}`},
    {scopes:['plan','write']},
    {scopes:['read','root']},
    {origin:'https://evil.test'},
    {workspaceId:'not a workspace id'},
    {projectIds:[]},
    {expiresAt:new Date(Date.now()-1000).toISOString()},
    {expiresAt:new Date(Date.now()+400*86400000).toISOString()},
    {credentialId:''},
  ];
  for(const change of bad){
    const h=harness(()=>json({...ISSUED,...change}));
    await assert.rejects(h.poll(),{code:'invalid_response'},JSON.stringify(change));
  }
});

test('a non-JSON or oversized link response is refused rather than parsed',async()=>{
  const html=harness(()=>new Response('<html>',{headers:{'content-type':'text/html'}}));
  await assert.rejects(html.poll(),e=>typeof e.code==='string');
  const big=harness(()=>json({...ISSUED,label:'x'.repeat(20000)}));
  await assert.rejects(big.poll(),{code:'response_too_large'});
});

test('a caller abort stops the loop without a credential',async()=>{
  const controller=new AbortController();
  const h=harness(()=>{controller.abort();return json({status:'authorization_pending'});});
  await assert.rejects(h.poll({signal:controller.signal}),{code:'link_cancelled'});
});

test('the origin is validated exactly like every other Zenith destination',()=>{
  assert.equal(linkOrigin('https://tryzenith.cloud'),'https://tryzenith.cloud');
  assert.throws(()=>linkOrigin('http://tryzenith.cloud'),{code:'insecure_endpoint'});
  assert.throws(()=>linkOrigin('https://user:pw@tryzenith.cloud'),{code:'invalid_endpoint'});
  assert.throws(()=>linkOrigin('https://tryzenith.cloud/path'),{code:'invalid_endpoint'});
  assert.equal(linkOrigin('http://127.0.0.1:3400',true),'http://127.0.0.1:3400');
});

test('the browser launcher refuses anything it cannot pass as one safe argument',()=>{
  assert.equal(openBrowser(`${ORIGIN}/agent/link?code=K7QM-3XRB`,'linux',{CI:'1'}),false);
  assert.equal(openBrowser('file:///etc/passwd','linux',{}),false);
  assert.equal(openBrowser('not a url','linux',{}),false);
  assert.equal(openBrowser(`${ORIGIN}/agent/link?code=A&calc`,'win32',{SystemRoot:'C:\\Windows'}),false);
  assert.equal(openBrowser(`${ORIGIN}/agent/link?code=K7QM-3XRB`,'win32',{}),false);
  assert.equal(openBrowser(`${ORIGIN}/${'x'.repeat(600)}`,'linux',{}),false);
});
