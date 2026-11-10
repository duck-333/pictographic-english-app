import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createWechatAccessTokenProvider, safeWechatErrorDiagnostic } from '../server/wechat-login.mjs'
import { createVirtualPaymentClient } from '../server/virtual-payment-client.mjs'
import { createVirtualPaymentService } from '../server/virtual-payment-service.mjs'

const secret = 'PRIVATE-CANARY-token-secret-openid-signature'
const orderNo = 'VP' + 'D'.repeat(30)
const env = { NODE_ENV: 'development', VIRTUAL_PAYMENT_ENABLED: 'true', VIRTUAL_PAYMENT_ENV: 'sandbox',
  VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '42', WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'sandbox-offer',
  WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: 'sandbox-product', WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: secret }
const order = { id:'1', orderNo, userId:'42', clientRequestId:'request-12345678', internalSku:'membership_30d',
  productId:'sandbox-product', productName:'30天学习会员', quantity:1, unitPriceFen:3000, orderAmountFen:3000,
  paidAmountFen:null, currency:'CNY', environment:'sandbox', wechatEnv:1, paymentChannel:'wechat_virtual_payment',
  clientPlatform:'android', providerOrderId:null, providerTransactionId:null, paymentStatus:'pending',
  entitlementStatus:'not_ready', deliveryStatus:'not_ready', membershipGrantId:null, entitlementTransactionId:null,
  paidAt:null, entitlementGrantedAt:null, deliveredAt:null, createdAt:'2026-11-09T10:51:21.000Z', updatedAt:'2026-11-09T10:51:21.000Z' }
const forbidden = () => { throw Error('Unexpected state mutation') }
const logs = []
function service(client, logger = line => logs.push(JSON.parse(line))) {
  return createVirtualPaymentService({ env, virtualPaymentClient: client, queryDiagnosticLogger: logger,
    store:{findByUserAndClientRequestId:async()=>null,findByUserAndOrderNo:async()=>({...order}),
      createOrder:forbidden,markOrderPending:forbidden,reconcileVerifiedWechatQuery:forbidden},
    paymentSessionService:{exchangeAndVerifyPaymentSession:async()=>({openid:secret,userId:'42'})},
    signingService:{createPaymentParameters:forbidden} })
}
const input = {authenticatedUserId:'42',orderNo,loginCode:secret}
async function rejects503(s) {
  await assert.rejects(s.reconcileOwnedOrder(input), e => {
    assert.equal(e.code,'PAYMENT_QUERY_UNAVAILABLE');assert.equal(e.statusCode,503)
    assert.equal(e.message,'Wechat payment query is unavailable.')
    assert.equal(e.paymentDiagnostic,undefined)
    return true
  })
}
function tokenRequest(mode) {
  return (_url,_options,callback) => {
    if(mode==='sync')throw Error(secret)
    const req=new EventEmitter();req.destroy=()=>{};
    req.end=()=>queueMicrotask(()=>{
      if(mode==='network'){req.emit('error',Error(secret));return}
      if(mode==='timeout'){req.emit('timeout');return}
      const res=new EventEmitter();res.destroy=()=>{};res.setEncoding=()=>{};
      res.statusCode=mode==='http'?502:200;res.headers={};callback(res)
      const body=mode==='json'?secret:JSON.stringify({errcode:40125,errmsg:secret,access_token:secret})
      res.emit('data',body);res.emit('end')
    });return req
  }
}
function token(mode){return createWechatAccessTokenProvider({appid:'fixture-appid',secret,request:tokenRequest(mode)})}
let count=0
async function check(name, client, expected){
  const before=logs.length;await rejects503(service(client));assert.equal(logs.length,before+1,name)
  const row=logs.at(-1);for(const[k,v]of Object.entries(expected))assert.equal(row[k],v,name+':'+k)
  assert.equal(row.orderNo,orderNo);assert.equal(row.environment,'sandbox');assert.equal(row.wechatEnv,1)
  assert.equal(row.operation,'reconcile');assert.equal(row.event,'virtual_payment_query_failed')
  assert.match(row.at,/^\d{4}-\d\d-\d\dT.*Z$/)
  assert(!JSON.stringify(row).includes(secret))
  assert(Object.keys(row).every(k=>['at','event','operation','orderNo','environment','wechatEnv','stage','reason','httpStatus','wechatErrcode'].includes(k)))
  count++
}
for(const [mode,reason,httpStatus,code]of [
  ['network','network_error'],['sync','network_error'],['timeout','timeout'],['http','http_error',502],
  ['business','wechat_rejected',200,40125],['json','invalid_response',200]
]){
  let queries=0
  const client=createVirtualPaymentClient({env,accessTokenProvider:token(mode),fetch:async()=>{queries++;throw Error(secret)}})
  await check('token-'+mode,client,{stage:'access_token',reason,httpStatus,wechatErrcode:code})
  assert.equal(queries,0)
}
const provider={getAccessToken:async()=>secret}
function client(fetch,timeoutMs=100){return createVirtualPaymentClient({env,accessTokenProvider:provider,fetch,timeoutMs})}
await check('network',client(async()=>{throw Error(secret)}),{stage:'query_request',reason:'network_error'})
await check('timeout',client(()=>new Promise(()=>{}),5),{stage:'query_request',reason:'timeout'})
await check('http',client(async()=>new Response(secret,{status:502})),{stage:'query_request',reason:'http_error',httpStatus:502})
for(const [body,expected]of [
  [{errcode:268490002,errmsg:'数据不存在',token:secret},{stage:'wechat_business',reason:'data_not_found',wechatErrcode:268490002}],
  [{errcode:40001,errmsg:secret,openid:secret},{stage:'wechat_business',reason:'wechat_rejected',wechatErrcode:40001}],
  [{errcode:'40001',errmsg:secret},{stage:'query_response',reason:'invalid_response'}],
  [secret,{stage:'query_response',reason:'invalid_response'}]
]) await check('response',client(async()=>new Response(typeof body==='string'?body:JSON.stringify(body))),{...expected,httpStatus:200})

// Log sink projects arbitrary dependency metadata rather than serializing errors.
const injected={queryOrder:async()=>{throw Object.assign(Error(secret),{paymentDiagnostic:{
  stage:secret,reason:secret,httpStatus:secret,wechatErrcode:secret,token:secret,payload:{openid:secret}}})}}
await check('injected-metadata',injected,{stage:'local_validation',reason:'unclassified',httpStatus:undefined,wechatErrcode:undefined})
const throwingGetter={queryOrder:async()=>{const error=Error(secret);Object.defineProperty(error,'paymentDiagnostic',{get(){throw Error(secret)}});throw error}}
await check('throwing-metadata',throwingGetter,{stage:'local_validation',reason:'unclassified'})

// P2: validate and output the very same values, even with hostile accessors.
const reads={metadata:0,stage:0,reason:0,httpStatus:0,wechatErrcode:0}
const initial={stage:'wechat_business',reason:'data_not_found',httpStatus:200,wechatErrcode:268490002}
const changing={}
for(const [key,value]of Object.entries(initial))Object.defineProperty(changing,key,{get(){reads[key]++;return reads[key]===1?value:secret}})
const changingError=Error(secret)
Object.defineProperty(changingError,'paymentDiagnostic',{get(){reads.metadata++;return reads.metadata===1?changing:secret}})
await check('changing-getters',{queryOrder:async()=>{throw changingError}},initial)
assert.deepEqual(reads,{metadata:1,stage:1,reason:1,httpStatus:1,wechatErrcode:1})
for(const key of Object.keys(initial)){
  const bad={...initial};Object.defineProperty(bad,key,{get(){throw Error(secret)}})
  assert.deepEqual(safeWechatErrorDiagnostic(bad),{stage:'local_validation',reason:'unclassified'})
}

// An exception while reading metadata must not escape the token provider's
// existing controlled WECHAT_ACCESS_TOKEN_UNAVAILABLE / 502 error boundary.
let tokenGetterReads=0
const throwingToken=createWechatAccessTokenProvider({appid:'fixture-appid',secret,request(){
  const req=new EventEmitter();req.end=()=>{
    const error=Error(secret)
    Object.defineProperty(error,'paymentDiagnostic',{get(){tokenGetterReads++;throw Error(secret)}})
    throw error
  };return req
}})
await assert.rejects(throwingToken.getAccessToken(),e=>{
  assert.equal(e.code,'WECHAT_ACCESS_TOKEN_UNAVAILABLE');assert.equal(e.statusCode,502)
  assert.equal(e.message,'Wechat access token service is unavailable.')
  assert.deepEqual(e.paymentDiagnostic,{stage:'local_validation',reason:'unclassified'})
  return true
})
assert.equal(tokenGetterReads,1)
await check('token-throwing-metadata',createVirtualPaymentClient({env,accessTokenProvider:throwingToken,fetch:forbidden}),
  {stage:'access_token',reason:'unclassified'})
assert.equal(tokenGetterReads,2)

for(const body of [{errcode:0,order:{}},{errcode:0,order:null}]){
  const invalidOrder=client(async()=>new Response(JSON.stringify(body),{status:200}))
  await check('invalid-order-after-headers',invalidOrder,{stage:'query_response',reason:'invalid_response',httpStatus:200})
  await assert.rejects(invalidOrder.queryOrder({openid:secret,orderNo}),e=>{
    assert.equal(e.statusCode,502)
    assert.equal(e.code,body.order===null?'VIRTUAL_PAYMENT_RESPONSE_INVALID':'VIRTUAL_PAYMENT_QUERY_STATUS_UNKNOWN')
    assert.equal(e.paymentDiagnostic.httpStatus,200);return true
  })
}
let bodyFetches=0,aborts=0
const bodyTimeout=client(async(_url,{signal})=>{
  bodyFetches++;signal.addEventListener('abort',()=>aborts++,{once:true})
  return {status:200,headers:{get:()=>null},body:{getReader:()=>({
    read:()=>new Promise(()=>{}),cancel:async()=>{},releaseLock(){}
  })}}
},10)
await check('body-timeout-after-headers',bodyTimeout,{stage:'query_request',reason:'timeout',httpStatus:200})
assert.equal(bodyFetches,1);assert.equal(aborts,1)
await assert.rejects(bodyTimeout.queryOrder({openid:secret,orderNo}),e=>{
  assert.equal(e.code,'VIRTUAL_PAYMENT_CLIENT_TIMEOUT');assert.equal(e.statusCode,504)
  assert.equal(e.paymentDiagnostic.httpStatus,200);return true
})
assert.equal(bodyFetches,2);assert.equal(aborts,2)
for(const logger of [()=>{throw Error(secret)},()=>Promise.reject(Error(secret))]) await rejects503(service(injected,logger))
await new Promise(resolve=>setImmediate(resolve))
// Verify the default sink writes one JSON string into the existing console stream.
const original=console.error;const captured=[]
try{console.error=(...args)=>captured.push(args);await rejects503(service(injected,null))}finally{console.error=original}
assert.equal(captured.length,1);assert.equal(captured[0].length,1);assert.equal(JSON.parse(captured[0][0]).orderNo,orderNo)
assert(!captured[0][0].includes(secret))
console.log(JSON.stringify({passed:true,failureCases:count,loggerFailureCases:2,defaultSink:true,noNetwork:true,noDatabase:true}))
