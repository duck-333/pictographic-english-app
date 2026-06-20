<template>
  <view class="page">
    <view class="profile-card">
      <view class="avatar-fallback">象</view>
      <view class="profile-main">
        <text class="profile-title">本机学习记录</text>
        <text class="profile-subtitle">收藏、最近查看和学习次数仅保存在当前设备</text>
      </view>
    </view>

    <view class="stats-grid">
      <view class="stat-card">
        <text class="stat-value">{{ state.searchCount || 0 }}</text>
        <text class="stat-label">查词次数</text>
      </view>
      <view class="stat-card">
        <text class="stat-value">{{ favoriteWords.length }}</text>
        <text class="stat-label">收藏单词</text>
      </view>
      <view class="stat-card">
        <text class="stat-value">{{ recentWords.length }}</text>
        <text class="stat-label">最近查看</text>
      </view>
      <view class="stat-card">
        <text class="stat-value">{{ state.streakDays || 0 }}</text>
        <text class="stat-label">连续天数</text>
      </view>
    </view>

    <view class="section">
      <view class="section-head">
        <text class="section-title">最近查看</text>
        <text class="hint-text">本机记录</text>
      </view>
      <view v-if="recentWords.length" class="word-list">
        <view
          v-for="item in recentWords"
          :key="item.id"
          class="word-row"
          hover-class="row-pressed"
          :data-id="item.id"
          @tap="openDetailFromEvent"
        >
          <view>
            <text class="word-name">{{ item.word }}</text>
            <text class="word-meaning">{{ item.meaning }}</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
      </view>
      <view v-else class="empty-state">
        <view class="empty-mark">象</view>
        <text class="empty-title">还没有最近查看</text>
        <text class="empty-description">查过的单词会自动出现在这里。</text>
      </view>
    </view>

    <view class="section">
      <view class="section-head">
        <text class="section-title">收藏单词</text>
        <text class="hint-text">{{ favoriteWords.length }} 个</text>
      </view>
      <view v-if="favoriteWords.length" class="word-list">
        <view
          v-for="item in favoriteWords"
          :key="item.id"
          class="word-row"
          hover-class="row-pressed"
          :data-id="item.id"
          @tap="openDetailFromEvent"
        >
          <view>
            <text class="word-name">{{ item.word }}</text>
            <text class="word-meaning">{{ item.meaning }}</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
      </view>
      <view v-else class="empty-state">
        <view class="empty-mark">象</view>
        <text class="empty-title">还没有收藏</text>
        <text class="empty-description">在单词详情页点收藏后，会出现在这里。</text>
      </view>
    </view>

    <view class="section settings-card">
      <view class="setting-row">
        <view>
          <text class="setting-title">数据同步状态</text>
          <text class="setting-desc">当前版本不登录、不采集头像昵称，学习数据仅保存在当前设备。</text>
        </view>
        <text class="sync-badge">本机</text>
      </view>
      <view class="setting-row">
        <view>
          <text class="setting-title">关于象形英语</text>
          <text class="setting-desc">当前版本提供查词、词条讲解、收藏和学习记录。</text>
        </view>
      </view>
      <button class="clear-button" hover-class="danger-pressed" @tap="confirmClear">清除本机记录</button>
    </view>

    <bottom-nav current="/pages/mine/index" />
  </view>
</template>

<script>
import BottomNav from '../../components/BottomNav.vue'
import {
  clearUserData,
  getFavoriteWords,
  getRecentWords,
  getUserState,
  savePendingWordId
} from '../../common/user-store.js'

export default {
  components: {
    BottomNav
  },
  data() {
    return {
      state: getUserState(),
      recentWords: [],
      favoriteWords: []
    }
  },
  onShow() {
    this.refreshData()
  },
  methods: {
    refreshData() {
      this.state = getUserState()
      this.recentWords = getRecentWords()
      this.favoriteWords = getFavoriteWords()
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
    goHome() {
      uni.reLaunch({
        url: '/pages/index/index'
      })
    },
    confirmClear() {
      uni.showModal({
        title: '清除本机记录',
        content: '会清除最近查看和收藏记录。此操作只影响当前设备。',
        confirmText: '清除',
        confirmColor: '#dc2626',
        success: (res) => {
          if (!res.confirm) return
          clearUserData()
          this.refreshData()
          uni.showToast({
            title: '已清除',
            icon: 'none'
          })
        }
      })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 32rpx 32rpx calc(188rpx + env(safe-area-inset-bottom));
  background: #f0f9ff;
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 32rpx;
  border-radius: 32rpx;
  background: linear-gradient(145deg, #0e3a5c 0%, #1a5a8a 100%);
  box-shadow: 0 18rpx 48rpx rgba(14, 58, 92, 0.18);
}

.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 104rpx;
  height: 104rpx;
  border: 2rpx solid rgba(255, 235, 162, 0.4);
  border-radius: 32rpx;
  background: rgba(255, 255, 255, 0.14);
  color: #ffeba2;
  font-size: 42rpx;
  font-weight: 900;
}

.profile-main {
  flex: 1;
  min-width: 0;
}

.profile-title {
  display: block;
  color: #ffffff;
  font-size: 34rpx;
  font-weight: 800;
}

.profile-subtitle {
  display: block;
  margin-top: 8rpx;
  color: rgba(255, 255, 255, 0.66);
  font-size: 24rpx;
}

.stats-grid {
  display: flex;
  gap: 14rpx;
  margin-top: 24rpx;
}

.stat-card {
  flex: 1;
  min-width: 0;
  padding: 24rpx 10rpx;
  border: 2rpx solid #dbeeff;
  border-radius: 24rpx;
  background: #ffffff;
  text-align: center;
}

.stat-value,
.stat-label,
.section-title,
.hint-text,
.word-name,
.word-meaning,
.setting-title,
.setting-desc,
.sync-badge {
  display: block;
}

.stat-value {
  color: #0e3a5c;
  font-size: 34rpx;
  font-weight: 900;
}

.stat-label {
  margin-top: 6rpx;
  color: #6baed6;
  font-size: 21rpx;
}

.section {
  margin-top: 28rpx;
}

.section-head,
.word-row,
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-head {
  margin-bottom: 18rpx;
}

.section-title {
  color: #0e3a5c;
  font-size: 30rpx;
  font-weight: 900;
}

.hint-text {
  color: #6baed6;
  font-size: 24rpx;
}

.word-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.word-row {
  min-height: 104rpx;
  padding: 0 28rpx;
  border: 2rpx solid #ececec;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 4rpx 12rpx rgba(14, 58, 92, 0.05);
}

.word-name {
  color: #0e3a5c;
  font-size: 32rpx;
  font-weight: 900;
}

.word-meaning {
  max-width: 520rpx;
  margin-top: 6rpx;
  color: #6baed6;
  font-size: 22rpx;
  line-height: 1.45;
}

.row-arrow {
  color: #fe8500;
  font-size: 40rpx;
}

.settings-card {
  padding: 30rpx;
  border-radius: 30rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 18rpx rgba(14, 58, 92, 0.06);
}

.clear-button {
  width: 100%;
  height: 84rpx;
  margin-top: 26rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  font-weight: 900;
  line-height: 84rpx;
}

.setting-row {
  align-items: flex-start;
  gap: 18rpx;
  padding: 18rpx 0;
  border-bottom: 2rpx solid #eef6fc;
}

.setting-row:last-of-type {
  border-bottom: 0;
}

.setting-title {
  color: #0e3a5c;
  font-size: 27rpx;
  font-weight: 800;
}

.setting-desc {
  margin-top: 8rpx;
  color: #6b8aa4;
  font-size: 23rpx;
  line-height: 1.5;
}

.sync-badge {
  flex-shrink: 0;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: #ebf8ff;
  color: #0e3a5c;
  font-size: 22rpx;
  font-weight: 800;
}

.clear-button {
  background: #fff1f2;
  color: #dc2626;
}

.button-pressed,
.row-pressed,
.danger-pressed {
  opacity: 0.76;
  transform: scale(0.98);
}
</style>
