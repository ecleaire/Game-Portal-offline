import {test} from 'node:test';
import assert from 'node:assert/strict';
import {describeError} from '../offline-html/errors.js';

test('storage failures have separate stable codes and actionable messages',()=>{
 const names=['NotAllowedError','SecurityError','NotFoundError','NotReadableError','NoModificationAllowedError','QuotaExceededError','NetworkError','TimeoutError','InvalidStateError','AbortError'];
 const codes=names.map(name=>{const result=describeError(new DOMException('Underlying failure',name));assert(result.message.length>25);assert(result.details.includes(name));return result.code;});
 assert.equal(new Set(codes).size,names.length);
 assert.match(describeError(new DOMException('Write aborted','AbortError')).message,/保存結果/);
 assert.doesNotMatch(describeError(new DOMException('Write aborted','AbortError')).message,/選択をキャンセル/);
});
test('unconfirmed writes take precedence over their low-level causes',()=>{
 for(const code of ['SETTINGS_SAVE_UNCONFIRMED','CONTENT_UPDATE_UNCONFIRMED'])for(const name of ['AbortError','QuotaExceededError','NetworkError']){
  const original=Object.assign(new Error('保存結果未確認です。再保存せず確認してください。',{cause:new DOMException('Failed',name)}),{code});
  const wrapped=new Error('Operation failed',{cause:original}),info=describeError(wrapped);
  assert.equal(info.code,code);assert.equal(info.message,original.message);assert.match(info.details,new RegExp(name));
 }
});
test('unknown errors retain their message without guessing a network diagnosis',()=>{
 for(const name of ['Error','toString','constructor','__proto__']){
  const info=describeError({name,message:'作品の形式を確認してください。'});assert.equal(info.code,'OPERATION_FAILED');assert.equal(info.message,'作品の形式を確認してください。');
 }
 assert.equal(describeError('Custom failure').message,'Custom failure');assert(describeError(null).message);
});
test('diagnostics handle nested and cyclic causes without looping',()=>{
 const error=new Error('Outer',{cause:new DOMException('Denied','NotAllowedError')});assert.equal(describeError(error).code,'ACCESS_DENIED');
 error.cause=error;assert.equal(describeError(error).code,'OPERATION_FAILED');
 let nested=new Error('End');for(let i=0;i<30;i++)nested=new Error('Layer',{cause:nested});assert.equal(describeError(nested).details.split('原因：').length,8);
});


test('native user-facing validation guidance survives generic storage error names',()=>{
 const error=Object.assign(new Error('フォルダーのフルパスを入力してください。'),{name:'NotReadableError',userMessage:'フォルダーのフルパスを入力してください。'});
 assert.equal(describeError(error).message,error.userMessage);assert.equal(describeError(error).code,'READ_FAILED');
 const pending=Object.assign(new Error('保存結果未確認です。再保存せず確認してください。',{cause:error}),{code:'SETTINGS_SAVE_UNCONFIRMED'});assert.equal(describeError(pending).message,pending.message);
});


test('operation-level preservation and recovery instructions survive nested storage failures',()=>{
 for(const name of ['QuotaExceededError','NetworkError','AbortError']){
  const error=new Error('セーブを退避できなかったため、本体は変更していません。ゲーム画面を閉じずに再試行してください。',{cause:new DOMException('Failure',name)});
  const info=describeError(error);assert.equal(info.message,error.message);assert.notEqual(info.code,'OPERATION_FAILED');assert.match(info.details,new RegExp(name));
 }
});
