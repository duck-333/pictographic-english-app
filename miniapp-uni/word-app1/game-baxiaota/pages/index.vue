<template>
  <view class="game-page">
    <view class="game-card">
      <text class="eyebrow">巴小塔 · 象形探索</text>
      <text class="title">一起发现单词里的形状</text>
      <text class="description">探索游戏正在准备中，先带着一个单词出发吧。</text>
      <button class="home-button" :loading="returning" :disabled="returning" @tap="goHome">开始查词</button>
      <text v-if="error" class="error">{{ error }}</text>
    </view>
  </view>
</template>

<script>
import { returnToSearchHome } from '../common/navigation.js'

export default {
  data() { return { returning: false, error: '' } },
  methods: {
    async goHome() {
      if (this.returning) return
      this.returning = true
      this.error = ''
      try { await returnToSearchHome() } catch (error) {
        this.error = '暂时无法返回，请再次点击开始查词。'
      } finally { this.returning = false }
    }
  }
}
</script>

<style scoped>
.game-page { min-height: 100vh; padding: 64rpx 32rpx calc(40rpx + env(safe-area-inset-bottom)); background: #f0f9ff; }
.game-card { padding: 48rpx 36rpx; border-radius: 28rpx; background: #fff; }
.eyebrow, .title, .description, .error { display: block; }
.eyebrow { color: #648399; font-size: 24rpx; }
.title { margin-top: 24rpx; color: #123f60; font-size: 40rpx; font-weight: 600; line-height: 1.5; }
.description { margin-top: 24rpx; color: #648399; font-size: 28rpx; line-height: 1.8; }
.home-button { margin-top: 48rpx; border-radius: 20rpx; background: #123f60; color: #fff; font-size: 32rpx; }
.error { margin-top: 24rpx; color: #a34b00; font-size: 26rpx; line-height: 1.6; }
</style>
