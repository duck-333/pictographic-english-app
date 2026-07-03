<template>
  <view class="page">
    <view class="content">
      <view class="hero">
        <view class="top-row">
          <view>
            <view class="brand-row">
              <text class="brand">象形英语</text>
            </view>
            <text class="tagline">用象形逻辑，读懂每个英语单词</text>
          </view>
        </view>

        <view class="search-stack">
          <view class="search-shell" :class="{ focused }" @tap="openSearchPanel">
            <view class="search-icon"></view>

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

            <view
              class="search-toggle"
              :class="{ expanded: searchPanelOpen }"
              hover-class="search-toggle-pressed"
              @tap.stop="toggleSearchPanel"
            >
              <view class="search-toggle-chevron"></view>
            </view>

            <button
              class="inline-search"
              :class="{ inactive: !canSubmitSearch || searching }"
              :hover-class="searchButtonHoverClass"
              @tap.stop="submitSearch"
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
                    data-source="recent"
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
                <text class="panel-hint" v-if="searching">正在查询线上词库</text>
                <text class="panel-hint" v-else-if="results.length">{{ results.length }} 个</text>
                <text class="panel-hint" v-else>没有匹配结果</text>
              </view>

              <view v-if="searchErrorMessage" class="search-error">
                <text>{{ searchErrorMessage }}</text>
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
            <view class="word-row">
              <text class="today-word">{{ todayWord.word }}</text>
              <text class="today-phonetic">{{ todayWord.phonetic }}</text>
            </view>

            <view v-if="todayDisplayParts.length" class="parts-line">
              <block v-for="part in todayDisplayParts" :key="part.key">
                <view class="part-chip" :style="part.chipStyle">
                  <text class="part-text" :style="part.textStyle">{{ part.text }}</text>
                  <text class="part-meaning">{{ part.meaning }}</text>
                </view>
                <text v-if="part.showPlus" class="plus">+</text>
              </block>
            </view>

            <text v-if="todayWordSummary" class="tip">{{ todayWordSummary }}</text>

            <view class="card-foot">
              <text v-if="todayWord.level || todayWord.cardType" class="level-badge">{{ todayWord.level || todayWord.cardType }}</text>
              <text class="tap-tip">点击查看完整解析 -></text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <bottom-nav current="/pages/index/index" />
  </view>
</template>

<script>
import BottomNav from '../../components/BottomNav.vue'
import {
  fetchWordById,
  fetchHomepageFeaturedWord,
  fetchWords,
  normalizeWordQuery
} from '../../common/word-repository.js'
import {
  buildPartChipStyle,
  buildPartTextStyle
} from '../../common/part-visual-style.js'
import {
  addRecentWord,
  clearRecentWords,
  getRecentWordIds,
  getRecentWords,
  getUserState,
  isBlockedLegacyHistoryId,
  removeRecentWord,
  replaceRecentWordId,
  savePendingWordId
} from '../../common/user-store.js'

export default {
  components: {
    BottomNav
  },
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
      searchErrorMessage: '',
      recentWords: [],
      userState: getUserState(),
      todayWord: null,
      todayWordSource: 'empty',
      todayWordRequestId: 0,
      recentWordsRequestId: 0,
      todayParts: [],
      missingDescription: ''
    }
  },
  onShow() {
    this.refreshUserData()
    this.loadTodayWord()
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
    },
    todayWordSummary() {
      if (!this.todayWord) return ''
      return String(
        this.todayWord.explanation ||
        this.todayWord.tip ||
        this.todayWord.pictograph ||
        ''
      ).trim()
    },
    todayDisplayParts() {
      if (!Array.isArray(this.todayParts) || !this.todayParts.length) return []
      const normalizedParts = this.todayParts
        .map((part, index) => {
          const source = part && typeof part === 'object' ? part : {}
          const text = String(source.text || source.label || '').trim()
          const meaning = String(source.meaning || source.title || '').trim()
          if (!text && !meaning) return null
          return {
            ...source,
            key: `${text || 'part'}-${index}`,
            text,
            meaning,
            chipStyle: buildPartChipStyle(source, index),
            textStyle: buildPartTextStyle(source, index)
          }
        })
        .filter((part) => part)
      return normalizedParts.map((part, index) => ({
        ...part,
        showPlus: index < normalizedParts.length - 1
      }))
    }
  },
  methods: {
    refreshUserData() {
      this.userState = getUserState()
      this.recentWords = getRecentWords()
      this.refreshRecentWordsFromServer()
    },
    async refreshRecentWordsFromServer() {
      const ids = getRecentWordIds()
      const requestId = this.recentWordsRequestId + 1
      this.recentWordsRequestId = requestId

      if (!ids.length) {
        this.recentWords = []
        return
      }

      const verifiedWords = []
      for (let index = 0; index < ids.length; index += 1) {
        const id = ids[index]
        const result = await this.resolvePublishedHistoryWord(id)
        if (this.recentWordsRequestId !== requestId) return
        if (result.word) {
          verifiedWords.push(result.word)
          if (result.word.id !== id) {
            replaceRecentWordId(id, result.word.id)
          }
        } else if (result.remove) {
          removeRecentWord(id)
        }
      }

      if (this.recentWordsRequestId !== requestId) return
      const used = {}
      this.recentWords = verifiedWords.filter((word) => {
        if (!word || !word.id || used[word.id]) return false
        used[word.id] = true
        return word.status === 'published'
      })
      this.userState = getUserState()
    },
    async resolvePublishedHistoryWord(value) {
      const raw = String(value || '').trim()
      if (!raw || isBlockedLegacyHistoryId(raw)) {
        return { word: null, remove: true }
      }

      const candidates = [raw]
      if (raw.indexOf('word-') === 0 || raw.indexOf('node-') === 0) {
        candidates.push(raw.replace(/^(word|node)-/, ''))
      }

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]
        try {
          const byId = await fetchWordById(candidate)
          if (byId && byId.status === 'published') {
            return { word: byId, remove: false }
          }
        } catch (error) {
          return { word: null, remove: false, error }
        }
      }

      const query = normalizeWordQuery(candidates[candidates.length - 1] || raw)
      if (query) {
        try {
          const byWord = await fetchWordByWord(query)
          if (byWord && byWord.status === 'published') {
            return { word: byWord, remove: false }
          }
        } catch (error) {
          return { word: null, remove: false, error }
        }
      }

      return { word: null, remove: true }
    },
    applyTodayWord(word, source = 'empty') {
      const publishedWord = word && word.status === 'published' ? word : null
      this.todayWord = publishedWord
      this.todayWordSource = publishedWord ? source : 'empty'
      this.todayParts = publishedWord && Array.isArray(publishedWord.parts) ? publishedWord.parts : []
    },
    async loadTodayWord() {
      const requestId = this.todayWordRequestId + 1
      this.todayWordRequestId = requestId
      try {
        const result = await fetchHomepageFeaturedWord()
        if (this.todayWordRequestId !== requestId) return
        this.applyTodayWord(result && result.word, result && result.source)
      } catch (error) {
        if (this.todayWordRequestId !== requestId) return
        this.applyTodayWord(null, 'empty')
      }
    },
    resetSuggestionState() {
      this.results = []
      this.missingWord = ''
      this.missingDescription = ''
      this.searchErrorMessage = ''
    },
    buildMissingDescription(word) {
      if (!word) return ''
      return `暂未收录“${word}”。`
    },
    async updateSuggestionState(word) {
      this.results = []
      this.missingWord = word
      this.missingDescription = this.buildMissingDescription(word)
      this.searchErrorMessage = ''
      const requestWord = word
      try {
        const remoteResults = await fetchWords(word)
        if (this.normalizedQuery !== requestWord) return
        this.results = remoteResults
      } catch (error) {
        if (this.normalizedQuery !== requestWord) return
        const fallbackResults = error && Array.isArray(error.fallback) ? error.fallback : []
        this.results = fallbackResults
        this.searchErrorMessage = fallbackResults.length
          ? '线上词库暂时无法连接，当前显示本地备用结果。'
          : '线上词库暂时无法连接，请检查网络后重试。'
        this.missingDescription = fallbackResults.length ? '' : this.searchErrorMessage
      }
    },
    handleQueryInput(event) {
      this.query = event && event.detail ? event.detail.value : ''

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
    openSearchPanel() {
      this.clearSearchBlurTimer()
      this.searchPanelOpen = true
    },
    toggleSearchPanel() {
      this.clearSearchBlurTimer()
      this.searchPanelOpen = !this.searchPanelOpen
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
    async submitSearch() {
      if (this.searching) return

      this.clearSearchBlurTimer()

      const word = this.normalizedQuery
      if (!word) {
        this.searchPanelOpen = true
        return
      }

      this.searching = true
      try {
        await this.updateSuggestionState(word)
        this.searchPanelOpen = true
      } finally {
        this.searching = false
      }
    },
    clearRecentHistory() {
      clearRecentWords()
      this.refreshUserData()
      this.searchPanelOpen = true
    },
    openTodayWord() {
      if (!this.todayWord) return
      this.openDetail(this.todayWord.id, false, { trustedWord: this.todayWord })
    },
    async openDetailFromEvent(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      const countSearch = dataset.countSearch === true || dataset.countSearch === 'true'
      const source = String(dataset.source || '')
      if (source === 'recent') {
        await this.openRecentDetail(dataset.id)
        return
      }
      this.openDetail(dataset.id, countSearch)
    },
    async openRecentDetail(id) {
      const result = await this.resolvePublishedHistoryWord(id)
      if (result.word) {
        if (result.word.id !== id) {
          replaceRecentWordId(id, result.word.id)
          this.refreshUserData()
        }
        this.openDetail(result.word.id, false, { trustedWord: result.word })
        return
      }

      if (result.remove) {
        removeRecentWord(id)
        this.refreshUserData()
        uni.showToast({
          title: '该词条暂未发布',
          icon: 'none'
        })
        return
      }

      uni.showToast({
        title: '线上词库暂时无法连接',
        icon: 'none'
      })
    },
    openDetail(id, countSearch = false, options = {}) {
      if (!id) return
      this.searchPanelOpen = false
      this.clearSearchBlurTimer()
      const trustedWord = options.trustedWord && options.trustedWord.status === 'published' ? options.trustedWord : null
      const targetId = trustedWord ? trustedWord.id : id
      savePendingWordId(targetId)
      addRecentWord(targetId, {
        countSearch,
        skipPublishedCacheCheck: Boolean(trustedWord)
      })
      this.refreshUserData()
      uni.navigateTo({
        url: `/pages/word-detail/index?id=${targetId}`
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
  padding-bottom: calc(188rpx + env(safe-area-inset-bottom));
}

.hero {
  position: relative;
  z-index: 2;
  overflow: visible;
  padding: 92rpx 40rpx 48rpx;
  background: linear-gradient(160deg, #0e3a5c 0%, #1a5a8a 100%);
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

.tagline {
  display: block;
  margin-top: 6rpx;
  color: rgba(255, 255, 255, 0.64);
  font-size: 24rpx;
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
  gap: 16rpx;
  height: 136rpx;
  padding: 0 18rpx 0 28rpx;
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
  width: 46rpx;
  height: 46rpx;
  overflow: visible;
  color: #ffffff;
  transform: rotate(-45deg);
  transform-origin: 50% 50%;
}

.search-icon::before {
  content: "";
  position: absolute;
  left: 6rpx;
  top: 1rpx;
  width: 34rpx;
  height: 34rpx;
  box-sizing: border-box;
  border: 4rpx solid currentColor;
  border-radius: 999rpx;
}

.search-icon::after {
  content: "";
  position: absolute;
  left: 21rpx;
  top: 31rpx;
  width: 4rpx;
  height: 15rpx;
  border-radius: 999rpx;
  background: currentColor;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 88rpx;
  color: #ffffff;
  font-size: 34rpx;
  font-weight: 800;
}

.search-placeholder {
  color: rgba(255, 255, 255, 0.56);
  font-size: 32rpx;
  font-weight: 600;
}

.search-toggle {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 42rpx;
  height: 52rpx;
  border-radius: 16rpx;
  color: rgba(255, 255, 255, 0.72);
}

.search-toggle-chevron {
  width: 14rpx;
  height: 14rpx;
  border-right: 4rpx solid currentColor;
  border-bottom: 4rpx solid currentColor;
  transform: translateY(-4rpx) rotate(45deg);
  transition: transform 0.16s ease;
}

.search-toggle.expanded .search-toggle-chevron {
  transform: translateY(4rpx) rotate(225deg);
}

.search-toggle-pressed {
  background: rgba(255, 255, 255, 0.1);
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

.inline-search::after {
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

.search-error {
  margin-top: 16rpx;
  padding: 16rpx 20rpx;
  border-radius: 18rpx;
  background: rgba(255, 235, 162, 0.16);
  color: #ffeba2;
  font-size: 21rpx;
  line-height: 1.55;
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
  color: #315c82;
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

.pressed,
.text-pressed,
.card-pressed,
.row-pressed,
.button-pressed {
  opacity: 0.8;
  transform: scale(0.98);
}
</style>
