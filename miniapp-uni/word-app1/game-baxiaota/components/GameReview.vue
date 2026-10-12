<template>
  <view class="review">
    <view class="heading"><image class="mascot" :src="reading" mode="aspectFit"/><text class="eyebrow">学习回顾</text><text class="title">从一个角，认识一组词</text><text class="muted">把刚才动过的形状，和词根连起来。</text></view>
    <view class="columns"><view v-for="(group,index) in groups" :key="group.root" class="column" :class="'col-'+index">
      <view class="root"><view v-if="index!==1" class="shape" :class="index===0?'mark-arc':'mark-gate'"/><text v-else class="shape">∩</text><text class="root-word">{{ group.root }}</text><text class="meaning">{{ group.meaning }}</text><text class="note">{{ group.note }}</text></view><text class="note">关联单词</text>
      <view v-for="word in group.words" :key="word[0]" class="entry"><text class="word" :class="{long:word[0].length>10}" :data-word="word[0]">{{ word[0] }}</text><text class="definition">{{ word[1] }}</text></view>
    </view></view>
    <view class="guide"><text class="bridge">接下来，继续探索 ↓</text><text class="eyebrow">在象形英语小程序里</text><text class="title">探索更多单词的形与义</text><text class="muted">接下来，回到查词首页，探索更多单词的形与义吧！</text>
      <view class="benefit"><text>配合视频讲解，形与义更好理解</text><text class="muted">跟着讲解一步步看，把刚才的象形发现，变成理解单词的线索。</text></view>
      <view v-for="(step,index) in imageSteps" :key="index" class="step"><view class="step-heading"><text class="number">0{{ index+1 }}</text><view><text class="step-title">{{ step.title }}</text><text class="muted">{{ step.description }}</text></view></view>
        <view v-if="imagesVisible"><image v-for="image in step.images" :key="image.key" class="screenshot" :src="image.src" :data-src="image.src" :data-request-token="image.token" mode="widthFix" @error="imageFailed" @load="imageLoaded"/></view>
      </view>
      <text class="lookup">用象形的视角拆解单词，带着一个单词出发吧</text><button class="home" :loading="returning" :disabled="returning" @tap="$emit('home')">开始查词</button><text class="foot">搜索单词·查看拆解·观看讲解</text>
    </view>
    <view class="actions"><button @tap="$emit('back')">回看最后的画面</button><button @tap="$emit('restart')">重新体验</button></view>
  </view>
</template>
<script>
import { assets,guides } from '../common/game-assets.js'
export default { props:{returning:Boolean,retryToken:Number},data(){return {imageResults:{},imagesVisible:true,imageNodes:guides.map(src=>({src,token:this.retryToken,key:this.retryToken+':'+src})),reading:assets.reading,
  groups:[
    {root:'arc-',shape:'⌒',meaning:'弧',note:'a · 角　r · 转动　c · 圆弧',words:[['arc','n. 弧；弧线'],['arcade','n. 拱廊'],['arciform','adj. 弓形的'],['arcuate','adj. 弧形的；弯曲的'],['Arctic','adj. 北极的；n. 北极']]},
    {root:'arch-',shape:'∩',meaning:'拱形',note:'弧有了高度，成为一座拱门。',words:[['arch','n. 拱；拱门'],['archer','n. 弓箭手'],['archive','n. 档案；v. 存档']]},
    {root:'archa-',shape:'⚑',meaning:'起始点',note:'拱门、小旗与道路的起点。',words:[['archaeology','n. 考古学'],['archaeologic','adj. 考古学的'],['archaeological','adj. 考古学的'],['archaeologist','n. 考古学家']]}
  ],steps:[{title:'搜索单词',description:'输入你想了解的英文单词。',images:guides.slice(0,2)},
    {title:'点开词条',description:'进入单词详情，查看象形拆解。',images:guides.slice(2,3)},
    {title:'观看视频',description:'跟着讲解，一步步理解形与义的联系。',images:guides.slice(3)}]
}},computed:{imageSteps(){return this.steps.map(step=>({...step,images:step.images.map(src=>this.imageNodes.find(node=>node.src===src))}))}},watch:{retryToken(){const ticket=this.retryToken;this.imagesVisible=false;this.imageResults={};this.$nextTick(()=>{if(!this.dead && ticket===this.retryToken){this.imageNodes=guides.map(src=>({src,token:ticket,key:ticket+':'+src}));this.imagesVisible=true}})}},beforeDestroy(){this.dead=true},methods:{
  imageRequest(event){const dataset=event && event.currentTarget && event.currentTarget.dataset;if(!dataset)return null;const token=Number(dataset.requestToken),src=dataset.src;if(this.dead || !Number.isInteger(token) || token!==this.retryToken || !guides.includes(src))return null;return {token,src}},
  imageFailed(event){const request=this.imageRequest(event);if(!request)return;const {src,token}=request,detail=event.detail || {};this.$set(this.imageResults,src,{loaded:false,errMsg:detail.errMsg || 'unknown image error'});console.warn('[baxiaota tutorial]',src,detail);this.$emit('image-error',{token,src,detail})},
  imageLoaded(event){const request=this.imageRequest(event);if(!request)return;const {src,token}=request;this.$set(this.imageResults,src,{loaded:true,width:event.detail.width,height:event.detail.height});this.$emit('image-load',{token,src,allLoaded:guides.every(path=>this.imageResults[path] && this.imageResults[path].loaded)})}
} }
</script>
<style scoped>
.review { color:#123f60; }.heading { position:relative;margin:26px 0 25px;padding-right:65px; }.mascot { position:absolute;right:-25px;top:-20px;width:123px;height:130px; }
.eyebrow { display:block;color:#ed8000;font-size:12px; }.title { display:block;margin-top:8px;font-size:22px;line-height:1.5;font-weight:600; }.muted { display:block;font-size:12px;line-height:1.7;color:#648399;margin-top:8px; }
.columns { display:flex;gap:8px;margin:0 -12px; }.column { flex:1;min-width:0;padding:13px 9px;border-radius:16px;background:#f0f8fc; }.col-2 { flex:1.22; }.root { min-height:163px;padding-bottom:12px; }
.shape { display:block;height:33px;margin-bottom:7px;font-size:28px;color:#ed8000; }.root-word { display:block;margin-bottom:5px;font:600 23px Arial; }.meaning { font-size:13px; }.note { display:block;margin-top:7px;font-size:11px;line-height:1.65;color:#648399; }
.mark-arc,.mark-gate{position:relative;width:28px}.mark-arc::before{content:"";position:absolute;left:1px;top:8px;width:26px;height:13px;border:2px solid #ed8000;border-bottom:0;border-radius:13px 13px 0 0;box-sizing:border-box}.mark-gate::before{content:"";position:absolute;left:3px;top:3px;width:22px;height:24px;background:#ed8000;border-radius:1px}.mark-gate::after{content:"";position:absolute;left:9px;top:10px;width:10px;height:17px;background:#f0f8fc;border-radius:6px 6px 0 0}
.entry { padding:13px 0;min-height:98px;border-top:1px solid #dce9f0; }.word { display:block;white-space:nowrap;font-size:14px;line-height:1.45;font-family:Arial; }.word.long { font-size:12px;margin:0 -3px; }.definition { display:block;font-size:12px;line-height:1.65;margin-top:6px; }
.guide { margin-top:32px; }.bridge,.foot { display:block;text-align:center;color:#648399;font-size:11px;margin:20px 0; }.benefit { margin-top:18px;padding:16px;border-radius:14px;background:#f0f8fc;font-size:14px; }.step { margin-top:24px; }.step-heading { display:flex;gap:12px; }.number { color:#ed8000;font-size:22px; }.step-title { font-size:15px;font-weight:600; }
.screenshot { display:block;width:150px;max-width:100%;margin:18px auto 0;border-radius:9px; }.lookup { display:block;margin:26px auto 22px;font-size:17px;line-height:1.8;text-align:center; }.home { min-height:56px;padding:16px 24px;border-radius:16px;background:#123f60;color:#f0f8fc;font-size:19px;line-height:1.4; }
.actions { display:flex;justify-content:space-between;margin-top:20px; }.actions button { margin:0;min-height:44px;padding:8px 0;background:transparent;color:#648399;font-size:12px; }.actions button::after { border:0; }
@media(max-width:350px){.columns{gap:6px;margin:0 -13px}.column{padding:12px 7px}.root{min-height:177px}.root-word{font-size:21px}.word{font-size:13px}.word.long{font-size:11px}}
</style>
