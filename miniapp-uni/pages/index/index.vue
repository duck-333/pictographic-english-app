<template>
  <view class="page">
    <view class="hero">
      <text class="hero-title">象形英语</text>
      <text class="hero-subtitle">先用本地假数据跑通查词首页和详情页</text>
    </view>

    <view class="search-box card">
      <input
        :value="query"
        class="search-input"
        placeholder="请输入英文单词，比如 study"
        confirm-type="search"
        @input="handleQueryInput"
        @confirm="runSearch"
      />
      <button class="search-button" @tap="runSearch">搜索</button>
    </view>

    <view class="section">
      <text class="section-title">热门搜索</text>
      <view class="hot-list">
        <view
          v-for="item in hotWords"
          :key="item"
          class="hot-tag"
          @tap="useHotWord(item)"
        >
          {{ item }}
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-head">
        <text class="section-title">搜索结果</text>
        <text class="section-tip">共 {{ results.length }} 个</text>
      </view>

      <view v-if="results.length" class="result-list">
        <view
          v-for="item in results"
          :key="item.id"
          class="result-card card"
          @tap="openDetail(item.id)"
        >
          <view class="result-top">
            <text class="word">{{ item.word }}</text>
            <text class="phonetic">{{ item.phonetic }}</text>
          </view>
          <text class="meaning">{{ item.meaning }}</text>
          <text class="meta">书中页码：第 {{ item.bookPage }} 页</text>
        </view>
      </view>

      <view v-else class="empty-box card">
        <text class="empty-title">暂时没搜到这个词</text>
        <text class="empty-text">你可以先试试 study、student、transport 或 structure。</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { HOT_WORDS, WORDS, searchWords } from '../../common/mock-data'

const query = ref('')
const hotWords = HOT_WORDS
const results = ref(WORDS)

function handleQueryInput(event) {
  query.value = event && event.detail ? event.detail.value : ''
}

function runSearch() {
  results.value = searchWords(query.value)
}

function useHotWord(word) {
  query.value = word
  runSearch()
}

function openDetail(id) {
  uni.navigateTo({
    url: `/pages/word-detail/index?id=${id}`
  })
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 32rpx;
}

.hero {
  padding: 24rpx 4rpx 16rpx;
}

.hero-title {
  display: block;
  font-size: 48rpx;
  font-weight: 700;
  color: #0f4c81;
}

.hero-subtitle {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: #6c86a0;
}

.search-box {
  display: flex;
  gap: 20rpx;
  align-items: center;
  padding: 24rpx;
}

.search-input {
  flex: 1;
  height: 84rpx;
  padding: 0 24rpx;
  border-radius: 18rpx;
  background: #f3f8fd;
  font-size: 28rpx;
}

.search-button {
  width: 160rpx;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 18rpx;
  background: #0f4c81;
  color: #ffffff;
  font-size: 28rpx;
}

.section {
  margin-top: 28rpx;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #16324f;
}

.section-tip {
  font-size: 24rpx;
  color: #7b91a8;
}

.hot-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 18rpx;
}

.hot-tag {
  padding: 16rpx 24rpx;
  border-radius: 999rpx;
  background: #e7f1fb;
  color: #0f4c81;
  font-size: 26rpx;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-top: 18rpx;
}

.result-card {
  padding: 26rpx;
}

.result-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 20rpx;
}

.word {
  font-size: 38rpx;
  font-weight: 700;
  color: #0f4c81;
}

.phonetic {
  font-size: 24rpx;
  color: #7b91a8;
}

.meaning {
  display: block;
  margin-top: 14rpx;
  font-size: 28rpx;
  line-height: 1.6;
  color: #274d73;
}

.meta {
  display: block;
  margin-top: 14rpx;
  font-size: 24rpx;
  color: #7b91a8;
}

.empty-box {
  margin-top: 18rpx;
  padding: 36rpx 28rpx;
  text-align: center;
}

.empty-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #16324f;
}

.empty-text {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: #7b91a8;
}
</style>
