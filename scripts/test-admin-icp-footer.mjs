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
assert.doesNotMatch(pageSource, /VITE_ICP_RECORD_NUMBER|VITE_ICP_RECORD_LINK/)

console.log('Admin ICP footer test passed')
