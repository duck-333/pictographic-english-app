<template>
  <view class="bottom-nav">
    <view
      v-for="item in navItems"
      :key="item.path"
      class="nav-item"
      :class="{ active: item.path === current }"
      hover-class="nav-item-pressed"
      hover-stay-time="80"
      :data-path="item.path"
      @tap="openNavFromEvent"
    >
      <view class="nav-icon" :class="item.icon">
        <view v-if="item.icon === 'mine'" class="i-a"></view>
        <view v-if="item.icon === 'mine'" class="i-b"></view>
      </view>
      <text class="nav-label">{{ item.label }}</text>
      <view class="nav-dot" :class="{ visible: item.path === current }"></view>
    </view>
  </view>
</template>

<script>
import { NAV_ITEMS } from '../common/word-repository.js'

export default {
  name: 'BottomNav',
  props: {
    current: {
      type: String,
      default: '/pages/index/index'
    }
  },
  data() {
    return {
      navItems: NAV_ITEMS
    }
  },
  methods: {
    openNavFromEvent(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      this.openNav(dataset.path)
    },
    openNav(path) {
      if (!path) return
      if (path === this.current) return
      uni.reLaunch({ url: path })
    }
  }
}
</script>

<style scoped>
.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 72rpx calc(10rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(10rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid rgba(169, 226, 255, 0.25);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 -10rpx 36rpx rgba(14, 58, 92, 0.09);
}

.nav-item {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  min-width: 0;
  min-height: 98rpx;
  padding: 4rpx 0 2rpx;
  color: #6baed6;
  transition: transform 0.16s ease, opacity 0.16s ease;
}

.nav-item-pressed {
  opacity: 0.72;
  transform: scale(0.96);
}

.nav-item.active {
  color: #0e3a5c;
}

.nav-label {
  display: block;
  min-height: 30rpx;
  font-size: 23rpx;
  font-weight: 700;
  line-height: 30rpx;
}

.nav-dot {
  width: 7rpx;
  height: 7rpx;
  border-radius: 999rpx;
  background: #fe8500;
  opacity: 0;
}

.nav-dot.visible {
  opacity: 1;
}

.nav-icon {
  position: relative;
  width: 42rpx;
  height: 42rpx;
}

.nav-icon.search {
  overflow: visible;
  transform: rotate(-45deg);
  transform-origin: 50% 50%;
}

.nav-icon.search::before {
  content: "";
  position: absolute;
  left: 6rpx;
  top: 1rpx;
  width: 30rpx;
  height: 30rpx;
  box-sizing: border-box;
  border: 4rpx solid currentColor;
  border-radius: 999rpx;
}

.nav-icon.search::after {
  content: "";
  position: absolute;
  left: 19rpx;
  top: 27rpx;
  width: 4rpx;
  height: 15rpx;
  border-radius: 999rpx;
  background: currentColor;
}

.nav-icon.mine .i-a {
  position: absolute;
  left: 11rpx;
  top: 1rpx;
  width: 20rpx;
  height: 20rpx;
  border: 4rpx solid currentColor;
  border-radius: 999rpx;
}

.nav-icon.mine .i-b {
  position: absolute;
  left: 4rpx;
  bottom: 1rpx;
  width: 34rpx;
  height: 17rpx;
  border: 4rpx solid currentColor;
  border-top-left-radius: 24rpx;
  border-top-right-radius: 24rpx;
  border-bottom: 0;
}

</style>
