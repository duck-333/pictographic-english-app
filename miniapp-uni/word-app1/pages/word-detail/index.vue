<template>
  <view class="page">
    <view class="topbar">
      <button class="back-button" hover-class="button-pressed" @tap="goBack">返回</button>
      <view class="tools" v-if="word">
        <view class="tool-button" hover-class="button-pressed" @tap="toggleBookmark">
          <view class="bookmark" :class="{ active: bookmarked }"></view>
        </view>
        <view class="tool-button" hover-class="button-pressed" @tap="openFeedback">
          <text class="tool-text">反馈</text>
        </view>
      </view>
    </view>

    <view v-if="word">
      <view class="hero">
        <view class="hero-ghost">{{ word.parts && word.parts.length ? word.parts[0].text : word.word }}</view>
        <view class="type-badge">{{ word.cardType || '单词' }} · {{ word.level }}</view>
        <view class="word-line">
          <text class="word">{{ word.word }}</text>
          <text class="phonetic">{{ word.phonetic }}</text>
        </view>
        <text class="meaning">{{ word.meaning }}</text>
        <text v-if="word.bookPage" class="book-page">书中索引：第 {{ word.bookPage }} 页</text>
      </view>

      <view v-if="word.parts && word.parts.length" class="section card">
        <text class="section-eyebrow">象形拆解</text>
        <view class="parts">
          <block v-for="(part, index) in word.parts" :key="part.text">
            <view
              class="part-chip"
              :class="{ selected: expandedPart === part.text }"
              :style="{ backgroundColor: part.bgColor, borderColor: expandedPart === part.text ? part.color : part.borderColor }"
              hover-class="chip-pressed"
              :data-part-text="part.text"
              :data-target-id="part.targetId || ''"
              @tap="handlePartTap"
            >
              <text class="part-text" :style="{ color: part.color }">{{ part.text }}</text>
              <text class="part-meaning">{{ part.meaning }}</text>
              <text v-if="part.targetId" class="part-action">点进</text>
            </view>
            <text v-if="index < word.parts.length - 1" class="plus">+</text>
          </block>
          <text class="equals">=</text>
          <text class="equals-word">{{ word.word }}</text>
        </view>
        <view v-if="expandedPart" class="part-detail">
          <text class="part-detail-title">{{ expandedPart }}</text>
          <text class="part-detail-text">{{ activePartMeaning }}</text>
          <text class="part-detail-link">这个节点暂未配置下一级卡片。</text>
        </view>
      </view>

      <view v-else class="section card">
        <text class="section-eyebrow">节点说明</text>
        <text class="desc">{{ word.tip }}</text>
      </view>

      <view class="section card">
        <view class="title-row">
          <text class="section-title">完整意象</text>
          <text class="mini-action" hover-class="text-pressed" @tap="toggleDesc">{{ showFullDesc ? '收起' : '展开' }}</text>
        </view>
        <text class="desc" :class="{ folded: !showFullDesc }">{{ word.pictograph }}</text>
      </view>

      <view class="section card">
        <text class="section-title">例句</text>
        <view v-if="word.examples && word.examples.length">
          <view v-for="item in word.examples" :key="item.english" class="example">
            <text class="example-en">{{ item.english }}</text>
            <text class="example-cn">{{ item.chinese }}</text>
          </view>
        </view>
        <text v-else class="desc">例句稍后补充。</text>
      </view>

      <view v-if="relatedWords.length" class="section card">
        <text class="section-title">同族词</text>
        <view class="related-list">
          <view
            v-for="item in relatedWords"
            :key="item.id"
            class="related-chip"
            hover-class="chip-pressed"
            :data-id="item.id"
            @tap="openDetailFromEvent"
          >
            <text class="related-word">{{ item.word }}</text>
            <text class="related-level">{{ item.level }}</text>
          </view>
        </view>
      </view>

      <view class="section video-card">
        <view>
          <text class="video-title">{{ word.videoTitle }}</text>
          <text class="video-meta">时长 {{ word.videoDuration }} · 视频打点待接入</text>
        </view>
        <button class="play-button" hover-class="button-pressed" @tap="showVideoTip">
          <view class="play-triangle"></view>
        </button>
      </view>
    </view>

    <view v-else class="empty-state">
      <view class="empty-mark">象</view>
      <text class="empty-title">暂未收录这个单词</text>
      <text class="empty-description">{{ notFoundDescription }}</text>
      <button class="empty-action" hover-class="empty-action-pressed" @tap="openFeedback">提交缺词反馈</button>
    </view>

    <view class="bottom-nav">
      <view class="nav-item active" hover-class="nav-item-pressed" @tap="goHome">
        <view class="nav-icon search">
          <view class="i-a"></view>
          <view class="i-b"></view>
          <view class="i-c"></view>
        </view>
        <text class="nav-label">查词</text>
        <view class="nav-dot"></view>
      </view>
      <view class="nav-item" hover-class="nav-item-pressed" @tap="goMine">
        <view class="nav-icon mine">
          <view class="i-a"></view>
          <view class="i-b"></view>
          <view class="i-c"></view>
        </view>
        <text class="nav-label">我的</text>
      </view>
    </view>
  </view>
</template>

<script>
import { getRelatedWords, getWordById, getWordByWord } from '../../common/mock-data.js'
import { addRecentWord, getPendingWordId, isFavorite, savePendingWordId, toggleFavorite } from '../../common/user-store.js'

export default {
  data() {
    return {
      word: null,
      relatedWords: [],
      bookmarked: false,
      expandedPart: '',
      activePartMeaning: '',
      showFullDesc: true,
      notFoundQuery: '',
      notFoundDescription: '这个单词还没有讲解内容，可以提交缺词反馈。'
    }
  },
  onLoad(options) {
    this.loadWord(options)
  },
  methods: {
    loadWord(options) {
      const optionValue = options && (options.id || options.word) ? options.id || options.word : ''
      const fallbackValue = optionValue || getPendingWordId() || 'word-study'
      const raw = decodeURIComponent(fallbackValue)
      const target = this.resolveLearningNode(raw)

      this.word = target
      this.notFoundQuery = target ? '' : raw
      this.notFoundDescription = target
        ? ''
        : raw
          ? `“${raw}” 还没有讲解内容，可以提交缺词反馈。`
          : '这个单词还没有讲解内容，可以提交缺词反馈。'
      this.relatedWords = target ? getRelatedWords(target) : []
      this.bookmarked = target ? isFavorite(target.id) : false
      this.expandedPart = ''
      this.activePartMeaning = ''
      this.showFullDesc = true

      if (target) {
        addRecentWord(target.id, { countSearch: false })
      }
    },
    resolveLearningNode(rawValue) {
      const raw = (rawValue || '').trim()
      if (!raw) return null

      const candidates = [
        raw,
        raw.indexOf('word-') === 0 || raw.indexOf('node-') === 0 ? raw : `word-${raw}`,
        raw.indexOf('word-') === 0 || raw.indexOf('node-') === 0 ? raw : `node-${raw}`
      ]
      for (let i = 0; i < candidates.length; i += 1) {
        const byId = getWordById(candidates[i])
        if (byId) return byId
      }
      return getWordByWord(raw)
    },
    toggleBookmark() {
      if (!this.word) return
      this.bookmarked = toggleFavorite(this.word.id)
      uni.showToast({
        title: this.bookmarked ? '已收藏' : '已取消收藏',
        icon: 'none'
      })
    },
    handlePartTap(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      const targetId = dataset.targetId || ''
      const partText = dataset.partText || ''
      if (targetId) {
        this.openDetail(targetId)
        return
      }
      this.togglePart(partText)
    },
    togglePart(partText) {
      if (!this.word || !partText) return
      if (this.expandedPart === partText) {
        this.expandedPart = ''
        this.activePartMeaning = ''
        return
      }
      const part = this.word.parts.find((item) => item.text === partText)
      this.expandedPart = partText
      this.activePartMeaning = part ? part.meaning : ''
    },
    toggleDesc() {
      this.showFullDesc = !this.showFullDesc
    },
    showVideoTip() {
      uni.showToast({
        title: '下一步接入真实视频片段',
        icon: 'none'
      })
    },
    openFeedback() {
      const word = encodeURIComponent(this.word ? this.word.word : this.notFoundQuery)
      uni.navigateTo({
        url: `/pages/mine/index?feedbackWord=${word}`
      })
    },
    openDetailFromEvent(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      this.openDetail(dataset.id)
    },
    openDetail(id) {
      if (!id) return
      savePendingWordId(id)
      uni.navigateTo({
        url: `/pages/word-detail/index?id=${id}`
      })
    },
    goBack() {
      uni.navigateBack({
        fail: () => {
          uni.reLaunch({ url: '/pages/index/index' })
        }
      })
    },
    goHome() {
      uni.reLaunch({
        url: '/pages/index/index'
      })
    },
    goMine() {
      uni.reLaunch({
        url: '/pages/mine/index'
      })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 88rpx 32rpx 168rpx;
  background: #f0f9ff;
}

.topbar,
.tools,
.title-row,
.related-list {
  display: flex;
  align-items: center;
}

.topbar {
  justify-content: space-between;
  margin-bottom: 24rpx;
}

.tools {
  gap: 16rpx;
}

.back-button,
.tool-button {
  margin: 0;
  border-radius: 24rpx;
  background: #ffffff;
  color: #0e3a5c;
  font-size: 26rpx;
  box-shadow: 0 4rpx 12rpx rgba(14, 58, 92, 0.06);
}

.back-button {
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 28rpx;
}

.tool-button {
  position: relative;
  width: 72rpx;
  height: 72rpx;
}

.tool-text {
  color: #0e3a5c;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 72rpx;
}

.bookmark {
  position: absolute;
  left: 23rpx;
  top: 18rpx;
  width: 26rpx;
  height: 34rpx;
  border: 4rpx solid #6baed6;
  border-bottom: 0;
}

.bookmark.active {
  background: #fe8500;
  border-color: #fe8500;
}

.hero {
  position: relative;
  overflow: hidden;
  padding: 40rpx;
  border-radius: 32rpx;
  background: linear-gradient(140deg, #0e3a5c 0%, #1a5a8a 100%);
  box-shadow: 0 24rpx 64rpx rgba(14, 58, 92, 0.22);
}

.hero-ghost {
  position: absolute;
  top: -24rpx;
  right: 18rpx;
  color: rgba(169, 226, 255, 0.08);
  font-size: 132rpx;
  font-weight: 800;
}

.type-badge {
  display: inline-block;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.72);
  font-size: 22rpx;
}

.word-line {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 18rpx;
  margin-top: 24rpx;
}

.word {
  color: #ffffff;
  font-size: 76rpx;
  font-weight: 900;
  line-height: 1;
}

.phonetic {
  margin-bottom: 8rpx;
  color: rgba(255, 255, 255, 0.54);
  font-size: 26rpx;
}

.meaning,
.book-page {
  display: block;
}

.meaning {
  margin-top: 24rpx;
  color: rgba(255, 255, 255, 0.86);
  font-size: 28rpx;
  line-height: 1.65;
}

.book-page {
  margin-top: 14rpx;
  color: rgba(255, 235, 162, 0.78);
  font-size: 22rpx;
}

.section {
  margin-top: 24rpx;
  padding: 30rpx;
}

.card {
  border-radius: 28rpx;
  background: #ffffff;
  box-shadow: 0 4rpx 16rpx rgba(14, 58, 92, 0.06);
}

.section-eyebrow {
  color: #6baed6;
  font-size: 24rpx;
  font-weight: 800;
}

.section-title {
  display: block;
  color: #0e3a5c;
  font-size: 30rpx;
  font-weight: 800;
}

.parts {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 24rpx;
}

.part-chip {
  min-width: 116rpx;
  padding: 16rpx;
  border: 3rpx solid;
  border-radius: 22rpx;
  text-align: center;
}

.part-chip.selected {
  transform: translateY(-6rpx);
  box-shadow: 0 12rpx 28rpx rgba(14, 58, 92, 0.12);
}

.part-text,
.part-meaning,
.desc,
.example-en,
.example-cn,
.video-title,
.video-meta,
.part-detail-title,
.part-detail-text,
.part-detail-link,
.mini-action,
.related-word,
.related-level {
  display: block;
}

.part-text {
  font-size: 34rpx;
  font-weight: 900;
}

.part-meaning {
  margin-top: 6rpx;
  color: #315c82;
  font-size: 20rpx;
}

.part-action {
  display: inline-block;
  margin-top: 8rpx;
  padding: 3rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.62);
  color: #0e3a5c;
  font-size: 18rpx;
  font-weight: 800;
}

.plus,
.equals {
  color: #a9e2ff;
  font-size: 32rpx;
}

.equals-word {
  color: #0e3a5c;
  font-size: 32rpx;
  font-weight: 800;
}

.part-detail {
  margin-top: 24rpx;
  padding: 22rpx;
  border: 2rpx solid #dbeeff;
  border-radius: 22rpx;
  background: #f5fbff;
}

.part-detail-title {
  color: #0e3a5c;
  font-size: 32rpx;
  font-weight: 800;
}

.part-detail-text {
  margin-top: 8rpx;
  color: #315c82;
  font-size: 26rpx;
}

.part-detail-link {
  margin-top: 10rpx;
  color: #fe8500;
  font-size: 22rpx;
}

.title-row {
  justify-content: space-between;
}

.mini-action {
  color: #fe8500;
  font-size: 24rpx;
}

.desc {
  margin-top: 18rpx;
  color: #315c82;
  font-size: 28rpx;
  line-height: 1.8;
}

.desc.folded {
  max-height: 140rpx;
  overflow: hidden;
}

.example {
  margin-top: 18rpx;
  padding: 20rpx;
  border-radius: 22rpx;
  background: #f5fbff;
}

.example-en {
  color: #0e3a5c;
  font-size: 26rpx;
  line-height: 1.6;
}

.example-cn {
  margin-top: 8rpx;
  color: #6baed6;
  font-size: 24rpx;
  line-height: 1.5;
}

.related-list {
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 20rpx;
}

.related-chip {
  min-width: 172rpx;
  padding: 18rpx 20rpx;
  border: 2rpx solid #a9e2ff;
  border-radius: 22rpx;
  background: #ebf8ff;
}

.related-word {
  color: #0e3a5c;
  font-size: 28rpx;
  font-weight: 800;
}

.related-level {
  margin-top: 6rpx;
  color: #6baed6;
  font-size: 20rpx;
}

.video-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 32rpx;
  background: #0e3a5c;
}

.video-title {
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 800;
}

.video-meta {
  margin-top: 8rpx;
  color: rgba(255, 255, 255, 0.58);
  font-size: 24rpx;
}

.play-button {
  position: relative;
  width: 84rpx;
  height: 84rpx;
  margin: 0;
  border-radius: 999rpx;
  background: #ffeba2;
}

.play-triangle {
  position: absolute;
  top: 27rpx;
  left: 34rpx;
  width: 0;
  height: 0;
  border-top: 15rpx solid transparent;
  border-bottom: 15rpx solid transparent;
  border-left: 22rpx solid #0e3a5c;
}

.button-pressed,
.chip-pressed,
.text-pressed {
  opacity: 0.76;
  transform: scale(0.98);
}
</style>
