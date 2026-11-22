<template>
  <view v-if="state.candidate || state.pending || state.message" class="invitation-notice">
    <text>{{ state.saving ? '正在保存好友邀请，请稍候…' : state.message }}</text>
    <button v-if="state.pending && !state.saving" @tap="retry">重试保存邀请</button>
    <button v-if="state.candidate" @tap="goRegister">去完成手机号注册</button>
  </view>
</template>
<script>
import { invitationState, subscribeInvitation, saveIncomingInvitation } from '../common/invitation-state.js'
export default {
  data() { return { state: invitationState() } },
  mounted() { this.unsubscribe = subscribeInvitation(() => { this.state = invitationState() }) },
  beforeDestroy() { if (this.unsubscribe) this.unsubscribe() },
  methods: {
    async retry() { try { await saveIncomingInvitation() } catch (error) { uni.showToast({ title: '邀请尚未保存，请检查网络后重试', icon: 'none' }) } },
    goRegister() { uni.navigateTo({ url: '/pages/mine/index' }) }
  }
}
</script>
<style scoped>
.invitation-notice { margin: 24rpx 0; padding: 24rpx; border-radius: 20rpx; background: #eaf5ff; color: #235376; font-size: 26rpx; line-height: 1.7; }
.invitation-notice button { margin-top: 16rpx; font-size: 26rpx; background: #fff; color: #0e3a5c; }
</style>
