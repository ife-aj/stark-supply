import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshQueue } from '../../shared/cart-sync.ts';
import { callbackCode } from '../src/oauth-callback.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('a newer invalidation discards an in-flight stale cart and reads again', async () => {
 const pending = [], values = [], errors = [];
 const queue = createRefreshQueue(() => new Promise(resolve => pending.push(resolve)), v => values.push(v), e => errors.push(e));
 const work = queue.refresh(); void queue.refresh();
 pending.shift()(['old']); await tick();
 assert.deepEqual(values, []); pending.shift()(['new']); await work;
 assert.deepEqual(values, [['new']]); assert.deepEqual(errors, []);
});
test('logging out discards an old user cart that arrives afterwards', async () => {
 let complete; const values=[];
 const queue=createRefreshQueue(()=>new Promise(resolve=>{complete=resolve;}),v=>values.push(v),()=>{});
 const work=queue.refresh(); queue.dispose(); complete(['private old cart']); await work; await queue.refresh();
 assert.deepEqual(values,[]);
});
test('a failed read does not prevent recovery after reconnect', async () => {
 const values=[],errors=[];let attempts=0;
 const queue=createRefreshQueue(async()=>{if(!attempts++)throw new Error('offline');return ['restored'];},v=>values.push(v),e=>errors.push(e));
 await queue.refresh();await queue.refresh();assert.equal(errors.length,1);assert.deepEqual(values,[['restored']]);
});
test('OAuth accepts only our callback route and reports provider errors', () => {
 assert.equal(callbackCode('starksupply://auth/callback?code=pkce-code'), 'pkce-code');
 assert.equal(callbackCode('https://example.com/auth/callback?code=wrong'), null);
 assert.equal(callbackCode('starksupply://wrong/callback?code=wrong'), null);
 assert.equal(callbackCode('starksupply://auth/other?code=wrong'), null);
 assert.equal(callbackCode('starksupply://auth/callback'), null);
 assert.throws(()=>callbackCode('starksupply://auth/callback?error_description=Access%20denied'),/Access denied/);
});
