// Shared by the miniapp and server. Historical SKUs keep their original facts.
const base = { mode: 'short_series_goods', quantity: 1, currency: 'CNY', membershipSourceType: 'wechat_order' }
export const LEGACY_MEMBERSHIP_PRODUCT = Object.freeze({
  ...base, internalSku: 'membership_30d', displayName: '30天学习会员',
  priceFen: 3000, durationSeconds: 30 * 86400
})
export const MONTHLY_MEMBERSHIP_PRODUCT = Object.freeze({
  ...base, internalSku: 'membership_30d_v2', displayName: '30天学习会员',
  priceFen: 1200, durationSeconds: 30 * 86400, sellable: true
})
export const YEARLY_MEMBERSHIP_PRODUCT = Object.freeze({
  ...base, internalSku: 'membership_365d', displayName: '365天学习会员',
  priceFen: 9800, durationSeconds: 365 * 86400, sellable: true
})
export const SANDBOX_MEMBERSHIP_PRODUCT = Object.freeze({ ...LEGACY_MEMBERSHIP_PRODUCT, priceFen: 100, sandboxTest: true })
export const MEMBERSHIP_PRODUCTS = [LEGACY_MEMBERSHIP_PRODUCT, MONTHLY_MEMBERSHIP_PRODUCT, YEARLY_MEMBERSHIP_PRODUCT, SANDBOX_MEMBERSHIP_PRODUCT]
export const MEMBERSHIP_PLANS = [MONTHLY_MEMBERSHIP_PRODUCT, YEARLY_MEMBERSHIP_PRODUCT]
export function membershipProductForPrice(priceFen) {
  return MEMBERSHIP_PRODUCTS.find((product) => product.priceFen === priceFen) || null
}
export function membershipProductForSku(sku) {
  return MEMBERSHIP_PRODUCTS.find((product) => product.internalSku === sku && !product.sandboxTest) || null
}
export function membershipDays(product) { return product.durationSeconds / 86400 }
export function membershipPriceText(product) { return `¥${(product.priceFen / 100).toFixed(2)}` }
