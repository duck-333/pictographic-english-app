<template>
  <view class="page">
    <view class="content">
      <view class="hero">
        <view class="hero-ghost">tud port struct</view>
        <view class="top-row">
          <view>
            <view class="brand-row">
              <text class="brand">象形英语</text>
              <text class="beta">BETA</text>
            </view>
            <text class="tagline">用象形逻辑，读懂每个英语单词</text>
          </view>
          <view class="bell" hover-class="pressed">
            <view class="bell-body"></view>
            <view class="bell-dot"></view>
          </view>
        </view>

        <view class="search-shell" :class="{ focused }">
          <view class="search-icon">
            <view class="search-circle"></view>
            <view class="search-handle"></view>
          </view>
          <input
            :value="query"
            class="search-input"
            placeholder="搜索单词… 试试 study"
            confirm-type="search"
            @confirm="submitSearch"
            @input="handleQueryInput"
            @focus="handleSearchFocus"
            @blur="handleSearchBlur"
          />
          <button
            v-if="query"
            class="inline-search"
            :disabled="searching"
            hover-class="text-pressed"
            @tap="submitSearch"
          >
            {{ searching ? '查找中' : '搜索' }}
          </button>
        </view>

        <view class="stats-row">
          <view class="stat-item">
            <view class="flame"></view>
            <text class="stat-text">连续学习 <text class="accent">{{ userState.streakDays || 0 }}</text> 天</text>
          </view>
          <view class="stat-item">
            <view class="book-mini"></view>
            <text class="stat-text">已查 <text class="blue">{{ userState.searchCount || 0 }}</text> 次</text>
          </view>
        </view>
      </view>

      <view class="body">
        <view v-if="searched" class="search-results">
          <view class="section-head compact">
            <text class="section-title">搜索结果</text>
            <text class="result-count">{{ resultCount }} 个</text>
          </view>
          <view v-if="resultCount" class="result-list">
            <view
              v-for="item in results"
              :key="item.id"
              class="result-row"
              hover-class="row-pressed"
              :data-id="item.id"
              :data-count-search="true"
              @tap="openDetailFromEvent"
            >
              <view>
                <text class="recent-word">{{ item.word }}</text>
                <text class="recent-meaning">{{ item.meaning }}</text>
              </view>
              <text class="row-arrow">›</text>
            </view>
          </view>
          <view v-else class="empty-state">
            <view class="empty-mark">象</view>
            <text class="empty-title">暂未收录这个单词</text>
            <text class="empty-description">{{ missingDescription }}</text>
            <button class="empty-action" hover-class="empty-action-pressed" @tap="openFeedback">提交缺词反馈</button>
          </view>
        </view>

        <view v-if="todayWord" class="section-block">
          <view class="section-head">
            <view class="head-left">
              <view class="spark"></view>
              <text class="section-title">今日象形词</text>
            </view>
            <view class="detail-link" hover-class="text-pressed" @tap="openTodayWord">
              <text>查看详情</text>
              <text class="chevron">›</text>
            </view>
          </view>

          <view class="today-card" hover-class="card-pressed" @tap="openTodayWord">
            <view class="card-ghost">t</view>
            <view class="word-row">
              <text class="today-word">{{ todayWord.word }}</text>
              <text class="today-phonetic">{{ todayWord.phonetic }}</text>
            </view>
            <view class="parts-line">
              <block v-for="(part, index) in todayParts" :key="part.text">
                <view class="part-chip" :style="{ backgroundColor: part.bgColor, borderColor: part.borderColor }">
                  <text class="part-text" :style="{ color: part.color }">{{ part.text }}</text>
                  <text class="part-meaning">{{ part.meaning }}</text>
                </view>
                <text v-if="index < todayPartsLastIndex" class="plus">+</text>
              </block>
            </view>
            <text class="tip">{{ todayWord.tip }}</text>
            <view class="card-foot">
              <text class="level-badge">{{ todayWord.level }} 必备</text>
              <text class="tap-tip">点击查看完整解析 →</text>
            </view>
          </view>
        </view>

        <view class="section-block">
          <text class="section-title">热门搜索</text>
          <view class="hot-list">
            <view
              v-for="word in hotWords"
              :key="word"
              class="hot-chip"
              hover-class="chip-pressed"
              :data-word="word"
              @tap="searchHotFromEvent"
            >
              {{ word }}
            </view>
          </view>
        </view>

        <view class="section-block">
          <view class="section-head">
            <text class="section-title">最近查看</text>
            <text v-if="recentWords.length" class="hint-text">保存在本机</text>
          </view>
          <view v-if="recentWords.length" class="recent-list">
            <view
              v-for="item in recentWords"
              :key="item.id"
              class="recent-row"
              hover-class="row-pressed"
              :data-id="item.id"
              :data-count-search="false"
              @tap="openDetailFromEvent"
            >
              <view>
                <text class="recent-word">{{ item.word }}</text>
                <text class="recent-meaning">{{ item.meaning }}</text>
              </view>
              <text class="row-arrow">›</text>
            </view>
          </view>
          <view v-else class="empty-state">
            <view class="empty-mark">象</view>
            <text class="empty-title">还没有查看记录</text>
            <text class="empty-description">搜索一个单词后，这里会自动保存最近查看。</text>
          </view>
        </view>
      </view>
    </view>

    <view class="bottom-nav">
      <view class="nav-item active" hover-class="nav-item-pressed">
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
import { HOT_WORDS, TODAY_WORD_ID, getWordById, getWordByWord, searchWords, normalizeWordQuery } from '../../common/mock-data.js'
import { addRecentWord, getRecentWords, getUserState, savePendingWordId } from '../../common/user-store.js'

const initialTodayWord = getWordById(TODAY_WORD_ID)

export default {
  data() {
    return {
      query: '',
      focused: false,
      searched: false,
      searching: false,
      missingWord: '',
      results: [],
      resultCount: 0,
      hotWords: HOT_WORDS,
      recentWords: [],
      userState: getUserState(),
      todayWord: initialTodayWord,
      todayParts: initialTodayWord && Array.isArray(initialTodayWord.parts) ? initialTodayWord.parts : [],
      todayPartsLastIndex: initialTodayWord && Array.isArray(initialTodayWord.parts) ? initialTodayWord.parts.length - 1 : -1,
      missingDescription: ''
    }
  },
  onShow() {
    this.refreshUserData()
  },
  methods: {
    refreshUserData() {
      this.recentWords = getRecentWords()
      this.userState = getUserState()
    },
    handleQueryInput(event) {
      this.query = event && event.detail ? event.detail.value : ''
    },
    handleSearchFocus() {
      this.focused = true
    },
    handleSearchBlur() {
      this.focused = false
    },
    submitSearch() {
      const word = normalizeWordQuery(this.query)
      if (!word) {
        this.searched = false
        this.results = []
        this.resultCount = 0
        this.missingWord = ''
        return
      }

      this.searching = true
      const exact = getWordByWord(word)
      if (exact) {
        addRecentWord(exact.id)
        this.refreshUserData()
        this.searching = false
        this.openDetail(exact.id, false)
        return
      }

      const matches = searchWords(word)
      this.results = matches
      this.resultCount = matches.length
      this.missingWord = word
      this.missingDescription = `可以先提交“${word}”，后续优先补充讲解。`
      this.searched = true
      this.searching = false
    },
    searchHot(word) {
      this.query = word
      this.submitSearch()
    },
    searchHotFromEvent(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      this.searchHot(dataset.word)
    },
    openTodayWord() {
      if (!this.todayWord) return
      this.openDetail(this.todayWord.id, false)
    },
    openDetailFromEvent(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      const countSearch = dataset.countSearch === true || dataset.countSearch === 'true'
      this.openDetail(dataset.id, countSearch)
    },
    openDetail(id, countSearch = false) {
      if (!id) return
      savePendingWordId(id)
      addRecentWord(id, { countSearch })
      this.refreshUserData()
      uni.navigateTo({
        url: `/pages/word-detail/index?id=${id}`
      })
    },
    openFeedback() {
      const word = encodeURIComponent(this.missingWord || this.query || '')
      uni.navigateTo({
        url: `/pages/mine/index?feedbackWord=${word}`
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
  background: #f0f9ff;
}

.content {
  min-height: 100vh;
  padding-bottom: 168rpx;
}

.hero {
  position: relative;
  overflow: hidden;
  padding: 92rpx 40rpx 34rpx;
  background: linear-gradient(160deg, #0e3a5c 0%, #1a5a8a 100%);
}

.hero-ghost {
  position: absolute;
  top: -28rpx;
  right: -18rpx;
  font-size: 72rpx;
  color: rgba(255, 255, 255, 0.06);
  letter-spacing: 8rpx;
}

.top-row,
.brand-row,
.stats-row,
.stat-item,
.section-head,
.head-left,
.detail-link,
.word-row,
.parts-line,
.card-foot,
.recent-row,
.result-row {
  display: flex;
}

.top-row {
  position: relative;
  align-items: center;
  justify-content: space-between;
}

.brand-row {
  align-items: center;
  gap: 14rpx;
}

.brand {
  color: #ffeba2;
  font-size: 44rpx;
  font-weight: 800;
}

.beta {
  padding: 2rpx 12rpx;
  border-radius: 16rpx;
  background: rgba(255, 235, 162, 0.15);
  color: rgba(255, 235, 162, 0.88);
  font-size: 20rpx;
  font-weight: 700;
}

.tagline {
  display: block;
  margin-top: 6rpx;
  color: rgba(255, 255, 255, 0.64);
  font-size: 24rpx;
}

.bell {
  position: relative;
  width: 76rpx;
  height: 76rpx;
  border-radius: 999rpx;
  background: rgba(169, 226, 255, 0.12);
}

.bell-body {
  position: absolute;
  left: 25rpx;
  top: 20rpx;
  width: 26rpx;
  height: 32rpx;
  border: 4rpx solid #ffffff;
  border-bottom: 0;
  border-top-left-radius: 18rpx;
  border-top-right-radius: 18rpx;
}

.bell-dot {
  position: absolute;
  top: 12rpx;
  right: 14rpx;
  width: 12rpx;
  height: 12rpx;
  border-radius: 999rpx;
  background: #fe8500;
}

.search-shell {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20rpx;
  height: 96rpx;
  margin-top: 38rpx;
  padding: 0 28rpx;
  border: 3rpx solid rgba(255, 255, 255, 0.15);
  border-radius: 32rpx;
  background: rgba(255, 255, 255, 0.13);
}

.search-shell.focused {
  border-color: #a9e2ff;
}

.search-icon {
  position: relative;
  width: 36rpx;
  height: 36rpx;
  color: rgba(255, 255, 255, 0.72);
}

.search-circle {
  width: 24rpx;
  height: 24rpx;
  border: 4rpx solid currentColor;
  border-radius: 999rpx;
}

.search-handle {
  position: absolute;
  right: 2rpx;
  bottom: 2rpx;
  width: 16rpx;
  height: 4rpx;
  border-radius: 999rpx;
  background: currentColor;
  transform: rotate(45deg);
}

.search-input {
  flex: 1;
  min-width: 0;
  color: #ffffff;
  font-size: 30rpx;
}

.inline-search {
  flex-shrink: 0;
  padding: 0;
  margin: 0;
  background: transparent;
  color: #ffeba2;
  font-size: 24rpx;
  font-weight: 800;
  line-height: 1;
}

.stats-row {
  align-items: center;
  flex-wrap: wrap;
  gap: 24rpx;
  margin-top: 28rpx;
}

.stat-item {
  align-items: center;
  gap: 10rpx;
}

.stat-text {
  color: rgba(255, 255, 255, 0.82);
  font-size: 24rpx;
}

.accent {
  color: #fe8500;
  font-weight: 800;
}

.blue {
  color: #a9e2ff;
  font-weight: 800;
}

.flame {
  width: 20rpx;
  height: 28rpx;
  border-radius: 20rpx 20rpx 20rpx 4rpx;
  background: #fe8500;
  transform: rotate(35deg);
}

.book-mini {
  width: 22rpx;
  height: 26rpx;
  border: 3rpx solid #a9e2ff;
  border-radius: 4rpx;
}

.body {
  padding: 30rpx 32rpx 32rpx;
}

.section-block,
.search-results {
  margin-top: 34rpx;
}

.search-results {
  margin-top: 0;
}

.section-head {
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}

.compact {
  margin-top: 0;
}

.head-left,
.detail-link {
  align-items: center;
  gap: 10rpx;
}

.spark {
  width: 22rpx;
  height: 22rpx;
  border-radius: 999rpx;
  background: #fe8500;
  box-shadow: 0 0 0 8rpx rgba(254, 133, 0, 0.14);
}

.section-title {
  color: #0e3a5c;
  font-size: 26rpx;
  font-weight: 800;
}

.detail-link {
  color: #fe8500;
  font-size: 24rpx;
}

.chevron,
.row-arrow {
  color: #fe8500;
  font-size: 40rpx;
}

.today-card {
  position: relative;
  overflow: hidden;
  padding: 36rpx;
  border-radius: 32rpx;
  background: linear-gradient(135deg, #0e3a5c 0%, #1a5a8a 100%);
  box-shadow: 0 16rpx 56rpx rgba(14, 58, 92, 0.28);
}

.card-ghost {
  position: absolute;
  top: -12rpx;
  right: 22rpx;
  color: rgba(169, 226, 255, 0.08);
  font-size: 120rpx;
  font-weight: 800;
}

.word-row {
  position: relative;
  align-items: flex-end;
  gap: 18rpx;
  margin-bottom: 22rpx;
}

.today-word {
  color: #ffffff;
  font-size: 72rpx;
  font-weight: 900;
  line-height: 1;
}

.today-phonetic {
  margin-bottom: 8rpx;
  color: rgba(255, 255, 255, 0.56);
  font-size: 26rpx;
}

.parts-line {
  position: relative;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-bottom: 22rpx;
}

.part-chip {
  min-width: 96rpx;
  padding: 10rpx 16rpx;
  border: 2rpx solid;
  border-radius: 18rpx;
  text-align: center;
}

.part-text,
.part-meaning,
.tip,
.level-badge,
.tap-tip,
.recent-word,
.recent-meaning {
  display: block;
}

.part-text {
  font-size: 30rpx;
  font-weight: 800;
}

.part-meaning {
  margin-top: 2rpx;
  color: rgba(255, 255, 255, 0.62);
  font-size: 18rpx;
}

.plus {
  color: rgba(255, 255, 255, 0.3);
  font-size: 24rpx;
}

.tip {
  position: relative;
  color: rgba(255, 255, 255, 0.76);
  font-size: 24rpx;
  line-height: 1.7;
}

.card-foot {
  align-items: center;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 24rpx;
}

.level-badge {
  padding: 4rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 235, 162, 0.18);
  color: #ffeba2;
  font-size: 22rpx;
  font-weight: 800;
}

.tap-tip {
  color: rgba(255, 255, 255, 0.44);
  font-size: 22rpx;
}

.hot-list {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 18rpx;
}

.hot-chip {
  padding: 12rpx 26rpx;
  border: 2rpx solid #ececec;
  border-radius: 999rpx;
  background: #ffffff;
  color: #0e3a5c;
  font-size: 26rpx;
  font-weight: 700;
  box-shadow: 0 4rpx 10rpx rgba(14, 58, 92, 0.07);
}

.recent-list,
.result-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.recent-row,
.result-row {
  align-items: center;
  justify-content: space-between;
  min-height: 100rpx;
  padding: 0 28rpx;
  border: 2rpx solid #ececec;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 4rpx 12rpx rgba(14, 58, 92, 0.05);
}

.recent-word {
  color: #0e3a5c;
  font-size: 32rpx;
  font-weight: 800;
}

.recent-meaning {
  max-width: 560rpx;
  margin-top: 6rpx;
  color: #6baed6;
  font-size: 22rpx;
  line-height: 1.45;
}

.result-count,
.hint-text {
  color: #6baed6;
  font-size: 24rpx;
}

.pressed,
.text-pressed,
.chip-pressed,
.card-pressed,
.row-pressed {
  opacity: 0.78;
  transform: scale(0.98);
}
</style>
