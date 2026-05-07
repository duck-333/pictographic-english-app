<template>
  <view class="page">
    <text class="title">关系网</text>
    <text class="desc">这个页面后面会承接原 demo 的词根关系网络。</text>
    <button class="back" @tap="goHome">回到查词</button>
  </view>
</template>

<script>
export default {
  methods: {
    goHome() {
      uni.reLaunch({ url: '/pages/index/index' })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 96rpx 36rpx;
  background: #f0f9ff;
}
.title {
  display: block;
  color: #0e3a5c;
  font-size: 44rpx;
  font-weight: 700;
}
.desc {
  display: block;
  margin-top: 18rpx;
  color: #6baed6;
  font-size: 28rpx;
  line-height: 1.7;
}
.back {
  margin-top: 36rpx;
  background: #0e3a5c;
  color: #ffffff;
  border-radius: 24rpx;
}
</style>
