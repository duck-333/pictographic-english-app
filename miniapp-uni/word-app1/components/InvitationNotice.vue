<template>
  <view class="invitation-notice">
    <view v-if="active && state.guideVisible" class="invitation-overlay" @touchmove.stop.prevent="noop" @tap.stop="noop">
      <view class="invitation-dialog" role="dialog" aria-modal="true" aria-label="好友邀你体验象形英语" @tap.stop="noop">
        <button class="notice-close" aria-label="关闭邀请提示" @tap.stop="dismiss">×</button>
        <view class="invitation-mark">象</view>
        <text class="invitation-eyebrow">一份来自好友的邀请</text>
        <text class="invitation-title">好友邀你体验象形英语</text>
        <text class="invitation-description">用象形逻辑，读懂每个英语单词</text>
        <view class="invitation-benefit">
          <text class="benefit-number">30<text class="benefit-unit">次</text></text>
          <view class="benefit-copy"><text class="benefit-title">首次注册赠送</text><text class="benefit-caption">查词权益</text></view>
        </view>
        <text class="invitation-detail">首次完成手机号注册，可获30次查词权益。</text>
        <button class="invitation-primary" hover-class="button-pressed" @tap.stop="goRegister">去完成注册</button>
        <button class="invitation-secondary" @tap.stop="dismiss">先逛逛</button>
      </view>
    </view>
    <view v-if="active && (result || state.feedbackVisible)" class="invitation-feedback" @tap.stop="noop">
      <button class="notice-close feedback-close" aria-label="关闭提示" @tap.stop="closeFeedback">×</button>
      <text class="feedback-title">{{ result ? result.title : (state.pending ? '邀请暂未保存' : '邀请提醒') }}</text>
      <text class="feedback-description">{{ result ? result.description : state.message }}</text>
      <button v-if="!result && state.pending" class="feedback-retry" :disabled="state.saving" @tap.stop="retry">{{ state.saving ? '正在重试…' : '重试保存邀请' }}</button>
    </view>
  </view>
</template>
<script>
import { invitationState, subscribeInvitation, saveIncomingInvitation, dismissInvitationNotice } from '../common/invitation-state.js'
export default {
  props: { active: { type: Boolean, default: false }, result: { type: Object, default: null } },
  data() { return { state: invitationState() } },
  watch: { active() { this.syncState() } },
  mounted() { this.unsubscribe = subscribeInvitation(this.syncState); this.syncState() },
  beforeDestroy() { if (this.unsubscribe) this.unsubscribe(); clearTimeout(this.expiryTimer) },
  methods: {
    noop() {},
    syncState() {
      clearTimeout(this.expiryTimer)
      this.state = invitationState()
      if (this.active && this.state.expiresAt) {
        const remaining = Date.parse(this.state.expiresAt) - Date.now()
        if (remaining > 0) this.expiryTimer = setTimeout(() => this.syncState(), Math.min(remaining + 20, 2147483647))
      }
    },
    dismiss() { dismissInvitationNotice() },
    closeFeedback() { if (this.result) this.$emit('dismiss-result'); else this.dismiss() },
    async retry() { try { await saveIncomingInvitation() } catch (error) { uni.showToast({ title: '邀请尚未保存，请检查网络后重试', icon: 'none' }) } },
    goRegister() { this.dismiss(); this.$emit('register') }
  }
}
</script>
<style scoped>
.invitation-notice { height: 0; }
.invitation-overlay { position: fixed; z-index: 200; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; padding-top: calc(24px + env(safe-area-inset-top)); padding-bottom: calc(24px + env(safe-area-inset-bottom)); background: rgba(9, 35, 55, .48); }
.invitation-dialog { position: relative; width: 100%; max-width: 340px; max-height: 100%; overflow-y: auto; padding: 28px 22px 12px; border-radius: 26px; background: linear-gradient(160deg, #eef9ff, #fff 65%); color: #103d58; text-align: center; box-shadow: 0 18px 50px rgba(9, 35, 55, .18); }
.notice-close { position: absolute; top: 4px; right: 4px; width: 44px; height: 44px; padding: 0; margin: 0; border-radius: 50%; background: transparent; color: #648399; font-size: 28px; line-height: 44px; font-weight: 400; }
.invitation-mark { width: 54px; height: 54px; margin: 0 auto 16px; border-radius: 18px; background: #103d58; color: #ffe89a; font-size: 30px; line-height: 54px; font-weight: 700; }
.invitation-eyebrow, .invitation-title, .invitation-description, .invitation-detail, .benefit-title, .benefit-caption { display: block; }
.invitation-eyebrow { color: #648399; font-size: 12px; letter-spacing: 2px; margin-bottom: 8px; }
.invitation-title { font-size: 21px; line-height: 1.45; font-weight: 700; }
.invitation-description { margin-top: 8px; font-size: 13px; line-height: 1.6; color: #648399; }
.invitation-benefit { display: flex; justify-content: center; align-items: center; gap: 18px; margin: 22px 0 14px; padding: 16px 12px; border-radius: 18px; background: #fff3cf; }
.benefit-number { font-size: 46px; line-height: 1.1; font-weight: 700; color: #103d58; }
.benefit-unit { font-size: 15px; margin-left: 4px; }
.benefit-copy { text-align: left; }
.benefit-title { font-size: 15px; font-weight: 700; }
.benefit-caption { margin-top: 4px; font-size: 13px; color: #78663e; }
.invitation-detail { font-size: 13px; line-height: 1.7; margin: 0 0 20px; color: #526e7e; }
.invitation-primary { padding: 0 8px; border-radius: 15px; background: #103d58; color: #fff; font-size: 16px; line-height: 48px; font-weight: 600; }
.invitation-secondary { margin-top: 4px; background: transparent; color: #648399; font-size: 14px; line-height: 44px; }
.invitation-feedback { position: fixed; z-index: 180; left: 20px; right: 20px; bottom: calc(86px + env(safe-area-inset-bottom)); max-width: 420px; margin: 0 auto; padding: 18px 44px 18px 20px; border: 1px solid #d9eaf4; border-radius: 18px; color: #103d58; background: #fff; box-shadow: 0 8px 28px rgba(16, 61, 88, .14); }
.feedback-title, .feedback-description { display: block; }
.feedback-title { font-size: 16px; font-weight: 700; line-height: 1.5; }
.feedback-description { margin-top: 5px; font-size: 13px; line-height: 1.7; color: #526e7e; }
.feedback-retry { margin: 10px 0 0; padding: 0 14px; background: #eaf5ff; color: #103d58; border-radius: 10px; font-size: 14px; line-height: 44px; }
@media (max-height: 600px) {
  .invitation-dialog { padding-top: 22px; }
  .invitation-mark, .invitation-eyebrow, .invitation-description { display: none; }
  .invitation-title { font-size: 20px; }
  .invitation-benefit { margin-top: 14px; padding: 12px; }
  .invitation-detail { margin-bottom: 12px; }
}
</style>
