import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import * as fs from 'node:fs'
import * as fsAsync from 'node:fs/promises'
import * as path from 'node:path'
import * as urls from 'node:url'
import * as schema from '../miniapp-uni/word-app1/common/content-schema.js'
import { createWordStore } from '../server/word-store.mjs'
import { createApiHandler } from '../server/index.mjs'
import { createUserSessionToken } from '../server/auth.mjs'
import { createLocalContentRateLimiter } from '../server/content-rate-limit.mjs'
import { toFeaturedTextWord, toFullWord } from '../server/word-access-policy.mjs'

const secret = 'isolated-featured-text-test-secret'
const privateUrl = 'https://fixture.invalid/full-lesson.mp4'
const a = {
  id: 'word-alpha', word: 'alpha', status: 'published', basicMeaning: '基础义', meaning: '完整释义',
  explanation: '完整意象第一行\n完整意象第二行', tip: '完整说明', intro: '完整介绍', pictograph: '文字意象',
  parts: [{ text: 'al', meaning: '拆解说明', targetId: 'word-beta', color: '#123456', videoUrl: privateUrl }],
  examples: [{english:'An alpha example.',chinese:'例句译文',videoUrl:privateUrl}], siblingIds:['word-beta'],
  videoTitle: '讲解标题',
  videoClips: [{ clipId:'clip-a', videoUrl:privateUrl, url:privateUrl, segmentTitle:'片段标题',
    focus:'讲解重点',targetPart:'al',note:'片段说明',startSec:4,endSec:9,assetId:'private-asset',psign:'private-token' }],
  videoSegment: {videoUrl:privateUrl}, video:{url:privateUrl}, video_url:privateUrl,
  fullVideoUrl:privateUrl, fileId:'private-file', playAuth:'private-token',
  richTextHtml:`<video src="${privateUrl}"></video>`, unknownVideo:{url:privateUrl},
  access:{canAccessFull:true,charged:true,membershipActive:true,remainingQuota:999}
}
const b={...a,id:'word-beta',word:'beta',explanation:'Beta完整意象'}
const c={...a,id:'word-gamma',word:'gamma'}
const unpublished={...a,id:'word-hidden',word:'hidden',status:'unpublished'}
const records=[a,b,c,unpublished]
const free=toFeaturedTextWord(a)
assert.deepEqual(Object.keys(free).sort(),[
  'id','word','meaning','basicMeaning','phonetic','level','group','status','cardType','bookPage','image','updatedAt','access',
  'tip','explanation','intro','pictograph','videoTitle','parts','examples','siblingIds','videoClips'
].sort(),'independent text-only top-level whitelist')
assert.deepEqual(free.videoClips,[{clipId:'clip-a',segmentTitle:'片段标题',focus:'讲解重点',targetPart:'al',note:'片段说明',startSec:4,endSec:9}])
assert.equal(JSON.stringify(free).includes(privateUrl),false)
assert.equal(JSON.stringify(free).includes('private-token'),false)
assert.deepEqual(free.parts,[{text:'al',meaning:'拆解说明',targetId:'word-beta',color:'#123456'}])
assert.deepEqual(free.examples,[{english:'An alpha example.',chinese:'例句译文'}])
assert.equal(toFullWord(a).videoClips[0].videoUrl,privateUrl,'ordinary full projection remains unchanged')

// Execute the actual store module with its readFile import replaced in memory.
// The first read changes the available payload before any second read can occur.
const moduleUrl=new URL('../server/word-store.mjs',import.meta.url)
const storeSource=(await fsAsync.readFile(moduleUrl,'utf8'))
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\r?\n/gm,'')
  .replace(/export function /g,'function ').replace(/import\.meta\.url/g,'moduleUrl')
const before={words:[a,b],homepageFeatured:{mode:'manual',featuredWordIds:[a.id,b.id],manualWordId:a.id}}
const after={words:[{...a,status:'unpublished'},b],homepageFeatured:{mode:'manual',featuredWordIds:[b.id],manualWordId:b.id}}
let reads=0
const memoryFactory=new Function('dependencies',`with(dependencies){${storeSource};return createWordStore}`)({
  ...fs,...fsAsync,...path,...urls,...schema,moduleUrl:moduleUrl.href,
  readFile:async()=>JSON.stringify(++reads===1?before:after)
})
const memoryStore=memoryFactory()
const captured=await memoryStore.findWordDetailContext('ALPHA',{date:new Date('2026-10-14T08:00:00Z')})
assert.equal(reads,1,'detail context must read exactly once')
assert.equal(captured.word.id,a.id);assert.equal(captured.featuredWordId,a.id)
const later=await memoryStore.findWordDetailContext(a.id)
assert.equal(reads,2);assert.equal(later.word,null);assert.equal(later.featuredWordId,b.id)

const dataPath=new URL(`../server/local-data/featured-text-test-${process.pid}.json`,import.meta.url)
const store=createWordStore({dataPath})
let currentDate=new Date('2026-10-14T15:59:59Z'),tick=0,calls=0
const balances=new Map([['normal',2],['zero',0],['member',0]])
const ledger=new Map()
const entitlements={async consumeQuota(input){
  calls++
  if(ledger.has(input.idempotencyKey))return {allowed:true,reason:'quota_consumed',remainingQuota:balances.get(input.userId),idempotent:true}
  if(input.userId==='member')return {allowed:true,reason:'membership_active',remainingQuota:0}
  if(!balances.get(input.userId))return {allowed:false,remainingQuota:0}
  balances.set(input.userId,balances.get(input.userId)-1);ledger.set(input.idempotencyKey,input)
  return {allowed:true,reason:'quota_consumed',remainingQuota:balances.get(input.userId)}
}}
const limiter=createLocalContentRateLimiter({now:()=>tick,limits:{
  basicIp:{capacity:200,ratePerMinute:60000},fullIp:{capacity:200,ratePerMinute:60000},account:{capacity:200,ratePerMinute:60000}
}})
const options={store,userEntitlementStore:entitlements,contentRateLimiter:limiter,jwtSecret:secret,
  now:()=>currentDate,userStore:{async findUserProfileById(id){return balances.has(id)?{id}:null}},adminApiToken:'isolated-admin'}
const tokens=Object.fromEntries(['normal','zero','member','missing'].map(id=>[id,createUserSessionToken(id,{jwtSecret:secret,now:()=>currentDate}).token]))
const expired=createUserSessionToken('normal',{jwtSecret:secret,now:()=>new Date('2026-10-01T00:00:00Z'),userSessionTtlMs:1000}).token
let server
async function openServer(extra={}){
  const instance=http.createServer(createApiHandler({...options,...extra}))
  instance.listen(0,'127.0.0.1');await once(instance,'listening');return instance
}
async function get(route,{auth='',requestId='featured-access',instance=server}={}){
  tick+=10
  const response=await fetch(`http://127.0.0.1:${instance.address().port}${route}`,{headers:{
    ...(auth?{Authorization:auth}:{}),...(requestId===null?{}:{'X-Client-Request-Id':requestId})
  }})
  if(route.startsWith('/api/words/'))assert.match(response.headers.get('cache-control'),/no-store/)
  return {status:response.status,body:await response.json(),headers:response.headers}
}
const detail=(id=a.id,extra={})=>get(`/api/words/${encodeURIComponent(id)}`,extra)
async function config(ids,manual='',mode='manual'){
  const result=await store.saveHomepageFeaturedConfig({featuredWordIds:ids,mode,manualWordId:manual})
  assert.equal(result.ok,true,JSON.stringify(result.errors))
}
function assertFree(result,expected=a){
  assert.equal(result.status,200);assert.equal(result.body.word.id,expected.id)
  assert.equal(result.body.word.explanation,expected.explanation)
  assert.equal(result.body.word.meaning,expected.meaning)
  assert.equal(result.body.word.access.canAccessFull,true)
  assert.equal(result.body.word.access.reason,'FEATURED_WORD_FREE')
  assert.equal(result.body.word.access.charged,false);assert.equal(result.body.word.access.chargeAmount,0)
  assert.equal(result.body.word.access.remainingQuota,null);assert.equal(result.body.word.access.membershipActive,false)
  assert.equal(result.body.word.access.membershipType,'none')
  assert.equal(result.body.charged,false);assert.equal(result.body.remainingQuota,null)
  assert.equal(JSON.stringify(result.body).includes(privateUrl),false)
  assert.equal(JSON.stringify(result.body).includes('private-token'),false)
}
try{
  await store.replaceWords(records);await config([a.id,b.id],a.id)
  server=await openServer()
  for(const user of ['', 'normal','zero','member'])assertFree(await detail(a.id,{auth:user?`Bearer ${tokens[user]}`:''}))
  assert.equal(calls,0);assert.equal(ledger.size,0);assert.equal(balances.get('normal'),2)
  const home=await get('/api/homepage/featured-word')
  assertFree(await detail(home.body.word.id))
  const search=await get('/api/words?q=alpha')
  assert.equal(search.body.words[0].access.canAccessFull,false,'search stays basic')
  assertFree(await detail(search.body.words[0].id))
  assertFree(await detail('ALPHA'))
  for(const id of [b.id,c.id]){
    const ordinary=await detail(id)
    assert.equal(ordinary.body.word.access.canAccessFull,false)
    assert.equal(ordinary.body.word.access.reason,'LOGIN_REQUIRED')
    assert.equal((await detail(id,{auth:`Bearer ${tokens.zero}`})).body.code,'QUOTA_INSUFFICIENT')
  }
  const ordinaryMember=await detail(b.id,{auth:`Bearer ${tokens.member}`})
  assert.equal(ordinaryMember.body.word.videoClips[0].videoUrl,privateUrl)
  assert.equal(ordinaryMember.body.membershipActive,true);assert.equal(ledger.size,0)
  assert.equal((await detail(unpublished.id)).status,404)
  for(const auth of ['Bearer invalid',`Bearer ${expired}`,'Basic bogus'])assert.ok([401,403].includes((await detail(a.id,{auth})).status))
  assert.equal((await detail(a.id,{auth:`Bearer ${tokens.missing}`})).status,401)
  assert.equal((await detail(a.id,{requestId:null})).body.code,'CLIENT_REQUEST_ID_REQUIRED')
  assert.equal((await detail(a.id,{requestId:'!!!'})).body.code,'CLIENT_REQUEST_ID_INVALID')
  assert.equal((await detail(a.id,{auth:`Bearer ${tokens.normal}`,requestId:null})).status,400)

  // A free request leaves no ledger entry; after rotation the SAME id must pay.
  const ordinaryCalls=calls
  assertFree(await detail(a.id,{auth:`Bearer ${tokens.normal}`,requestId:'same-visit'}))
  assert.equal(calls,ordinaryCalls)
  await config([a.id,b.id],b.id)
  assertFree(await detail(b.id),b)
  assert.equal((await detail(a.id,{auth:`Bearer ${tokens.zero}`,requestId:'featured-access'})).body.code,'QUOTA_INSUFFICIENT')
  const paid=await detail(a.id,{auth:`Bearer ${tokens.normal}`,requestId:'same-visit'})
  assert.equal(paid.body.charged,true);assert.equal(balances.get('normal'),1);assert.equal(ledger.size,1)
  assert.equal(paid.body.word.videoClips[0].videoUrl,privateUrl)
  const replay=await detail(a.id,{auth:`Bearer ${tokens.normal}`,requestId:'same-visit'})
  assert.equal(replay.body.access.canAccessFull,true);assert.equal(ledger.size,1);assert.equal(balances.get('normal'),1)
  await config([a.id,b.id],a.id)
  const callsBeforeFree=calls
  assertFree(await detail(a.id,{auth:`Bearer ${tokens.normal}`,requestId:'same-visit'}))
  assert.equal(calls,callsBeforeFree,'current free branch precedes even paid ledger replay')
  await config([b.id],b.id)
  assert.equal((await detail(a.id)).body.access.canAccessFull,false,'removed word is ordinary')

  assert.equal((await store.saveHomepageFeaturedConfig({featuredWordIds:[a.id],mode:'manual',manualWordId:c.id})).ok,false)
  assert.equal((await store.saveHomepageFeaturedConfig({featuredWordIds:[a.id,unpublished.id],mode:'dailyRotation'})).ok,false)
  // Historical invalid manual selection falls back to published pool rotation.
  await fsAsync.writeFile(dataPath,JSON.stringify({words:records,homepageFeatured:{featuredWordIds:[b.id],mode:'manual',manualWordId:c.id}}))
  assert.equal((await store.resolveHomepageFeaturedWord()).source,'dailyRotation')
  assertFree(await detail(b.id),b);assert.equal((await detail(c.id)).body.access.canAccessFull,false)
  await fsAsync.writeFile(dataPath,JSON.stringify({words:records,homepageFeatured:{featuredWordIds:[],mode:'manual',manualWordId:c.id}}))
  assert.equal((await store.resolveHomepageFeaturedWord()).word,null)
  assert.equal((await detail(c.id)).body.access.canAccessFull,false)

  await config([a.id,b.id],'','dailyRotation')
  const dayOne=(await store.resolveHomepageFeaturedWord({date:currentDate})).word
  assertFree(await detail(dayOne.id),dayOne)
  currentDate=new Date('2026-10-14T16:00:00Z')
  const dayTwo=(await store.resolveHomepageFeaturedWord({date:currentDate})).word
  assert.notEqual(dayOne.id,dayTwo.id)
  assertFree(await detail(dayTwo.id),dayTwo)
  assert.equal((await detail(dayOne.id)).body.access.canAccessFull,false)
  await config([a.id,b.id],a.id)
  await store.replaceWords([{...a,status:'unpublished'},b,c,unpublished])
  assert.equal((await detail(a.id)).status,404);assertFree(await detail(b.id),b)
  const newWord={...a,id:'word-delta',word:'delta',explanation:'Delta完整意象'}
  await store.replaceWords([...records,newWord]);await config([a.id,b.id,newWord.id],'','dailyRotation')
  const chosen=new Set()
  for(let i=0;i<3;i++){
    currentDate=new Date(Date.UTC(2026,9,15+i,8))
    const selected=(await store.resolveHomepageFeaturedWord({date:currentDate})).word
    chosen.add(selected.id);assertFree(await detail(selected.id),selected)
  }
  assert.ok(chosen.has(newWord.id),'new published member participates in rotation')
  await config([a.id,b.id,newWord.id],newWord.id)
  assertFree(await detail(newWord.id),newWord)

  // Distinct IP/account admission tests do not need real quota/database stores.
  for(const [group,auth] of [['fullIp',''],['account',`Bearer ${tokens.normal}`]]){
    const limitedServer=await openServer({contentRateLimiter:createLocalContentRateLimiter({limits:{[group]:{capacity:1,ratePerMinute:1}}})})
    try{
      assertFree(await detail(newWord.id,{auth,instance:limitedServer}),newWord)
      const blocked=await detail(newWord.id,{auth,instance:limitedServer})
      assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0)
    }finally{await new Promise(resolve=>limitedServer.close(resolve))}
  }
  const noLimiter=await openServer({contentRateLimiter:null})
  try{
    assert.equal((await detail(newWord.id,{instance:noLimiter})).status,503)
    assert.equal((await detail(newWord.id,{auth:`Bearer ${tokens.normal}`,instance:noLimiter})).status,503)
    assert.equal((await detail(a.id,{instance:noLimiter})).body.access.canAccessFull,false)
  }finally{await new Promise(resolve=>noLimiter.close(resolve))}
  const finalCalls=calls,finalLedger=ledger.size
  await fsAsync.writeFile(dataPath,'{invalid json')
  assert.equal((await detail(newWord.id)).status,500,'read failure never grants cached free access')
  assert.equal(calls,finalCalls);assert.equal(ledger.size,finalLedger)
}finally{
  if(server)await new Promise(resolve=>server.close(resolve))
  await fsAsync.unlink(dataPath).catch(error=>{if(error.code!=='ENOENT')throw error})
}

// Execute actual admin computation/validation, without connecting an admin API.
const adminSource=await fsAsync.readFile(new URL('../admin-portal/pictographic-admin/pages/index/index.vue',import.meta.url),'utf8')
const adminScript=adminSource.split('<script>')[1].split('</script>')[0]
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\r?\n/gm,'').replace('export default','return')
let saved=0,modal=0
const admin=new Function('dependencies',`with(dependencies){${adminScript}}`)({
  uni:{showModal(){modal++}},saveAdminHomepageFeatured:async()=>{saved++;return {config:{},currentWord:null}}
})
const page={adminUnlocked:true,homepageFeatured:{publishedWords:records,featuredWordIds:[a.id,b.id],mode:'manual',manualWordId:c.id,saving:false}}
assert.deepEqual(admin.computed.homepageManualOptions.call(page).slice(1).map(word=>word.id),[a.id,b.id])
admin.methods.refreshHomepageFeaturedPreview.call(page)
assert.ok([a.id,b.id].includes(page.homepageFeatured.currentWord.id));assert.equal(page.homepageFeatured.source,'dailyRotation')
await admin.methods.saveHomepageFeaturedConfig.call(page)
assert.equal(modal,1);assert.equal(saved,0,'out-of-pool manual selection rejected before admin API')

// Real client projection/normalization must retain anonymous text only in the
// returned detail, never promote the shared cache or turn metadata into media.
const storage=new Map(),requests=[]
globalThis.uni={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),request:options=>{requests.push(options)}}
try{
  const auth=await import('../miniapp-uni/word-app1/common/auth-store.js')
  auth.clearAuthSession()
  const repository=await import('../miniapp-uni/word-app1/common/word-repository.js')
  const pending=repository.fetchWordById(a.id,{accessContent:true,clientRequestId:'anonymous-text'})
  assert.equal(requests.at(-1).header.Authorization,undefined)
  requests.at(-1).success({statusCode:200,data:{ok:true,word:free,access:free.access}})
  const received=await pending
  assert.equal(received.explanation,a.explanation);assert.equal(received.access.canAccessFull,true)
  assert.equal(JSON.stringify(received).includes(privateUrl),false)
  const cached=repository.getCachedPublishedRemoteWordById(a.id)
  assert.equal(cached.access.canAccessFull,false)
  for(const key of ['parts','explanation','videoClips'])assert.equal(Object.hasOwn(cached,key),false)
  assert.equal([...storage.values()].some(value=>JSON.stringify(value).includes(a.explanation)),false)
  const detailSource=await fsAsync.readFile(new URL('../miniapp-uni/word-app1/pages/word-detail/index.vue',import.meta.url),'utf8')
  const detailScript=detailSource.split('<script>')[1].split('</script>')[0]
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\r?\n/gm,'').replace('export default','return')
  const detailPage=new Function('dependencies',`with(dependencies){${detailScript}}`)({...repository,BottomNav:{}})
  assert.equal(detailPage.computed.canAccessFullContent.call({word:received,accessInfo:received.access}),true)
  assert.equal(detailPage.computed.fullImageryText.call({word:received}),a.explanation)
  assert.equal(detailPage.computed.hasPlayableFullVideo.call({hasVideoData:true,activeVideoUrl:''}),false)
}finally{delete globalThis.uni}

console.log('Featured text: anonymous/normal/member/zero quota; no consume/ledger; entry IDs; Shanghai rotation/manual/unpublish/remove/add; token/request ID/429/no-store; same-ID transitions; actual single-read snapshot; strict text/video projection; read failure; admin pool validation passed (local JSON + memory adapters, no production/DB/VOD).')
