<template>
  <view class="page">
    <view class="summary-card">
      <view>
        <text class="page-title">最近学习</text>
        <text class="total-text">共 {{ items.length }} 个单词</text>
      </view>
      <view class="sort-control">
        <view
          class="sort-option"
          :class="{ active: sortMode === 'recent' }"
          @tap="setSortMode('recent')"
        >
          最近学习
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

    <view v-if="loading" class="loading-card">正在加载最近学习...</view>
    <view v-else-if="sortedItems.length" class="word-list">
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
        :title="loadFailed ? '最近学习加载失败' : '还没有最近学习'"
        :description="loadFailed ? '请检查网络后重新进入页面。' : '查过的单词会自动出现在这里。'"
      />
    </view>
  </view>
</template>

<script>
import EmptyState from '../../components/EmptyState.vue'
import { getAuthSession } from '../../common/auth-store.js'
import { listUserRecentWords } from '../../common/user-recent-words-api-client.js'
import { fetchWordById, getCachedPublishedRemoteWordById } from '../../common/word-repository.js'
import { getRecentWordIds, savePendingWordId } from '../../common/user-store.js'

function parseTimestamp(value) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function compareByRecentTime(left, right) {
  const leftTime = parseTimestamp(left.viewedAt)
  const rightTime = parseTimestamp(right.viewedAt)
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

export default {
  components: {
    EmptyState
  },
  data() {
    return {
      items: [],
      sortMode: 'recent',
      loading: false,
      loadFailed: false,
      loadToken: 0
    }
  },
  computed: {
    sortedItems() {
      const items = [...this.items]
      return this.sortMode === 'alphabetical'
        ? items.sort(compareAlphabetically)
        : items.sort(compareByRecentTime)
    }
  },
  onShow() {
    this.loadRecentWords()
  },
  onUnload() {
    this.loadToken += 1
  },
  methods: {
    setSortMode(mode) {
      this.sortMode = mode
    },
    async loadRecentWords() {
      const loadToken = this.loadToken + 1
      this.loadToken = loadToken
      this.loading = true
      this.loadFailed = false
      this.items = []

      const session = getAuthSession()
      try {
        const records = session
          ? await listUserRecentWords({ session })
          : getRecentWordIds().map((wordId, originalIndex) => ({
              wordId,
              viewedAt: '',
              originalIndex
            }))
        const items = await this.resolveRecords(records, loadToken)
        if (this.loadToken === loadToken) {
          this.items = items
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
          viewedAt: String(record.viewedAt || '').trim(),
          word,
          originalIndex: Number.isInteger(record.originalIndex) ? record.originalIndex : index
        })
      }
      return items
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
</style>
