import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { readFile, mkdir, unlink } from 'node:fs/promises'
import { toBasicWord, toHomepageFeaturedWord } from '../server/word-access-policy.mjs'
import { createApiHandler } from '../server/index.mjs'
import { createWordStore } from '../server/word-store.mjs'
import { createLocalContentRateLimiter } from '../server/content-rate-limit.mjs'
import { toHomepageFeaturedWord as toClientFeaturedWord } from '../miniapp-uni/word-app1/common/homepage-featured-word.js'

// Isolated test records, never real backend content or a real-data acceptance claim.
const asia = {
  id: 'Asia', word: 'Asia', status: 'published', phonetic: '', basicMeaning: '亚洲',
  parts: [{text:'as',meaning:'太阳升起',targetId:'as',privateNote:'not public'}, {text:'i',meaning:'连接'}, {text:'a',meaning:'表地点'}],
  explanation: '测试意象第一段。\n测试意象第二段。', intro:'private intro',
  illustrationImage:{url:'https://fixture.invalid/protected.png'},
  videoClips:[{videoUrl:'https://fixture.invalid/protected.mp4'}],
  access:{canAccessFull:true,charged:true}, examples:[{english:'detail only'}]
}
const next = { ...asia, id:'selected-next', word:'Next', phonetic:'/nekst/', parts:[{text:'next',meaning:'下一词测试'}], explanation:'下一词测试意象。' }
const protectedFields = ['intro','pictograph','illustrationImage','videoClips','videoSegment','examples','richTextHtml','siblingIds']
for (const project of [toHomepageFeaturedWord, toClientFeaturedWord]) {
  const value=project(asia)
  assert.equal(value.word,'Asia'); assert.equal(value.phonetic,'')
  assert.equal(value.explanation,asia.explanation)
  assert.equal(value.parts[0].meaning,asia.parts[0].meaning)
  assert.equal(Object.hasOwn(value.parts[0],'privateNote'),false)
  assert.deepEqual(value.parts, [
    {text:'as',meaning:'太阳升起'}, {text:'i',meaning:'连接'}, {text:'a',meaning:'表地点'}
  ], 'independent strict display whitelist')
  assert.deepEqual(project({parts:[{label:'legacy',title:'旧释义',targetId:'secret',color:'red',bgColor:'red',borderColor:'red'}]}).parts,
    [{text:'legacy',meaning:'旧释义'}], 'schema aliases normalize without exposing aliases or styling')
  const envelope = project({...asia,level:'A',group:'g',cardType:'word',bookPage:1,image:'',updatedAt:'today',unknown:'blocked'})
  assert.deepEqual(Object.keys(envelope).sort(), [
    'id','word','phonetic','level','group','status','cardType','bookPage','image','updatedAt',
    'meaning','basicMeaning','access','parts','explanation'
  ].sort(), 'basic envelope plus only two display fields; independent expected keys')
  assert.equal(value.access.canAccessFull,false);assert.equal(value.access.charged,false)
  for(const key of protectedFields)assert.equal(Object.hasOwn(value,key),false,key)
  value.parts[0].meaning='changed'
  assert.equal(asia.parts[0].meaning,'太阳升起','projection must detach source')
}
const basic=toBasicWord(asia)
assert.equal(Object.hasOwn(basic,'parts'),false);assert.equal(Object.hasOwn(basic,'explanation'),false)

const dataDirectory=new URL('../server/local-data/',import.meta.url)
await mkdir(dataDirectory,{recursive:true})
const dataPath=new URL('homepage-display-test-'+process.pid+'.json',dataDirectory)
const store=createWordStore({dataPath})
let milliseconds=0, lookups=0
const limiter=createLocalContentRateLimiter({now:()=>milliseconds,limits:{basicIp:{ratePerMinute:60000,capacity:1}}})
await store.replaceWords([asia,next,{...next,id:'unselected',word:'Unselected'}])
await store.saveHomepageFeaturedConfig({featuredWordIds:['Asia','selected-next'],mode:'manual',manualWordId:'Asia'})
const server=http.createServer(createApiHandler({
  store:{...store,async resolveHomepageFeaturedWord(options){lookups++;return store.resolveHomepageFeaturedWord(options)}},
  contentRateLimiter:limiter,jwtSecret:'local-display-test-secret'
}))
server.listen(0,'127.0.0.1');await once(server,'listening')
const base='http://127.0.0.1:'+server.address().port
async function get(path){milliseconds+=10;const response=await fetch(base+path);return {response,body:await response.json()}}
async function saveFixture(word) {
  const {illustrationImage,videoClips,...record}=word
  const result=await store.saveWord({...record,meaning:record.basicMeaning})
  assert.equal(result.ok,true,JSON.stringify(result.errors))
}
function sameRecord(preview,record){
  for(const key of ['id','word','phonetic','explanation'])assert.equal(preview[key],record[key],key)
  assert.deepEqual(preview.parts,record.parts.map(part=>({text:part.text || part.label || '',meaning:part.meaning || part.title || ''})))
}
try {
  const first=await get('/api/homepage/featured-word')
  assert.equal(first.response.status,200);assert.match(first.response.headers.get('cache-control'),/no-store/)
  assert.deepEqual(Object.keys(first.body).sort(),['ok','source','word'],'response exposes only the current recommendation, not the pool')
  sameRecord(first.body.word,await store.findWordById('Asia'))
  for(const key of protectedFields)assert.equal(Object.hasOwn(first.body.word,key),false,key)
  const previousLookups=lookups
  const limited=await fetch(base+'/api/homepage/featured-word')
  assert.equal(limited.status,429);assert.match(limited.headers.get('cache-control'),/no-store/)
  assert.ok(Number(limited.headers.get('retry-after'))>0);assert.equal(lookups,previousLookups)
  assert.equal((await limited.json()).code,'CONTENT_RATE_LIMITED')
  // Search and a NON-current detail still use the ordinary basic whitelist.
  for(const path of ['/api/words?q=Asia','/api/words/selected-next']){
    const result=await get(path),word=result.body.word||result.body.words[0]
    assert.equal(word.access.canAccessFull,false)
    for(const key of ['parts','explanation',...protectedFields])assert.equal(Object.hasOwn(word,key),false,key)
  }
  await saveFixture({...asia,phonetic:'/test/',parts:[{text:'updated',meaning:'后台更新测试'}],explanation:'更新后的测试意象。'})
  sameRecord((await get('/api/homepage/featured-word')).body.word,await store.findWordById('Asia'))
  await store.saveHomepageFeaturedConfig({featuredWordIds:['Asia','selected-next'],mode:'manual',manualWordId:'selected-next'})
  assert.equal((await get('/api/homepage/featured-word')).body.word.id,'selected-next')
  await saveFixture({...next,status:'unpublished'})
  assert.notEqual((await get('/api/homepage/featured-word')).body.word?.id,'selected-next')
  await saveFixture(next)
  await store.saveHomepageFeaturedConfig({featuredWordIds:['Asia','selected-next'],mode:'dailyRotation',manualWordId:''})
  const ids=[]
  for(const date of [new Date('2026-10-13T08:00:00Z'),new Date('2026-10-14T08:00:00Z')]){
    const selection=await store.resolveHomepageFeaturedWord({date});ids.push(selection.word.id)
    assert.ok(['Asia','selected-next'].includes(selection.word.id));sameRecord(toHomepageFeaturedWord(selection.word),await store.findWordById(selection.word.id))
  }
  assert.notEqual(ids[0],ids[1])
  const current=(await get('/api/homepage/featured-word')).body.word
  assert.ok(ids.includes(current.id));sameRecord(current,await store.findWordById(current.id))
  await store.saveHomepageFeaturedConfig({featuredWordIds:[],mode:'dailyRotation',manualWordId:''})
  assert.equal((await get('/api/homepage/featured-word')).body.word,null)
}finally{await new Promise(resolve=>server.close(resolve));await unlink(dataPath)}

const storage=new Map(),requests=[]
globalThis.uni={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),request(options){requests.push(options);return {abort(){}}}}
const auth=await import('../miniapp-uni/word-app1/common/auth-store.js')
const api=await import('../miniapp-uni/word-app1/common/word-api-client.js')
const repository=await import('../miniapp-uni/word-app1/common/word-repository.js')
const session=(id,token=id)=>({user:{id},token,expiresAt:new Date(Date.now()+60000).toISOString()})
const reply=(request,word=asia)=>request.success({statusCode:200,data:{ok:true,word,source:'manual'}})
const assertBasic=word=>{assert.equal(word.access.canAccessFull,false);for(const key of ['parts','explanation',...protectedFields])assert.equal(Object.hasOwn(word,key),false,key)}
try {
  const pending=repository.fetchHomepageFeaturedWord();reply(requests.at(-1));const result=await pending
  sameRecord(result.word,toClientFeaturedWord(asia))
  assertBasic(repository.getCachedPublishedRemoteWordById(asia.id))
  assertBasic(repository.getWordById(asia.id))
  assertBasic(repository.searchWords('Asia')[0])
  assertBasic(repository.listWords().find(word=>word.id===asia.id))
  assert.equal([...storage.values()].some(value=>JSON.stringify(value).includes(asia.explanation)),false,'display content is not persisted to shared storage')
  const publicDetail=api.fetchServerWordById(asia.id);reply(requests.at(-1));assertBasic(await publicDetail)
  const search=repository.fetchWords('Asia');requests.at(-1).success({statusCode:200,data:{ok:true,words:[asia]}});assertBasic((await search)[0])
  auth.saveAuthSession(session('A'))
  const delayed=repository.fetchHomepageFeaturedWord(),old=requests.at(-1)
  auth.saveAuthSession(session('B'));reply(old)
  await assert.rejects(delayed,error=>error.code==='AUTH_SESSION_CHANGED')
  assert.equal(repository.getCachedPublishedRemoteWordById(asia.id),null)
  const relogin=repository.fetchHomepageFeaturedWord(),reloginRequest=requests.at(-1)
  auth.clearAuthSession();auth.saveAuthSession(session('B'));reply(reloginRequest)
  await assert.rejects(relogin,error=>error.code==='AUTH_SESSION_CHANGED')
  assert.equal(repository.getCachedPublishedRemoteWordById(asia.id),null)
  const renewed=repository.fetchHomepageFeaturedWord(),renewedRequest=requests.at(-1)
  auth.saveAuthSession(session('B','renewed'));reply(renewedRequest)
  assert.equal((await renewed).word.explanation,asia.explanation)
  assertBasic(repository.getCachedPublishedRemoteWordById(asia.id))
  const limited=repository.fetchHomepageFeaturedWord();requests.at(-1).success({statusCode:429,header:{'Retry-After':'4'},data:{ok:false,code:'CONTENT_RATE_LIMITED'}})
  await assert.rejects(limited,error=>error.statusCode===429&&error.retryAfter===4)

  const source=await readFile(new URL('../miniapp-uni/word-app1/pages/index/index.vue',import.meta.url),'utf8')
  const script=source.split('<script>')[1].split('</script>')[0].replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\r?\n/gm,'').replace('export default','return')
  let now=Date.parse('2026-10-14T15:59:59Z'), timerId=0
  const timers=new Map()
  const fakeTimeout=(callback,delay)=>{timers.set(++timerId,{callback,at:now+delay});return timerId}
  const fakeClear=id=>timers.delete(id)
  const advance=async milliseconds=>{
    now+=milliseconds
    for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback()}
    await Promise.resolve()
  }
  const definition=new Function('dependencies','with(dependencies){'+script+'}')({...repository,...auth,BottomNav:{},BaxiaotaEntry:{},getUserState:()=>({}),Date:{now:()=>now},setTimeout:fakeTimeout,clearTimeout:fakeClear})
  const page=definition.data()
  Object.entries(definition.methods).forEach(([key,value])=>{page[key]=value.bind(page)})
  Object.entries(definition.computed).forEach(([key,value])=>{Object.defineProperty(page,key,{get:value.bind(page)})})
  page.applyTodayWord(toClientFeaturedWord(asia),'manual')
  assert.equal(page.todayWord.word,'Asia');assert.equal(page.todayWord.phonetic,'')
  assert.equal(page.todayWordSummary,asia.explanation.trim())
  assert.deepEqual(page.todayDisplayParts.map(part=>({text:part.text,meaning:part.meaning})),asia.parts.map(part=>({text:part.text,meaning:part.meaning})))
  assert.match(source,/<text v-if="todayWord.phonetic" class="today-phonetic">/)
  let opened
  page.openDetail=(...args)=>{opened=args};page.openTodayWord();assert.equal(opened[0],asia.id)
  page.measureGameEntryBounds=()=>{}
  page.refreshUserData=()=>{}
  definition.onShow.call(page)
  const firstRequest=requests.at(-1),count=requests.length
  definition.onShow.call(page)
  assert.equal(requests.length,count,'duplicate onShow shares pending request')
  assert.equal(page.todayWord,null,'old display cleared before waiting')
  reply(firstRequest,asia);await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.todayWord.id,asia.id)
  assert.equal([...timers.values()][0].at,now+1000,'refresh at Shanghai midnight')
  await advance(1000)
  assert.equal(page.todayWord,null,'cross-day stale display cleared while waiting')
  reply(requests.at(-1),next);await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.todayWord.id,next.id)
  assert.equal([...timers.values()][0].at,now+300000,'five minute polling')
  await advance(300000)
  assert.equal(page.todayWord,null)
  reply(requests.at(-1),asia);await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.todayWord.id,asia.id,'manual switch reflected on poll')
  await advance(300000)
  reply(requests.at(-1),null);await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.todayWord,null,'unpublished/empty selection stays hidden')
  page.applyTodayWord(toClientFeaturedWord(asia),'manual')
  await advance(300000)
  requests.at(-1).fail({errMsg:'fixture failure'});await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.todayWord,null,'failed refresh never restores old content')
  assert.equal(page.todayWordSummary,'')
  const older=page.loadTodayWord(),olderRequest=requests.at(-1)
  definition.onHide.call(page)
  assert.equal(timers.size,0)
  definition.onShow.call(page)
  const newerRequest=requests.at(-1)
  reply(newerRequest,next);await new Promise(resolve=>setImmediate(resolve))
  reply(olderRequest,asia);await older
  assert.equal(page.todayWord.id,next.id);assert.equal(page.todayWordSummary,next.explanation)
  now=Date.parse('2026-10-15T15:59:59Z')
  const spanning=page.loadTodayWord()
  await advance(1001)
  reply(requests.at(-1),asia);await spanning
  assert.equal(page.todayWord,null,'response started on previous Shanghai date discarded')
  await advance(1)
  reply(requests.at(-1),next);await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.todayWord.id,next.id)
  const unloading=page.loadTodayWord(),unloadRequest=requests.at(-1)
  definition.onUnload.call(page)
  reply(unloadRequest,asia);await unloading
  assert.equal(page.todayWord,null,'destroyed page ignores response')
  assert.equal(timers.size,0,'destroyed page does not reschedule')
  page.applyTodayWord({...toClientFeaturedWord(next),parts:[],explanation:''},'manual')
  assert.deepEqual(page.todayDisplayParts,[]);assert.equal(page.todayWordSummary,'')
}finally{auth.clearAuthSession();delete globalThis.uni}
console.log('Homepage display: local HTTP selected record/rotation/update, no-store/429, client projection/basic-only caches, session races, and actual page methods passed; no production data or native layout acceptance.')
