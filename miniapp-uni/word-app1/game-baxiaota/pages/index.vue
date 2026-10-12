<template>
  <view class="game-page" :class="{'review-page':state.review}"><view class="phone">
    <view class="progress"><view :style="'width:'+progress+'%'"/></view>
    <game-review v-if="state.review" :retry-token="tutorialRetry" :returning="returning" @home="goHome" @back="review(false)" @restart="restart" @image-error="tutorialFailed" @image-load="tutorialLoaded"/>
    <view v-else>
      <view class="heading" :class="{leaving:state.textLeaving}"><text class="title">{{ copy[0] }}</text><text class="subtitle">{{ copy[1] }}</text></view>
      <view class="letters"><text v-for="(letter,index) in letters" :key="index" class="letter" :style="letter.style">{{ letter.text }}</text></view>
      <game-scene ref="scene" :state="state" :active="active" :scroll-top="scrollTop" :max-height="sceneMaxHeight" @gesture="gesture" @ready="sceneReady"/>
      <view class="hint" :class="{leaving:state.textLeaving}"><button v-if="state.phase===5" class="summary-button" @tap="openSummary">查看总结</button><text v-else>{{ copy[2] }}</text></view><game-learning ref="learning" :state="state" @reading="reading"/>
      <view class="controls-space" :style="footerHeight?'height:'+footerHeight+'px':''"/>
      <view class="controls"><button class="control-button" @tap="restart">重新体验</button><button class="control-button" :disabled="!ready || state.reading" @tap="demo">{{ state.demo && !state.paused?'暂停演示':'自动演示' }}</button><button class="control-button" :disabled="!ready || state.reading || state.phase===5" @tap="pauseOrContinue">{{ state.paused?'继续':'暂停' }}</button></view>
    </view>
    <view v-if="state.review && tutorialError" class="error"><text>教程图片加载失败</text><button @tap="retryTutorial">重试教程</button></view><text v-if="error" class="error">{{ error }}</text>
  </view></view>
</template>
<script>
import GameScene from '../components/GameScene.vue'
import GameLearning from '../components/GameLearning.vue'
import GameReview from '../components/GameReview.vue'
import {createGameController,clamp} from '../common/game-controller.js'
import {texts} from '../common/game-content.js'
import {returnToSearchHome} from '../common/navigation.js'
export default {
  components:{GameScene,GameLearning,GameReview},
  data(){return {state:{phase:0,tilt:0,arc:0,lift:0,reveal:0,zoom:0,copyKey:0,lessonKey:'angle'},active:false,ready:false,returning:false,error:'',tutorialError:false,tutorialRetry:0,scrollTop:0,footerHeight:0,sceneMaxHeight:0}},
  onLoad(){this.layoutRequestId=0;this.pageSequence=0;this.disposed=false;this.controller=createGameController({onChange:state=>{if(!this.disposed)this.state=state}});this.state=this.controller.snapshot()},
  onShow(){this.active=true},
  onPageScroll(event){this.scrollTop=event.scrollTop},
  onHide(){this.layoutRequestId++;this.pageSequence++;this.active=false;this.controller.pause()},
  onResize(){if(this.$refs.scene){this.controller.pause();this.$refs.scene.initialize()}},
  onUnload(){this.layoutRequestId++;this.pageSequence++;this.disposed=true;this.active=false;this.controller.destroy()},
  computed:{
    copy(){return texts[this.state.copyKey]},
    progress(){const s=this.state;return 8+92*(s.tilt+s.arc+s.lift+s.reveal+s.zoom)/5},
    letters(){const s=this.state,values=[1,s.phase>1?1:clamp((s.arc-.1)/.3),s.phase>1?1:clamp((s.arc-.5)/.4),clamp(s.lift/.85),clamp(s.reveal/.8)];let count=1;values.forEach((v,i)=>{if(v>.02)count=i+1});return ['A','r','c','h','a'].map((text,i)=>({text:i===0 && (s.phase!==0 || s.tilt>=.84)?'a':text,style:'opacity:'+values[i]+';transform:translate('+((i-(count-1)/2)*57)+'px,'+(12*(1-values[i]))+'px);'}))}
  },
  methods:{
    sceneReady(value){this.ready=value;if(!value && (this.state.tilt>0 || this.state.phase>0 || this.state.demo))this.controller.pause();if(value)this.measureLayout()},
    measureLayout(){
      const ticket=++this.layoutRequestId,scene=this.$refs.scene,learning=this.$refs.learning
      const valid=()=>ticket===this.layoutRequestId && !this.disposed && this.active && !this.state.review && scene===this.$refs.scene && scene && scene.rect && learning===this.$refs.learning
      this.$nextTick(()=>{
        if(!valid() || !learning)return
        uni.createSelectorQuery().select('.controls').boundingClientRect().exec(result=>{
          if(!valid() || !result[0])return
          const footer=result[0]
          uni.createSelectorQuery().in(learning).select('.learning').boundingClientRect().select('.reading').boundingClientRect().selectViewport().scrollOffset().exec(parts=>{
            if(!valid() || !parts[0])return
            const card=parts[0],reading=parts[1],scroll=parts[2],info=uni.getWindowInfo?uni.getWindowInfo():uni.getSystemInfoSync()
            const gap=card.top+(scroll?scroll.scrollTop:this.scrollTop)-scene.rect.documentTop-scene.rect.height
            const available=info.windowHeight-scene.rect.documentTop-gap-(card.height-(reading?reading.height:0))-footer.height
            this.footerHeight=Math.ceil(footer.height)
            const height=Math.max(120,Math.floor(available*2)/2)
            if(Math.abs(this.sceneMaxHeight-height)>1)this.sceneMaxHeight=height
          })
        })
      })
    },
    gesture(e){if(!this.ready)return;if(e.kind==='start')this.controller.touchStart(e.point,e.id);else if(e.kind==='move')this.controller.touchMove(e.point,e.id);else if(e.kind==='end')this.controller.touchEnd(e.id);else this.controller.cancelTouch()},
    demo(){if(this.state.paused){this.controller.resume();if(this.state.demo)return}this.controller.toggleDemo()},pause(){this.controller.pause()},pauseOrContinue(){if(this.state.paused)this.controller.resume();else this.controller.pause()},reading(value){this.controller.setReading(value)},
    restart(){const ticket=++this.pageSequence,reset=()=>{if(ticket!==this.pageSequence || this.disposed || !this.active)return;this.controller.reset();this.tutorialError=false;this.$nextTick(()=>{if(ticket===this.pageSequence && !this.disposed && this.active && this.$refs.scene)this.$refs.scene.initialize()})};if(this.scrollTop>0){this.controller.pause();return this.resetScroll().then(reset).catch(()=>{if(ticket===this.pageSequence && !this.disposed)this.error='暂时无法重玩，请重试。'})}reset()},
    review(value){if(value || this.scrollTop===0){this.controller.setReview(value);return}const ticket=++this.pageSequence;return this.resetScroll().then(()=>{if(ticket===this.pageSequence && !this.disposed && this.active)this.controller.setReview(false)}).catch(()=>{if(ticket===this.pageSequence && !this.disposed)this.error='暂时无法返回场景，请重试。'})},
    resetScroll(){return new Promise((resolve,reject)=>uni.pageScrollTo({scrollTop:0,duration:0,success:()=>uni.createSelectorQuery().selectViewport().scrollOffset().exec(()=>resolve()),fail:reject}))},
    openSummary(){if(this.active && !this.disposed && this.ready && this.state.phase===5 && !this.state.review)this.review(true)},
    tutorialFailed(info){if(!this.disposed && this.active && this.state.review && info.token===this.tutorialRetry)this.tutorialError=true},
    tutorialLoaded(info){if(!this.disposed && this.active && this.state.review && info.token===this.tutorialRetry && info.allLoaded)this.tutorialError=false},
    retryTutorial(){if(this.disposed || !this.active || !this.state.review)return;this.tutorialError=false;this.tutorialRetry++},
    async goHome(){if(this.returning)return;const ticket=++this.pageSequence;this.controller.pause();this.returning=true;this.error='';try{if(this.scrollTop>0)await this.resetScroll();if(ticket!==this.pageSequence || this.disposed || !this.active)return;await returnToSearchHome()}catch(error){this.error='暂时无法返回，请再次点击开始查词。'}finally{this.returning=false}}
  }
}
</script>
<style scoped>
.game-page{min-height:100vh;background:#fff;padding:0;color:#123f60}.phone{position:relative;margin:auto;padding:12px 24px 0;background:#fff;overflow:hidden}
.review-page .phone{padding-bottom:calc(16px + env(safe-area-inset-bottom))}
.progress{height:2px;margin-top:0;background:#dce9f0}.progress view{height:100%;background:#ed8000}
.heading{margin:18px 0 10px;min-height:63px}.title{display:block;font-size:24px;font-weight:600;line-height:1.5}.subtitle{display:block;margin-top:5px;font-size:13px;color:#648399}.leaving{opacity:0}
.letters{position:relative;height:60px;margin:auto;max-width:310px}.letter{position:absolute;left:50%;margin-left:-25px;width:50px;height:60px;border-radius:15px;background:#f0f8fc;text-align:center;font:600 34px/60px Arial}
.hint{display:block;min-height:22px;text-align:center;color:#ed8000;font-size:13px;margin:4px 0;line-height:1.6}.summary-button{display:inline-block;margin:0;padding:0 20px;min-height:44px;background:#ed8000;color:#fff;font-size:14px;line-height:44px;border-radius:12px}.summary-button::after{border:0}.controls-space{height:calc(64px + env(safe-area-inset-bottom))}.controls{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;justify-content:space-between;gap:6px;padding:16px 24px calc(4px + env(safe-area-inset-bottom));background:#fff;border:0;box-shadow:none}.controls button{flex:1;margin:0;min-height:44px;padding:0;background:transparent;color:#648399;font-size:12px;line-height:44px}.controls button::after{border:0}
.error{display:block;margin-top:16px;font-size:14px;color:#a34b00}
@media(max-width:350px){.phone{padding:12px 20px 0}.controls{padding-left:20px;padding-right:20px}}
</style>
