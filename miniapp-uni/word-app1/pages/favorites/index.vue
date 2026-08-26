<template>
  <view class="page">
    <view class="summary-card">
      <view>
        <text class="page-title">收藏单词</text>
        <text class="total-text">共 {{ items.length }} 个单词</text>
      </view>
      <view class="sort-control">
        <view
          class="sort-option"
          :class="{ active: sortMode === 'recent' }"
          @tap="setSortMode('recent')"
        >
          最近收藏
        </view>
        <view
          class="sort-option"
          :class="{ active: sortMode === 'alphabetical' }"
          @tap="setSortMode('alphabetical')"
        >
          A-Z
        </view>
      </view>
    </view>

    <view v-if="loading" class="loading-card">正在加载收藏单词...</view>
    <template v-else-if="sortMode === 'recent'">
      <view v-if="sortedItems.length" class="word-list">
        <view
          v-for="item in sortedItems"
          :key="item.wordId"
          class="word-row"
          hover-class="row-pressed"
          :data-id="item.wordId"
          @tap="openDetailFromEvent"
        >
          <view class="word-copy">
            <text class="word-name">{{ item.word.word }}</text>
            <text class="word-meaning">{{ item.word.meaning }}</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
      </view>
      <view v-else class="empty-wrap">
        <EmptyState
          :title="emptyTitle"
          :description="emptyDescription"
        />
      </view>
    </template>

    <view v-else-if="loggedIn && items.length" class="alphabetical-layout">
      <view class="search-box">
        <text class="search-icon">⌕</text>
        <input
          class="search-input"
          :value="searchQuery"
          placeholder="搜索收藏单词"
          placeholder-class="search-placeholder"
          @input="handleSearchInput"
        />
      </view>

      <scroll-view
        v-if="alphabeticalGroups.length"
        class="alphabetical-scroll"
        scroll-y
        :scroll-into-view="scrollIntoView"
        :scroll-with-animation="true"
      >
        <view class="alphabetical-list">
          <view
            v-for="group in alphabeticalGroups"
            :id="getSectionId(group.letter)"
            :key="group.letter"
            class="letter-section"
          >
            <text class="letter-title">{{ group.letter }}</text>
            <view
              v-for="item in group.items"
              :key="item.wordId"
              class="word-row"
              hover-class="row-pressed"
              :data-id="item.wordId"
              @tap="openDetailFromEvent"
            >
              <view class="word-copy">
                <text class="word-name">{{ item.word.word }}</text>
                <text class="word-meaning">{{ item.word.meaning }}</text>
              </view>
              <text class="row-arrow">›</text>
            </view>
          </view>
        </view>
      </scroll-view>

      <view v-else class="empty-wrap alphabetical-empty">
        <EmptyState
          title="没有找到匹配的收藏单词"
          description="请尝试其他关键词。"
        />
      </view>

      <view v-if="alphabeticalGroups.length" class="letter-index">
        <text
          v-for="letter in alphabetIndex"
          :key="letter"
          class="index-letter"
          :class="{
            available: availableLetters.indexOf(letter) >= 0,
            active: activeLetter === letter
          }"
          :data-letter="letter"
          @tap="jumpToLetter"
        >
          {{ letter }}
        </text>
      </view>
    </view>

    <view v-else class="empty-wrap">
      <EmptyState
        :title="emptyTitle"
        :description="emptyDescription"
      />
    </view>
  </view>
</template>

<script>
import EmptyState from '../../components/EmptyState.vue'
import { getAuthSession } from '../../common/auth-store.js'
import { listUserFavorites } from '../../common/user-favorites-api-client.js'
import { fetchWordById, getCachedPublishedRemoteWordById } from '../../common/word-repository.js'
import { savePendingWordId } from '../../common/user-store.js'

const ALPHABET_INDEX = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat('#')

function parseTimestamp(value) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function compareByRecentTime(left, right) {
  const leftTime = parseTimestamp(left.createdAt)
  const rightTime = parseTimestamp(right.createdAt)
  if (leftTime === null && rightTime !== null) return 1
  if (leftTime !== null && rightTime === null) return -1
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
    return rightTime - leftTime
  }
  return left.originalIndex - right.originalIndex
}

function compareAlphabetically(left, right) {
  const result = String(left.word && left.word.word ? left.word.word : '').localeCompare(
    String(right.word && right.word.word ? right.word.word : ''),
    'en',
    { sensitivity: 'base' }
  )
  return result || left.originalIndex - right.originalIndex
}

function getGroupLetter(item) {
  const value = String(item && item.word && item.word.word ? item.word.word : '').trim()
  if (!value) return '#'
  const firstCharacter = value.charAt(0).toUpperCase()
  return /^[A-Z]$/.test(firstCharacter) ? firstCharacter : '#'
}

export default {
  components: {
    EmptyState
  },
  data() {
    return {
      items: [],
      sortMode: 'recent',
      loggedIn: false,
      loading: false,
      loadFailed: false,
      loadToken: 0,
      searchQuery: '',
      scrollIntoView: '',
      activeLetter: '',
      alphabetIndex: ALPHABET_INDEX
    }
  },
  computed: {
    sortedItems() {
      const items = [...this.items]
      return this.sortMode === 'alphabetical'
        ? items.sort(compareAlphabetically)
        : items.sort(compareByRecentTime)
    },
    filteredAlphabeticalItems() {
      const query = String(this.searchQuery || '').trim().toLocaleLowerCase('en')
      if (!query) return [...this.items]
      return this.items.filter((item) => {
        const word = String(item && item.word && item.word.word ? item.word.word : '').toLocaleLowerCase('en')
        const meaning = String(item && item.word && item.word.meaning ? item.word.meaning : '').toLocaleLowerCase('en')
        return word.indexOf(query) >= 0 || meaning.indexOf(query) >= 0
      })
    },
    alphabeticalGroups() {
      const groupedItems = {}
      ;[...this.filteredAlphabeticalItems]
        .sort(compareAlphabetically)
        .forEach((item) => {
          const letter = getGroupLetter(item)
          if (!groupedItems[letter]) groupedItems[letter] = []
          groupedItems[letter].push(item)
        })
      return ALPHABET_INDEX
        .filter((letter) => groupedItems[letter] && groupedItems[letter].length)
        .map((letter) => ({
          letter,
          items: groupedItems[letter]
        }))
    },
    availableLetters() {
      return this.alphabeticalGroups.map((group) => group.letter)
    },
    emptyTitle() {
      if (!this.loggedIn) return '需要登录后查看收藏单词'
      if (this.loadFailed) return '收藏单词加载失败'
      return '还没有收藏单词'
    },
    emptyDescription() {
      if (!this.loggedIn) return '请返回“我的”页面登录学习账号。'
      if (this.loadFailed) return '请检查网络后重新进入页面。'
      return '收藏喜欢的单词，方便以后复习。'
    }
  },
  onShow() {
    this.loadFavorites()
  },
  onUnload() {
    this.loadToken += 1
  },
  methods: {
    setSortMode(mode) {
      this.sortMode = mode
    },
    async loadFavorites() {
      const loadToken = this.loadToken + 1
      this.loadToken = loadToken
      this.loading = false
      this.loadFailed = false
      this.items = []

      const session = getAuthSession()
      this.loggedIn = Boolean(session)
      if (!session) return

      this.loading = true
      try {
        const records = await listUserFavorites({ session })
        const items = await this.resolveRecords(records, loadToken)
        if (this.loadToken === loadToken) {
          this.items = items
          this.activeLetter = ''
          this.scrollIntoView = ''
        }
      } catch (error) {
        if (this.loadToken === loadToken) {
          this.items = []
          this.loadFailed = true
        }
      } finally {
        if (this.loadToken === loadToken) {
          this.loading = false
        }
      }
    },
    async resolveRecords(records, loadToken) {
      const items = []
      for (let index = 0; index < records.length; index += 1) {
        if (this.loadToken !== loadToken) return []
        const record = records[index] || {}
        const wordId = String(record.wordId || '').trim()
        if (!wordId) continue

        let word = getCachedPublishedRemoteWordById(wordId)
        if (!word) {
          try {
            word = await fetchWordById(wordId)
          } catch (error) {
            word = null
          }
        }
        if (this.loadToken !== loadToken) return []
        if (!word || word.status !== 'published') continue

        items.push({
          wordId,
          createdAt: String(record.createdAt || '').trim(),
          word,
          originalIndex: index
        })
      }
      return items
    },
    handleSearchInput(event) {
      const detail = event && event.detail ? event.detail : {}
      this.searchQuery = String(detail.value || '')
      this.activeLetter = ''
      this.scrollIntoView = ''
    },
    getSectionId(letter) {
      return letter === '#' ? 'favorite-section-other' : `favorite-section-${letter}`
    },
    jumpToLetter(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      const letter = String(dataset.letter || '')
      if (this.availableLetters.indexOf(letter) < 0) return
      this.activeLetter = letter
      this.scrollIntoView = ''
      this.$nextTick(() => {
        this.scrollIntoView = this.getSectionId(letter)
      })
    },
    openDetailFromEvent(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      const id = String(dataset.id || '').trim()
      if (!id) return
      savePendingWordId(id)
      uni.navigateTo({
        url: `/pages/word-detail/index?id=${encodeURIComponent(id)}`
      })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 28rpx 30rpx 60rpx;
  background: #f0f9ff;
}

.summary-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  padding: 30rpx;
  border: 2rpx solid #dbeeff;
  border-radius: 30rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 18rpx rgba(14, 58, 92, 0.06);
}

.page-title,
.total-text,
.word-name,
.word-meaning {
  display: block;
}

.page-title {
  color: #0e3a5c;
  font-size: 34rpx;
  font-weight: 900;
}

.total-text {
  margin-top: 8rpx;
  color: #6baed6;
  font-size: 24rpx;
}

.sort-control {
  display: flex;
  padding: 6rpx;
  border-radius: 999rpx;
  background: #eef8ff;
}

.sort-option {
  padding: 12rpx 20rpx;
  border-radius: 999rpx;
  color: #6b8aa4;
  font-size: 23rpx;
  line-height: 1;
}

.sort-option.active {
  background: #0e3a5c;
  color: #ffffff;
  font-weight: 700;
}

.loading-card {
  margin-top: 24rpx;
  padding: 50rpx 30rpx;
  border-radius: 28rpx;
  background: #ffffff;
  color: #6baed6;
  font-size: 26rpx;
  text-align: center;
}

.alphabetical-layout {
  position: relative;
  margin-top: 24rpx;
  padding-right: 34rpx;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 76rpx;
  padding: 0 24rpx;
  border: 2rpx solid #dbeeff;
  border-radius: 24rpx;
  background: #ffffff;
}

.search-icon {
  color: #6baed6;
  font-size: 34rpx;
  line-height: 1;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 76rpx;
  color: #0e3a5c;
  font-size: 26rpx;
}

.search-placeholder {
  color: #9ab8cd;
}

.alphabetical-scroll {
  height: calc(100vh - 330rpx - env(safe-area-inset-bottom));
  margin-top: 18rpx;
}

.alphabetical-list {
  padding-bottom: calc(40rpx + env(safe-area-inset-bottom));
}

.letter-section {
  scroll-margin-top: 0;
}

.letter-title {
  display: block;
  padding: 16rpx 8rpx 12rpx;
  color: #6b8aa4;
  font-size: 25rpx;
  font-weight: 700;
}

.letter-index {
  position: fixed;
  top: 50%;
  right: 8rpx;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateY(-42%);
}

.index-letter {
  width: 30rpx;
  color: #bed3e2;
  font-size: 19rpx;
  line-height: 25rpx;
  text-align: center;
}

.index-letter.available {
  color: #416d8c;
  font-weight: 700;
}

.index-letter.active {
  border-radius: 999rpx;
  background: #0e3a5c;
  color: #ffffff;
}

.word-list {
  margin-top: 24rpx;
}

.word-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  margin-bottom: 16rpx;
  padding: 24rpx 28rpx;
  border: 2rpx solid #e4f0fa;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 18rpx rgba(14, 58, 92, 0.05);
}

.word-copy {
  min-width: 0;
}

.word-name {
  color: #0e3a5c;
  font-size: 30rpx;
  font-weight: 900;
}

.word-meaning {
  margin-top: 6rpx;
  color: #6baed6;
  font-size: 24rpx;
}

.row-arrow {
  flex: none;
  color: #ff8a00;
  font-size: 40rpx;
}

.row-pressed {
  opacity: 0.76;
  transform: scale(0.99);
}

.empty-wrap {
  margin-top: 24rpx;
}

.alphabetical-empty {
  margin-right: -34rpx;
}
</style>
