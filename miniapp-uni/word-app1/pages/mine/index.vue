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
        <text class="stat-value">{{ quotaBalanceText }}</text>
        <text class="stat-label">剩余查词次数</text>
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

    <view v-if="authLoggedIn" class="section entitlement-card">
      <view class="section-head">
        <text class="section-title">学习权益</text>
        <text class="hint-text">{{ entitlementHint }}</text>
      </view>
      <view v-if="entitlement" class="membership-summary">
        <text class="membership-summary-title">{{ membershipSummaryTitle }}</text>
        <text v-if="membershipSummaryValue" class="membership-summary-value">{{ membershipSummaryValue }}</text>
        <text v-if="membershipActive" class="membership-summary-note">会员期间不限次数</text>
      </view>
      <view class="entitlement-grid">
        <view class="entitlement-item">
          <text class="entitlement-value">{{ quotaTotalGrantedText }}</text>
          <text class="entitlement-label">累计获得</text>
        </view>
        <view class="entitlement-item">
          <text class="entitlement-value">{{ quotaTotalConsumedText }}</text>
          <text class="entitlement-label">已消耗</text>
        </view>
        <view class="entitlement-item">
          <text class="entitlement-value">{{ membershipTypeText }}</text>
          <text class="entitlement-label">会员类型</text>
        </view>
        <view class="entitlement-item">
          <text class="entitlement-value">{{ membershipStatusText }}</text>
          <text class="entitlement-label">会员状态</text>
        </view>
      </view>
    </view>

    <view class="section book-benefit-redeem-card">
      <view class="section-head">
        <text class="section-title">兑换30天学习权益</text>
        <text class="hint-text">购书用户福利</text>
      </view>
      <template v-if="!authLoggedIn">
        <text class="book-benefit-description">登录并验证手机号后即可兑换。</text>
        <button
          class="book-benefit-primary-button"
          :disabled="authLoading"
          open-type="getPhoneNumber"
          @getphonenumber="handlePhoneLogin"
        >
          {{ authLoading ? '登录中' : '登录后兑换' }}
        </button>
      </template>
      <template v-else-if="!hasPhoneBinding">
        <text class="book-benefit-description">请先完成可信手机号验证，再提交购书福利码。</text>
        <button
          class="book-benefit-primary-button"
          :disabled="authLoading"
          open-type="getPhoneNumber"
          @getphonenumber="handlePhoneLogin"
        >
          {{ authLoading ? '验证中' : '验证手机号' }}
        </button>
      </template>
      <template v-else>
        <input
          v-model="bookBenefitCode"
          class="book-benefit-code-input"
          :disabled="bookBenefitRedeeming"
          maxlength="128"
          placeholder="请输入购书福利码"
          @input="handleBookBenefitCodeInput"
        />
        <button
          class="book-benefit-primary-button"
          :disabled="bookBenefitRedeeming || !bookBenefitCode.trim()"
          @tap="submitBookBenefitRedemption"
        >
          {{ bookBenefitRedeeming ? '提交中...' : (bookBenefitPending ? '确认兑换结果' : '立即兑换') }}
        </button>
      </template>
      <view v-if="bookBenefitSuccess" class="book-benefit-success">
        <text class="book-benefit-success-title">30天学习权益已到账</text>
        <text>权益有效期至：{{ formatBookBenefitDate(bookBenefitSuccess.membershipExpireAt) }}</text>
      </view>
      <text v-if="bookBenefitMessage" class="book-benefit-message">{{ bookBenefitMessage }}</text>
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
import { redeemBookBenefitCode } from '../../common/book-benefit-api-client.js'
import { clearAuthSession, getAuthSession } from '../../common/auth-store.js'
import { getUserEntitlements } from '../../common/user-entitlements-api-client.js'
import { listUserFavorites } from '../../common/user-favorites-api-client.js'
import { listUserRecentWords } from '../../common/user-recent-words-api-client.js'
import { fetchWordById, getCachedPublishedRemoteWordById } from '../../common/word-repository.js'
import {
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
      authLoading: false,
      entitlement: null,
      entitlementLoading: false,
      entitlementLoadFailed: false,
      entitlementLoadToken: 0,
      favoriteLoadToken: 0,
      recentLoadToken: 0,
      bookBenefitCode: '',
      bookBenefitOperationId: '',
      bookBenefitRedeeming: false,
      bookBenefitPending: false,
      bookBenefitMessage: '',
      bookBenefitSuccess: null
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
    },
    quotaBalanceText() {
      if (!this.authLoggedIn) return '--'
      if (!this.entitlement) return this.entitlementLoading ? '...' : '--'
      return String(this.entitlement.quotaBalance)
    },
    quotaTotalGrantedText() {
      return this.entitlement ? String(this.entitlement.quotaTotalGranted) : '--'
    },
    quotaTotalConsumedText() {
      return this.entitlement ? String(this.entitlement.quotaTotalConsumed) : '--'
    },
    membershipTypeText() {
      const type = this.entitlement ? String(this.entitlement.membershipType || 'none') : 'none'
      if (type === 'none') return '普通'
      if (type === 'monthly') return '月会员'
      return type
    },
    membershipStatusText() {
      const status = this.entitlement ? String(this.entitlement.membershipStatus || 'none') : 'none'
      if (status === 'active') return '有效'
      if (status === 'expired') return '已过期'
      if (status === 'cancelled') return '已取消'
      return '未开通'
    },
    membershipActive() {
      return Boolean(this.entitlement && this.entitlement.membershipActive === true)
    },
    membershipExpired() {
      if (!this.entitlement || this.membershipActive) return false
      const status = String(this.entitlement.membershipStatus || 'none')
      if (status === 'expired') return true
      const expireAt = this.entitlement.membershipExpireAt ? new Date(this.entitlement.membershipExpireAt) : null
      return Boolean(expireAt && Number.isFinite(expireAt.getTime()) && expireAt.getTime() <= Date.now())
    },
    membershipExpireDateText() {
      if (!this.entitlement || !this.entitlement.membershipExpireAt) return '--'
      const text = String(this.entitlement.membershipExpireAt).trim()
      return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '--'
    },
    membershipSummaryTitle() {
      if (this.membershipActive) return '会员有效期：'
      if (this.membershipExpired) return '会员已到期'
      return '剩余查词次数：'
    },
    membershipSummaryValue() {
      if (this.membershipActive) return this.membershipExpireDateText
      if (this.membershipExpired) return ''
      return `${this.quotaBalanceText}次`
    },
    entitlementHint() {
      if (this.entitlementLoading) return '同步中'
      if (this.entitlementLoadFailed) return '加载失败'
      return '账号权益'
    }
  },
  onShow() {
    this.refreshData()
  },
  methods: {
    async refreshData() {
      const favoriteLoadToken = this.favoriteLoadToken + 1
      const recentLoadToken = this.recentLoadToken + 1
      const entitlementLoadToken = this.entitlementLoadToken + 1
      this.favoriteLoadToken = favoriteLoadToken
      this.recentLoadToken = recentLoadToken
      this.entitlementLoadToken = entitlementLoadToken
      this.state = getUserState()
      this.authSession = getAuthSession()
      if (!this.authLoggedIn) {
        this.entitlement = null
        this.entitlementLoading = false
        this.entitlementLoadFailed = false
        this.recentWords = getRecentWords()
        this.favoriteWords = []
        return
      }

      this.recentWords = []
      this.refreshUserEntitlement(this.authSession, entitlementLoadToken)
      this.refreshCloudRecentWords(this.authSession, recentLoadToken)

      try {
        const favoriteWords = await this.loadCloudFavoriteWords(this.authSession)
        if (this.favoriteLoadToken === favoriteLoadToken && this.authLoggedIn) {
          this.favoriteWords = favoriteWords
        }
      } catch (error) {
        if (this.favoriteLoadToken === favoriteLoadToken && this.authLoggedIn) {
          this.favoriteWords = []
          uni.showToast({
            title: '收藏列表加载失败',
            icon: 'none'
          })
        }
      }
    },
    async refreshUserEntitlement(session, loadToken) {
      this.entitlementLoading = true
      this.entitlementLoadFailed = false
      try {
        const entitlement = await getUserEntitlements({ session })
        if (this.entitlementLoadToken === loadToken && this.authLoggedIn) {
          this.entitlement = entitlement
          this.entitlementLoadFailed = false
        }
      } catch (error) {
        if (this.entitlementLoadToken === loadToken && this.authLoggedIn) {
          this.entitlement = null
          this.entitlementLoadFailed = true
        }
      } finally {
        if (this.entitlementLoadToken === loadToken && this.authLoggedIn) {
          this.entitlementLoading = false
        }
      }
    },
    async refreshCloudRecentWords(session, loadToken) {
      try {
        const recentWords = await this.loadCloudRecentWords(session)
        if (this.recentLoadToken === loadToken && this.authLoggedIn) {
          this.recentWords = recentWords
        }
      } catch (error) {
        if (this.recentLoadToken === loadToken && this.authLoggedIn) {
          this.recentWords = []
        }
      }
    },
    async loadCloudFavoriteWords(session) {
      const favorites = await listUserFavorites({ session })
      const words = []
      for (let index = 0; index < favorites.length; index += 1) {
        const wordId = String(favorites[index].wordId || '').trim()
        if (!wordId) continue
        let word = getCachedPublishedRemoteWordById(wordId)
        if (!word) {
          try {
            word = await fetchWordById(wordId)
          } catch (error) {
            word = null
          }
        }
        if (word && word.status === 'published') {
          words.push(word)
        }
      }
      return words
    },
    async loadCloudRecentWords(session) {
      const recentWords = (await listUserRecentWords({ session })).slice(0, 12)
      const words = []
      for (let index = 0; index < recentWords.length; index += 1) {
        const wordId = String(recentWords[index].wordId || '').trim()
        if (!wordId) continue
        let word = getCachedPublishedRemoteWordById(wordId)
        if (!word) {
          try {
            word = await fetchWordById(wordId)
          } catch (error) {
            word = null
          }
        }
        if (word && word.status === 'published') {
          words.push(word)
        }
      }
      return words
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
        await this.refreshData()
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
      this.entitlement = null
      this.entitlementLoading = false
      this.entitlementLoadFailed = false
      this.entitlementLoadToken += 1
      this.favoriteLoadToken += 1
      this.recentLoadToken += 1
      this.favoriteWords = []
      this.recentWords = getRecentWords()
      this.clearBookBenefitRedemptionState()
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
    createBookBenefitOperationId() {
      const timePart = Date.now().toString(36)
      const randomPart = Math.random().toString(36).slice(2, 12)
      return `book-redeem-${timePart}-${randomPart}`
    },
    handleBookBenefitCodeInput(event) {
      const value = event && event.detail ? String(event.detail.value || '') : String(this.bookBenefitCode || '')
      this.bookBenefitCode = value.slice(0, 128)
      this.bookBenefitOperationId = ''
      this.bookBenefitPending = false
      this.bookBenefitMessage = ''
      this.bookBenefitSuccess = null
    },
    clearBookBenefitRedemptionState() {
      this.bookBenefitCode = ''
      this.bookBenefitOperationId = ''
      this.bookBenefitPending = false
      this.bookBenefitMessage = ''
      this.bookBenefitSuccess = null
      this.bookBenefitRedeeming = false
    },
    isBookBenefitNetworkUncertain(error) {
      const code = error && error.code ? String(error.code) : ''
      return code === 'BOOK_BENEFIT_API_TIMEOUT' || code === 'BOOK_BENEFIT_API_NETWORK_ERROR'
    },
    getBookBenefitRedemptionMessage(error) {
      const code = error && error.code ? String(error.code) : ''
      const messages = {
        USER_AUTH_REQUIRED: '请先登录后再兑换。',
		UNAUTHORIZED: '登录状态已失效，请重新登录。',
        PHONE_VERIFICATION_REQUIRED: '请先验证手机号。',
        BOOK_BENEFIT_CODE_INVALID: '福利码不存在或格式错误。',
        BOOK_BENEFIT_CODE_EXPIRED: '福利码已过期。',
        BOOK_BENEFIT_CODE_REDEEMED: '福利码已使用。',
        BOOK_BENEFIT_CODE_VOIDED: '福利码已作废，请联系官方客服。',
        BOOK_BENEFIT_ALREADY_PARTICIPATED: '每个账号和当前绑定手机号仅可参加一次本活动。',
        BOOK_BENEFIT_REQUEST_CONFLICT: '兑换请求冲突，请稍后重试。'
      }
      return messages[code] || '服务暂时不可用，请稍后重试。'
    },
    formatBookBenefitDate(value) {
      const text = String(value || '').trim()
      return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '请在学习权益中查看'
    },
    async submitBookBenefitRedemption() {
      if (this.bookBenefitRedeeming) return
      if (!this.authLoggedIn) {
        this.bookBenefitMessage = '请先登录后再兑换。'
        return
      }
      if (!this.hasPhoneBinding) {
        this.bookBenefitMessage = '请先验证手机号。'
        return
      }
      const code = String(this.bookBenefitCode || '').trim()
      if (!code) {
        this.bookBenefitMessage = '请输入购书福利码。'
        return
      }
      if (!this.bookBenefitOperationId) this.bookBenefitOperationId = this.createBookBenefitOperationId()
      this.bookBenefitRedeeming = true
      this.bookBenefitMessage = ''
      try {
        const result = await redeemBookBenefitCode({
          code,
          operationId: this.bookBenefitOperationId
        }, {
          session: this.authSession
        })
        this.bookBenefitSuccess = {
          membershipExpireAt: result.membershipExpireAt || ''
        }
        this.bookBenefitCode = ''
        this.bookBenefitOperationId = ''
        this.bookBenefitPending = false
        this.bookBenefitMessage = '兑换成功，学习权益已刷新。'
        const entitlementLoadToken = this.entitlementLoadToken + 1
        this.entitlementLoadToken = entitlementLoadToken
        await this.refreshUserEntitlement(this.authSession, entitlementLoadToken)
      } catch (error) {
        const authInvalid = error && (error.code === 'UNAUTHORIZED' || Number(error.statusCode) === 401 || Number(error.statusCode) === 403)
        if (authInvalid) {
          clearAuthSession()
          this.authSession = null
          this.entitlement = null
          this.clearBookBenefitRedemptionState()
          this.bookBenefitMessage = '登录状态已失效，请重新登录。'
          return
        }
        if (this.isBookBenefitNetworkUncertain(error)) {
          this.bookBenefitPending = true
          this.bookBenefitMessage = '网络结果待确认，请保留福利码并使用同一操作再次确认。'
        } else {
          this.bookBenefitPending = false
          this.bookBenefitOperationId = ''
          this.bookBenefitMessage = this.getBookBenefitRedemptionMessage(error)
        }
      } finally {
        this.bookBenefitRedeeming = false
      }
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
.entitlement-value,
.entitlement-label,
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

.entitlement-card {
  padding: 30rpx;
  border: 2rpx solid #dbeeff;
  border-radius: 30rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 18rpx rgba(14, 58, 92, 0.06);
}

.membership-summary {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-bottom: 18rpx;
  padding: 22rpx;
  border-radius: 20rpx;
  background: #eef8ff;
}

.membership-summary-title,
.membership-summary-value {
  color: #0e3a5c;
  font-size: 30rpx;
  font-weight: 900;
}

.membership-summary-note {
  color: #2f80b7;
  font-size: 24rpx;
}

.entitlement-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.entitlement-item {
  flex: 0 0 calc(50% - 8rpx);
  min-width: 0;
  box-sizing: border-box;
  padding: 20rpx;
  border-radius: 20rpx;
  background: #f7fbff;
}

.book-benefit-redeem-card {
  padding: 30rpx;
  border: 2rpx solid #dbeeff;
  border-radius: 30rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 18rpx rgba(14, 58, 92, 0.06);
}

.book-benefit-description,
.book-benefit-message,
.book-benefit-success-title,
.book-benefit-success text {
  display: block;
}

.book-benefit-description,
.book-benefit-message {
  color: #6b8aa4;
  font-size: 24rpx;
  line-height: 1.6;
}

.book-benefit-code-input {
  box-sizing: border-box;
  width: 100%;
  height: 88rpx;
  padding: 0 24rpx;
  border: 2rpx solid #cfe3ef;
  border-radius: 22rpx;
  background: #f7fbff;
  color: #0e3a5c;
  font-size: 28rpx;
}

.book-benefit-primary-button {
  width: 100%;
  height: 84rpx;
  margin-top: 20rpx;
  border-radius: 999rpx;
  background: #0e3a5c;
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 900;
  line-height: 84rpx;
}

.book-benefit-primary-button[disabled] {
  opacity: 0.55;
}

.book-benefit-success {
  margin-top: 20rpx;
  padding: 22rpx;
  border-radius: 20rpx;
  background: #eef8f2;
  color: #1f7a45;
  font-size: 24rpx;
  line-height: 1.6;
}

.book-benefit-success-title {
  margin-bottom: 6rpx;
  font-size: 30rpx;
  font-weight: 900;
}

.book-benefit-message {
  margin-top: 16rpx;
}

.entitlement-value {
  color: #0e3a5c;
  font-size: 28rpx;
  font-weight: 900;
}

.entitlement-label {
  margin-top: 6rpx;
  color: #6b8aa4;
  font-size: 22rpx;
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
