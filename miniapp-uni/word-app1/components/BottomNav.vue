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
        <view class="i-a"></view>
        <view class="i-b"></view>
        <view class="i-c"></view>
      </view>
      <text class="nav-label">{{ item.label }}</text>
      <view v-if="item.path === current" class="nav-dot"></view>
    </view>
  </view>
</template>

<script>
import { NAV_ITEMS } from '../common/mock-data.js'

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

<style>
.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  justify-content: space-around;
  padding: 14rpx 80rpx calc(14rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid rgba(169, 226, 255, 0.25);
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 -8rpx 40rpx rgba(14, 58, 92, 0.07);
}

.nav-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 128rpx;
  padding: 8rpx 0 4rpx;
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
  margin-top: 8rpx;
  font-size: 22rpx;
  font-weight: 600;
}

.nav-dot {
  width: 8rpx;
  height: 8rpx;
  margin-top: 8rpx;
  border-radius: 999rpx;
  background: #fe8500;
}

.nav-icon {
  position: relative;
  width: 44rpx;
  height: 44rpx;
}

.nav-icon.search .i-a {
  width: 25rpx;
  height: 25rpx;
  border: 4rpx solid currentColor;
  border-radius: 999rpx;
}

.nav-icon.search .i-b {
  position: absolute;
  right: 4rpx;
  bottom: 5rpx;
  width: 18rpx;
  height: 4rpx;
  border-radius: 999rpx;
  background: currentColor;
  transform: rotate(45deg);
}

.nav-icon.mine .i-a {
  position: absolute;
  left: 11rpx;
  top: 4rpx;
  width: 22rpx;
  height: 22rpx;
  border: 4rpx solid currentColor;
  border-radius: 999rpx;
}

.nav-icon.mine .i-b {
  position: absolute;
  left: 5rpx;
  bottom: 3rpx;
  width: 34rpx;
  height: 18rpx;
  border: 4rpx solid currentColor;
  border-top-left-radius: 22rpx;
  border-top-right-radius: 22rpx;
  border-bottom: 0;
}

.nav-icon .i-c {
  display: none;
}
</style>
