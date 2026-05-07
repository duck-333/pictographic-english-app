<template>
  <view class="page" v-if="word">
    <view class="hero card">
      <text class="word">{{ word.word }}</text>
      <text class="phonetic">{{ word.phonetic }}</text>
      <text class="meaning">{{ word.meaning }}</text>
      <text class="book-page">书中索引：第 {{ word.bookPage }} 页</text>
    </view>

    <view class="section card">
      <text class="section-title">象形拆解</text>
      <view class="parts">
        <view v-for="part in word.parts" :key="part.text" class="part-chip">
          <text class="part-text">{{ part.text }}</text>
          <text class="part-meaning">{{ part.meaning }}</text>
        </view>
      </view>
    </view>

    <view class="section card">
      <text class="section-title">讲解说明</text>
      <text class="desc">{{ word.pictograph }}</text>
    </view>

    <view class="section card">
      <text class="section-title">视频讲解占位</text>
      <text class="video-title">{{ word.videoTitle }}</text>
      <text class="video-meta">时长：{{ word.videoDuration }}</text>
      <button class="video-button" @tap="showVideoTip">后面接真实视频</button>
    </view>
  </view>

  <view v-else class="page">
    <view class="empty card">
      <text class="empty-title">没有找到这个单词</text>
      <text class="empty-text">你可以返回首页重新搜索。</text>
      <button class="back-button" @tap="goBack">返回首页</button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { WORDS, getWordById } from '../../common/mock-data'

const word = ref(null)

onLoad((options) => {
  const rawId = options && (options.id || options.word) ? decodeURIComponent(options.id || options.word) : 'study'
  const normalizedId = rawId.replace(/^word-/, '')
  word.value = getWordById(rawId) || getWordById(normalizedId) || WORDS[0]
})

function showVideoTip() {
  uni.showToast({
    title: '下一步再接真实视频',
    icon: 'none'
  })
}

function goBack() {
  uni.navigateBack({
    fail() {
      uni.reLaunch({
        url: '/pages/index/index'
      })
    }
  })
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 32rpx;
}

.hero {
  padding: 30rpx;
  background: linear-gradient(150deg, #0f4c81 0%, #2a6fa6 100%);
}

.word {
  display: block;
  font-size: 52rpx;
  font-weight: 700;
  color: #ffffff;
}

.phonetic {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.78);
}

.meaning {
  display: block;
  margin-top: 18rpx;
  font-size: 30rpx;
  line-height: 1.6;
  color: #ffffff;
}

.book-page {
  display: inline-block;
  margin-top: 18rpx;
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.16);
  font-size: 24rpx;
  color: #e7f1fb;
}

.section {
  margin-top: 24rpx;
  padding: 28rpx;
}

.section-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #16324f;
}

.parts {
  display: flex;
  flex-wrap: wrap;
  gap: 18rpx;
  margin-top: 22rpx;
}

.part-chip {
  min-width: 180rpx;
  padding: 18rpx 20rpx;
  border-radius: 20rpx;
  background: #eef6ff;
}

.part-text {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: #0f4c81;
}

.part-meaning {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #597896;
}

.desc,
.video-title,
.video-meta,
.empty-text {
  display: block;
  margin-top: 18rpx;
  font-size: 28rpx;
  line-height: 1.8;
  color: #274d73;
}

.video-meta {
  font-size: 24rpx;
  color: #7b91a8;
}

.video-button,
.back-button {
  margin-top: 24rpx;
  height: 82rpx;
  line-height: 82rpx;
  border-radius: 18rpx;
  background: #0f4c81;
  color: #ffffff;
  font-size: 28rpx;
}

.empty {
  margin-top: 80rpx;
  padding: 40rpx 28rpx;
  text-align: center;
}

.empty-title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  color: #16324f;
}
</style>
