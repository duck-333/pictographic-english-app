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
              <text v-if="todayWord.phonetic" class="today-phonetic">{{ todayWord.phonetic }}</text>
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

            <view v-if="todayWordSummary" class="imagery">
              <text class="imagery-label">完整意象</text>
              <text class="tip">{{ todayWordSummary }}</text>
            </view>

            <view class="card-foot">
              <text class="tap-tip">点击查看完整解析 →</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <baxiaota-entry :active="gameEntryActive" :search-focused="focused" :bounds="gameEntryBounds" />
    <bottom-nav ref="bottomNav" current="/pages/index/index" />
  </view>
</template>

<script>
import BottomNav from '../../components/BottomNav.vue'
import BaxiaotaEntry from '../../components/BaxiaotaEntry.vue'
import {
  fetchWordById,
  fetchHomepageFeaturedWord,
  fetchWordByWord,
  fetchWords,
  getCachedPublishedRemoteWordById,
  normalizeWordQuery
} from '../../common/word-repository.js'
import { getAuthSession } from '../../common/auth-store.js'
import { recordUserRecentWord, listUserRecentWords } from '../../common/user-recent-words-api-client.js'
import {
  addRecentWord,
  clearRecentWords,
  getRecentWordIds,
  getRecentWords,
  getUserState,
  isBlockedLegacyHistoryId,
  recordLearningActivity,
  removeRecentWord,
  replaceRecentWordId,
  savePendingWordId
} from '../../common/user-store.js'

// Softer surfaces for the dark homepage card; detail-page/content colors stay independent.
const TODAY_PART_STYLES = [
  { background: '#ddd8ed', border: '#bcb0d9', color: '#63419b' },
  { background: '#eee0ba', border: '#d7bd7c', color: '#795719' },
  { background: '#cbe3e8', border: '#91bcc7', color: '#1c6375' },
  { background: '#d3e1f2', border: '#a5bfdf', color: '#315e95' },
  { background: '#ecd5dd', border: '#d6a9b9', color: '#913f5c' }
]

export default {
  components: {
    BottomNav,
    BaxiaotaEntry
  },
  data() {
    return {
      gameEntryActive: false,
      gameEntryMeasureRequestId: 0,
      gameEntryUnloaded: false,
      gameEntryBounds: { width: 0, bottom: 0 },
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
      todayWordActive: false,
      todayWordPending: false,
      todayWordRefreshTimer: null,
      recentWordsRequestId: 0,
      missingDescription: ''
    }
  },
  onShow() {
    this.todayWordActive = true
    this.gameEntryActive = true
    this.measureGameEntryBounds()
    this.refreshUserData()
    this.loadTodayWord()
  },
  onReady() { this.measureGameEntryBounds() },
  onResize() { this.measureGameEntryBounds() },
  onHide() {
    this.stopTodayWordRefresh()
    this.gameEntryActive = false
    this.gameEntryMeasureRequestId++
  },
  onShareAppMessage() {
    return {
      title: '象形英语｜以形释义解码单词',
      path: '/pages/index/index'
    }
  },
  onShareTimeline() {
    return {
      title: '象形英语｜以形释义解码单词'
    }
  },
  onUnload() {
    this.stopTodayWordRefresh()
    this.gameEntryActive = false
    this.gameEntryUnloaded = true
    this.gameEntryMeasureRequestId++
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
      const explanation = this.todayWord.explanation
      return typeof explanation === 'string' ? explanation.trim() : ''
    },
    todayDisplayParts() {
      const parts = this.todayWord && this.todayWord.parts
      if (!Array.isArray(parts) || !parts.length) return []
      const normalizedParts = parts
        .map((part, index) => {
          const source = part && typeof part === 'object' ? part : {}
          const style = TODAY_PART_STYLES[index % TODAY_PART_STYLES.length]
          return {
            ...source,
            key: `part-${index}`,
            chipStyle: `background-color:${style.background};border-color:${style.border};`,
            textStyle: `color:${style.color};`
          }
        })
      return normalizedParts.map((part, index) => ({
        ...part,
        showPlus: index < normalizedParts.length - 1
      }))
    }
  },
  methods: {
    measureGameEntryBounds() {
      // Capture before nextTick: a delayed older task must keep its own id.
      const requestId = ++this.gameEntryMeasureRequestId
      const isCurrent = () => requestId === this.gameEntryMeasureRequestId &&
        this.gameEntryActive && !this.gameEntryUnloaded
      this.$nextTick(() => {
        if (!isCurrent() || !this.$refs.bottomNav) return
        const info = uni.getWindowInfo ? uni.getWindowInfo() : uni.getSystemInfoSync()
        uni.createSelectorQuery().in(this.$refs.bottomNav).select('.bottom-nav').boundingClientRect(rect => {
          if (!isCurrent() || !rect) return
          // BottomNav is fixed to the viewport bottom; its measured height
          // already includes its safe inset. Do not subtract that inset twice.
          const fixedTop = Number.isFinite(rect.height) && rect.height > 0 ? info.windowHeight - rect.height : rect.top
          this.gameEntryMeasurement = { window: info, nav: rect }
          this.gameEntryBounds = { width: info.windowWidth, bottom: Math.max(0, Math.min(info.windowHeight, rect.top, fixedTop)) }
        }).exec()
      })
    },
    refreshUserData() {
      this.userState = getUserState()
      const session = getAuthSession()
      if (session) {
        this.recentWords = []
        this.refreshRecentWordsFromCloud(session)
        return
      }

      this.recentWords = getRecentWords()
      this.refreshRecentWordsFromServer()
    },
    async refreshRecentWordsFromCloud(session) {
      const requestId = this.recentWordsRequestId + 1
      this.recentWordsRequestId = requestId

      try {
        const recentWords = (await listUserRecentWords({ session })).slice(0, 12)
        const verifiedWords = []
        for (let index = 0; index < recentWords.length; index += 1) {
          const result = await this.resolvePublishedHistoryWord(recentWords[index].wordId)
          if (this.recentWordsRequestId !== requestId) return
          if (result.word) {
            verifiedWords.push(result.word)
          }
        }

        if (this.recentWordsRequestId !== requestId) return
        const used = {}
        this.recentWords = verifiedWords.filter((word) => {
          if (!word || !word.id || used[word.id]) return false
          used[word.id] = true
          return word.status === 'published'
        })
      } catch (error) {
        if (this.recentWordsRequestId === requestId) {
          this.recentWords = []
        }
      }
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
    },
    stopTodayWordRefresh() {
      this.todayWordActive = false
      this.todayWordRequestId++
      this.todayWordPending = false
      clearTimeout(this.todayWordRefreshTimer)
      this.todayWordRefreshTimer = null
      this.applyTodayWord(null)
    },
    scheduleTodayWordRefresh(delay) {
      clearTimeout(this.todayWordRefreshTimer)
      this.todayWordRefreshTimer = null
      if (!this.todayWordActive) return
      // Shanghai has a fixed UTC+8 date boundary. Server selects the word.
      const dayMs = 24 * 60 * 60 * 1000
      const untilMidnight = dayMs - ((Date.now() + 8 * 60 * 60 * 1000) % dayMs)
      this.todayWordRefreshTimer = setTimeout(() => {
        this.todayWordRefreshTimer = null
        this.loadTodayWord()
      }, delay === undefined ? Math.min(5 * 60 * 1000, untilMidnight) : delay)
    },
    async loadTodayWord() {
      if (!this.todayWordActive || this.todayWordPending) return
      clearTimeout(this.todayWordRefreshTimer)
      this.todayWordRefreshTimer = null
      this.todayWordPending = true
      this.applyTodayWord(null)
      const shanghaiDay = () => Math.floor((Date.now() + 8 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000))
      const requestedDay = shanghaiDay()
      const requestId = this.todayWordRequestId + 1
      this.todayWordRequestId = requestId
      try {
        const result = await fetchHomepageFeaturedWord()
        if (!this.todayWordActive || this.todayWordRequestId !== requestId || requestedDay !== shanghaiDay()) return
        this.applyTodayWord(result && result.word, result && result.source)
      } catch (error) {
        if (!this.todayWordActive || this.todayWordRequestId !== requestId) return
        this.applyTodayWord(null, 'empty')
      } finally {
        if (this.todayWordActive && this.todayWordRequestId === requestId) {
          this.todayWordPending = false
          this.scheduleTodayWordRefresh(requestedDay !== shanghaiDay() ? 1 : undefined)
        }
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
        this.results = []
        this.searchErrorMessage = '线上词库暂时无法连接，请检查网络后重试。'
        this.missingDescription = this.searchErrorMessage
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
        let remoteExact = null
        try {
          remoteExact = await fetchWordByWord(word)
        } catch (error) {
          this.results = []
          this.searchErrorMessage = '线上词库暂时无法连接，请检查网络后重试。'
          this.missingDescription = this.searchErrorMessage
          this.searchPanelOpen = true
          return
        }
        if (remoteExact) {
          this.openDetail(remoteExact.id, true, { trustedWord: remoteExact })
          return
        }

        await this.updateSuggestionState(word)
        this.searchPanelOpen = true
      } finally {
        this.searching = false
      }
    },
    clearRecentHistory() {
      if (getAuthSession()) {
        uni.showToast({
          title: '账号最近学习暂不支持清除',
          icon: 'none'
        })
        this.searchPanelOpen = true
        return
      }

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
      const session = getAuthSession()
      const result = await this.resolvePublishedHistoryWord(id)
      if (result.word) {
        if (result.word.id !== id) {
          if (!session) {
            replaceRecentWordId(id, result.word.id)
          }
          this.refreshUserData()
        }
        this.openDetail(result.word.id, false, { trustedWord: result.word })
        return
      }

      if (result.remove) {
        if (!session) {
          removeRecentWord(id)
        }
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
      this.recordRecentWordView(targetId, {
        countSearch,
        skipPublishedCacheCheck: Boolean(trustedWord)
      })
      uni.navigateTo({
        url: `/pages/word-detail/index?id=${targetId}`
      })
    },
    shouldRecordRecentWord(wordId, options = {}) {
      const id = String(wordId || '').trim()
      return Boolean(
        !isBlockedLegacyHistoryId(id) &&
        (options.skipPublishedCacheCheck || getCachedPublishedRemoteWordById(id))
      )
    },
    recordRecentWordView(wordId, options = {}) {
      if (!this.shouldRecordRecentWord(wordId, options)) return
      const session = getAuthSession()
      if (!session) {
        addRecentWord(wordId, options)
        this.refreshUserData()
        return
      }

      recordLearningActivity({
        countSearch: options.countSearch
      })
      recordUserRecentWord(wordId, { session })
        .then(() => {
          this.refreshUserData()
        })
        .catch(() => {})
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
  flex-wrap: wrap;
  gap: 18rpx;
  margin-bottom: 22rpx;
}

.today-word {
  max-width: 100%;
  overflow-wrap: anywhere;
  color: #ffffff;
  font-size: 72rpx;
  font-weight: 900;
  line-height: 1;
}

.today-phonetic {
  margin-bottom: 8rpx;
  color: #c5dfed;
  font-size: 26rpx;
}

.parts-line {
  position: relative;
  align-items: center;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 26rpx;
}

.part-chip {
  box-sizing: border-box;
  min-width: 120rpx;
  max-width: 100%;
  padding: 16rpx 18rpx;
  border: 2rpx solid;
  border-radius: 18rpx;
  text-align: center;
  overflow-wrap: anywhere;
}

.part-text,
.part-meaning,
.tip,
.tap-tip {
  display: block;
}

.part-text {
  font-size: 34rpx;
  font-weight: 800;
  line-height: 1.25;
}

.part-meaning {
  margin-top: 6rpx;
  color: #29475e;
  font-size: 22rpx;
  line-height: 1.5;
}

.plus {
  color: #bad8e9;
  font-size: 28rpx;
}

.imagery {
  padding-top: 22rpx;
  border-top: 1rpx solid rgba(197, 223, 237, 0.24);
}

.imagery-label {
  display: block;
  margin-bottom: 8rpx;
  color: #ffeba2;
  font-size: 22rpx;
  font-weight: 700;
}

.tip {
  color: #e0edf5;
  font-size: 26rpx;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.card-foot {
  align-items: center;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 24rpx;
}

.tap-tip {
  color: #bad8e9;
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
