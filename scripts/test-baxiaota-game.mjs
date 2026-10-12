import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createGameController, mapPoint, ease, smooth, radius, baseAngle } from '../miniapp-uni/word-app1/game-baxiaota/common/game-controller.js'
import { createAssetLoader, guides } from '../miniapp-uni/word-app1/game-baxiaota/common/game-assets.js'
import { sceneGeometry, tracePath, renderScene } from '../miniapp-uni/word-app1/game-baxiaota/common/scene-renderer.js'

function harness() {
  let time=0, next=0
  const frames=new Map(), cancelled=[]
  const c=createGameController({now:()=>time,request:fn=>{assert.equal(frames.size,0,'only one frame loop');frames.set(++next,fn);return next},cancel:id=>{cancelled.push(frames.get(id));frames.delete(id)}})
  const step=ms=>{time+=ms;const pending=[...frames];frames.clear();pending.forEach(([,fn])=>fn())}
  const run=ms=>{while(ms>0){const dt=Math.min(20,ms);step(dt);ms-=dt}}
  return {c,step,run,frames,cancelled}
}
const h=harness(),c=h.c
c.touchStart({x:195,y:88});h.run(1000)
assert.ok(Math.abs(c.state.tilt-1000/2800)<1e-10)
assert.equal(c.touchStart({x:195,y:88}),false,'automatic rotation cannot be manually taken over')
const rotation=c.task();c.setReading(true);h.run(5000)
assert.equal(c.state.tilt,1000/2800)
c.setReading(false);h.run(100);assert.equal(c.state.tilt,1000/2800,'closing detail stays paused')
c.toggleDemo();assert.equal(c.task().from,rotation.from);assert.equal(c.task().elapsed,1000)
h.run(1800);assert.equal(c.state.phase,1)
assert.equal(c.state.demo,false,'manual rotation resume preserves mode')
c.touchStart({x:195+radius*Math.cos(baseAngle),y:230-radius*Math.sin(baseAngle)})
c.touchMove({x:195-radius,y:230});c.touchEnd();assert.equal(c.state.arc,1)
c.setReading(true);c.setReading(false);c.toggleDemo();assert.equal(c.state.demo,false)
h.run(1999);assert.equal(c.state.topReady,false)
h.run(1);assert.equal(c.state.topReady,true)
h.run(10000);assert.equal(c.state.phase,1,'manual continue only finishes arc wait, never starts demonstration')
c.pause();c.toggleDemo();assert.equal(c.state.demo,false,'manual resume without main task preserves mode')
c.touchStart({x:195,y:230-radius});c.touchMove({x:195,y:230-radius-85});c.touchEnd()
assert.equal(c.state.phase,2);assert.equal(c.state.lift,1)
h.run(5000);assert.equal(c.state.phase,2,'first pull must wait for a distinct second gesture')
assert.equal(c.touchStart({x:300,y:50}),false,'second pull must hit the top handle')
c.touchStart({x:195,y:50});c.touchMove({x:195,y:32});assert.equal(c.state.phase,2,'18 is insufficient')
c.touchMove({x:195,y:31.9});assert.equal(c.state.phase,3)
h.run(680);const reveal=c.state.reveal;assert.ok(Math.abs(reveal-ease(.4))<1e-9)
c.pause();h.run(5000);assert.equal(c.state.reveal,reveal)
assert.equal(c.touchStart({x:195,y:150}),false,'paused reveal cannot be replaced by manual drag')
c.toggleDemo();h.run(1020);assert.equal(c.state.reveal,1)
assert.equal(c.state.demo,false,'manual building resume preserves mode')
c.touchStart({x:191,y:157});c.touchMove({x:191,y:292});c.touchEnd()
assert.equal(c.state.phase,5);assert.equal(c.state.zoom,1)
c.setReview(true);assert.equal(c.state.review,true)
c.setReview(false);assert.equal(c.state.paused,true);assert.equal(c.state.zoom,1)
c.reset();assert.equal(c.state.phase,0);h.run(5000);assert.equal(c.state.tilt,0)

const demo=harness();demo.c.toggleDemo();demo.run(40000)
assert.equal(demo.c.state.phase,5);assert.equal(demo.c.state.demo,false)
const takeover=harness();takeover.c.toggleDemo();takeover.run(4100)
assert.equal(takeover.c.state.phase,1)
const a=baseAngle+takeover.c.state.arc*(Math.PI-baseAngle)
assert.equal(takeover.c.touchStart({x:195+radius*Math.cos(a),y:230-radius*Math.sin(a)}),true)
assert.equal(takeover.c.state.demo,false);assert.equal(takeover.c.task(),undefined)

const frozen=harness();frozen.c.toggleDemo();frozen.run(5200)
assert.equal(frozen.c.state.arc,1);frozen.c.pause();const snapshot=JSON.stringify(frozen.c.snapshot()),task=frozen.c.task()
frozen.run(10000);assert.equal(JSON.stringify(frozen.c.snapshot()),snapshot)
frozen.c.resume();assert.equal(frozen.c.task().elapsed,task.elapsed)
assert.equal(frozen.c.state.demo,true)
for(const old of frozen.cancelled)if(old)old()
assert.equal(frozen.frames.size,1,'late cancelled frame cannot create a second resumed loop')
frozen.run(40000);assert.equal(frozen.c.state.phase,5)
const replay=harness();replay.c.toggleDemo();replay.run(1000);replay.c.reset()
for(const old of replay.cancelled)if(old)old()
replay.run(10000);assert.equal(replay.c.state.phase,0);assert.equal(replay.frames.size,0)
replay.c.toggleDemo();replay.run(1000);replay.c.destroy();const dead=JSON.stringify(replay.c.snapshot())
for(const old of replay.cancelled)if(old)old()
replay.run(10000);assert.equal(JSON.stringify(replay.c.snapshot()),dead)
assert.deepEqual(mapPoint({clientX:130,clientY:175},{left:10,top:20,width:240,height:310}),{x:195,y:155})
assert.equal(smooth(.5),.5)
const g=sceneGeometry({...c.snapshot(),phase:2,lift:1,reveal:0,zoom:0,blue:1})
assert.equal(g.hy,50);assert.equal(g.shapes.at(-2).color,'rgb(18,63,96)')
const paths=[]
const ctx=new Proxy({}, {get:(_,name)=>(...args)=>paths.push([name,...args])})
for(const s of g.shapes)if(s.d)tracePath(ctx,s.d)
assert(paths.some(p=>p[0]==='arc'));assert(paths.flat().every(v=>typeof v!=='number'||Number.isFinite(v)))

const pending=[]
const canvas={createImage(){const image={};pending.push(image);return image}}
const loader=createAssetLoader(),first=loader.load(canvas),second=loader.load(canvas)
pending.slice(5).forEach(image=>image.onload())
assert.ok(await second);pending.slice(0,5).forEach(image=>image.onload());assert.equal(await first,null)
const old=loader.load(canvas);loader.invalidate();pending.slice(10).forEach(image=>image.onload());assert.equal(await old,null)

// Execute actual GameScene methods with independently controlled nextTick,
// native selector responses and image completion promises.
const source=readFileSync('miniapp-uni/word-app1/game-baxiaota/components/GameScene.vue','utf8')
const script=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import.*$/gm,'').replace('export default','globalThis.options=')
function sceneHarness(windowInfo={pixelRatio:3}){
  const ticks=[],queries=[],loads=[],events=[]
  const context=vm.createContext({createAssetLoader:()=>({invalidate(){},load:()=>new Promise((resolve,reject)=>loads.push({resolve,reject}))}),mapPoint,renderScene:()=>{},uni:{getWindowInfo:()=>windowInfo,createSelectorQuery:()=>{
    const q={in:()=>q,select:()=>q,fields:()=>q,boundingClientRect:()=>q,selectViewport:()=>q,scrollOffset:()=>q,exec:cb=>queries.push((result,scrollTop=0)=>cb([result,{scrollTop}]))};return q
  }}})
  vm.runInContext(script,context);const options=context.options
  const instance={...options.data(),active:true,state:{},scrollTop:0,$nextTick:fn=>ticks.push(fn),$emit:(...args)=>events.push(args)}
  for(const [key,fn]of Object.entries(options.methods))instance[key]=fn.bind(instance)
  options.mounted.call(instance)
  const node=()=>({getContext:()=>({})})
  return {instance,ticks,queries,loads,events,node,options,tick:()=>ticks.shift()()}
}
const s=sceneHarness();s.tick();s.instance.initialize();s.tick()
const oldNode=s.node(),newNode=s.node()
const latest=s.queries[1]({node:newNode,left:0,top:0,width:300,height:240})
s.loads[0].resolve({gate:{}});await latest
await s.queries[0]({node:oldNode,left:0,top:0,width:390,height:310})
assert.equal(s.instance.canvas,newNode);assert.equal(s.instance.rect.width,300)
assert.equal(newNode.width,900);assert.equal(s.loads.length,1,'stale node response cannot start image loading')
s.instance.scrollTop=100
assert.equal(s.instance.point({clientX:150,clientY:20}).y,155,'scroll 100 uses current viewport rect')
assert.equal(s.instance.point({x:150,y:120}).y,155,'local coordinates remain independent of scroll')
s.instance.start({touches:[{x:150,y:100,identifier:1}]});s.instance.move({touches:[{x:160,y:110,identifier:2}]})
assert.equal(s.events.at(-1)[1].kind,'start','different touch identifier cannot move the active drag')
s.instance.move({touches:[{x:150,y:100,identifier:1},{x:160,y:110,identifier:2}]})
assert.equal(s.events.at(-1)[1].kind,'cancel');assert.equal(s.instance.touchId,null)
s.instance.start({touches:[{x:150,y:100,identifier:1},{x:160,y:110,identifier:2}]})
assert.equal(s.events.at(-1)[1].kind,'cancel','two-touch start cannot start game drag')
const imageRace=sceneHarness();imageRace.tick()
const imageOld=imageRace.queries[0]({node:imageRace.node(),left:0,top:0,width:390,height:310})
imageRace.instance.initialize();imageRace.tick()
const newestNode=imageRace.node(),imageNew=imageRace.queries[1]({node:newestNode,left:0,top:0,width:320,height:254})
imageRace.loads[1].resolve({gate:{}});await imageNew
imageRace.loads[0].resolve({gate:{}});await imageOld
assert.equal(imageRace.instance.canvas,newestNode)
const hide=sceneHarness();hide.tick();hide.instance.active=false;hide.options.watch.active.call(hide.instance,false)
await hide.queries[0]({node:hide.node(),width:390,height:310});assert.equal(hide.loads.length,0)
const queued=sceneHarness();queued.instance.initialize();queued.tick();queued.tick();assert.equal(queued.queries.length,1)
const unload=sceneHarness();unload.tick();const late=unload.queries[0]({node:unload.node(),width:390,height:310})
unload.options.beforeDestroy.call(unload.instance);unload.loads[0].resolve({gate:{}});await late
assert.equal(unload.instance.canvas,null);assert.equal(unload.events.at(-1)[1],false)
const fail=sceneHarness();fail.tick();const failure=fail.queries[0]({node:fail.node(),width:390,height:310})
fail.loads[0].reject(new Error('missing'));await failure;assert.match(fail.instance.error,/重试/)
fail.instance.initialize();fail.tick();const retry=fail.queries[1]({node:fail.node(),width:390,height:310})
fail.loads[1].resolve({gate:{}});await retry;assert.equal(fail.instance.error,'');assert.equal(fail.instance.loading,false)
fail.instance.scrollTop=100;fail.instance.initialize();fail.tick()
const resized=fail.queries[2]({node:fail.node(),left:10,top:40,width:195,height:155},100)
fail.loads[2].resolve({gate:{}});await resized
fail.instance.scrollTop=200;assert.equal(fail.instance.point({clientX:107.5,clientY:17.5}).y,155,'remeasured rect records paired scroll origin')
assert.equal(fail.instance.point({x:97.5,y:77.5}).x,195)
const fit=sceneHarness({windowWidth:412,pixelRatio:2.625});fit.tick()
fit.instance.maxHeight=220;fit.options.watch.maxHeight.call(fit.instance);fit.tick()
assert.equal(fit.instance.sceneHeight,220);assert.ok(Math.abs(fit.instance.sceneWidth/220-390/310)<1e-10)
const fitNode=fit.node(),fitted=fit.queries[1]({node:fitNode,left:10,top:173,width:fit.instance.sceneWidth,height:220},100)
fit.loads[0].resolve({gate:{}});await fitted
await fit.queries[0]({node:fit.node(),left:0,top:0,width:388,height:308})
assert.equal(fit.instance.canvas,fitNode);assert.equal(fitNode.height,578,'fractional DPR affects bitmap only')
assert.equal(fit.instance.point({x:fit.instance.sceneWidth/2,y:110}).y,155)

const pageSource=readFileSync('miniapp-uni/word-app1/game-baxiaota/pages/index.vue','utf8')
const pageScript=pageSource.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import.*$/gm,'').replace('export default','globalThis.options=')
const scrollRequests=[],scrollResponses=[];let homeCalls=0
const pageUni={pageScrollTo:request=>scrollRequests.push(request),createSelectorQuery:()=>{const q={selectViewport:()=>q,scrollOffset:()=>q,exec:callback=>scrollResponses.push(callback)};return q}}
const pc=vm.createContext({uni:pageUni,GameScene:{},GameLearning:{},GameReview:{},createGameController,clamp:(v)=>Math.min(1,Math.max(0,v)),texts:[],returnToSearchHome:()=>{homeCalls++;return Promise.resolve()}})
vm.runInContext(pageScript,pc);const po=pc.options,pi={...po.data(),$refs:{},$nextTick:fn=>fn()}
for(const[key,fn]of Object.entries(po.methods))pi[key]=fn.bind(pi)
po.onLoad.call(pi);po.onShow.call(pi);assert.equal(pi.active,true)
pi.sceneReady(false);assert.equal(pi.state.paused,false,'initial loading must not block manual A tap')
pi.ready=true;pi.controller.state.phase=4;pi.state.phase=4;pi.openSummary();assert.equal(pi.state.review,false)
pi.controller.state.phase=5;pi.state.phase=5
let conversions=0;const actualReview=pi.review;pi.review=value=>{if(value)conversions++;actualReview(value)}
pi.openSummary();pi.openSummary();assert.equal(conversions,1,'ordinary final button opens exactly once');pi.review(false)
assert.equal(pi.swipeStart,undefined,'summary has no edge swipe listener')
pi.controller.reset();pi.controller.pause();pi.pauseOrContinue();assert.equal(pi.state.demo,false,'continue button retains manual mode without a main task')
pi.controller.pause();pi.demo();assert.equal(pi.state.demo,true,'explicit automatic demonstration button starts auto from manual pause')
pi.pauseOrContinue();assert.equal(pi.state.paused,true);pi.pauseOrContinue();assert.equal(pi.state.demo,true,'auto continue retains mode')
po.onPageScroll.call(pi,{scrollTop:100});assert.equal(pi.scrollTop,100)
po.onHide.call(pi);assert.equal(pi.active,false);po.onShow.call(pi);assert.equal(pi.state.paused,true)
po.onPageScroll.call(pi,{scrollTop:0})
const pageTicks=[];pi.$nextTick=fn=>pageTicks.push(fn)
pi.controller.state.phase=5;pi.state.phase=5;pi.openSummary();pi.tutorialFailed({token:pi.tutorialRetry});assert.equal(pi.tutorialError,true)
const oldToken=pi.tutorialRetry;pi.retryTutorial();assert.equal(pi.state.review,true,'retry reloads only tutorial images, preserving scene progress');assert.equal(pi.state.phase,5)
pi.tutorialFailed({token:oldToken});assert.equal(pi.tutorialError,false,'stale tutorial error cannot affect retry')
pi.tutorialFailed({token:pi.tutorialRetry});pi.tutorialLoaded({token:oldToken,allLoaded:true});assert.equal(pi.tutorialError,true)
pi.tutorialLoaded({token:pi.tutorialRetry,allLoaded:true});assert.equal(pi.tutorialError,false)
po.onHide.call(pi);const hiddenToken=pi.tutorialRetry;pi.retryTutorial();assert.equal(pi.tutorialRetry,hiddenToken);po.onShow.call(pi)
pi.restart();let initialized=0;pi.$refs.scene={initialize:()=>initialized++}
po.onUnload.call(pi);assert.equal(pi.active,false)
pageTicks.shift()();assert.equal(initialized,0,'queued restart cannot initialize after unload')
// Actual page navigation waits for the scroll reset/native round trip before
// re-creating Canvas or leaving. Old completions cannot reopen after hide.
const nav={...po.data(),$refs:{},$nextTick:fn=>fn()}
for(const[key,fn]of Object.entries(po.methods))nav[key]=fn.bind(nav)
po.onLoad.call(nav);po.onShow.call(nav);nav.controller.state.phase=5;nav.review(true)
po.onPageScroll.call(nav,{scrollTop:100});const back=nav.review(false)
assert.equal(nav.state.review,true,'summary remains until native scroll reset completes')
assert.equal(scrollRequests[0].scrollTop,0);scrollRequests.shift().success()
assert.equal(nav.state.review,true);po.onPageScroll.call(nav,{scrollTop:0});scrollResponses.shift()([{scrollTop:0}]);await back
assert.equal(nav.state.review,false);assert.equal(nav.state.paused,true,'scroll reset never resumes demonstration')
nav.review(true);po.onPageScroll.call(nav,{scrollTop:100});const staleBack=nav.review(false)
po.onHide.call(nav);po.onShow.call(nav);scrollRequests.shift().success();scrollResponses.shift()([{scrollTop:0}]);await staleBack
assert.equal(nav.state.review,true,'return callback queued before hide cannot recreate scene')
const home=nav.goHome();assert.equal(homeCalls,0);scrollRequests.shift().success();assert.equal(homeCalls,0)
scrollResponses.shift()([{scrollTop:0}]);await home;assert.equal(homeCalls,1,'navigation occurs after native scroll acknowledgement')
nav.review(true);const replayFromScroll=nav.restart();assert.equal(nav.state.review,true);scrollRequests.shift().success();po.onPageScroll.call(nav,{scrollTop:0});scrollResponses.shift()([{scrollTop:0}]);await replayFromScroll;assert.equal(nav.state.phase,0);assert.equal(nav.state.review,false,'summary replay resets scroll before new scene')
po.onPageScroll.call(nav,{scrollTop:100});nav.controller.state.phase=5;nav.review(true);const staleReplay=nav.restart();po.onHide.call(nav);po.onShow.call(nav);scrollRequests.shift().success();scrollResponses.shift()([{scrollTop:0}]);await staleReplay;assert.equal(nav.state.review,true,'late replay cannot reset after hide')
const oldHome=nav.goHome();po.onHide.call(nav);po.onShow.call(nav);scrollRequests.shift().success();scrollResponses.shift()([{scrollTop:0}]);await oldHome;assert.equal(homeCalls,1,'hidden page cannot navigate on delayed scroll completion')
po.onUnload.call(nav)
// Real layout method, independently ordered nextTick/footer/card callbacks.
const layoutTicks=[],layoutReplies=[]
pc.uni={getWindowInfo:()=>({windowHeight:753}),createSelectorQuery:()=>{const q={in:()=>q,select:()=>q,boundingClientRect:()=>q,selectViewport:()=>q,scrollOffset:()=>q,exec:cb=>layoutReplies.push(cb)};return q}}
const layout={...po.data(),$refs:{scene:{rect:{documentTop:173,height:291}},learning:{}},$nextTick:fn=>layoutTicks.push(fn)}
for(const[key,fn]of Object.entries(po.methods))layout[key]=fn.bind(layout)
po.onLoad.call(layout);po.onShow.call(layout)
layout.measureLayout();layoutTicks.shift()();layoutReplies.shift()([{height:98}]);const oldLayout=layoutReplies.shift()
layout.measureLayout();layoutTicks.shift()();layoutReplies.shift()([{height:98}]);layoutReplies.shift()([{top:398,height:359},{height:200},{scrollTop:100}])
assert.equal(layout.footerHeight,98,'actual fixed footer height reserves safe area once')
assert.equal(layout.sceneMaxHeight,289,'expanded reading and current scroll do not shrink Canvas')
oldLayout([{top:498,height:500},null,{scrollTop:0}]);assert.equal(layout.sceneMaxHeight,289)
layout.measureLayout();layoutTicks.shift()();layoutReplies.shift()([{height:64}]);const hiddenLayout=layoutReplies.shift()
po.onHide.call(layout);po.onShow.call(layout);hiddenLayout([{top:498,height:159},null,{scrollTop:0}]);assert.equal(layout.footerHeight,98)
layout.measureLayout();po.onUnload.call(layout);layoutTicks.shift()();assert.equal(layoutReplies.length,0,'unload invalidates queued layout nextTick')
console.log('Baxiaota game regression passed: manual second pull, easing/resume, takeover, one loop, stale frames, node/image races, retry, lifecycle ordinary summary button, tutorial retry and playback controls.')

// Execute the real review component image handlers, including late callbacks
// from a destroyed retry instance, rather than fixed synchronous image mocks.
const reviewSource=readFileSync('miniapp-uni/word-app1/game-baxiaota/components/GameReview.vue','utf8')
const reviewContext=vm.createContext({assets:{},guides,console:{warn(){}}})
vm.runInContext(reviewSource.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import.*$/gm,'').replace('export default','globalThis.options='),reviewContext)
const ro=reviewContext.options,events=[],retryTicks=[],ri={...ro.data.call({retryToken:2}),retryToken:2,$nextTick:fn=>retryTicks.push(fn),$set:(obj,key,value)=>obj[key]=value,$emit:(...args)=>events.push(args)}
for(const[key,fn]of Object.entries(ro.methods))ri[key]=fn.bind(ri)
const imageEvent=(src,token,detail)=>({currentTarget:{dataset:{src,requestToken:token}},detail})
ri.imageFailed(imageEvent(guides[0],2,{errMsg:'image:fail decode'}));assert.equal(events.at(-1)[1].detail.errMsg,'image:fail decode')
for(const src of guides)ri.imageLoaded(imageEvent(src,2,{width:760,height:1645}))
assert.equal(events.at(-1)[1].allLoaded,true)
const oldImageNode=ri.imageNodes[0]
ri.retryToken=3;ro.watch.retryToken.call(ri);assert.equal(ri.imagesVisible,false);assert.equal(oldImageNode.token,2,'changing prop cannot relabel old node')
const previousEvents=events.length;ri.imageFailed(imageEvent(guides[0],2,{errMsg:'late'}));ri.imageLoaded(imageEvent(guides[0],2,{width:1,height:1}));assert.equal(events.length,previousEvents)
ri.retryToken=4;ro.watch.retryToken.call(ri);retryTicks.shift()();assert.equal(ri.imagesVisible,false,'old retry tick cannot reveal new images');retryTicks.shift()();assert.equal(ri.imagesVisible,true)
assert.equal(ri.imageNodes[0].token,4);assert.notEqual(ri.imageNodes[0].key,oldImageNode.key);assert.equal(oldImageNode.token,2)
ri.imageFailed({detail:{errMsg:'missing node'}});assert.equal(events.length,previousEvents,'missing node identity cannot inherit current token')
const before=events.length;ro.beforeDestroy.call(ri);ri.imageFailed(imageEvent(guides[0],4,{errMsg:'late'}));ri.imageLoaded(imageEvent(guides[0],4,{width:1,height:1}));assert.equal(events.length,before)
for(const group of ro.data().groups)for(const [word]of group.words)assert.ok(!word.includes('\n'))
// Record actual Canvas calls to ensure the final orange head is a filled,
// closed triangle after clearing the trajectory's dash pattern.
for(const phase of [0,2,3]){
 const ops=[],drawing=new Proxy({}, {get:(o,key)=>o[key] || ((...args)=>ops.push([key,...args])),set:(o,key,value)=>{o[key]=value;ops.push([key,value]);return true}})
 renderScene(drawing,{width:390,height:310},{...c.snapshot(),phase,lift:1,reveal:1,tilt:0,zoom:0},{})
 const lastFill=ops.findLastIndex(op=>op[0]==='fill'),clear=ops.findLastIndex(op=>op[0]==='setLineDash' && op[1].length===0)
 assert.ok(clear<lastFill);assert.equal(ops.slice(clear,lastFill).filter(op=>op[0]==='lineTo').length,2);assert.ok(ops.slice(clear,lastFill).some(op=>op[0]==='closePath'))
}
console.log('Device feedback regression passed: solid arrow heads, summary button, mode-preserving controls, image diagnostics/retry and single-line terms.')
