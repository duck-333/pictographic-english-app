<template>
  <view class="page">
    <view class="profile-card">
      <button class="avatar-button" open-type="chooseAvatar" hover-class="button-pressed" @chooseavatar="onChooseAvatar">
        <image v-if="profile.avatarUrl" class="avatar-image" :src="profile.avatarUrl" mode="aspectFill" />
        <text v-else class="avatar-fallback">象</text>
      </button>
      <view class="profile-main">
        <input
          class="nickname-input"
          type="nickname"
          :value="profile.nickname"
          placeholder="填写昵称"
          @input="handleNicknameInput"
          @blur="saveProfile"
        />
        <text class="profile-subtitle">{{ profile.syncStatus }} · 不强制登录</text>
      </view>
      <button class="save-button" hover-class="button-pressed" @tap="saveProfile">保存</button>
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

    <view class="section feedback-card">
      <text class="section-title">缺词反馈</text>
      <text class="form-hint">提交未收录单词，后续优先补充讲解。</text>
      <view class="form-field">
        <text class="field-label">单词</text>
        <input
          class="field-input"
          :value="feedback.missingWord"
          placeholder="例如: memory"
          confirm-type="done"
          @input="updateFeedbackWord"
        />
      </view>
      <view class="form-field">
        <text class="field-label">书页提示</text>
        <input
          class="field-input"
          :value="feedback.bookPageHint"
          placeholder="选填，例如: 第 32 页"
          @input="updateFeedbackPage"
        />
      </view>
      <view class="form-field">
        <text class="field-label">补充说明</text>
        <textarea
          class="field-textarea"
          :value="feedback.note"
          maxlength="120"
          placeholder="选填，说说你想看到什么讲解。"
          @input="updateFeedbackNote"
        />
      </view>
      <button class="submit-button" hover-class="button-pressed" @tap="submitFeedback">提交反馈</button>
      <view v-if="feedbacks.length" class="feedback-history">
        <view class="feedback-history-head">
          <text class="feedback-history-title">最近反馈</text>
          <text class="feedback-count">已保存 {{ feedbacks.length }} 条</text>
        </view>
        <view
          v-for="item in feedbacks"
          :key="item.id"
          class="feedback-row"
        >
          <view>
            <text class="feedback-word">{{ item.missingWord }}</text>
            <text class="feedback-meta">{{ item.bookPageHint || '未填写页码' }} · {{ item.displayDate }}</text>
          </view>
          <text class="feedback-status">待补充</text>
        </view>
        <text class="feedback-sync-tip">当前仅保存在本机，后续接入云同步后可统一处理。</text>
      </view>
    </view>

    <view class="section settings-card">
      <view class="setting-row">
        <view>
          <text class="setting-title">数据同步状态</text>
          <text class="setting-desc">当前为本机保存，后续可接入 openid 云同步。</text>
        </view>
        <text class="sync-badge">本机</text>
      </view>
      <view class="setting-row">
        <view>
          <text class="setting-title">关于象形英语</text>
          <text class="setting-desc">MVP 版本：查词、详情、收藏、反馈闭环。</text>
        </view>
      </view>
      <button class="clear-button" hover-class="danger-pressed" @tap="confirmClear">清除本机记录</button>
    </view>

    <view class="bottom-nav">
      <view class="nav-item" hover-class="nav-item-pressed" @tap="goHome">
        <view class="nav-icon search">
          <view class="i-a"></view>
          <view class="i-b"></view>
          <view class="i-c"></view>
        </view>
        <text class="nav-label">查词</text>
      </view>
      <view class="nav-item active" hover-class="nav-item-pressed">
        <view class="nav-icon mine">
          <view class="i-a"></view>
          <view class="i-b"></view>
          <view class="i-c"></view>
        </view>
        <text class="nav-label">我的</text>
        <view class="nav-dot"></view>
      </view>
    </view>
  </view>
</template>

<script>
import {
  clearUserData,
  getFavoriteWords,
  getFeedbacks,
  getRecentWords,
  getUserProfile,
  getUserState,
  savePendingWordId,
  saveUserProfile,
  submitMissingWordFeedback
} from '../../common/user-store.js'

export default {
  data() {
    return {
      profile: getUserProfile(),
      state: getUserState(),
      recentWords: [],
      favoriteWords: [],
      feedbacks: [],
      feedback: {
        missingWord: '',
        bookPageHint: '',
        note: ''
      }
    }
  },
  onLoad(options) {
    if (options && options.feedbackWord) {
      this.feedback.missingWord = decodeURIComponent(options.feedbackWord)
    }
  },
  onShow() {
    this.refreshData()
  },
  methods: {
    refreshData() {
      this.profile = getUserProfile()
      this.state = getUserState()
      this.recentWords = getRecentWords()
      this.favoriteWords = getFavoriteWords()
      this.feedbacks = getFeedbacks().map((item) => ({
        ...item,
        displayDate: this.formatFeedbackDate(item.createdAt)
      }))
    },
    onChooseAvatar(event) {
      this.profile.avatarUrl = event.detail.avatarUrl
      this.saveProfile()
    },
    handleNicknameInput(event) {
      this.profile.nickname = event.detail.value
    },
    saveProfile() {
      this.profile = saveUserProfile({
        nickname: this.profile.nickname || '象形英语学习者',
        avatarUrl: this.profile.avatarUrl
      })
      uni.showToast({
        title: '资料已保存',
        icon: 'none'
      })
    },
    updateFeedbackWord(event) {
      this.feedback.missingWord = event.detail.value
    },
    updateFeedbackPage(event) {
      this.feedback.bookPageHint = event.detail.value
    },
    updateFeedbackNote(event) {
      this.feedback.note = event.detail.value
    },
    submitFeedback() {
      const word = (this.feedback.missingWord || '').trim().toLowerCase()
      if (!/^[a-z][a-z'-]{0,44}$/.test(word)) {
        uni.showToast({
          title: '请输入 45 位以内英文单词',
          icon: 'none'
        })
        return
      }
      submitMissingWordFeedback({
        ...this.feedback,
        missingWord: word
      })
      this.feedback = {
        missingWord: '',
        bookPageHint: '',
        note: ''
      }
      this.refreshData()
      uni.showToast({
        title: '反馈已保存',
        icon: 'none'
      })
    },
    formatFeedbackDate(value) {
      if (!value) return '刚刚'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '刚刚'
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${month}-${day}`
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
        content: '会清除头像昵称、最近查看、收藏和反馈草稿。此操作只影响本机缓存。',
        confirmText: '清除',
        confirmColor: '#dc2626',
        success: (res) => {
          if (!res.confirm) return
          clearUserData()
          this.feedback = {
            missingWord: '',
            bookPageHint: '',
            note: ''
          }
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
  padding: 32rpx 32rpx 172rpx;
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

.avatar-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 104rpx;
  height: 104rpx;
  padding: 0;
  margin: 0;
  overflow: hidden;
  border: 2rpx solid rgba(255, 235, 162, 0.4);
  border-radius: 32rpx;
  background: rgba(255, 255, 255, 0.14);
}

.avatar-image {
  width: 104rpx;
  height: 104rpx;
}

.avatar-fallback {
  color: #ffeba2;
  font-size: 42rpx;
  font-weight: 900;
}

.profile-main {
  flex: 1;
  min-width: 0;
}

.nickname-input {
  height: 54rpx;
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

.save-button {
  flex-shrink: 0;
  height: 64rpx;
  padding: 0 24rpx;
  border-radius: 999rpx;
  background: rgba(255, 235, 162, 0.18);
  color: #ffeba2;
  font-size: 24rpx;
  font-weight: 800;
  line-height: 64rpx;
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
.form-hint,
.field-label,
.feedback-count,
.feedback-history-title,
.feedback-word,
.feedback-meta,
.feedback-status,
.feedback-sync-tip,
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

.feedback-card,
.settings-card {
  padding: 30rpx;
  border-radius: 30rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 18rpx rgba(14, 58, 92, 0.06);
}

.form-hint {
  margin-top: 10rpx;
  color: #6b8aa4;
  font-size: 24rpx;
  line-height: 1.55;
}

.form-field {
  margin-top: 22rpx;
}

.field-label {
  margin-bottom: 10rpx;
  color: #0e3a5c;
  font-size: 24rpx;
  font-weight: 800;
}

.field-input,
.field-textarea {
  width: 100%;
  border: 2rpx solid #dbeeff;
  border-radius: 22rpx;
  background: #f7fcff;
  color: #16324f;
  font-size: 26rpx;
}

.field-input {
  height: 78rpx;
  padding: 0 22rpx;
}

.field-textarea {
  min-height: 140rpx;
  padding: 20rpx 22rpx;
  line-height: 1.5;
}

.submit-button,
.clear-button {
  width: 100%;
  height: 84rpx;
  margin-top: 26rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  font-weight: 900;
  line-height: 84rpx;
}

.submit-button {
  background: #0e3a5c;
  color: #ffffff;
}

.feedback-history {
  margin-top: 26rpx;
  padding: 22rpx;
  border: 2rpx solid #dbeeff;
  border-radius: 24rpx;
  background: #f7fcff;
}

.feedback-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 14rpx;
}

.feedback-history-title {
  color: #0e3a5c;
  font-size: 25rpx;
  font-weight: 900;
}

.feedback-count {
  color: #6baed6;
  font-size: 22rpx;
}

.feedback-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  padding: 16rpx 0;
  border-top: 2rpx solid #e7f3fc;
}

.feedback-word {
  color: #0e3a5c;
  font-size: 27rpx;
  font-weight: 900;
}

.feedback-meta,
.feedback-sync-tip {
  margin-top: 6rpx;
  color: #7d96aa;
  font-size: 21rpx;
}

.feedback-status {
  flex-shrink: 0;
  padding: 6rpx 14rpx;
  border-radius: 999rpx;
  background: #fff7ed;
  color: #fe8500;
  font-size: 20rpx;
  font-weight: 800;
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
