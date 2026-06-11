import assert from 'node:assert/strict'
import fs from 'node:fs'

const configPath = new URL('../admin-portal/pictographic-admin/common/site-config.js', import.meta.url)
const pagePath = new URL('../admin-portal/pictographic-admin/pages/index/index.vue', import.meta.url)

let siteConfig

try {
  siteConfig = await import(configPath.href)
} catch (error) {
  console.error(`Admin ICP footer test failed: ${error.message}`)
  process.exit(1)
}

assert.equal(siteConfig.ICP_RECORD_NUMBER, '浙ICP备2026040189号')
assert.equal(siteConfig.ICP_RECORD_LINK, 'https://beian.miit.gov.cn/')

const pageSource = fs.readFileSync(pagePath, 'utf8')

assert.match(pageSource, /import\s+\{\s*ICP_RECORD_NUMBER,\s*ICP_RECORD_LINK\s*\}\s+from\s+['"]\.\.\/\.\.\/common\/site-config\.js['"]/)
assert.match(pageSource, /class="icp-footer"/)
assert.match(pageSource, /:href="icpFooter\.recordLink"/)
assert.match(pageSource, /\{\{\s*icpFooter\.recordNumber\s*\}\}/)
assert.match(pageSource, /v-if="!adminUnlocked"/)
assert.match(pageSource, /class="admin-public-review"/)
assert.match(pageSource, /象形英语内容工作台/)
assert.match(pageSource, /本网站用于维护“象形英语”英语单词查询、词义讲解、视频讲解等学习内容。/)
assert.match(pageSource, /后台管理功能仅限管理员使用，需通过 Admin API Token 登录。/)
assert.match(pageSource, /普通用户使用的小程序前台用于英语单词查询和学习内容浏览。/)
assert.match(pageSource, /ICP备案号：\{\{\s*icpFooter\.recordNumber\s*\}\}/)
assert.doesNotMatch(pageSource, /VITE_ICP_RECORD_NUMBER|VITE_ICP_RECORD_LINK/)
assert.doesNotMatch(pageSource, /dev-admin-token/)
assert.doesNotMatch(pageSource, /公开进入后台/)

console.log('Admin ICP footer test passed')
