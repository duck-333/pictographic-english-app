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

        <view class="search-stack">
          <view class="search-shell" :class="{ focused }">
            <view class="search-icon">
              <view class="search-circle"></view>
              <view class="search-handle"></view>
            </view>

            <input
              :value="query"
              class="search-input"
              placeholder="输入英语单词，例如 study"
              placeholder-class="search-placeholder"
              confirm-type="search"
              @confirm="submitSearch"
              @input="handleQueryInput"
              @focus="handleSearchFocus"
              @blur="handleSearchBlur"
            />

            <button
              class="inline-search"
              :class="{ inactive: !canSubmitSearch || searching }"
              :hover-class="searchButtonHoverClass"
              @tap="submitSearch"
            >
              {{ searching ? '查找中' : '搜索' }}
            </button>
          </view>

          <view
            v-if="searchPanelOpen"
            class="search-panel"
            @touchstart="holdSearchPanel"
            @touchend="releaseSearchPanel"
            @touchcancel="releaseSearchPanel"
          >
            <view v-if="showRecentPanel" class="panel-section">
              <view class="panel-head">
                <text class="panel-title">最近查看</text>
                <view
                  v-if="recentWords.length"
                  class="clear-recent"
                  hover-class="text-pressed"
                  @tap="clearRecentHistory"
                >
                  <view class="trash-icon">
                    <view class="trash-lid"></view>
                    <view class="trash-body"></view>
                    <view class="trash-line left"></view>
                    <view class="trash-line right"></view>
                  </view>
                  <text>清除历史记录</text>
                </view>
                <text v-else class="panel-hint">搜索后自动记录</text>
              </view>

              <scroll-view
                v-if="recentWords.length"
                class="panel-list-scroll"
                scroll-y
                :show-scrollbar="false"
              >
                <view class="panel-list">
                  <view
                    v-for="item in recentWords"
                    :key="item.id"
                    class="panel-row"
                    hover-class="row-pressed"
                    :data-id="item.id"
                    :data-count-search="false"
                    @tap="openDetailFromEvent"
                  >
                    <view class="panel-row-main">
                      <text class="panel-word">{{ item.word }}</text>
                      <text class="panel-meaning">{{ item.meaning }}</text>
                    </view>
                    <text class="panel-row-arrow">></text>
                  </view>
                </view>
              </scroll-view>

              <view v-else class="panel-empty">
                <text>暂无历史记录，输入单词开始查询。</text>
              </view>
            </view>

            <view v-else class="panel-section">
              <view class="panel-head">
                <text class="panel-title">推荐结果</text>
                <text class="panel-hint" v-if="results.length">{{ results.length }} 个</text>
                <text class="panel-hint" v-else>没有匹配结果</text>
              </view>

              <scroll-view
                v-if="results.length"
                class="panel-list-scroll"
                scroll-y
                :show-scrollbar="false"
              >
                <view class="panel-list">
                  <view
                    v-for="item in results"
                    :key="item.id"
                    class="panel-row"
                    hover-class="row-pressed"
                    :data-id="item.id"
                    :data-count-search="true"
                    @tap="openDetailFromEvent"
                  >
                    <view class="panel-row-main">
                      <text class="panel-word">{{ item.word }}</text>
                      <text class="panel-meaning">{{ item.meaning }}</text>
                    </view>
                    <text class="panel-row-arrow">></text>
                  </view>
                </view>
              </scroll-view>

              <view v-else class="panel-empty">
                <text>{{ missingDescription }}</text>
                <button class="panel-empty-action" hover-class="empty-action-pressed" @tap="openFeedback">
                  提交缺词反馈
                </button>
              </view>
            </view>
          </view>
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
        <view v-if="todayWord" class="section-block">
          <view class="section-head">
            <view class="head-left">
              <view class="spark"></view>
              <text class="section-title">今日象形词</text>
            </view>

            <view class="detail-link" hover-class="text-pressed" @tap="openTodayWord">
              <text>查看详情</text>
              <text class="chevron">></text>
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
              <text class="tap-tip">点击查看完整解析 -></text>
            </view>
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
import { TODAY_WORD_ID, getWordById, getWordByWord, searchWords, normalizeWordQuery } from '../../common/word-repository.js'
import { addRecentWord, clearRecentWords, getRecentWords, getUserState, savePendingWordId } from '../../common/user-store.js'

const initialTodayWord = getWordById(TODAY_WORD_ID)

export default {
  data() {
    return {
      query: '',
      focused: false,
      searchPanelOpen: false,
      searchBlurTimer: null,
      interactingWithSearchPanel: false,
      searching: false,
      missingWord: '',
      results: [],
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
  onUnload() {
    this.clearSearchBlurTimer()
  },
  computed: {
    normalizedQuery() {
      return normalizeWordQuery(this.query)
    },
    canSubmitSearch() {
      return Boolean(this.normalizedQuery)
    },
    searchButtonHoverClass() {
      return this.canSubmitSearch && !this.searching ? 'text-pressed' : ''
    },
    showRecentPanel() {
      return !this.normalizedQuery
    }
  },
  methods: {
    refreshUserData() {
      this.recentWords = getRecentWords()
      this.userState = getUserState()
    },
    resetSuggestionState() {
      this.results = []
      this.missingWord = ''
      this.missingDescription = ''
    },
    buildMissingDescription(word) {
      if (!word) return ''
      return `可以先提交“${word}”，后续优先补充讲解。`
    },
    updateSuggestionState(word) {
      this.results = searchWords(word)
      this.missingWord = word
      this.missingDescription = this.buildMissingDescription(word)
    },
    handleQueryInput(event) {
      this.query = event && event.detail ? event.detail.value : ''
      this.searchPanelOpen = true

      if (!this.normalizedQuery) {
        this.resetSuggestionState()
        return
      }

      this.updateSuggestionState(this.normalizedQuery)
    },
    handleSearchFocus() {
      this.clearSearchBlurTimer()
      this.focused = true
      this.searchPanelOpen = true
    },
    handleSearchBlur() {
      this.focused = false
      this.clearSearchBlurTimer()
      this.searchBlurTimer = setTimeout(() => {
        if (this.interactingWithSearchPanel) return
        this.searchPanelOpen = false
      }, 240)
    },
    holdSearchPanel() {
      this.interactingWithSearchPanel = true
      this.clearSearchBlurTimer()
      this.searchPanelOpen = true
    },
    releaseSearchPanel() {
      setTimeout(() => {
        this.interactingWithSearchPanel = false
      }, 260)
    },
    clearSearchBlurTimer() {
      if (!this.searchBlurTimer) return
      clearTimeout(this.searchBlurTimer)
      this.searchBlurTimer = null
    },
    submitSearch() {
      if (this.searching) return

      this.clearSearchBlurTimer()

      const word = this.normalizedQuery
      if (!word) {
        this.searchPanelOpen = true
        return
      }

      this.searching = true
      const exact = getWordByWord(word)
      if (exact) {
        this.searching = false
        this.openDetail(exact.id, true)
        return
      }

      this.updateSuggestionState(word)
      this.searching = false
      this.searchPanelOpen = true
    },
    clearRecentHistory() {
      clearRecentWords()
      this.refreshUserData()
      this.searchPanelOpen = true
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
      this.searchPanelOpen = false
      this.clearSearchBlurTimer()
      savePendingWordId(id)
      addRecentWord(id, { countSearch })
      this.refreshUserData()
      uni.navigateTo({
        url: `/pages/word-detail/index?id=${id}`
      })
    },
    openFeedback() {
      const word = encodeURIComponent(this.missingWord || this.normalizedQuery || '')
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
  padding-bottom: 176rpx;
}

.hero {
  position: relative;
  z-index: 2;
  overflow: visible;
  padding: 92rpx 40rpx 48rpx;
  background: linear-gradient(160deg, #0e3a5c 0%, #1a5a8a 100%);
}

.hero-ghost {
  position: absolute;
  top: -28rpx;
  right: -18rpx;
  color: rgba(255, 255, 255, 0.06);
  font-size: 72rpx;
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
.panel-head,
.panel-row,
.panel-row-main {
  display: flex;
}

.top-row {
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

.search-stack {
  position: relative;
  z-index: 12;
  margin-top: 96rpx;
}

.search-shell {
  position: relative;
  display: flex;
  align-items: center;
  gap: 22rpx;
  min-height: 136rpx;
  padding: 0 18rpx 0 30rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.1);
  border-radius: 34rpx;
  background: #09314f;
  box-shadow: 0 24rpx 54rpx rgba(3, 23, 45, 0.3);
}

.search-shell.focused {
  border-color: rgba(255, 171, 80, 0.9);
  box-shadow: 0 24rpx 60rpx rgba(3, 23, 45, 0.34), 0 0 0 8rpx rgba(255, 171, 80, 0.14);
}

.search-icon {
  position: relative;
  flex-shrink: 0;
  width: 44rpx;
  height: 44rpx;
  color: #ffffff;
}

.search-circle {
  width: 30rpx;
  height: 30rpx;
  border: 5rpx solid currentColor;
  border-radius: 999rpx;
}

.search-handle {
  position: absolute;
  right: 0;
  bottom: 2rpx;
  width: 18rpx;
  height: 5rpx;
  border-radius: 999rpx;
  background: currentColor;
  transform: rotate(45deg);
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 800;
}

.search-placeholder {
  color: rgba(255, 255, 255, 0.56);
  font-size: 32rpx;
  font-weight: 600;
}

.inline-search {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 156rpx;
  min-height: 88rpx;
  padding: 0;
  margin: 0;
  border-radius: 28rpx;
  background: #ffab50;
  color: #09314f;
  font-size: 28rpx;
  font-weight: 800;
  line-height: 1.2;
  box-shadow: 0 12rpx 26rpx rgba(255, 171, 80, 0.3);
}

.inline-search::after,
.panel-empty-action::after {
  border: 0;
}

.inline-search.inactive {
  color: rgba(9, 49, 79, 0.56);
  box-shadow: 0 10rpx 20rpx rgba(255, 171, 80, 0.22);
}

.search-panel {
  position: absolute;
  top: calc(100% + 18rpx);
  left: 0;
  right: 0;
  overflow: hidden;
  padding: 24rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  border-radius: 30rpx;
  background: rgba(9, 49, 79, 0.98);
  box-shadow: 0 20rpx 48rpx rgba(3, 23, 45, 0.28);
}

.panel-head {
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.panel-title {
  color: #ffeba2;
  font-size: 26rpx;
  font-weight: 900;
}

.panel-hint {
  flex-shrink: 0;
  color: rgba(169, 226, 255, 0.82);
  font-size: 22rpx;
}

.clear-recent {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex-shrink: 0;
  color: #ffab50;
  font-size: 22rpx;
  font-weight: 700;
}

.trash-icon {
  position: relative;
  width: 24rpx;
  height: 26rpx;
}

.trash-lid {
  position: absolute;
  left: 4rpx;
  top: 0;
  width: 16rpx;
  height: 4rpx;
  border-radius: 999rpx;
  background: currentColor;
}

.trash-body {
  position: absolute;
  left: 5rpx;
  top: 7rpx;
  width: 14rpx;
  height: 17rpx;
  border: 3rpx solid currentColor;
  border-top: 0;
  border-radius: 0 0 5rpx 5rpx;
}

.trash-line {
  position: absolute;
  top: 10rpx;
  width: 3rpx;
  height: 11rpx;
  border-radius: 999rpx;
  background: currentColor;
}

.trash-line.left {
  left: 10rpx;
}

.trash-line.right {
  right: 10rpx;
}

.panel-list-scroll {
  max-height: 520rpx;
  margin-top: 16rpx;
}

.panel-list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.panel-row {
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  min-height: 92rpx;
  padding: 18rpx 22rpx;
  border-radius: 20rpx;
  background: #d9efff;
}

.panel-row-main {
  flex: 1;
  min-width: 0;
  flex-direction: column;
}

.panel-word {
  color: #0e3a5c;
  font-size: 28rpx;
  font-weight: 800;
}

.panel-meaning {
  margin-top: 4rpx;
  color: #5d88aa;
  font-size: 20rpx;
  line-height: 1.45;
}

.panel-row-arrow {
  flex-shrink: 0;
  color: #fe8500;
  font-size: 34rpx;
  font-weight: 800;
}

.panel-empty {
  margin-top: 16rpx;
  padding: 20rpx;
  border-radius: 20rpx;
  background: #d9efff;
  color: #5d88aa;
  font-size: 22rpx;
  line-height: 1.6;
}

.panel-empty-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 220rpx;
  min-height: 68rpx;
  margin: 18rpx 0 0;
  padding: 0 26rpx;
  border-radius: 999rpx;
  background: #ffab50;
  color: #09314f;
  font-size: 24rpx;
  font-weight: 800;
}

.stats-row {
  align-items: center;
  flex-wrap: wrap;
  gap: 24rpx;
  margin-top: 32rpx;
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
  position: relative;
  z-index: 1;
  padding: 30rpx 32rpx 32rpx;
}

.section-block {
  margin-top: 34rpx;
}

.section-head {
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
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

.chevron {
  color: #fe8500;
  font-size: 32rpx;
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
.tap-tip {
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

.bottom-nav {
  position: fixed;
  left: 24rpx;
  right: 24rpx;
  bottom: 24rpx;
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 18rpx 16rpx calc(18rpx + env(safe-area-inset-bottom));
  border-radius: 30rpx;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18rpx 48rpx rgba(14, 58, 92, 0.12);
  backdrop-filter: blur(12rpx);
}

.nav-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  min-height: 88rpx;
}

.nav-icon {
  position: relative;
  width: 42rpx;
  height: 42rpx;
  color: #8cbfe6;
}

.nav-item.active .nav-icon,
.nav-item.active .nav-label {
  color: #0e3a5c;
}

.nav-icon.search .i-a {
  position: absolute;
  left: 4rpx;
  top: 4rpx;
  width: 24rpx;
  height: 24rpx;
  border: 4rpx solid currentColor;
  border-radius: 999rpx;
}

.nav-icon.search .i-b {
  position: absolute;
  right: 3rpx;
  bottom: 5rpx;
  width: 16rpx;
  height: 4rpx;
  border-radius: 999rpx;
  background: currentColor;
  transform: rotate(45deg);
}

.nav-icon.search .i-c {
  display: none;
}

.nav-icon.mine .i-a {
  position: absolute;
  left: 11rpx;
  top: 2rpx;
  width: 18rpx;
  height: 18rpx;
  border: 4rpx solid currentColor;
  border-radius: 999rpx;
}

.nav-icon.mine .i-b {
  position: absolute;
  left: 5rpx;
  bottom: 4rpx;
  width: 30rpx;
  height: 18rpx;
  border: 4rpx solid currentColor;
  border-top-left-radius: 18rpx;
  border-top-right-radius: 18rpx;
  border-bottom: 0;
}

.nav-icon.mine .i-c {
  display: none;
}

.nav-label {
  color: #8cbfe6;
  font-size: 24rpx;
  font-weight: 700;
}

.nav-dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 999rpx;
  background: #fe8500;
}

.pressed,
.text-pressed,
.card-pressed,
.row-pressed,
.button-pressed,
.nav-item-pressed,
.empty-action-pressed {
  opacity: 0.8;
  transform: scale(0.98);
}
</style>
