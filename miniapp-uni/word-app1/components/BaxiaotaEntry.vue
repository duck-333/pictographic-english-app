<template>
  <movable-area v-if="visible" class="bxt-area" :style="areaStyle">
    <movable-view v-if="positionReady"
      class="bxt-entry" direction="all" :x="x" :y="y"
      :inertia="false" :out-of-bounds="false" :scale="false" :animation="false"
      :disabled="opening || settling"
      @change="onPositionChange" @touchstart="onTouchStart"
      @touchmove.stop.prevent="onTouchMove" @touchend="onTouchEnd"
      @touchcancel="onTouchCancel" @tap.stop="openGame"
    >
      <image class="bxt-image" src="/static/baxiaota/entry.png" mode="aspectFit" :draggable="false" />
      <view class="bxt-label">{{ opening ? '进入中…' : '新手游戏' }}</view>
    </movable-view>
  </movable-area>
</template>

<script>
const POSITION_KEY = 'pictographic:baxiaotaEntryPosition'
const GAME_URL = '/game-baxiaota/pages/index'
const clamp = (value, max) => Math.max(0, Math.min(max, value))

export default {
  name: 'BaxiaotaEntry',
  props: {
    active: Boolean,
    searchFocused: Boolean,
    // Page viewport excludes the native navigation bar. bottom is the measured
    // top of BottomNav, whose own height already includes the safe area.
    bounds: { type: Object, default: () => ({ width: 0, bottom: 0 }) }
  },
  data() {
    return {
      x: 0, y: 0, currentX: 0, currentY: 0,
      side: 'right', ratio: 1, keyboardHeight: 0,
      positionReady: false, opening: false, settling: false, moved: false,
      touching: false, startPoint: null
    }
  },
  computed: {
    maxX() { return Math.max(0, this.bounds.width - 24 - 80) },
    maxY() { return Math.max(0, this.bounds.bottom - 16 - 110) },
    visible() {
      return this.active && !this.searchFocused && !this.keyboardHeight &&
        this.bounds.width >= 104 && this.bounds.bottom >= 126
    },
    areaStyle() {
      return `width:${Math.max(0, this.bounds.width - 24)}px;height:${Math.max(0, this.bounds.bottom - 16)}px;`
    }
  },
  watch: {
    bounds() { this.restorePosition() },
    active(value) {
      if (value) { this.opening = false; this.restorePosition() }
    },
    visible(value) {
      if (value) this.restorePosition()
      else { this.positionReady = false; this.cancelGesture() }
    }
  },
  mounted() {
    try {
      const saved = uni.getStorageSync(POSITION_KEY)
      if (saved && (saved.side === 'left' || saved.side === 'right') && Number.isFinite(saved.ratio)) {
        this.side = saved.side
        this.ratio = clamp(saved.ratio, 1)
      }
    } catch (error) { /* Storage unavailable: use the default position. */ }
    this.restorePosition()
    this.keyboardListener = ({ height }) => { this.keyboardHeight = Math.max(0, Number(height) || 0) }
    uni.onKeyboardHeightChange(this.keyboardListener)
  },
  beforeDestroy() {
    this.disposed = true
    this.cancelGesture()
    uni.offKeyboardHeightChange(this.keyboardListener)
  },
  methods: {
    restorePosition() {
      this.cancelGesture()
      this.positionReady = false
      this.x = this.currentX = this.side === 'left' ? 0 : this.maxX
      this.y = this.currentY = this.ratio * this.maxY
      // Native movable-view clamps initial x/y against its area's measured
      // dimensions. Mount it only after that area has completed native layout.
      this.$nextTick(() => {
        if (this.disposed || !this.visible) return
        uni.createSelectorQuery().in(this).select('.bxt-area').boundingClientRect(rect => {
          if (!this.disposed && this.visible && rect && rect.width > 0 && rect.height > 0) this.positionReady = true
        }).exec()
      })
    },
    cancelGesture() {
      clearTimeout(this.settleTimer)
      this.touching = false
      this.startPoint = null
      this.moved = true
      this.settling = false
    },
    onPositionChange(event) {
      if (!this.touching || !event.detail || event.detail.source !== 'touch') return
      this.currentX = clamp(event.detail.x, this.maxX)
      this.currentY = clamp(event.detail.y, this.maxY)
    },
    onTouchStart(event) {
      if (this.opening || this.settling) return
      if (!event.touches || event.touches.length !== 1) { this.moved = true; return }
      this.moved = false
      this.touching = true
      this.startPoint = event.touches[0]
    },
    trackMovement(point) {
      if (!this.startPoint || !point) return
      const dx = point.clientX - this.startPoint.clientX
      const dy = point.clientY - this.startPoint.clientY
      if (Math.sqrt(dx * dx + dy * dy) > 6) this.moved = true
    },
    onTouchMove(event) {
      if (!this.touching) return
      if (event.touches.length !== 1) this.moved = true
      this.trackMovement(event.touches[0])
    },
    onTouchEnd(event) {
      if (!this.touching) return
      this.trackMovement(event.changedTouches && event.changedTouches[0])
      this.touching = false
      this.startPoint = null
      // Always restore the edge, even a sub-threshold move. Tap handling is
      // separate; a real drag remains suppressed until the next touch starts.
      this.snapToEdge(this.moved)
    },
    onTouchCancel() {
      if (!this.touching) return
      this.touching = false
      this.startPoint = null
      this.moved = true
      this.snapToEdge(true)
    },
    snapToEdge(save) {
      this.side = this.currentX + 40 <= (this.bounds.width - 24) / 2 ? 'left' : 'right'
      this.ratio = this.maxY ? clamp(this.currentY, this.maxY) / this.maxY : 0
      // First sync Vue with the native dragged position, then set the target.
      this.x = this.currentX
      this.y = this.currentY
      this.settling = save
      this.$nextTick(() => {
        if (this.disposed || !this.visible) return
        this.x = this.currentX = this.side === 'left' ? 0 : this.maxX
        this.y = this.currentY = this.ratio * this.maxY
        if (!save) return
        this.settleTimer = setTimeout(() => {
          this.settling = false
          try { uni.setStorageSync(POSITION_KEY, { side: this.side, ratio: this.ratio }) } catch (error) { /* Position is optional. */ }
        }, 80)
      })
    },
    openGame() {
      if (!this.visible || !this.positionReady || this.moved || this.touching || this.settling || this.opening) return
      this.opening = true
      uni.showLoading({ title: '正在进入游戏', mask: false })
      uni.navigateTo({
        url: GAME_URL,
        fail: () => {
          this.opening = false
          uni.showToast({ title: '暂时无法进入，请再试一次', icon: 'none' })
        },
        complete: () => { uni.hideLoading() }
      })
    }
  }
}
</script>

<style scoped>
.bxt-area { position: fixed; top: 0; left: 12px; z-index: 35; pointer-events: none; }
.bxt-entry { width: 80px; height: 110px; pointer-events: auto; }
.bxt-image { display: block; width: 80px; height: 88px; }
.bxt-label { height: 22px; border-radius: 11px; background: #fe8500; color: #fff; font-size: 12px; font-weight: 600; line-height: 22px; text-align: center; }
</style>
