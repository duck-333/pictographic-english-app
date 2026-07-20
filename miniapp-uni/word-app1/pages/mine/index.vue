<template>
  <view class="page">
    <view class="profile-card">
      <view class="avatar-fallback">象</view>
      <view class="profile-main">
        <text class="profile-title">{{ authLoggedIn ? '学习账号已登录' : '我的学习空间' }}</text>
        <text class="profile-subtitle">{{ authSubtitle }}</text>
      </view>
    </view>

    <view class="section auth-card">
      <view class="auth-copy">
        <text class="setting-title">{{ authLoggedIn ? '账号信息' : '手机号快捷登录' }}</text>
        <text class="setting-desc">
          {{ authDescription }}
        </text>
      </view>
      <view class="auth-actions">
        <button
          v-if="!authLoggedIn"
          class="login-button"
          :class="{ disabled: authLoading }"
          hover-class="button-pressed"
          :disabled="authLoading"
          open-type="getPhoneNumber"
          @getphonenumber="handlePhoneLogin"
        >
          {{ authLoading ? '登录中' : '手机号快捷登录' }}
        </button>
        <button
          v-else
          class="logout-button"
          hover-class="button-pressed"
          @tap="handleLogout"
        >
          退出登录
        </button>
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
        <text class="stat-label">最近学习</text>
      </view>
      <view class="stat-card">
        <text class="stat-value">{{ state.streakDays || 0 }}</text>
        <text class="stat-label">连续学习</text>
      </view>
    </view>

    <view class="section">
      <view class="section-head">
        <text class="section-title">最近学习</text>
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
        <text class="empty-title">还没有最近学习</text>
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
        <text class="empty-title">还没有收藏单词</text>
        <text class="empty-description">收藏喜欢的单词，方便以后复习。</text>
      </view>
    </view>

    <view class="section settings-card">
      <view class="setting-row">
        <view>
          <text class="setting-title">学习记录</text>
          <text class="setting-desc">{{ syncDescription }}</text>
        </view>
        <text class="sync-badge">{{ authLoggedIn ? (hasPhoneBinding ? '已绑定' : '已登录') : '未登录' }}</text>
      </view>
      <view class="setting-row">
        <view>
          <text class="setting-title">关于象形英语</text>
          <text class="setting-desc">当前版本提供查词、词条讲解、收藏和学习记录。</text>
        </view>
      </view>
      <button class="feedback-button" hover-class="button-pressed" @tap="showFeedbackTip">学习反馈</button>
    </view>

    <bottom-nav current="/pages/mine/index" />
  </view>
</template>

<script>
import BottomNav from '../../components/BottomNav.vue'
import { loginWithWechatPhone } from '../../common/auth-api-client.js'
import { clearAuthSession, getAuthSession } from '../../common/auth-store.js'
import {
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
      favoriteWords: [],
      authSession: getAuthSession(),
      authLoading: false
    }
  },
  computed: {
    authLoggedIn() {
      return Boolean(this.authSession && this.authSession.token && this.authSession.user && this.authSession.user.id)
    },
    hasPhoneBinding() {
      return Boolean(this.authSession && this.authSession.user && this.authSession.user.hasPhoneBinding)
    },
    phoneMasked() {
      return this.authSession && this.authSession.user ? String(this.authSession.user.phoneMasked || '').trim() : ''
    },
    authSubtitle() {
      if (!this.authLoggedIn) return '登录学习账号，逐步保存你的学习记录'
      if (this.hasPhoneBinding && this.phoneMasked) {
        return `手机号：${this.phoneMasked}，学习记录将逐步跟随账号保存`
      }
      return '学习记录将逐步跟随账号保存'
    },
    authDescription() {
      if (!this.authLoggedIn) {
        return '授权手机号用于创建学习账号，后续保存学习记录和管理学习权益。'
      }
      if (this.hasPhoneBinding && this.phoneMasked) {
        return `手机号：${this.phoneMasked}`
      }
      return '学习账号已建立'
    },
    syncDescription() {
      return this.authLoggedIn
        ? '学习账号已建立，后续将逐步支持学习记录跟随账号保存。'
        : '登录后，可使用学习账号保存学习进度和学习权益。'
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
      this.authSession = getAuthSession()
    },
    getPhoneCodeFromEvent(event) {
      const detail = event && event.detail ? event.detail : {}
      return detail.code ? String(detail.code).trim() : ''
    },
    async handlePhoneLogin(event) {
      if (this.authLoading) return
      const phoneCode = this.getPhoneCodeFromEvent(event)
      if (!phoneCode) {
        uni.showToast({
          title: '未完成手机号授权',
          icon: 'none'
        })
        return
      }
      this.authLoading = true
      try {
        this.authSession = await loginWithWechatPhone(phoneCode)
        uni.showToast({
          title: '登录成功',
          icon: 'none'
        })
      } catch (error) {
        uni.showToast({
          title: this.getLoginErrorMessage(error),
          icon: 'none'
        })
      } finally {
        this.authLoading = false
      }
    },
    handleLogout() {
      clearAuthSession()
      this.authSession = null
      uni.showToast({
        title: '已退出登录',
        icon: 'none'
      })
    },
    getLoginErrorMessage(error) {
      const code = error && error.code ? String(error.code) : ''
      if (code === 'WECHAT_CODE_INVALID' || code === 'WECHAT_CODE_MISSING') return '登录状态已过期，请重试'
      if (code === 'WECHAT_PHONE_CODE_REQUIRED' || code === 'WECHAT_PHONE_CODE_INVALID') return '手机号授权已失效，请重新授权'
      if (code === 'IDENTITY_CONFLICT') return '账号绑定状态需要人工处理，请联系客服'
      if (code === 'WECHAT_RATE_LIMITED') return '登录太频繁，请稍后再试'
      if (code === 'WECHAT_LOGIN_BLOCKED') return '当前微信账号暂无法登录'
      if (code === 'WECHAT_CONFIG_MISSING' || code === 'USER_DB_CONFIG_MISSING' || code === 'PHONE_HASH_SECRET_MISSING') return '登录服务暂未配置'
      if (code === 'AUTH_API_TIMEOUT' || code === 'AUTH_API_NETWORK_ERROR') return '登录服务连接失败'
      return '登录暂不可用，请稍后重试'
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
    showFeedbackTip() {
      uni.showModal({
        title: '学习反馈',
        content: '学习反馈功能正在完善中，感谢你的支持。',
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#0e3a5c'
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

.auth-card {
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

.auth-copy {
  flex: 1;
  min-width: 0;
}

.auth-actions {
  flex-shrink: 0;
  width: 224rpx;
}

.feedback-button {
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

.feedback-button {
  background: #ebf8ff;
  color: #0e3a5c;
}

.login-button,
.logout-button {
  width: 224rpx;
  height: 76rpx;
  padding: 0;
  border-radius: 999rpx;
  font-size: 26rpx;
  font-weight: 900;
  line-height: 76rpx;
}

.login-button {
  background: #0e3a5c;
  color: #ffffff;
}

.login-button.disabled {
  opacity: 0.6;
}

.logout-button {
  background: #ebf8ff;
  color: #0e3a5c;
}

.button-pressed,
.row-pressed {
  opacity: 0.76;
  transform: scale(0.98);
}
</style>
