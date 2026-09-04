<template>
  <view class="page">
    <view class="card">
      <text class="eyebrow">获取学习权益</text>
      <text class="title">购买30天会员</text>
      <text class="price">¥30.00</text>
      <text class="description">一次性购买，非自动续费</text>
      <text class="description">会员期间不限学习次数</text>
      <text v-if="entitlement && entitlement.membershipActive" class="note">购买后顺延30天</text>
      <text v-if="entitlement && entitlement.membershipExpireAt" class="description">当前有效期至：{{ expiryText }}</text>
      <text v-if="!loggedIn" class="note">请先登录学习账号</text>
      <button v-if="!loggedIn" class="primary" @tap="goLogin">去登录</button>
      <template v-else>
        <button v-if="pendingRecord" class="primary" :disabled="busy || !queryAllowed" :loading="busy" @tap="query(pendingRecord)">查询上次购买结果</button>
        <button v-else class="primary" :disabled="busy || !purchaseAllowed" :loading="busy" @tap="buy()">购买30天会员</button>
        <button v-if="pendingRecord" class="secondary" :disabled="busy || !purchaseAllowed" @tap="buy()">仍要另购30天会员</button>
      </template>
      <text v-if="availabilityMessage" class="message">{{ availabilityMessage }}</text>
      <text v-if="message" class="message" aria-live="polite">{{ message }}</text>
      <text v-if="discoveryFailed" class="message">暂未完整获取历史购买记录，可稍后重试。</text>
      <button v-if="discoveryFailed" class="secondary" :disabled="busy || !queryAllowed" @tap="discover()">重新查找购买记录</button>
      <button v-if="nextCursor" class="secondary" :disabled="busy || !queryAllowed" @tap="discover(nextCursor)">加载更多</button>
      <button class="secondary" @tap="backToLearning">返回学习</button>
    </view>
    <view v-if="records.length" class="card">
      <text class="section-title">本机购买记录</text>
      <text class="description">未确认的购买记录会保留，可稍后回来查询。</text>
      <view v-for="record in records" :key="record.clientRequestId" class="record">
        <text class="description">30天会员 · {{ dateText(record.createdAt) }}</text>
        <text class="note">{{ statusText(record) }}</text>
        <button v-if="!isFinished(record)" class="secondary" :disabled="busy || !queryAllowed" @tap="query(record)">查询购买结果</button>
        <button v-if="!record.mayHaveInvoked" class="secondary" :disabled="busy || !purchaseAllowed" @tap="buy(record.clientRequestId)">继续未完成的购买</button>
      </view>
    </view>
  </view>
</template>

<script>
import { getAuthSession } from '../../common/auth-store.js'
import { createPurchaseController, recordMessage } from '../../common/virtual-payment-purchase.js'
import { paymentMessage } from '../../common/virtual-payment-api-client.js'

export default {
  data() {
    return { loggedIn: false, purchaseAllowed: false, queryAllowed: false, busy: false, records: [], entitlement: null,
      availabilityMessage: '', message: '', nextCursor: null, discoveryFailed: false, loadSequence: 0, pageEpoch: 0, pageVisible: true, pageDisposed: false }
  },
  computed: {
    pendingRecord() { return this.records.find((r) => !['granted', 'delivered', 'manual_review', 'closed', 'failed'].includes(r.hint)) || null },
    expiryText() { return String(this.entitlement.membershipExpireAt || '').slice(0, 10) }
  },
  onShow() {
    if (this.pageDisposed) return
    if (!this.pageVisible) this.busy = false
    this.pageVisible = true
    if (!this.purchase) {
      this.purchase = createPurchaseController({
        confirm: (content) => new Promise((resolve) => uni.showModal({ title: '确认购买', content, confirmText: '确认购买', success: (result) => resolve(result.confirm === true), fail: () => resolve(false) })),
        onChange: () => this.reloadRecords(),
        onEntitlement: (value) => { this.loadSequence++; this.entitlement = value },
        onRefreshFailed: () => { this.message = '会员已到账，权益展示暂未刷新，请稍后重试' }
      })
    }
    this.purchase.resume()
    this.refresh()
  },
  onHide() { this.pageVisible = false; this.pageEpoch++; this.loadSequence++; if (this.purchase) this.purchase.pause() },
  onUnload() { this.pageDisposed = true; this.pageVisible = false; this.pageEpoch++; this.loadSequence++; if (this.purchase) this.purchase.dispose() },
  methods: {
    statusText: recordMessage,
    dateText(value) { const date = new Date(value); return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` },
    isFinished(record) { return ['delivered', 'closed', 'failed'].includes(record.hint) },
    reloadRecords() {
      if (this.pageDisposed || !this.pageVisible) return
      try { this.records = this.purchase.list() } catch (error) { this.records = []; this.message = paymentMessage(error) }
    },
    async refresh() {
      if (this.pageDisposed || !this.pageVisible) return
      let load = ++this.loadSequence
      this.loggedIn = Boolean(getAuthSession())
      this.entitlement = null
      this.records = []
      this.purchaseAllowed = false
      this.queryAllowed = false
      this.availabilityMessage = ''
      this.message = ''
      try {
        const owner = this.purchase.api.context()
        this.queryAllowed = true
        this.reloadRecords()
        try { this.purchase.api.context(true); this.purchaseAllowed = true } catch (error) { this.availabilityMessage = paymentMessage(error) }
        this.nextCursor = null
        await this.discover()
        if (this.pageDisposed || !this.pageVisible || load + 1 !== this.loadSequence) return
        load = this.loadSequence
        const entitlement = await this.purchase.api.refresh(owner)
        if (load === this.loadSequence) this.entitlement = entitlement
      } catch (error) { if (load === this.loadSequence) this.availabilityMessage = paymentMessage(error) }
    },
    async run(operation) {
      if (this.busy || this.pageDisposed || !this.pageVisible) return
      const epoch = this.pageEpoch
      const active = () => !this.pageDisposed && this.pageVisible && epoch === this.pageEpoch
      this.loadSequence++
      this.busy = true
      this.message = ''
      try { await operation() } catch (error) { if (active()) this.message = paymentMessage(error) }
      finally { if (active()) { this.busy = false; this.reloadRecords() } }
    },
    discover(cursor = null) {
      const epoch = this.pageEpoch
      return this.run(async () => {
        this.discoveryFailed = true
        const result = await this.purchase.discover(cursor)
        if (!result || result.ok !== true || !Array.isArray(result.orders) || this.pageDisposed || !this.pageVisible || epoch !== this.pageEpoch) return
        this.nextCursor = result.nextCursor
        this.discoveryFailed = false
      })
    },
    buy(id) { return this.run(() => this.purchase.buy(id)) },
    query(record) { return this.run(() => this.purchase.query(record.clientRequestId)) },
    goLogin() {
      try { this.purchase.api.environment(); uni.navigateTo({ url: '/pages/mine/index' }) }
      catch (error) { this.message = paymentMessage(error) }
    },
    backToLearning() { uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/index/index' }) }) }
  }
}
</script>

<style>
.page { min-height: 100vh; padding: 28rpx; box-sizing: border-box; background: #f4f9ff; color: #163b55; }
.card { padding: 32rpx; margin-bottom: 24rpx; background: #fff; border: 1rpx solid #dcebf5; border-radius: 24rpx; }
.eyebrow,.title,.price,.description,.note,.message,.section-title { display: block; }
.eyebrow { color: #53768d; font-size: 25rpx; margin-bottom: 14rpx; }
.title { font-size: 40rpx; font-weight: 700; }
.price { font-size: 56rpx; font-weight: 700; margin: 24rpx 0; }
.description { color: #607b8d; font-size: 27rpx; line-height: 1.8; }
.note { margin-top: 14rpx; font-size: 28rpx; line-height: 1.7; }
.message { color: #705b36; margin-top: 20rpx; font-size: 26rpx; line-height: 1.7; }
.primary,.secondary { margin-top: 24rpx; border-radius: 16rpx; font-size: 29rpx; }
.primary { background: #0e3a5c; color: #fff; }
.secondary { background: #eef6fc; color: #235376; }
button[disabled] { opacity: .55; }
.section-title { font-size: 32rpx; font-weight: 700; margin-bottom: 16rpx; }
.record { border-top: 1rpx solid #e2edf5; padding-top: 22rpx; margin-top: 22rpx; }
</style>
