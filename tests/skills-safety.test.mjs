import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {CONTROL_TOOLS,READER_TOOLS} from '../packages/client/dist/control.js';

const skillsDir=new URL('../shared/skills/',import.meta.url),agentsDir=new URL('../shared/claude-agents/',import.meta.url);
async function documents(){
  const docs=[];
  for(const name of (await readdir(skillsDir)).sort())docs.push({name:`skills/${name}`,text:await readFile(new URL(`${name}/SKILL.md`,skillsDir),'utf8')});
  for(const name of (await readdir(agentsDir)).sort())docs.push({name:`claude-agents/${name}`,text:await readFile(new URL(name,agentsDir),'utf8')});
  return docs;
}
// A sentence is a request for a credential when it pairs an asking verb with a credential noun.
const ASK=/\b(ask|asks|asking|request|requests|prompt|collect|obtain|paste|pastes|enter|type|provide|give|share|send)\b/i;
const SECRET=/\b(secrets?|passwords?|passwd|tokens?|api[ _-]?keys?|credentials?|webhooks?|private keys?|cookies?)\b/i;
// ...unless the same sentence refuses it, or routes it to a person in the browser.
const SAFE=/\b(never|not|no|don't|do not|refuse[sd]?|without|instead)\b|zenith_get_handoff|in the browser|on that page|browser hand-?off/i;
const sentences=text=>text.replace(/```[\s\S]*?```/g,' ').split(/(?<=[.!?])\s+|\n\s*[-*|]\s+|\n{2,}/);

test('no skill or agent tells the agent to ask the user for a secret, a password or a token',async()=>{
  const offenders=[];
  for(const {name,text} of await documents())
    for(const sentence of sentences(text))
      if(ASK.test(sentence)&&SECRET.test(sentence)&&!SAFE.test(sentence))offenders.push(`${name}: ${sentence.trim().slice(0,200)}`);
  assert.deepEqual(offenders,[],'Route secret values and provider credentials to zenith_get_handoff instead.');
});

test('the scanner itself catches a request for a secret',()=>{
  for(const bad of ['Ask the user for their API key.','Have them paste the token here.','Request the database password from the user.'])
    assert.ok(sentences(bad).some(s=>ASK.test(s)&&SECRET.test(s)&&!SAFE.test(s)),bad);
  for(const good of ['Never ask the user for a secret value.','Do not ask them to paste a token.','Use zenith_get_handoff so they enter the secret in the browser.'])
    assert.ok(!sentences(good).some(s=>ASK.test(s)&&SECRET.test(s)&&!SAFE.test(s)),good);
});

test('secret, credential and policy work is routed to browser hand-offs by name',async()=>{
  const read=name=>readFile(new URL(`${name}/SKILL.md`,skillsDir),'utf8');
  const secrets=await read('secrets');
  for(const task of ['secret.set','secret.rotate','connection.credentials','alerts.channel'])assert.ok(secrets.includes(`task: "${task}"`),task);
  assert.match(secrets,/Never ask the user for a secret value, password, token or provider credential/);
  assert.match(await read('environments'),/task: "environment.policies"/);
  assert.match(await read('operate'),/task: "deploy.approve"/);
  assert.match(await read('workspace'),/task: "workspace.create"/);
  assert.match(await read('edit'),/secret_value_refused/);
});

test('every Zenith tool a skill or agent names is one the client can serve',async()=>{
  const known=new Set([...CONTROL_TOOLS,...READER_TOOLS]),unknown=[];
  for(const {name,text} of await documents())
    for(const [tool] of text.matchAll(/\bzenith_[a-z_]+\b/g))if(!known.has(tool))unknown.push(`${name}: ${tool}`);
  assert.deepEqual(unknown,[]);
});
