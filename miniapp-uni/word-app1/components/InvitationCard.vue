<template>
  <view id="invitation-card" class="invitation-card">
    <text class="invitation-title">邀请好友注册，获得30次查词权益</text>
    <text class="invitation-copy">{{ rule }}</text>
    <template v-if="registered">
      <text v-if="summary" class="invitation-progress">邀请进度：{{ summary.successfulInvitations }}/5 · 已到账奖励：{{ summary.totalRewardQuota }}次</text>
      <text v-else class="invitation-copy">{{ loading ? '邀请进度加载中…' : '邀请进度暂未获取' }}</text>
      <text v-if="summary && summary.pendingRewards" class="invitation-copy">{{ summary.pendingRewards }}笔奖励待到账，已占用奖励名额；到账后请刷新权益。</text>
      <text v-if="summary && summary.limitReached" class="invitation-message">奖励名额已满</text>
      <button v-else-if="shareReady" class="invitation-button" open-type="share" :data-invitation-share="true">{{ label }}</button>
      <button v-else class="invitation-button" :disabled="preparing || loading || !summary" @tap="prepare">{{ preparing ? '邀请准备中…' : label }}</button>
      <button class="invitation-refresh" :disabled="loading || preparing" @tap="manualRefresh">刷新邀请进度和权益</button>
    </template>
    <button v-else class="invitation-button" @tap="goLogin">{{ label }}</button>
    <text v-if="!registered" class="invitation-copy">请先完成手机号快捷登录／注册后邀请。</text>
    <text v-if="message" class="invitation-message">{{ message }}</text>
  </view>
</template>
<script>
import { getAuthSession, captureAuthSession, isAuthSessionCurrent, subscribeAuthSession } from '../common/auth-store.js'
import { INVITATION_LABEL, INVITATION_RULE, ORDINARY_SHARE, createInvitationShare, getInvitationSummary, invitationMessage } from '../common/invitation-api-client.js'
export default {
  data() { return { label: INVITATION_LABEL, rule: INVITATION_RULE, registered: false, summary: null, credential: null, shareReady: false, loading: false, preparing: false, message: '', sequence: 0 } },
  mounted() { this.unsubscribe = subscribeAuthSession(() => this.refresh()); this.refresh() },
  beforeDestroy() { this.pause(); if (this.unsubscribe) this.unsubscribe() },
  methods: {
    pause() { this.sequence++; clearTimeout(this.expiryTimer); this.credential = null; this.shareReady = false; this.preparing = false; this.loading = false },
    async refresh() {
      this.pause()
      const sequence = this.sequence
      const session = getAuthSession()
      this.registered = Boolean(session && session.user.hasPhoneBinding)
      this.summary = null
      this.message = ''
      if (!this.registered) return
      const owner = captureAuthSession()
      this.loading = true
      try {
        const summary = await getInvitationSummary()
        if (sequence === this.sequence && isAuthSessionCurrent(owner)) this.summary = summary
      } catch (error) {
        if (sequence === this.sequence && isAuthSessionCurrent(owner)) this.message = invitationMessage(error)
      } finally { if (sequence === this.sequence) this.loading = false }
    },
    manualRefresh() { this.refresh(); this.$emit('refresh-entitlement') },
    async prepare() {
      if (this.preparing || !this.summary || this.summary.limitReached) return
      this.preparing = true
      this.message = ''
      const sequence = this.sequence, owner = captureAuthSession()
      try {
        const credential = await createInvitationShare()
        if (sequence !== this.sequence || !isAuthSessionCurrent(owner)) return
        this.credential = credential
        this.shareOwner = owner
        this.shareReady = true
        this.message = '邀请已准备，请点击“邀请好友，得30次”发送'
        this.expiryTimer = setTimeout(() => { this.shareReady = false; this.credential = null; this.message = '邀请凭证已失效，请重新准备' }, Math.min(2147483647, Math.max(1, Date.parse(credential.expiresAt) - Date.now())))
      } catch (error) {
        if (sequence === this.sequence && isAuthSessionCurrent(owner)) {
          this.message = invitationMessage(error)
          if (error.code === 'INVITER_REWARD_LIMIT_REACHED') {
            await this.refresh()
            if (isAuthSessionCurrent(owner)) this.message = '奖励名额已满'
          }
        }
      } finally { if (sequence === this.sequence) this.preparing = false }
    },
    shareMessage() {
      if (!this.shareReady || !this.credential || !isAuthSessionCurrent(this.shareOwner) || Date.parse(this.credential.expiresAt) <= Date.now()) {
        this.shareReady = false
        this.message = '邀请已失效，请重新准备后再邀请'
        uni.showToast({ title: this.message, icon: 'none' })
        return { ...ORDINARY_SHARE }
      }
      return { title: '好友邀请你体验象形英语，首次注册享30次查词权益', path: '/pages/index/index?invitationToken=' + encodeURIComponent(this.credential.token) }
    },
    goLogin() {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      if (pages.length && pages[pages.length - 1].route === 'pages/mine/index') { uni.pageScrollTo({ scrollTop: 0, duration: 200 }); uni.showToast({ title: '请在上方完成手机号快捷登录', icon: 'none' }); return }
      uni.navigateTo({ url: '/pages/mine/index' })
    }
  }
}
</script>
<style scoped>
.invitation-card { margin: 24rpx 0; padding: 32rpx; border-radius: 24rpx; background: #fff; border: 1rpx solid #dcebf5; color: #163b55; }
.invitation-title,.invitation-copy,.invitation-progress,.invitation-message { display: block; }
.invitation-title { font-size: 32rpx; font-weight: 700; }
.invitation-copy { margin-top: 16rpx; font-size: 26rpx; line-height: 1.8; color: #607b8d; }
.invitation-progress { margin-top: 20rpx; font-size: 27rpx; font-weight: 600; }
.invitation-message { margin-top: 16rpx; font-size: 26rpx; line-height: 1.7; color: #705b36; }
.invitation-button,.invitation-refresh { margin-top: 24rpx; border-radius: 16rpx; font-size: 28rpx; }
.invitation-button { background: #0e3a5c; color: #fff; }
.invitation-refresh { background: #eef6fc; color: #235376; }
button[disabled] { opacity: .55; }
</style>
