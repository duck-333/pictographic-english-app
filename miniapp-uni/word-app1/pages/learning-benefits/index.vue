<template>
  <view class="page">
    <view class="card">
      <text class="eyebrow">获取学习权益</text>
      <text class="title">购买学习会员</text>
      <view class="plans">
        <button v-for="product in products" :key="product.internalSku" class="plan" :class="{ selected: selectedSku === product.internalSku }"
          :disabled="busy" @tap="selectProduct(product.internalSku)">{{ product.durationSeconds === monthlyDuration ? '月卡' : '年卡' }} · {{ days(product) }}天 · {{ price(product) }}</button>
      </view>
      <text class="price">{{ productPriceText }}</text>
      <text class="description">一次性购买，非自动续费</text>
      <text class="description">会员期间不限学习次数</text>
      <text v-if="entitlement && entitlement.membershipActive" class="note">购买后从原到期时间顺延{{ days(selectedProduct) }}天</text>
      <text v-if="entitlement && entitlement.membershipExpireAt" class="description">当前有效期至：{{ expiryText }}</text>
      <text v-if="!loggedIn" class="note">请先登录学习账号</text>
      <button v-if="!loggedIn" class="primary" @tap="goLogin">去登录</button>
      <template v-else>
        <button v-if="pendingRecord" class="primary" :disabled="busy || !queryAllowed" :loading="busy" @tap="query(pendingRecord)">查询上次购买结果</button>
        <button v-else class="primary" :disabled="busy || !purchaseAllowed" :loading="busy" @tap="buy()">购买{{ days(selectedProduct) }}天会员</button>
        <button v-if="pendingRecord" class="secondary" :disabled="busy || !purchaseAllowed" @tap="buy()">仍要另购{{ days(selectedProduct) }}天会员</button>
      </template>
      <text v-if="availabilityMessage" class="message">{{ availabilityMessage }}</text>
      <text v-if="message" class="message" aria-live="polite">{{ message }}</text>
      <text v-if="discoveryFailed" class="message">暂未完整获取历史购买记录，可稍后重试。</text>
      <button v-if="discoveryFailed" class="secondary" :disabled="busy || !queryAllowed" @tap="discover()">重新查找购买记录</button>
      <button v-if="nextCursor" class="secondary" :disabled="busy || !queryAllowed" @tap="discover(nextCursor)">加载更多</button>
      <button class="secondary" open-type="share">分享给好友</button>
      <button class="secondary" @tap="backToLearning">返回学习</button>
    </view>
    <view v-if="records.length" class="card">
      <text class="section-title">本机购买记录</text>
      <text class="description">未确认的购买记录会保留，可稍后回来查询。</text>
      <view v-for="record in records" :key="record.clientRequestId" class="record">
        <text class="description">{{ recordTitle(record) }} · {{ dateText(record.createdAt) }}</text>
        <text class="note">{{ statusText(record) }}</text>
        <button v-if="!isFinished(record)" class="secondary" :disabled="busy || !queryAllowed" @tap="query(record)">查询购买结果</button>
        <button v-if="!record.mayHaveInvoked" class="secondary" :disabled="busy || !purchaseAllowed" @tap="buy(record.clientRequestId)">继续未完成的购买</button>
        <button class="secondary" @tap="viewDiagnostic(record)">查看诊断</button>
        <button class="secondary" @tap="copyDiagnostic(record)">复制诊断信息</button>
        <view v-if="diagnosticView && diagnosticView.clientRequestId === record.clientRequestId">
          <text class="diagnostic-text" :user-select="true">{{ diagnosticView.text }}</text>
          <button class="secondary" @tap="diagnosticView = null">收起诊断</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { MEMBERSHIP_PLANS, MONTHLY_MEMBERSHIP_PRODUCT, membershipProductForPrice, membershipDays, membershipPriceText } from '../../common/membership-products.js'
import { getAuthSession, subscribeAuthSession } from '../../common/auth-store.js'
import { createPurchaseController, recordMessage } from '../../common/virtual-payment-purchase.js'
import { paymentMessage } from '../../common/virtual-payment-api-client.js'

export default {
  data() {
    return { loggedIn: false, purchaseAllowed: false, queryAllowed: false, busy: false, records: [], entitlement: null, products: MEMBERSHIP_PLANS, selectedSku: MONTHLY_MEMBERSHIP_PRODUCT.internalSku, monthlyDuration: MONTHLY_MEMBERSHIP_PRODUCT.durationSeconds,
      availabilityMessage: '', message: '', nextCursor: null, discoveryFailed: false, loadSequence: 0, pageEpoch: 0, pageVisible: true, pageDisposed: false,
      diagnosticView: null }
  },
  computed: {
    selectedProduct() { return this.products.find((p) => p.internalSku === this.selectedSku) || this.products[0] },
    productPriceText() { return membershipPriceText(this.selectedProduct) },
    pendingRecord() { return this.records.find((r) => !['granted', 'delivered', 'manual_review', 'closed', 'failed'].includes(r.hint)) || null },
    expiryText() { return String((this.entitlement && this.entitlement.membershipExpireAt) || '').slice(0, 10) }
  },
  onShareAppMessage() {
    return {
      title: '象形英语｜以形释义解码单词',
      path: '/pages/index/index'
    }
  },
  onLoad() {
    if (this.unsubscribeDiagnosticSession) return
    this.unsubscribeDiagnosticSession = subscribeAuthSession(() => { this.diagnosticView = null })
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
    if (typeof this.purchase.api.products === 'function') {
      this.products = this.purchase.api.products()
      if (!this.products.some((p) => p.internalSku === this.selectedSku)) this.selectedSku = this.products[0].internalSku
    }
    this.purchase.resume()
    this.refresh()
  },
  onHide() { this.diagnosticView = null; this.pageVisible = false; this.pageEpoch++; this.loadSequence++; if (this.purchase) this.purchase.pause() },
  onUnload() {
    this.unsubscribeDiagnosticSession?.()
    this.unsubscribeDiagnosticSession = null
    this.diagnosticView = null
    this.pageDisposed = true
    this.pageVisible = false
    this.pageEpoch++
    this.loadSequence++
    if (this.purchase) this.purchase.dispose()
  },
  methods: {
    days: membershipDays,
    price: membershipPriceText,
    selectProduct(sku) { if (!this.busy) this.selectedSku = sku },
    recordTitle(record) { const product = membershipProductForPrice(record.priceFen); return product && record.sku === product.internalSku ? `${membershipDays(product)}天会员 · ${membershipPriceText(product)}` : '会员购买' },
    statusText: recordMessage,
    dateText(value) { const date = new Date(value); return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` },
    isFinished(record) { return ['delivered', 'closed', 'failed'].includes(record.hint) },
    reloadRecords() {
      if (this.pageDisposed || !this.pageVisible) return
      try { this.records = this.purchase.list() } catch (error) { this.records = []; this.message = paymentMessage(error) }
    },
    diagnosticNotice(title) {
      try { uni.showToast({ title, icon: 'none' }) } catch (_) {}
    },
    viewDiagnostic(record) {
      if (this.pageDisposed || !this.pageVisible || !record) return
      this.diagnosticView = null
      const result = this.purchase.diagnosticReport(record.clientRequestId)
      if (result.status !== 'ok') {
        this.diagnosticNotice({
          not_found: '未找到该订单诊断',
          read_failed: '诊断缓存读取失败',
          serialize_failed: '诊断文本生成失败',
          context_unavailable: '当前账号或环境不可用'
        }[result.status])
        return
      }
      this.diagnosticView = { clientRequestId: record.clientRequestId, text: result.text }
      return result.text
    },
    copyDiagnostic(record) {
      const data = this.viewDiagnostic(record)
      if (!data) return
      const view = this.diagnosticView
      const failed = () => {
        if (this.diagnosticView === view) this.diagnosticNotice('剪贴板写入失败，可查看诊断')
      }
      try { uni.setClipboardData({ data, fail: failed }) } catch (_) { failed() }
    },
    async refresh() {
      if (this.pageDisposed || !this.pageVisible) return
      let load = ++this.loadSequence
      this.loggedIn = Boolean(getAuthSession())
      this.entitlement = null
      this.records = []
      this.diagnosticView = null
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
    buy(id) { return this.run(() => this.purchase.buy(id, this.selectedSku)) },
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
.plans { display: flex; gap: 16rpx; margin-top: 24rpx; }
.plan { flex: 1; padding: 16rpx 8rpx; margin: 0; font-size: 26rpx; border: 2rpx solid #dcebf5; background: #f4f9ff; color: #235376; }
.plan.selected { border-color: #0e3a5c; background: #e4f1fa; font-weight: 700; }
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
.diagnostic-text { display: block; margin-top: 16rpx; padding: 16rpx; background: #f4f9ff; font-size: 24rpx; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
</style>
