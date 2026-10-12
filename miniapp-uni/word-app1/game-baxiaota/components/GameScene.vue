<template>
  <view class="scene-shell">
    <canvas type="2d" id="bxt-scene" class="scene" :style="'width:'+sceneWidth+'px;height:'+sceneHeight+'px'" :disable-scroll="true"
      @touchstart="start" @touchmove.stop.prevent="move" @touchend="end" @touchcancel="cancelTouch" />
    <view v-if="loading || error" class="feedback"><text>{{ error || '正在准备探索画面…' }}</text><button v-if="error" @tap="initialize">重试加载</button></view>
  </view>
</template>
<script>
import { createAssetLoader } from '../common/game-assets.js'
import { mapPoint } from '../common/game-controller.js'
import { renderScene } from '../common/scene-renderer.js'
export default {
  props: { state: Object, active: Boolean, maxHeight:{type:Number,default:0}, scrollTop: {type:Number,default:0} },
  data() { return { loading: true, error: '', sceneHeight: 286,sceneWidth:360 } },
  watch: { maxHeight(){if(this.active)this.initialize()},state() { this.paint() }, active(value) { if(value)this.initialize();else this.invalidate() } },
  mounted() { this.loader=createAssetLoader();this.requestId=0;this.dead=false;if(this.active)this.initialize() },
  beforeDestroy() { this.dead=true;this.invalidate() },
  methods: {
    invalidate() {
      this.requestId++;if(this.loader)this.loader.invalidate()
      this.canvas=null;this.context=null;this.rect=null;this.images=null;this.touchId=null;this.$emit('ready',false)
    },
    initialize() {
      this.invalidate()
      const ticket=this.requestId, valid=()=>!this.dead && this.active && ticket===this.requestId
      const windowInfo=uni.getWindowInfo?uni.getWindowInfo():uni.getSystemInfoSync()
      if(Number.isFinite(windowInfo.windowWidth)){
        const height=(windowInfo.windowWidth-(windowInfo.windowWidth<=350?16:24))*310/390
        this.sceneHeight=this.maxHeight>0?Math.min(height,this.maxHeight):height
        this.sceneWidth=this.sceneHeight*390/310
      }
      this.loading=true;this.error=''
      this.$nextTick(()=>{
        if(!valid())return
        uni.createSelectorQuery().in(this).select('#bxt-scene').fields({node:true,size:true,rect:true}).selectViewport().scrollOffset().exec(async results=>{
          const result=results[0], measuredScroll=results[1] && results[1].scrollTop
          if(!valid())return
          if(!result || !result.node || !result.width || !result.height){this.loading=false;this.error='画布尚未就绪，请重试';return}
          try {
            const documentTop=result.top+(Number.isFinite(measuredScroll)?measuredScroll:this.scrollTop)
            const canvas=result.node,info=uni.getWindowInfo?uni.getWindowInfo():uni.getSystemInfoSync()
            canvas.width=Math.round(result.width*info.pixelRatio);canvas.height=Math.round(result.height*info.pixelRatio)
            const context=canvas.getContext('2d'),images=await this.loader.load(canvas)
            if(!valid() || !images)return
            this.canvas=canvas;this.context=context;this.images=images
            this.rect={left:result.left,top:result.top,width:result.width,height:result.height,documentTop}
            this.loading=false;this.paint();this.$emit('ready',true)
          }catch(error){if(valid()){this.loading=false;this.error='图片加载失败，请重试'}}
        })
      })
    },
    paint() { if(!this.dead && this.active && this.context && this.images)renderScene(this.context,this.canvas,this.state,this.images) },
    point(touch) {
      // Canvas native x/y are relative; clientX/clientY use the measured viewport rect.
      if(Number.isFinite(touch.x) && Number.isFinite(touch.y))return {x:touch.x*390/this.rect.width,y:touch.y*310/this.rect.height}
      return mapPoint(touch,{...this.rect,top:this.rect.documentTop-this.scrollTop})
    },
    start(event) {
      if(this.loading || this.error || !this.rect)return
      if(event.touches.length!==1){this.cancelTouch();return}
      const touch=event.touches[0];this.touchId=touch.identifier==null?0:touch.identifier
      this.$emit('gesture',{kind:'start',point:this.point(touch),id:this.touchId})
    },
    move(event) {
      if(!this.rect || this.touchId==null)return
      if(event.touches.length!==1){this.cancelTouch();return}
      const touch=event.touches[0],id=touch.identifier==null?0:touch.identifier
      if(id===this.touchId)this.$emit('gesture',{kind:'move',point:this.point(touch),id})
    },
    end() { if(this.touchId!=null)this.$emit('gesture',{kind:'end',id:this.touchId});this.touchId=null },
    cancelTouch() { this.touchId=null;this.$emit('gesture',{kind:'cancel'}) }
  }
}
</script>
<style scoped>
.scene-shell { position:relative;margin:8px -12px 0; }
.scene { display:block;margin:0 auto; }
.feedback { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f0f8fc;color:#648399;font-size:14px; }
.feedback button { margin-top:12px;font-size:14px; }
</style>
