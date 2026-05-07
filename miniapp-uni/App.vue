<template>
  <view class="app-shell">
    <slot />
  </view>
</template>

<style>
page {
  background: #f4f9ff;
  color: #16324f;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
}

view,
text,
button,
input {
  box-sizing: border-box;
}

.card {
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 8rpx 28rpx rgba(22, 50, 79, 0.08);
}
</style>
