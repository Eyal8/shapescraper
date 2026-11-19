const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const html = fs.readFileSync('src/game.html', 'utf8');
const code = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x => x[1]).find(x => x.includes('window.AgeAssurance ='));
function setup({platform='ios', status='notRequired', range={status:'resolved',minor:false}, allowed=true, error=false}={}) {
  const calls=[];
  const plugin={
    async getRequirements(){ calls.push('requirements'); return {status}; },
    async requestRequiredAgeRange(){ calls.push('range'); return range; },
    async checkAnalyticsUpdate(){ calls.push('update'); if(error)throw Error('unavailable'); return {allowed}; }
  };
  const window={Capacitor:{getPlatform:()=>platform},capacitorExports:{registerPlugin:()=>plugin}};
  vm.runInNewContext(code,{window});
  return {age:window.AgeAssurance,calls};
}
test('new iOS measurement is off before the update and age checks finish',async()=>{
  const {age}=setup(); assert.equal(age.analyticsAllowed(),false); await age.ensure(); assert.equal(age.analyticsAllowed(),true);
});
test('unacknowledged update leaves core advertising eligibility unchanged and measurement off',async()=>{
  const {age}=setup({allowed:false}); await age.ensure(); assert.equal(age.analyticsAllowed(),false); assert.equal(age.adsAllowed(),true);
});
test('native update-check failure keeps new measurement off',async()=>{
  const {age}=setup({error:true}); await age.ensure(); assert.equal(age.analyticsAllowed(),false);
});
test('a known minor cannot enable measurement even with an affirmative update result',async()=>{
  const {age,calls}=setup({status:'required',range:{status:'resolved',minor:true}}); await age.ensure(); assert.equal(age.analyticsAllowed(),false); assert.deepEqual(calls,['requirements','range','update']);
});
test('declined age sharing never starts an update sheet or measurement',async()=>{
  const {age,calls}=setup({status:'required',range:{status:'declined'}}); await age.ensure(); assert.equal(age.analyticsAllowed(),false); assert.deepEqual(calls,['requirements','range']);
});
test('Android retains its existing platform path without an Apple notification',async()=>{
  const {age,calls}=setup({platform:'android',allowed:false}); await age.ensure(); assert.equal(age.analyticsAllowed(),true); assert.deepEqual(calls,['requirements']);
});
test('one startup operation does not repeatedly present the update sheet',async()=>{
  const {age,calls}=setup(); await age.ensure(); await age.ensure(); assert.equal(calls.filter(x=>x==='update').length,1);
});
