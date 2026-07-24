<template>
	<view class="admin-page">
		<view class="hero">
			<view>
				<view class="eyebrow">Entitlement Transactions</view>
				<text class="title">权益流水详情</text>
				<text class="subtitle">查看用户完整权益流水，分页加载，不修改任何权益数据。</text>
			</view>
			<view class="hero-actions">
				<button class="outline-button" @click="goBack">返回权益管理</button>
				<button class="publish-button" :disabled="loading" @click="reloadPage">
					{{ loading ? '刷新中...' : '刷新数据' }}
				</button>
			</view>
		</view>

		<view v-if="message" class="status-message">{{ message }}</view>

		<view v-if="!userId" class="panel empty-panel">
			<text>缺少 user_id，请从用户权益管理页面选择用户后进入流水详情。</text>
		</view>

		<template v-else>
			<view class="detail-grid">
				<view class="panel user-panel">
					<view class="panel-head">
						<view>
							<text class="panel-title">用户基本信息</text>
							<text class="panel-note">仅展示后台管理所需的非敏感字段。</text>
						</view>
					</view>
					<view class="info-grid">
						<view class="info-item">
							<text class="info-label">user_id</text>
							<text class="info-value">{{ user.id || userId }}</text>
						</view>
						<view class="info-item">
							<text class="info-label">手机号</text>
							<text class="info-value">{{ user.phoneMasked || '未提供' }}</text>
						</view>
						<view class="info-item">
							<text class="info-label">用户状态</text>
							<text class="info-value">{{ user.status || '未知' }}</text>
						</view>
						<view class="info-item">
							<text class="info-label">注册时间</text>
							<text class="info-value">{{ formatAdminDate(user.createdAt) }}</text>
						</view>
					</view>
				</view>

				<view class="panel balance-panel">
					<view class="panel-head">
						<view>
							<text class="panel-title">当前权益余额</text>
							<text class="panel-note">读取 user_entitlements 快照，流水为事实记录。</text>
						</view>
					</view>
					<view class="summary-grid">
						<view class="summary-card accent">
							<text class="summary-value">{{ entitlement.quotaBalance }}</text>
							<text class="summary-label">剩余查词次数</text>
						</view>
						<view class="summary-card">
							<text class="summary-value">{{ entitlement.quotaTotalGranted }}</text>
							<text class="summary-label">累计获得</text>
						</view>
						<view class="summary-card">
							<text class="summary-value">{{ entitlement.quotaTotalConsumed }}</text>
							<text class="summary-label">已使用</text>
						</view>
						<view class="summary-card">
							<text class="summary-value">{{ entitlement.membershipStatus }}</text>
							<text class="summary-label">会员状态</text>
						</view>
					</view>
				</view>
			</view>

			<view class="panel filter-panel">
				<view class="panel-head">
					<view>
						<text class="panel-title">筛选区域</text>
						<text class="panel-note">当前预留按交易类型筛选，后续可扩展时间范围和来源筛选。</text>
					</view>
				</view>
				<view class="filter-row">
					<input
						v-model="filterDraft"
						class="filter-input"
						placeholder="交易类型，例如 CONTENT_ACCESS / ADMIN_GRANT"
						@confirm="applyTransactionFilter"
					/>
					<button class="secondary-button" :disabled="loadingTransactions" @click="applyTransactionFilter">筛选</button>
					<button class="outline-button" :disabled="loadingTransactions || !transactionType" @click="clearTransactionFilter">清空</button>
				</view>
				<text v-if="transactionType" class="active-filter">当前筛选：{{ transactionType }}</text>
			</view>

			<view class="panel transactions-panel">
				<view class="panel-head">
					<view>
						<text class="panel-title">完整流水列表</text>
						<text class="panel-note">使用现有后台流水接口分页读取。</text>
					</view>
					<view class="pagination-inline">
						<button class="secondary-button" :disabled="loadingTransactions || page <= 1" @click="previousPage">上一页</button>
						<text>第 {{ page }} 页 · 每页 {{ pageSize }} 条</text>
						<button class="secondary-button" :disabled="loadingTransactions || !hasNextPage" @click="nextPage">下一页</button>
					</view>
				</view>

				<view class="transaction-table">
					<view class="transaction-row header">
						<text>时间</text>
						<text>类型</text>
						<text>变动</text>
						<text>余额</text>
						<text>来源</text>
						<text>原因</text>
						<text>操作人</text>
					</view>
					<view
						v-for="transaction in transactions"
						:key="transaction.id"
						class="transaction-row"
					>
						<text>{{ formatAdminDate(transaction.createdAt) }}</text>
						<text>{{ transaction.transactionType }}</text>
						<text :class="['transaction-amount', getTransactionAmountClass(transaction)]">
							{{ formatTransactionAmount(transaction) }}
						</text>
						<text>{{ transaction.balanceAfter }}</text>
						<text>{{ transaction.source || '未记录' }}</text>
						<text>{{ transaction.reason || '未记录' }}</text>
						<text>{{ transaction.operatorType || 'system' }} {{ transaction.operatorId || '' }}</text>
					</view>
					<view v-if="!transactions.length && !loadingTransactions" class="empty-panel">
						暂无符合条件的权益流水。
					</view>
					<view v-if="loadingTransactions" class="empty-panel">
						正在加载权益流水...
					</view>
				</view>
			</view>
		</template>
	</view>
</template>

<script>
import {
	getAdminApiToken,
	getAdminUserEntitlement,
	listAdminUserEntitlementTransactions
} from '../../common/api-client.js'

export default {
	data() {
		return {
			userId: '',
			adminApiToken: '',
			user: {},
			entitlement: {
				quotaBalance: 0,
				quotaTotalGranted: 0,
				quotaTotalConsumed: 0,
				quotaTotalExpired: 0,
				membershipType: 'none',
				membershipStatus: 'none',
				membershipExpireAt: ''
			},
			transactions: [],
			page: 1,
			pageSize: 20,
			transactionType: '',
			filterDraft: '',
			loading: false,
			loadingTransactions: false,
			message: ''
		}
	},
	computed: {
		hasNextPage() {
			return this.transactions.length >= this.pageSize
		}
	},
	onLoad(options = {}) {
		this.userId = this.extractUserId(options)
		this.adminApiToken = getAdminApiToken()
		this.reloadPage()
	},
	methods: {
		extractUserId(options = {}) {
			const queryUserId = options.userId || options.user_id || ''
			if (queryUserId) return String(queryUserId).trim()
			if (typeof window === 'undefined' || !window.location) return ''
			const routeText = `${window.location.pathname || ''}${window.location.hash || ''}`
			const match = routeText.match(/\/admin\/entitlements\/users\/([^/?#]+)\/transactions/)
				|| routeText.match(/\/entitlements\/users\/([^/?#]+)\/transactions/)
			return match ? decodeURIComponent(match[1]) : ''
		},
		getAdminRequestOptions() {
			return {
				adminApiToken: this.adminApiToken
			}
		},
		normalizeUser(user) {
			const source = user && typeof user === 'object' && !Array.isArray(user) ? user : {}
			const id = source.id || source.userId || source.user_id || this.userId
			const phoneMasked = source.phoneMasked || source.phone_masked || source.maskedPhone || source.masked_phone || ''
			return {
				id: id ? String(id) : '',
				phoneMasked: phoneMasked ? String(phoneMasked) : '未提供',
				status: source.status || source.userStatus || source.user_status || '未知',
				createdAt: source.createdAt || source.created_at || ''
			}
		},
		normalizeEntitlementSnapshot(entitlement) {
			const source = entitlement && typeof entitlement === 'object' && !Array.isArray(entitlement) ? entitlement : {}
			const quotaBalance = source.quotaBalance !== undefined ? source.quotaBalance : source.quota_balance
			const quotaTotalGranted = source.quotaTotalGranted !== undefined ? source.quotaTotalGranted : source.quota_total_granted
			const quotaTotalConsumed = source.quotaTotalConsumed !== undefined ? source.quotaTotalConsumed : source.quota_total_consumed
			const quotaTotalExpired = source.quotaTotalExpired !== undefined ? source.quotaTotalExpired : source.quota_total_expired
			return {
				quotaBalance: Number(quotaBalance || 0),
				quotaTotalGranted: Number(quotaTotalGranted || 0),
				quotaTotalConsumed: Number(quotaTotalConsumed || 0),
				quotaTotalExpired: Number(quotaTotalExpired || 0),
				membershipType: source.membershipType || source.membership_type || 'none',
				membershipStatus: source.membershipStatus || source.membership_status || 'none',
				membershipExpireAt: source.membershipExpireAt || source.membership_expire_at || ''
			}
		},
		normalizeTransaction(transaction) {
			const source = transaction && typeof transaction === 'object' && !Array.isArray(transaction) ? transaction : {}
			const balanceAfter = source.balanceAfter !== undefined ? source.balanceAfter : source.balance_after
			return {
				id: source.id || source.transactionId || source.transaction_id || source.idempotencyKey || source.idempotency_key || '',
				transactionType: source.transactionType || source.transaction_type || 'UNKNOWN',
				amount: Number(source.amount || 0),
				balanceAfter: balanceAfter !== undefined ? balanceAfter : '',
				source: source.source || '',
				reason: source.reason || '',
				operatorType: source.operatorType || source.operator_type || '',
				operatorId: source.operatorId || source.operator_id || '',
				createdAt: source.createdAt || source.created_at || ''
			}
		},
		extractEntitlementSnapshot(data) {
			if (data && data.entitlement) return data.entitlement
			if (data && data.userEntitlement) return data.userEntitlement
			return data || {}
		},
		async reloadPage() {
			if (!this.userId) return
			if (!this.adminApiToken) {
				this.message = '缺少 Admin API Token，请先回到后台首页登录。'
				return
			}
			this.loading = true
			this.message = '正在加载用户权益数据...'
			try {
				await this.loadUserEntitlement()
				await this.loadTransactions()
				this.message = `已加载 user_id=${this.userId} 的权益流水。`
			} catch (error) {
				this.handleAdminError(error, '权益流水加载失败。')
			} finally {
				this.loading = false
			}
		},
		async loadUserEntitlement() {
			const result = await getAdminUserEntitlement(this.userId, this.getAdminRequestOptions())
			this.user = this.normalizeUser(result && result.user)
			this.entitlement = this.normalizeEntitlementSnapshot(this.extractEntitlementSnapshot(result))
		},
		async loadTransactions() {
			this.loadingTransactions = true
			try {
				const result = await listAdminUserEntitlementTransactions(this.userId, {
					...this.getAdminRequestOptions(),
					limit: this.pageSize,
					offset: (this.page - 1) * this.pageSize,
					transactionType: this.transactionType
				})
				this.transactions = Array.isArray(result.transactions)
					? result.transactions.map((item) => this.normalizeTransaction(item))
					: []
			} finally {
				this.loadingTransactions = false
			}
		},
		applyTransactionFilter() {
			this.transactionType = String(this.filterDraft || '').trim().toUpperCase()
			this.page = 1
			this.loadTransactions().catch((error) => {
				this.handleAdminError(error, '权益流水筛选失败。')
			})
		},
		clearTransactionFilter() {
			this.filterDraft = ''
			this.transactionType = ''
			this.page = 1
			this.loadTransactions().catch((error) => {
				this.handleAdminError(error, '权益流水加载失败。')
			})
		},
		previousPage() {
			if (this.page <= 1 || this.loadingTransactions) return
			this.page -= 1
			this.loadTransactions().catch((error) => {
				this.handleAdminError(error, '权益流水加载失败。')
			})
		},
		nextPage() {
			if (!this.hasNextPage || this.loadingTransactions) return
			this.page += 1
			this.loadTransactions().catch((error) => {
				this.handleAdminError(error, '权益流水加载失败。')
			})
		},
		handleAdminError(error, fallbackMessage) {
			if (error && (error.code === 'UNAUTHORIZED' || error.isAuthError)) {
				this.message = '管理员鉴权失败，请返回后台首页重新输入 Admin API Token。'
				uni.showModal({
					title: '管理员鉴权失败',
					content: this.message,
					showCancel: false
				})
				return
			}
			this.message = error && error.message ? error.message : fallbackMessage
			uni.showModal({
				title: '权益流水加载失败',
				content: this.message,
				showCancel: false
			})
		},
		formatAdminDate(value) {
			if (!value) return '未设置'
			const date = new Date(value)
			if (Number.isNaN(date.getTime())) return String(value)
			const year = date.getFullYear()
			const month = String(date.getMonth() + 1).padStart(2, '0')
			const day = String(date.getDate()).padStart(2, '0')
			const hour = String(date.getHours()).padStart(2, '0')
			const minute = String(date.getMinutes()).padStart(2, '0')
			return `${year}-${month}-${day} ${hour}:${minute}`
		},
		formatTransactionAmount(transaction) {
			const amount = Number(transaction && transaction.amount || 0)
			if (amount > 0) return `+${amount}`
			return String(amount)
		},
		getTransactionAmountClass(transaction) {
			const amount = Number(transaction && transaction.amount || 0)
			if (amount > 0) return 'positive'
			if (amount < 0) return 'negative'
			return 'neutral'
		},
		goBack() {
			uni.navigateBack({
				fail: () => {
					uni.reLaunch({ url: '/pages/index/index' })
				}
			})
		}
	}
}
</script>

<style lang="scss" scoped>
.admin-page {
	min-height: 100vh;
	padding: 28px;
	background: #eef7fb;
	color: #12344d;
	box-sizing: border-box;
}

.hero,
.hero-actions,
.panel-head,
.filter-row,
.pagination-inline {
	display: flex;
	align-items: center;
}

.hero {
	justify-content: space-between;
	gap: 20px;
	margin-bottom: 18px;
	padding: 26px;
	border-radius: 28px;
	background: linear-gradient(135deg, #0e3a5c, #1d6799);
	color: #fff;
	box-shadow: 0 18px 46px rgba(14, 58, 92, 0.18);
}

.eyebrow,
.title,
.subtitle,
.panel-title,
.panel-note,
.info-label,
.info-value,
.summary-value,
.summary-label,
.status-message,
.active-filter {
	display: block;
}

.eyebrow {
	color: rgba(255, 255, 255, 0.72);
	font-size: 12px;
	font-weight: 900;
	text-transform: uppercase;
	letter-spacing: 0;
}

.title {
	margin-top: 8px;
	font-size: 30px;
	font-weight: 900;
	line-height: 1.35;
}

.subtitle {
	margin-top: 8px;
	color: rgba(255, 255, 255, 0.84);
	font-size: 14px;
	line-height: 1.7;
}

.hero-actions {
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: 10px;
}

button {
	border: 0;
}

.outline-button,
.secondary-button,
.publish-button {
	margin: 0;
	padding: 0 18px;
	line-height: 36px;
	font-weight: 800;
}

.outline-button {
	background: #eaf7ff;
	color: #0e3a5c;
}

.secondary-button {
	background: #edf7fc;
	color: #0e3a5c;
}

.publish-button {
	background: #fe8500;
	color: #fff;
}

.status-message {
	margin-bottom: 14px;
	color: #66869b;
	font-size: 13px;
}

.panel {
	border: 1px solid rgba(14, 58, 92, 0.08);
	border-radius: 26px;
	background: #fff;
	box-shadow: 0 16px 40px rgba(14, 58, 92, 0.09);
	padding: 20px;
	box-sizing: border-box;
}

.panel + .panel,
.detail-grid + .panel {
	margin-top: 16px;
}

.panel-head {
	justify-content: space-between;
	gap: 16px;
	margin-bottom: 16px;
}

.panel-title {
	color: #12344d;
	font-size: 18px;
	font-weight: 900;
}

.panel-note {
	margin-top: 6px;
	color: #66869b;
	font-size: 13px;
	line-height: 1.6;
}

.detail-grid {
	display: grid;
	grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
	gap: 16px;
	align-items: stretch;
}

.info-grid,
.summary-grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 12px;
}

.info-item,
.summary-card {
	padding: 16px;
	border: 1px solid #e0eef6;
	border-radius: 18px;
	background: #f9fcfe;
}

.summary-card {
	background: #fff;
}

.summary-card.accent {
	border-color: rgba(254, 133, 0, 0.26);
	background: #fff8e8;
}

.info-label,
.summary-label {
	color: #7892a3;
	font-size: 12px;
}

.info-value {
	margin-top: 6px;
	color: #12344d;
	font-size: 14px;
	font-weight: 800;
	word-break: break-all;
}

.summary-value {
	color: #0e3a5c;
	font-size: 24px;
	font-weight: 900;
	word-break: break-all;
}

.summary-label {
	margin-top: 6px;
}

.filter-row {
	gap: 12px;
}

.filter-input {
	box-sizing: border-box;
	flex: 1;
	min-width: 0;
	height: 42px;
	padding: 0 14px;
	border: 1px solid #cfe3ef;
	border-radius: 14px;
	background: #fff;
	color: #12344d;
	font-size: 14px;
}

.active-filter {
	margin-top: 12px;
	color: #66869b;
	font-size: 13px;
}

.pagination-inline {
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: 10px;
	color: #66869b;
	font-size: 13px;
}

.transaction-table {
	margin-top: 16px;
	overflow-x: auto;
}

.transaction-row {
	display: grid;
	grid-template-columns: 1.15fr 1.25fr 0.7fr 0.7fr 1fr 1.4fr 1fr;
	gap: 12px;
	align-items: center;
	min-width: 1060px;
	padding: 12px 14px;
	border-bottom: 1px solid #e6f0f6;
	color: #315c82;
	font-size: 13px;
}

.transaction-row.header {
	border-radius: 14px;
	background: #f4f9fc;
	color: #7892a3;
	font-size: 12px;
	font-weight: 900;
}

.transaction-amount {
	font-weight: 900;
}

.transaction-amount.positive {
	color: #1f7a45;
}

.transaction-amount.negative {
	color: #b03934;
}

.transaction-amount.neutral {
	color: #7892a3;
}

.empty-panel {
	padding: 18px;
	border: 1px dashed #cfe3ef;
	border-radius: 16px;
	background: #f9fcfe;
	color: #7892a3;
	font-size: 13px;
	line-height: 1.6;
}

@media (max-width: 900px) {
	.admin-page {
		padding: 16px;
	}

	.hero,
	.panel-head,
	.filter-row,
	.pagination-inline {
		flex-direction: column;
		align-items: flex-start;
	}

	.detail-grid,
	.info-grid,
	.summary-grid {
		grid-template-columns: 1fr;
	}

	.hero-actions {
		justify-content: flex-start;
	}
}
</style>
