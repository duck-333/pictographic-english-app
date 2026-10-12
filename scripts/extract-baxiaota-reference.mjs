import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import vm from 'node:vm'
import { resolve } from 'node:path'

// Input is the compact HTML extracted from the approved ZIP, never the old standalone HTML.
const html = readFileSync(process.argv[2], 'utf8')
const root = resolve('miniapp-uni/word-app1/game-baxiaota')
const names = ['gate.jpg', null, 'wave.png', 'compass.png', 'celebrate.png', 'reading.png',
  'guide-search.webp', 'guide-results.webp', 'guide-detail.webp', 'guide-video.webp']
const matches = [...html.matchAll(/data:image\/([^;]+);base64,([A-Za-z0-9+/=]+)/g)]
if (matches.length !== names.length) throw new Error('Unexpected reference resource count')
mkdirSync(root + '/static', { recursive: true })
mkdirSync(root + '/common', { recursive: true })
matches.forEach((m, i) => { if (names[i]) writeFileSync(root + '/static/' + names[i], Buffer.from(m[2], 'base64')) })
const lessonLiteral = html.match(/const lessons=({[\s\S]*?});\s*let lessonKey/)[1]
const textStatements = html.match(/const texts=([\s\S]*?)\n function copy/)[1]
const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } })
const lessons = vm.runInContext('(' + lessonLiteral + ')', context, { timeout: 1000 })
const texts = vm.runInContext('const texts=' + textStatements + '; texts', context, { timeout: 1000 })
for (const lesson of Object.values(lessons)) {
  lesson.body = [...lesson.body.matchAll(/<(h3|p)>([\s\S]*?)<\/\1>/g)].map(m => ({ type: m[1], text: m[2] }))
}
writeFileSync(root + '/common/game-content.js', '// Teaching associations from ZIP; content review remains required.\n' +
  'export const texts = ' + JSON.stringify(texts, null, 2) + '\nexport const lessons = ' + JSON.stringify(lessons, null, 2) + '\n')
console.log('Extracted nine raster assets and teaching content; far-scene SVG is drawn as Canvas paths.')
