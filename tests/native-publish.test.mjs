import {test} from 'node:test';import assert from 'node:assert/strict';
import {publishWithConfirmation} from '../scripts/confirm-native-publish.mjs';
test('native output transport errors require exact remote commit confirmation',()=>{
 const expected='a'.repeat(40),failure=Error('Transport failed');let reads=0,pushes=0;
 assert.equal(publishWithConfirmation(()=>pushes++,()=>{reads++;return expected;},expected),false);assert.equal(pushes,1);assert.equal(reads,0);
 assert.equal(publishWithConfirmation(()=>{throw failure;},()=>expected,expected),true);
 for(const remote of ['', 'b'.repeat(40),expected+' unexpected'])assert.throws(()=>publishWithConfirmation(()=>{throw failure;},()=>remote,expected),error=>error===failure);
 assert.throws(()=>publishWithConfirmation(()=>{throw failure;},()=>{throw Error('Cannot verify');},expected),error=>error===failure);
});
