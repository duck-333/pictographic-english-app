import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

// Run against an already compiled local DevTools project (CLI auto port 9420).
// This drives actual compiled Vue/Canvas events, not a mocked controller.
const output=resolve(process.argv[2]),mode=process.argv[3]||'inspect'
mkdirSync(output,{recursive:true})
const socket=new WebSocket('ws://127.0.0.1:'+(process.argv[4]||9420)),pending=new Map();let sequence=0
await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true})})
socket.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(m.error):p.resolve(m.result)}})
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(new Error('timeout '+method))},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})
const run=async(body,args=[])=>{const value=await call('App.callFunction',{functionDeclaration:'function(){var p=getCurrentPages().slice(-1)[0].$vm;'+body+'}',args});return value.result}
const delay=ms=>new Promise(r=>setTimeout(r,ms))
const launch=async()=>{await call('App.callFunction',{functionDeclaration:"function(){return new Promise((resolve,reject)=>wx.reLaunch({url:'/game-baxiaota/pages/index',success:resolve,fail:reject}))}",args:[]});for(let i=0;i<100;i++){const page=await run('return {route:p.$scope.route,ready:p.ready,controller:!!p.controller}');if(page.route==='game-baxiaota/pages/index' && page.ready && page.controller)break;await delay(100);if(i===99)throw Error('game page initialization timeout')}assert.match(await run('return p.controller.pause.toString()'),/generation\+\+/,'DevTools must load final stale-frame fix')}
const scroll=top=>call('App.callFunction',{functionDeclaration:'function(top){return new Promise(resolve=>wx.pageScrollTo({scrollTop:top,duration:0,complete:resolve}))}',args:[top]})
const read=()=>run('return {route:p.$scope.route,state:p.state,ready:p.ready,children:p.$children.map(c=>({name:c.$options._componentTag,loading:c.loading,error:c.error,rect:c.rect,}))}')
const shot=async name=>{const r=await call('App.captureScreenshot',{});writeFileSync(output+'/'+name+'.png',Buffer.from(r.data,'base64'))}
try {
  if(mode==='tutorial-race') {
    await launch();await run('p.controller.state.phase=5;p.review(true)');await delay(1800)
    const nodes=()=>run("var r=p.$children.find(c=>c.imageResults);return new Promise(resolve=>wx.createSelectorQuery().in(r.$scope).selectAll('.screenshot').fields({dataset:true}).exec(v=>resolve(v[0])))")
    const state=()=>run("var r=p.$children.find(c=>c.imageResults);return {token:p.tutorialRetry,componentToken:r.retryToken,nodeTokens:r.imageNodes.map(n=>n.token),error:p.tutorialError,results:r.imageResults,visible:r.imagesVisible}")
    const dispatch=(node,type,detail)=>run("var r=p.$children.find(c=>c.imageResults),node=arguments[0],event={type:arguments[1],timeStamp:Date.now(),target:{dataset:node.dataset},currentTarget:{dataset:node.dataset},detail:arguments[2]};if(typeof r.$scope.__e!=='function')throw Error('compiled dispatcher unavailable');r.$scope.__e(event)",[node,type,detail])
    const loaded=async()=>{for(let i=0;i<60;i++){const s=await state();if(s.visible && s.componentToken===s.token && s.nodeTokens.every(t=>t===s.token) && Object.keys(s.results).length===4 && Object.values(s.results).every(v=>v.loaded))return s;await delay(100)}throw Error('tutorial load timeout')}
    const log=[],old=await nodes();assert.equal(old.length,4);assert.equal(old[0].dataset.requestToken,0)
    log.push({normal:await loaded(),nodes:old})
    await dispatch(old[0],'error',{errMsg:'injected current node failure'});assert.equal((await state()).error,true)
    await run('p.retryTutorial()');const round1=await loaded(),one=await nodes();assert.equal(round1.token,1);assert.equal(round1.error,false);assert.ok(one.every(n=>n.dataset.requestToken===1))
    await dispatch(old[0],'error',{errMsg:'late old error after new success'});assert.deepEqual(await state(),round1)
    await dispatch(old[0],'load',{width:1,height:1});assert.deepEqual(await state(),round1);log.push({newSuccessThenOldErrorAndLoad:'passed',round1})
    await run('p.retryTutorial()');await loaded();const two=await nodes();assert.ok(two.every(n=>n.dataset.requestToken===2));await run('p.retryTutorial()');const round3=await loaded();assert.equal(round3.token,3)
    for(const node of [...old,...one,...two]){await dispatch(node,'error',{errMsg:'late continuous retry'});await dispatch(node,'load',{width:2,height:2})}
    assert.deepEqual(await state(),round3);log.push({continuousRetries:'passed',round3})
    const current=await nodes();await dispatch(current[0],'error',{errMsg:'current round failure'});assert.equal((await state()).error,true)
    await shot('current-failure');await run('p.retryTutorial()');const recovered=await loaded();assert.equal(recovered.token,4);assert.equal(recovered.error,false)
    log.push({currentFailureAndRetry:'passed',recovered,dispatch:'actual compiled component $scope.__e with native node datasets; delayed events injected',developmentCompiledAt:process.argv[5],capturedAt:new Date().toISOString()})
    writeFileSync(output+'/tutorial-race.json',JSON.stringify(log,null,2));await shot('retry-recovered');console.log(JSON.stringify(log))
  } else if(mode==='profile') {
    console.log(JSON.stringify(await run('return {system:wx.getSystemInfoSync(),window:wx.getWindowInfo(),active:p.active,state:p.state}')))
    console.log(JSON.stringify(await run("var s=p.$refs.scene;if(!s || !s.rect)return null;return new Promise(resolve=>wx.createSelectorQuery().in(s.$scope).select('#bxt-scene').boundingClientRect(r=>resolve({rect:r,stored:s.rect,parentScroll:p.scrollTop,childScroll:s.scrollTop,client:s.point({clientX:r.left+r.width/2,clientY:r.top+r.height/2})})).exec())")))
  } else if(mode==='home-layout') {
    await call('App.callFunction',{functionDeclaration:"function(){return new Promise(resolve=>wx.reLaunch({url:'/pages/index/index',complete:resolve}))}",args:[]});await delay(1800)
    const data=await run("var c=p.$children.find(c=>c.restorePosition);return new Promise(resolve=>wx.createSelectorQuery().in(c.$scope).selectAll('.bxt-area,.bxt-entry').boundingClientRect(r=>resolve({rects:r,bounds:c.bounds,geometry:c.areaGeometry,position:{x:c.x,y:c.y},measurement:p.gameEntryMeasurement,system:wx.getSystemInfoSync(),window:wx.getWindowInfo()})).exec())")
    assert.ok(data.rects[1].bottom<=data.bounds.bottom-16+.5,'complete floating entry and label clear measured navigation')
    assert.equal(data.rects[1].height,110)
    await shot('home-entry');await run("var c=p.$children.find(c=>c.restorePosition);c.side='right';c.ratio=1;c.restorePosition()")
    await delay(500)
    const restored=await run("var c=p.$children.find(c=>c.restorePosition);return new Promise(resolve=>wx.createSelectorQuery().in(c.$scope).select('.bxt-entry').boundingClientRect(r=>resolve({rect:r,bounds:c.bounds,maxY:c.maxY})).exec())")
    assert.ok(restored.rect.bottom<=restored.bounds.bottom-16+.5);await shot('home-restored-bottom')
    writeFileSync(output+'/home-layout.json',JSON.stringify({data,restored,developmentCompiledAt:process.argv[5],capturedAt:new Date().toISOString()},null,2));console.log(JSON.stringify({data,restored}))
  } else if(mode==='image-diagnostic') {
    await launch();await run('p.controller.state.phase=5;p.review(true)');await delay(4000)
    const data=await run("var r=p.$children.find(c=>c.imageResults);return {results:r.imageResults,steps:r.steps,error:p.tutorialError}")
    writeFileSync(output+'/image-diagnostic.json',JSON.stringify(data,null,2));await shot('image-diagnostic');console.log(JSON.stringify(data))
  } else if(mode==='feedback') {
    await launch();await delay(1500)
    const records=[]
    const controls=()=>run("return new Promise(resolve=>wx.createSelectorQuery().select('.controls').boundingClientRect(resolve).exec())")
    const initial=await controls();records.push({stage:'initial',controls:initial});await shot('feedback-initial')
    await run('p.demo()')
    for(const phase of [1,2,3,5]) {
      for(let i=0;i<600;i++){const state=(await read()).state;if(state.phase===phase && !state.textLeaving && !state.lessonLeaving && (phase!==2 || state.lift===1) && (phase!==3 || state.reveal>=.99))break;await delay(40);if(i===599)throw Error('phase timeout '+phase)}
      // Screenshot latency can outlast a stage's brief wait. Pause the real
      // demonstration before capture, then continue its retained tasks/mode.
      await run('p.pause()')
      const rect=await controls();assert.equal(rect.top,initial.top);assert.equal(rect.bottom,initial.bottom)
      const meta=await run("var s=p.$refs.scene;return {state:p.state,scrollTop:p.scrollTop,rect:s.rect,bitmap:{width:s.canvas.width,height:s.canvas.height},DPR:wx.getWindowInfo().pixelRatio}")
      records.push({stage:phase,controls:rect,...meta});await shot('feedback-stage-'+phase)
      if(phase!==5)await run('p.pauseOrContinue()')
    }
    const finalLayout=await run("var l=p.$children.find(c=>c.lesson);return new Promise(resolve=>wx.createSelectorQuery().select('.summary-button').boundingClientRect().exec(r=>wx.createSelectorQuery().in(l.$scope).select('.learning').boundingClientRect(card=>resolve({button:r[0],card})).exec()))")
    assert.ok(finalLayout.button.bottom<=finalLayout.card.top);records.push({finalLayout})
    await run('p.reading(true)');await delay(200);await scroll(100);await delay(300);assert.deepEqual(await controls(),initial)
    for(let i=0;i<50;i++){if(await run('return p.$refs.scene.scrollTop===p.scrollTop && p.scrollTop===100'))break;await delay(100);if(i===49)throw Error('scroll prop synchronization timeout')}
    const mapping=await run("var s=p.$refs.scene;return new Promise(resolve=>wx.createSelectorQuery().in(s.$scope).select('#bxt-scene').boundingClientRect(r=>resolve({client:s.point({clientX:r.left+r.width/2,clientY:r.top+r.height/2}),local:s.point({x:r.width/2,y:r.height/2})})).exec())")
    assert.ok(Math.abs(mapping.client.x-195)<.01 && Math.abs(mapping.client.y-155)<.01);assert.equal(mapping.local.y,155);records.push({scrollMapping:mapping})
    await scroll(10000);await delay(400)
    const readingBottom=await run("var l=p.$children.find(c=>c.lesson);return new Promise(resolve=>wx.createSelectorQuery().in(l.$scope).select('.reading').boundingClientRect(resolve).exec())")
    assert.ok(readingBottom.bottom<=initial.top,'scrollable explanation clears fixed controls');await shot('feedback-expanded-bottom')
    await scroll(0);await delay(300);await run('p.reading(false)');await delay(200)
    const page=await call('App.getCurrentPage',{}),element=await call('Page.getElement',{pageId:page.pageId,selector:'.summary-button'})
    await call('Element.tap',{pageId:page.pageId,elementId:element.elementId});await delay(1500)
    assert.equal((await read()).state.review,true);assert.equal(await controls(),null)
    const review=await run("var r=p.$children.find(c=>c.imageResults);return new Promise(resolve=>wx.createSelectorQuery().in(r.$scope).selectAll('.word').fields({rect:true,size:true,dataset:true,computedStyle:['font-size','line-height','white-space','font-family']}).exec(result=>{var ctx=wx.createOffscreenCanvas({type:'2d',width:1,height:1}).getContext('2d');var words=result[0].map(w=>{ctx.font=w['font-size']+' Arial';w.textWidth=ctx.measureText(w.dataset.word).width;return w});resolve({words,images:r.imageResults,token:p.tutorialRetry})}))")
    for(const result of Object.values(review.images)){assert.equal(result.loaded,true);assert.equal(result.width,760);assert.equal(result.height,1645)}
    assert.equal(Object.keys(review.images).length,4)
    for(const word of review.words){assert.equal(word['white-space'],'nowrap');assert.ok(word.height<=parseFloat(word['line-height'])+1);assert.ok(word.textWidth<=word.width,'English term fits its measured column')}
    records.push({review});await shot('feedback-summary')
    for(const top of [1250,2050,2900]){await scroll(top);await delay(300);await shot('feedback-tutorial-'+top)}
    await run("var r=p.$children.find(c=>c.imageResults);return new Promise(resolve=>wx.createSelectorQuery().in(r.$scope).select('.screenshot').fields({dataset:true}).exec(v=>{r.$scope.__e({type:'error',target:{dataset:v[0].dataset},currentTarget:{dataset:v[0].dataset},detail:{errMsg:'injected retry regression'}});resolve()}))")
    assert.equal(await run('return p.tutorialError'),true);await run('p.retryTutorial()');await delay(1500)
    const retry=await run('return {token:p.tutorialRetry,error:p.tutorialError,images:p.$children.find(c=>c.imageResults).imageResults,phase:p.state.phase}')
    assert.equal(retry.token,review.token+1);assert.equal(retry.error,false);assert.equal(retry.phase,5);assert.equal(Object.keys(retry.images).length,4);for(const image of Object.values(retry.images))assert.equal(image.loaded,true)
    records.push({retry,diagnosticInjection:true,developmentCompiledAt:process.argv[5],capturedAt:new Date().toISOString()})
    writeFileSync(output+'/feedback-results.json',JSON.stringify(records,null,2));console.log(JSON.stringify(records))
  } else if(mode==='layout') {
    await launch();await delay(1800)
    const layout=await run("return new Promise(resolve=>wx.createSelectorQuery().select('.progress').boundingClientRect().select('.heading').boundingClientRect().select('.letters').boundingClientRect().select('.hint').boundingClientRect().select('.controls').boundingClientRect().select('.phone').boundingClientRect().exec(r=>resolve({rects:r,windowInfo:wx.getWindowInfo(),state:p.state})))")
    const footerStyle=await run("return new Promise(resolve=>wx.createSelectorQuery().select('.controls').fields({rect:true,size:true,computedStyle:['padding-bottom','padding-top','background-color','border-top-width','box-shadow','position']}).selectAll('.control-button').fields({rect:true,size:true,computedStyle:['color','line-height']}).exec(r=>resolve({footer:r[0],buttons:r[1]})))")
    const card=await run("var l=p.$children.find(c=>c.lesson && c.lesson.body);return new Promise(resolve=>wx.createSelectorQuery().in(l.$scope).selectAll('.learning,.main,.read').boundingClientRect(resolve).exec())")
    const canvas=await run("var s=p.$refs.scene;return {rect:s.rect,bitmap:{width:s.canvas.width,height:s.canvas.height},center:s.point({x:s.rect.width/2,y:s.rect.height/2})}")
    const progress=layout.rects[0],heading=layout.rects[1],letters=layout.rects[2],controls=layout.rects[4]
    assert.ok(controls.bottom<=layout.windowInfo.windowHeight+1/layout.windowInfo.pixelRatio+.01,'iPhone initial controls fit visible viewport within one bitmap pixel')
    const safeBottom=layout.windowInfo.screenHeight-layout.windowInfo.safeArea.bottom
    assert.equal(footerStyle.footer.position,'fixed');assert.ok(parseFloat(footerStyle.footer['padding-bottom'])>=safeBottom,'footer content clears bottom safe area')
    assert.equal(footerStyle.footer['border-top-width'],'0px');assert.equal(footerStyle.footer['box-shadow'],'none')
    assert.equal(footerStyle.buttons.length,3)
    for(const b of footerStyle.buttons){assert.ok(b.height>=44);assert.equal(b.color,'rgb(100, 131, 153)')}
    assert.ok(card[2].bottom<=controls.top,'detail entry remains above fixed controls')
    assert.ok(Math.abs(canvas.rect.width/canvas.rect.height-390/310)<.001,'Canvas stays proportional')
    assert.equal(canvas.center.x,195);assert.equal(canvas.center.y,155)
    const system=await run('return wx.getSystemInfoSync()')
    const meta={...layout,system,footerStyle,card,canvas,developmentCompiledAt:process.argv[5],capturedAt:new Date().toISOString()};writeFileSync(output+'/layout.json',JSON.stringify(meta,null,2));await shot('layout-initial');console.log(JSON.stringify(meta))
  } else if(mode==='inspect') {
    await launch();await delay(1800)
    console.log(JSON.stringify(await call('Tool.getInfo',{})))
    console.log(JSON.stringify(await read()));await shot('initial')
  } else if(mode.startsWith('reentry')) {
    for(let i=0;i<3;i++) {await launch();await delay(1500);await run('p.reading(true)');await delay(200);await scroll(100);await delay(300);assert.equal((await run('return p.scrollTop')),100);if(mode.includes('reset')){await scroll(0);await delay(200)}await run('return p.goHome()');await delay(500)}
    await launch();await delay(1800);await run('p.pause()')
    const meta=await run("var s=p.$children.find(c=>c.rect && c.start);return {state:p.state,scrollTop:p.scrollTop,rect:s.rect,bitmap:{width:s.canvas.width,height:s.canvas.height},windowInfo:wx.getWindowInfo()}")
    meta.capturedAt=new Date().toISOString();meta.developmentCompiledAt=process.argv[5]||null;writeFileSync(output+'/'+mode+'.json',JSON.stringify(meta,null,2));if(!mode.endsWith('-raw'))await shot(mode+'-interface');console.log(JSON.stringify(meta))
  } else if(mode.startsWith('display-')) {
    const stage=mode.slice(8).replace(/-(raw|refresh)$/,'')
    await launch();await delay(1800);await scroll(0)
    if(mode.endsWith('-refresh')){await scroll(1);await delay(200);await scroll(0);await delay(200)}
    if(stage!=='A') {
      await run('p.demo()')
      for(let i=0;i<500;i++) {
        const s=(await read()).state
        if(!s.textLeaving && !s.lessonLeaving && (stage==='arch' && s.phase===2 && s.lift===1 || stage==='building' && s.phase===3 && s.reveal===1 || stage==='final' && s.phase===5))break
        await delay(50)
        if(i===499)throw Error('stage timeout '+stage)
      }
    }
    await run('p.pause()');await delay(500)
    const meta=await run("var s=p.$children.find(c=>c.rect && c.start);return {state:p.state,scrollTop:p.scrollTop,rect:s.rect,bitmap:{width:s.canvas.width,height:s.canvas.height},windowInfo:wx.getWindowInfo(),pauseSource:p.controller.pause.toString()}")
    meta.capturedAt=new Date().toISOString();meta.developmentCompiledAt=process.argv[5]||null;writeFileSync(output+'/'+mode+'.json',JSON.stringify(meta,null,2));if(!mode.endsWith('-raw'))await shot(mode+'-interface');console.log(JSON.stringify(meta))
  } else if(mode==='manual') {
    await launch();await delay(2000)
    const log=[]
    const gesture=async(kind,x,y)=>run("var s=p.$children.find(c=>c.rect && c.start);var t={x:arguments[1]*s.rect.width/390,y:arguments[2]*s.rect.height/310,identifier:1};if(arguments[0]==='start')s.start({touches:[t]});else if(arguments[0]==='move')s.move({touches:[t]});else s.end();return p.state",[kind,x,y])
    assert.equal((await read()).ready,true)
    await run('p.reading(true)');await delay(200);await scroll(100);await delay(400)
    const mapping=await run("var s=p.$children.find(c=>c.rect && c.start);return new Promise(resolve=>wx.createSelectorQuery().in(s.$scope).select('#bxt-scene').boundingClientRect(r=>resolve({scrollTop:p.scrollTop,client:s.point({clientX:r.left+r.width/2,clientY:r.top+r.height/2}),local:s.point({x:r.width/2,y:r.height/2}),rect:r})).exec())")
    assert.ok(mapping.scrollTop>0 && mapping.scrollTop<=100,'short initial card may clamp native scroll below requested 100px');assert.ok(Math.abs(mapping.client.x-195)<.01 && Math.abs(mapping.client.y-155)<.01);assert.equal(mapping.local.y,155);log.push({requestedScroll:100,scrollMapping:mapping})
    await scroll(0);await delay(300);await run('p.reading(false);p.restart()');await delay(500)
    await shot('01-angle');await gesture('start',195,88);await gesture('end',195,88);await delay(900);await run('p.pause()');await delay(300);await run('p.pauseOrContinue()');await delay(2200)
    assert.equal((await read()).state.phase,1);assert.equal((await read()).state.demo,false);await shot('02-angle-rotated')
    const r=Math.hypot(48,121),a=2*Math.atan2(48,121)
    await gesture('start',195+r*Math.cos(a),230-r*Math.sin(a))
    for(let i=1;i<=20;i++){const angle=a+(Math.PI-a)*i/20;await gesture('move',195+r*Math.cos(angle),230-r*Math.sin(angle));await delay(30)}
    await gesture('end',195-r,230);await shot('03-arc-wait');await run('p.reading(true)');await delay(200);await run('p.reading(false)');await run('p.pauseOrContinue()');await delay(2200)
    assert.equal((await read()).state.topReady,true);assert.equal((await read()).state.phase,1);assert.equal((await read()).state.demo,false);await shot('04-arc-ready')
    await gesture('start',195,230-r);await gesture('move',195,230-r-85);await gesture('end',195,230-r-85)
    assert.equal((await read()).state.phase,2);assert.equal((await read()).state.lift,1)
    await delay(400);await shot('05-arch-second-pull-wait');await delay(1000)
    assert.equal((await read()).state.phase,2)
    await gesture('start',195,50);await gesture('move',195,25);await gesture('end',195,25)
    await delay(700);await run('p.reading(true)');const frozen=(await read()).state.reveal;await delay(1200)
    assert.equal((await read()).state.reveal,frozen);await shot('06-reveal-detail-paused')
    await run('p.reading(false)');await delay(300);assert.equal((await read()).state.reveal,frozen)
    await run('p.pauseOrContinue()');await delay(1400);assert.equal((await read()).state.reveal,1);assert.equal((await read()).state.demo,false);await shot('07-building')
    await gesture('start',191,157);await gesture('move',191,292);await gesture('end',191,292)
    assert.equal((await read()).state.phase,5);await delay(400);await shot('08-final')
    await run('p.openSummary()')
    assert.equal((await read()).state.review,true);await delay(500);await shot('09-review')
    await scroll(1300);await delay(400);await shot('10-tutorial')
    await scroll(2100);await delay(400);await shot('11-tutorial-detail')
    await scroll(3000);await delay(400);await shot('12-tutorial-video-home')
    await run('p.review(false)');await delay(800);assert.equal(await run('return p.scrollTop'),0,'summary return resets native scroll before Canvas recreation');await shot('13-review-return');assert.equal((await read()).ready,true);assert.equal((await read()).state.paused,true)
    await run('p.review(true)');await scroll(3000);await delay(300);await run('p.restart()');await delay(800);assert.equal(await run('return p.scrollTop'),0);assert.equal((await read()).state.phase,0);await shot('14-summary-replay')
    log.push({manual:'passed',secondPull:'distinct',pauseReveal:frozen,reviewBack:'paused and reacquired Canvas',restart:'initial'})
    await run('p.demo()');await delay(1100);await run('p.pause()');const tilt=(await read()).state.tilt;await delay(1100)
    assert.equal((await read()).state.tilt,tilt);await run('p.pauseOrContinue()');await delay(30000)
    assert.equal((await read()).state.phase,5);log.push({demo:'passed',rotationPauseResume:tilt})
    await run('p.review(true)');await run('return p.goHome()');await delay(600)
    log.push({home:await call('App.getCurrentPage',{})});writeFileSync(output+'/simulator-results.json',JSON.stringify(log,null,2));console.log(JSON.stringify(log))
  } else if(mode==='record') {
    await launch();await delay(2000)
    if(process.argv[6]==='paired') {
      const readyAt=Date.now();writeFileSync(output+'/capture-ready.json',JSON.stringify({readyAt}))
      while(!existsSync(output+'/capture-start.json') || JSON.parse(readFileSync(output+'/capture-start.json')).startedAt<readyAt)await delay(50)
    } else await delay(3000)
    await run('p.demo()');const start=Date.now(),frames=[]
    for(let i=0;i<130;i++) {
      const target=start+i*250;if(target>Date.now())await delay(target-Date.now())
      const before=await run("var s=p.$children.find(c=>c.rect && c.start);return {state:p.state,scrollTop:p.scrollTop,rect:s.rect,bitmap:{width:s.canvas.width,height:s.canvas.height},DPR:wx.getWindowInfo().pixelRatio}")
      const r=await call('App.captureScreenshot',{});const file='demo-'+String(i).padStart(3,'0')+'.png'
      writeFileSync(output+'/'+file,Buffer.from(r.data,'base64'));frames.push({file,elapsed:Date.now()-start,capturedAt:Date.now(),before,developmentCompiledAt:process.argv[5]||null})
      if((await read()).state.phase===5){
        for(let j=0;j<50;j++){const final=(await read()).state;if(!final.textLeaving && !final.lessonLeaving && final.copyKey===5)break;await delay(50)}
        const before=await run("var s=p.$refs.scene;return {state:p.state,scrollTop:p.scrollTop,rect:s.rect,bitmap:{width:s.canvas.width,height:s.canvas.height},DPR:wx.getWindowInfo().pixelRatio}")
        const last=await call('App.captureScreenshot',{}),file='demo-'+String(frames.length).padStart(3,'0')+'.png'
        writeFileSync(output+'/'+file,Buffer.from(last.data,'base64'));frames.push({file,elapsed:Date.now()-start,capturedAt:Date.now(),before,developmentCompiledAt:process.argv[5]||null});break
      }
    }
    writeFileSync(output+'/demo-frames.json',JSON.stringify(frames));console.log({frames:frames.length,final:await read()})
  }
} finally { socket.close() }
