const PREFIX_STYLE = {
  color: '#7C3AED',
  bgColor: '#F3F0FF',
  borderColor: '#C4B5FD'
}

const ROOT_STYLE = {
  color: '#C9973A',
  bgColor: '#FFFBEB',
  borderColor: '#FCD34D'
}

const SUFFIX_STYLE = {
  color: '#0E7490',
  bgColor: '#ECFEFF',
  borderColor: '#A5F3FC'
}

const LETTER_STYLE = {
  color: '#2563EB',
  bgColor: '#EFF6FF',
  borderColor: '#BFDBFE'
}

export const WORDS = [
  {
    id: 'word-study',
    cardType: '单词',
    word: 'study',
    phonetic: '/ˈstʌdi/',
    meaning: 'v. 学习；研究；n. 研究；书房',
    level: 'CET-4',
    mastered: true,
    bookPage: 18,
    parts: [
      { text: 's', meaning: '即 ex · 外出', targetId: 'node-s', ...PREFIX_STYLE },
      { text: 'tud', meaning: '敲击 · 钻研', targetId: 'node-tud', ...ROOT_STYLE },
      { text: 'y', meaning: '后缀', targetId: 'node-y', ...SUFFIX_STYLE }
    ],
    tip: '用力敲击（tud）知识，向外出发（s）--这就是“学习”。',
    pictograph:
      's 表示向外发力，tud 表示敲击、钻研，y 是构词后缀。study 的完整意象是：主动向外探索，用持续敲击的方式钻研知识，所以它表达“学习、研究”的动作。',
    videoTitle: 'study 象形拆解讲解',
    videoDuration: '02:36',
    videoClips: [
      {
        clipId: 'study-overview-001',
        title: 'study 整体讲解',
        segmentTitle: 'study 整体讲解',
        focus: '先看 s + tud + y 如何组成 study 的学习动作',
        targetPart: 'study',
        note: '本地 mock 片段：同一个测试视频的 0-8 秒，用来验证详情页播放器和时间定位。',
        url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        startSec: 0,
        endSec: 8,
        provider: 'local-mock',
        assetId: 'mock-flower-video',
        storagePath: 'mock/videos/flower.mp4'
      },
      {
        clipId: 'study-tud-002',
        title: 'tud 词根讲解',
        segmentTitle: 'tud 词根讲解',
        focus: '重点观察 tud 表示敲击、钻研、反复触碰知识',
        targetPart: 'tud',
        note: '本地 mock 片段：同一个测试视频的 8-16 秒，验证同一视频截多个片段。',
        url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        startSec: 8,
        endSec: 16,
        provider: 'local-mock',
        assetId: 'mock-flower-video',
        storagePath: 'mock/videos/flower.mp4'
      },
      {
        clipId: 'study-letter-s-003',
        title: 's 节点补充',
        segmentTitle: 's 节点补充',
        focus: '补充 s 的向外、滑出、延展感',
        targetPart: 's',
        note: '本地 mock 片段：不同测试视频的 3-10 秒，验证不同视频片段也能组合到同一词条。',
        url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
        videoUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
        startSec: 3,
        endSec: 10,
        provider: 'local-mock',
        assetId: 'mock-sintel-video',
        storagePath: 'mock/videos/sintel-trailer.mp4'
      }
    ],
    examples: [
      { english: 'She studies hard every day to improve her English.', chinese: '她每天努力学习，以提高英语水平。' },
      { english: 'This study shows that exercise improves memory.', chinese: '这项研究表明，运动能改善记忆力。' }
    ],
    siblingIds: ['word-student']
  },
  {
    id: 'node-s',
    cardType: '字母卡',
    word: 's',
    phonetic: '/s/',
    meaning: '字母 s：可理解为向外、滑出、延展的动作感',
    level: '字母',
    mastered: false,
    bookPage: 18,
    parts: [],
    tip: '在 study 里，s 借用 ex 的“向外”感，像把注意力向外推出去。',
    pictograph:
      's 的形状像弯曲滑动的轨迹，也常被用来表达向外、延展、滑出的动作感。放在 study 里，它帮助表达“主动向外探索知识”的第一步。',
    videoTitle: 's 字母象形讲解',
    videoDuration: '01:20',
    examples: [],
    siblingIds: ['node-tud', 'node-y', 'word-study']
  },
  {
    id: 'node-tud',
    cardType: '词根卡',
    word: 'tud',
    phonetic: '/tʌd/',
    meaning: '词根 tud：敲击、钻研、反复触碰知识',
    level: '词根',
    mastered: false,
    bookPage: 18,
    parts: [
      { text: 't', meaning: '手 · 敲击点', targetId: 'node-t', ...LETTER_STYLE },
      { text: 'u', meaning: '容器 · 承接', targetId: 'node-u', ...ROOT_STYLE },
      { text: 'd', meaning: '得到 · 落点', targetId: 'node-d', ...SUFFIX_STYLE }
    ],
    tip: 'tud 像一次次敲击知识表面，直到把它钻透。',
    pictograph:
      'tud 可以拆成 t、u、d 三个动作节点：t 像敲击的动作，u 像承接知识的容器，d 像最终落下并得到结果。合在一起，就是反复钻研、敲开知识。',
    videoTitle: 'tud 词根拆解讲解',
    videoDuration: '01:48',
    examples: [],
    siblingIds: ['node-t', 'node-u', 'node-d', 'word-study']
  },
  {
    id: 'node-y',
    cardType: '后缀卡',
    word: 'y',
    phonetic: '/i/',
    meaning: '后缀 y：让词形成一个完整词形',
    level: '后缀',
    mastered: false,
    bookPage: 18,
    parts: [],
    tip: 'y 在 study 里主要承担收尾和构词作用。',
    pictograph:
      'y 像一个分叉后收束的尾巴，在 study 里不承担主要语义，而是让前面的 s + tud 形成完整单词。',
    videoTitle: 'y 后缀象形讲解',
    videoDuration: '01:05',
    examples: [],
    siblingIds: ['node-s', 'node-tud', 'word-study']
  },
  {
    id: 'node-t',
    cardType: '字母卡',
    word: 't',
    phonetic: '/t/',
    meaning: '字母 t：像手柄或敲击点，表示触碰、敲打',
    level: '字母',
    mastered: false,
    bookPage: 18,
    parts: [],
    tip: 't 是 tud 里的敲击动作起点。',
    pictograph:
      't 的横竖结构像一个可握住的工具，也像一个明确的敲击点。放在 tud 中，它代表“开始敲击、开始触碰知识”。',
    videoTitle: 't 字母象形讲解',
    videoDuration: '01:10',
    examples: [],
    siblingIds: ['node-u', 'node-d', 'node-tud']
  },
  {
    id: 'node-u',
    cardType: '字母卡',
    word: 'u',
    phonetic: '/ʌ/',
    meaning: '字母 u：像容器，表示包含、承接',
    level: '字母',
    mastered: false,
    bookPage: 18,
    parts: [],
    tip: 'u 像一个小容器，承接被敲开的知识。',
    pictograph:
      'u 的形状像杯子或容器，用来表达“包含、承接”。在 tud 中，它连接敲击动作和最终得到的结果。',
    videoTitle: 'u 字母象形讲解',
    videoDuration: '01:12',
    examples: [],
    siblingIds: ['node-t', 'node-d', 'node-tud']
  },
  {
    id: 'node-d',
    cardType: '字母卡',
    word: 'd',
    phonetic: '/d/',
    meaning: '字母 d：像落点或得到的结果',
    level: '字母',
    mastered: false,
    bookPage: 18,
    parts: [],
    tip: 'd 是 tud 里“敲击之后得到结果”的收束点。',
    pictograph:
      'd 像一个带竖线的封闭空间，可以理解为动作落下后的结果。放在 tud 中，它表示钻研之后形成的所得。',
    videoTitle: 'd 字母象形讲解',
    videoDuration: '01:08',
    examples: [],
    siblingIds: ['node-t', 'node-u', 'node-tud']
  },
  {
    id: 'word-student',
    cardType: '单词',
    word: 'student',
    phonetic: '/ˈstuːdənt/',
    meaning: 'n. 学生；研究者',
    level: 'CET-4',
    mastered: true,
    bookPage: 19,
    parts: [
      { text: 'stud', meaning: '敲击 · 钻研', ...ROOT_STYLE },
      { text: 'ent', meaning: '……的人', ...SUFFIX_STYLE }
    ],
    tip: 'student 是持续钻研知识的人。',
    pictograph:
      'stud 表示敲击、钻研，ent 表示“……的人”。student 的意象是持续敲击知识、钻研知识的人，也就是学生。',
    videoTitle: 'student 词根联想讲解',
    videoDuration: '02:12',
    examples: [
      { english: 'He is an excellent student of history.', chinese: '他是一位出色的历史研究者。' }
    ],
    siblingIds: ['word-study']
  },
  {
    id: 'word-transport',
    cardType: '单词',
    word: 'transport',
    phonetic: '/ˈtrænspɔːrt/',
    meaning: 'v./n. 运输；运送；交通',
    level: 'CET-4',
    mastered: false,
    bookPage: 43,
    parts: [
      { text: 'trans', meaning: '穿越 · 跨越', ...PREFIX_STYLE },
      { text: 'port', meaning: '携带 · 搬运', ...ROOT_STYLE }
    ],
    tip: 'transport 的本质是携带某物跨越空间。',
    pictograph:
      'trans 表示跨越，port 表示携带、搬运。transport 的完整意象是携带物品穿越空间，所以表示运输、运送。',
    videoTitle: 'transport 构词逻辑讲解',
    videoDuration: '02:58',
    examples: [
      { english: 'Public transport is efficient in this city.', chinese: '这座城市的公共交通很高效。' }
    ],
    siblingIds: ['word-import', 'word-support']
  },
  {
    id: 'word-structure',
    cardType: '单词',
    word: 'structure',
    phonetic: '/ˈstrʌktʃər/',
    meaning: 'n. 结构；构造',
    level: 'CET-4',
    mastered: false,
    bookPage: 51,
    parts: [
      { text: 'struct', meaning: '建造 · 堆叠', ...ROOT_STYLE },
      { text: 'ure', meaning: '结果 · 状态', ...SUFFIX_STYLE }
    ],
    tip: 'structure 是被搭建出来之后形成的样子。',
    pictograph:
      'struct 表示建造、搭建，ure 表示结果或状态。structure 的意象是建造之后形成的整体样子，所以表示结构。',
    videoTitle: 'structure 象形拆解讲解',
    videoDuration: '02:25',
    examples: [
      { english: 'The sentence structure in English differs from Chinese.', chinese: '英语句子结构与中文不同。' }
    ],
    siblingIds: []
  },
  {
    id: 'word-describe',
    cardType: '单词',
    word: 'describe',
    phonetic: '/dɪˈskraɪb/',
    meaning: 'v. 描述；描写；形容',
    level: 'CET-4',
    mastered: true,
    bookPage: 67,
    parts: [
      { text: 'de', meaning: '向下 · 完全', ...PREFIX_STYLE },
      { text: 'scribe', meaning: '刻写 · 书写', ...ROOT_STYLE }
    ],
    tip: 'describe 是把看到的细节完整刻写下来。',
    pictograph:
      'de 表示向下、完全，scribe 表示刻写、书写。describe 的意象是把细节完整写下，所以表示描述。',
    videoTitle: 'describe 词根讲解',
    videoDuration: '02:18',
    examples: [
      { english: 'Can you describe what you saw?', chinese: '你能描述一下你看到的吗？' }
    ],
    siblingIds: []
  },
  {
    id: 'word-support',
    cardType: '单词',
    word: 'support',
    phonetic: '/səˈpɔːrt/',
    meaning: 'v./n. 支持；支撑',
    level: 'CET-4',
    mastered: false,
    bookPage: 74,
    parts: [
      { text: 'sup', meaning: '在下方', ...PREFIX_STYLE },
      { text: 'port', meaning: '承载 · 支撑', ...ROOT_STYLE }
    ],
    tip: 'support 是在下方承托，帮助对方站住。',
    pictograph:
      'sup 表示在下方，port 表示承载。support 的意象是从下面托住，所以表示支持、支撑。',
    videoTitle: 'support 构词讲解',
    videoDuration: '02:05',
    examples: [
      { english: 'Thank you for your support throughout the project.', chinese: '感谢你在整个项目中的支持。' }
    ],
    siblingIds: ['word-transport']
  },
  {
    id: 'word-import',
    cardType: '单词',
    word: 'import',
    phonetic: '/ˈɪmpɔːrt/',
    meaning: 'v./n. 进口；输入',
    level: 'CET-4',
    mastered: false,
    bookPage: 79,
    parts: [
      { text: 'im', meaning: '向内 · 进入', ...PREFIX_STYLE },
      { text: 'port', meaning: '携带', ...ROOT_STYLE }
    ],
    tip: 'import 是把东西向内带进来。',
    pictograph:
      'im 表示向内，port 表示携带。import 的意象是向内携带，所以表示进口、输入。',
    videoTitle: 'import 构词讲解',
    videoDuration: '02:01',
    examples: [],
    siblingIds: ['word-transport']
  }
]

export const HOT_WORDS = ['study', 'transport', 'structure', 'describe', 'support', 'import']

export const TODAY_WORD_ID = 'word-study'

export const NAV_ITEMS = [
  { path: '/pages/index/index', label: '查词', icon: 'search' },
  { path: '/pages/mine/index', label: '我的', icon: 'mine' }
]

export function normalizeWordQuery(query) {
  return (query || '').trim().toLowerCase()
}

export function searchWords(query) {
  const keyword = normalizeWordQuery(query)
  if (!keyword) {
    return []
  }
  return WORDS.filter((item) => item.word.toLowerCase().includes(keyword))
}

export function getWordById(id) {
  return WORDS.find((item) => item.id === id) || null
}

export function getWordByWord(word) {
  const keyword = normalizeWordQuery(word)
  return WORDS.find((item) => item.word.toLowerCase() === keyword) || null
}

export function getRelatedWords(word) {
  if (!word || !word.siblingIds) {
    return []
  }
  return word.siblingIds
    .map((id) => getWordById(id))
    .filter((item) => item)
}
