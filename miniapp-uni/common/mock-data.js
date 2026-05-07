export const WORDS = [
  {
    id: 'study',
    word: 'study',
    phonetic: '/ˈstʌdi/',
    meaning: 'v. 学习；研究',
    bookPage: 18,
    parts: [
      { text: 's', meaning: '向外发力' },
      { text: 'tud', meaning: '敲击、钻研' },
      { text: 'y', meaning: '后缀' }
    ],
    pictograph:
      '可以把 study 理解成：不断向外发力地敲击知识，直到把内容钻透，所以它有“学习、研究”的意思。',
    videoTitle: 'study 词源拆解讲解',
    videoDuration: '02:36'
  },
  {
    id: 'student',
    word: 'student',
    phonetic: '/ˈstuːd(ə)nt/',
    meaning: 'n. 学生',
    bookPage: 19,
    parts: [
      { text: 'stud', meaning: '钻研、学习' },
      { text: 'ent', meaning: '人、身份' }
    ],
    pictograph:
      'student 可以理解成“正在钻研的人”，所以它自然就指向“学生”这个身份。',
    videoTitle: 'student 词根联想讲解',
    videoDuration: '02:12'
  },
  {
    id: 'transport',
    word: 'transport',
    phonetic: '/ˈtrænspɔːt/',
    meaning: 'v. 运输；运送',
    bookPage: 43,
    parts: [
      { text: 'trans', meaning: '穿过、跨越' },
      { text: 'port', meaning: '搬运、携带' }
    ],
    pictograph:
      'transport 就是“把东西搬着跨过去”，所以是运输、运送。',
    videoTitle: 'transport 构词逻辑讲解',
    videoDuration: '02:58'
  },
  {
    id: 'structure',
    word: 'structure',
    phonetic: '/ˈstrʌktʃə(r)/',
    meaning: 'n. 结构；构造',
    bookPage: 51,
    parts: [
      { text: 'struct', meaning: '建造、搭起来' },
      { text: 'ure', meaning: '结果、状态' }
    ],
    pictograph:
      'structure 可以理解成“被搭建出来之后形成的样子”，所以就是结构、构造。',
    videoTitle: 'structure 象形拆解讲解',
    videoDuration: '02:25'
  }
]

export const HOT_WORDS = ['study', 'student', 'transport', 'structure']

export function searchWords(query) {
  const keyword = (query || '').trim().toLowerCase()
  if (!keyword) {
    return WORDS
  }
  return WORDS.filter((item) => {
    return item.word.toLowerCase().includes(keyword)
  })
}

export function getWordById(id) {
  return WORDS.find((item) => item.id === id) || null
}
