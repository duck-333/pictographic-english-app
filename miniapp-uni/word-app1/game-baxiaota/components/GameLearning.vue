<template>
  <view class="learning">
    <view class="main" :class="{leaving:state.lessonLeaving}"><text class="eyebrow">象形释义</text>
      <view class="title"><text class="term">{{ state.lessonKey === 'angle' ? (state.tilt &lt; .84 ? 'A' : 'a') : lesson.term }}</text><text>{{ lesson.meaning }}</text></view><text class="link">{{ lesson.link }}</text></view>
    <image v-if="pose" class="pet" :src="pose" mode="aspectFit" />
    <view v-if="state.wordVisible" class="word"><text class="eyebrow">单词</text><text>{{ lesson.word }}</text></view>
    <button v-if="!state.reading" class="read" @tap="$emit('reading',true)">详情 ＋</button>
    <view v-else class="reading"><text v-for="(item,index) in lesson.body" :key="index" :class="item.type">{{ item.text }}</text><button class="read" @tap="$emit('reading',false)">收起 －</button></view>
  </view>
</template>
<script>
import { lessons } from '../common/game-content.js'
import { assets } from '../common/game-assets.js'
export default { props:{state:Object},computed:{
  lesson(){return lessons[this.state.lessonKey]},
  pose(){return this.state.phase===0?assets.wave:this.state.phase===1?assets.compass:this.state.phase===5?assets.celebrate:''}
} }
</script>
<style scoped>
.learning { position:relative;margin-top:8px;padding:16px 18px 8px;border-radius:18px;background:#f0f8fc;color:#123f60; }
.main { min-height:88px;padding-right:88px; }.leaving { opacity:0; }
.eyebrow { display:block;color:#648399;font-size:11px; }
.title { display:flex;align-items:baseline;gap:16px;margin:7px 0;font-size:16px;font-weight:600; }
.term { font:600 30px/1.2 Arial; }.link { display:block;min-height:22px;font-size:13px;line-height:1.7; }
.pet { position:absolute;width:164px;height:164px;right:-25px;top:-33px;pointer-events:none; }
.word { min-height:49px;margin-top:8px;padding-top:9px;border-top:1px solid #dce9f0;font-size:13px;line-height:1.65; }
.read { display:block;width:100%;margin:0;padding:8px 0;min-height:44px;border:0;background:transparent;color:#ed8000;text-align:left;font-size:12px; }.read::after { border:0; }
.reading { padding-top:12px;border-top:1px solid #dce9f0; }.h3,.p { display:block;margin-bottom:12px;font-size:13px;line-height:1.8; }.h3 { font-weight:600;font-size:14px;margin-bottom:6px; }
</style>
