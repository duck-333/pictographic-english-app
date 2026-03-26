export type CardType = 'word' | 'root' | 'letter' | 'prefix' | 'suffix';

export interface WordPart {
  symbol: string;
  meaning: string;
  cardId: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

export interface WordCard {
  id: string;
  symbol: string;
  type: CardType;
  phonetic?: string;
  chineseMeaning: string;
  englishMeaning?: string;
  pictographDescription: string;
  hieroglyph?: string;
  parts?: WordPart[];
  parentCardIds?: string[];
  siblingCardIds?: string[];
  examples?: { english: string; chinese: string }[];
  levels?: string[];
  hasVideo: boolean;
  frequency?: number;
  category?: string;
}

const PREFIX_STYLE = {
  color: '#7C3AED',
  bgColor: '#F3F0FF',
  borderColor: '#C4B5FD',
};
const ROOT_STYLE = {
  color: '#C9973A',
  bgColor: '#FFFBEB',
  borderColor: '#FCD34D',
};
const SUFFIX_STYLE = {
  color: '#0E7490',
  bgColor: '#ECFEFF',
  borderColor: '#A5F3FC',
};
const LETTER_STYLE = {
  color: '#1D4ED8',
  bgColor: '#EFF6FF',
  borderColor: '#BFDBFE',
};

export const WORD_CARDS: Record<string, WordCard> = {
  // ─── 字母 Letters ───────────────────────────────────────────────
  'letter-t': {
    id: 'letter-t',
    symbol: 't',
    type: 'letter',
    hieroglyph: '𓂝',
    chineseMeaning: '手 / 举起的臂',
    englishMeaning: 'Hand / Raised Arm',
    pictographDescription:
      '源自古埃及象形文字 𓝂，描绘一只向上举起的手臂。在象形英语体系中，"t" 代表"触摸"、"持有"、"手" 的概念，是构成大量动作词根的核心符号。',
    parentCardIds: ['root-tud'],
    siblingCardIds: ['letter-u', 'letter-d'],
    hasVideo: true,
    frequency: 5,
    examples: [
      { english: 'touch — the hand makes contact', chinese: 'touch 触摸 — 手与物体接触' },
      { english: 'take — hand reaches out to grasp', chinese: 'take 拿取 — 手伸出抓握' },
    ],
  },
  'letter-u': {
    id: 'letter-u',
    symbol: 'u',
    type: 'letter',
    chineseMeaning: '包含 / 容纳',
    englishMeaning: 'Contain / Hold',
    pictographDescription:
      'U 形如同一个容器的截面，开口向上，代表"包含"、"容纳"、"围绕"的概念。凡含有 u 的词根，往往有"集中"或"内聚"的意味。',
    parentCardIds: ['root-tud'],
    siblingCardIds: ['letter-t', 'letter-d'],
    hasVideo: true,
    frequency: 5,
  },
  'letter-d': {
    id: 'letter-d',
    symbol: 'd',
    type: 'letter',
    chineseMeaning: '得 / 目标达成',
    englishMeaning: 'Get / Goal Achieved',
    pictographDescription:
      'D 形如同一只张开的手心向外，表示"接收"、"获得"的动作。在象形体系中，d 代表动作的终点，即"得到结果"的含义。',
    parentCardIds: ['root-tud'],
    siblingCardIds: ['letter-t', 'letter-u'],
    hasVideo: true,
    frequency: 5,
  },
  'letter-p': {
    id: 'letter-p',
    symbol: 'p',
    type: 'letter',
    chineseMeaning: '向前 / 出',
    englishMeaning: 'Forward / Out',
    pictographDescription:
      'P 形如同迈出的脚步，小圆圈是脚，竖线是腿，代表"向前走"、"出去"的动作概念。',
    parentCardIds: ['root-port'],
    hasVideo: false,
    frequency: 4,
  },
  'letter-r': {
    id: 'letter-r',
    symbol: 'r',
    type: 'letter',
    chineseMeaning: '回旋 / 返回',
    englishMeaning: 'Return / Revolve',
    pictographDescription:
      'R 的形状描绘头部转向，或弯曲回旋的路径，代表"回转"、"重复"、"返回"的概念。',
    hasVideo: false,
    frequency: 4,
  },

  // ─── 前缀 Prefixes ───────────────────────────────────────────────
  'prefix-ex': {
    id: 'prefix-ex',
    symbol: 'ex / s',
    type: 'prefix',
    chineseMeaning: '出 / 外',
    pictographDescription:
      '来自拉丁语 ex-，象形表示"向外伸出"的动作。在古英语演变中，s 与 ex 常可通用，同样表达"向外"之意，这正是 study 中 s 的来源。',
    siblingCardIds: ['letter-s'],
    hasVideo: true,
    frequency: 5,
    examples: [
      { english: 'export — carry out (ex + port)', chinese: 'export 出口 — 向外搬运' },
      { english: 'exclude — shut out (ex + clude)', chinese: 'exclude 排除 — 把…关在外面' },
    ],
  },
  'letter-s': {
    id: 'letter-s',
    symbol: 's',
    type: 'prefix',
    chineseMeaning: '流动 / 外出 (通 ex)',
    pictographDescription:
      'S 形如同蛇的弯曲爬行，代表"流动"、"延伸"的概念。作为前缀，s 与拉丁前缀 ex 通用，表达"向外"之意，因此 study 中的 s = 向外发力，深入钻研之意。',
    siblingCardIds: ['prefix-ex'],
    hasVideo: true,
    frequency: 5,
  },
  'prefix-trans': {
    id: 'prefix-trans',
    symbol: 'trans',
    type: 'prefix',
    chineseMeaning: '穿越 / 跨越',
    pictographDescription:
      '来自拉丁语 trans-，描绘一条穿越界线的路径。凡含 trans 的单词，均有"从一端到另一端"的跨越之意。',
    hasVideo: true,
    frequency: 4,
    examples: [
      { english: 'transport — carry across', chinese: 'transport 运输 — 跨越携带' },
      { english: 'transform — shape across', chinese: 'transform 改变 — 跨越形态' },
    ],
  },
  'prefix-con': {
    id: 'prefix-con',
    symbol: 'con / com',
    type: 'prefix',
    chineseMeaning: '共同 / 一起',
    pictographDescription:
      '来自拉丁语 cum（with），表示"共同"、"一起"的关系。在不同情境下拼写为 con、com、col、cor 等变体。',
    hasVideo: false,
    frequency: 5,
    examples: [
      { english: 'construct — build together', chinese: 'construct 建造 — 共同构建' },
    ],
  },
  'prefix-in': {
    id: 'prefix-in',
    symbol: 'in / im',
    type: 'prefix',
    chineseMeaning: '向内 / 进入',
    pictographDescription:
      '来自拉丁语 in-，表示"向内"、"进入"的方向。根据后续字母变化为 im、ir、il 等形式。',
    hasVideo: false,
    frequency: 5,
    examples: [
      { english: 'import — carry in', chinese: 'import 进口 — 向内搬运' },
      { english: 'instruct — build in(to)', chinese: 'instruct 指导 — 向内建构' },
    ],
  },
  'prefix-re': {
    id: 'prefix-re',
    symbol: 're',
    type: 'prefix',
    chineseMeaning: '再 / 回',
    pictographDescription:
      '来自拉丁语 re-，描绘一个返回的路径。凡含 re 的单词，均有"再次"或"回到原点"之意。',
    hasVideo: false,
    frequency: 5,
    examples: [
      { english: 'report — carry back', chinese: 'report 报告 — 带回消���' },
    ],
  },
  'prefix-de': {
    id: 'prefix-de',
    symbol: 'de',
    type: 'prefix',
    chineseMeaning: '向下 / 完全',
    pictographDescription:
      '来自拉丁语 de-，有"向下"或"完全、彻底"两种含义。在动词中常强调动作的完成度。',
    hasVideo: false,
    frequency: 4,
  },

  // ─── 后缀 Suffixes ────────────────────────────────────────────────
  'suffix-y': {
    id: 'suffix-y',
    symbol: '-y',
    type: 'suffix',
    chineseMeaning: '后缀 / 构成动词或名词',
    pictographDescription:
      '英语常见后缀，附在词根后构成动词（study, carry）或形容词（study, noisy）。无独立象形含义，是词形演变的语法标记。',
    hasVideo: false,
    frequency: 5,
  },
  'suffix-ent': {
    id: 'suffix-ent',
    symbol: '-ent',
    type: 'suffix',
    chineseMeaning: '…的人 / …的事物',
    pictographDescription:
      '来自拉丁语现在分词后缀 -entem，表示"正在做…的人或物"。',
    hasVideo: false,
    frequency: 4,
  },
  'suffix-ure': {
    id: 'suffix-ure',
    symbol: '-ure',
    type: 'suffix',
    chineseMeaning: '后缀 / 表示结果或状态',
    pictographDescription:
      '来自拉丁语后缀 -ura，将动词变为名词，表示动作的"结果"、"过程"或"状态"。',
    hasVideo: false,
    frequency: 3,
  },
  'suffix-or': {
    id: 'suffix-or',
    symbol: '-or',
    type: 'suffix',
    chineseMeaning: '…的人 / 施动者',
    pictographDescription:
      '来自拉丁语施动者后缀 -or，表示"做某事的人"。相当于英语中的 -er。',
    hasVideo: false,
    frequency: 4,
  },

  // ─── 词根 Roots ───────────────────────────────────────────────────
  'root-tud': {
    id: 'root-tud',
    symbol: 'tud / stud',
    type: 'root',
    chineseMeaning: '敲击 / 钻研',
    englishMeaning: 'Strike / Hammer',
    pictographDescription:
      '【t】手 + 【u】包含 + 【d】得 → 手（t）持续集中发力（u）直到得到结果（d），象形为反复敲击的动作。引申为"用力钻研"，正是 study（学习）的精髓——像凿子一样深入探究事物。',
    parts: [
      { symbol: 't', meaning: '手·臂', cardId: 'letter-t', ...LETTER_STYLE },
      { symbol: 'u', meaning: '包含·集中', cardId: 'letter-u', ...LETTER_STYLE },
      { symbol: 'd', meaning: '得·达到', cardId: 'letter-d', ...LETTER_STYLE },
    ],
    parentCardIds: ['word-study', 'word-student', 'word-studio', 'word-studious'],
    hasVideo: true,
    frequency: 5,
    examples: [
      { english: 'study — hammer (knowledge) out', chinese: 'study 学习 — 凿出知识' },
      { english: 'student — one who hammers at knowledge', chinese: 'student 学生 — 钻研知识的人' },
    ],
  },
  'root-port': {
    id: 'root-port',
    symbol: 'port',
    type: 'root',
    chineseMeaning: '携带 / 搬运',
    englishMeaning: 'Carry / Bear',
    pictographDescription:
      '来自拉丁语 portāre（to carry），描绘一个人搬运重物的场景。结合不同前缀，衍生出方向各异的"搬运"含义。',
    parts: [
      { symbol: 'p', meaning: '向前·出', cardId: 'letter-p', ...LETTER_STYLE },
      { symbol: 'ort', meaning: '力量·重量', cardId: '', ...LETTER_STYLE },
    ],
    parentCardIds: ['word-transport', 'word-export', 'word-import', 'word-support', 'word-report'],
    hasVideo: true,
    frequency: 5,
  },
  'root-struct': {
    id: 'root-struct',
    symbol: 'struct',
    type: 'root',
    chineseMeaning: '建造 / 堆叠',
    englishMeaning: 'Build / Construct',
    pictographDescription:
      '来自拉丁语 struere（to pile up, build），描绘一层一层堆砌材料建造的场景。',
    parentCardIds: ['word-structure', 'word-construct', 'word-instructor'],
    hasVideo: true,
    frequency: 5,
  },
  'root-scrib': {
    id: 'root-scrib',
    symbol: 'scrib / script',
    type: 'root',
    chineseMeaning: '刻写 / 书写',
    englishMeaning: 'Write / Inscribe',
    pictographDescription:
      '来自拉丁语 scribere（to write），最初指用尖锐工具在石头或木板上刻划，引申为一切书写行为。',
    parentCardIds: ['word-describe', 'word-prescribe'],
    hasVideo: false,
    frequency: 4,
  },

  // ─── 单词 Words ───────────────────────────────────────────────────
  'word-study': {
    id: 'word-study',
    symbol: 'study',
    type: 'word',
    phonetic: '/ˈstʌdi/',
    chineseMeaning: 'v. 学习；研究\nn. 研究；书房',
    pictographDescription:
      '【s】= 即·ex·向外发力 + 【tud】= 敲击·钻研 + 【y】= 动词后缀。\n完整意象：向外（s）施以敲击之力（tud）——就像工匠用凿子凿石，"study" 描述的是那种主动出击、深入钻研的学习行为，而非被动接收。',
    parts: [
      { symbol: 's', meaning: '即·ex·外出', cardId: 'letter-s', ...PREFIX_STYLE },
      { symbol: 'tud', meaning: '敲击·钻研', cardId: 'root-tud', ...ROOT_STYLE },
      { symbol: 'y', meaning: '后缀', cardId: 'suffix-y', ...SUFFIX_STYLE },
    ],
    siblingCardIds: ['word-student', 'word-studio', 'word-studious'],
    levels: ['CET-4'],
    hasVideo: true,
    frequency: 5,
    examples: [
      { english: 'She studies hard every day to improve her English.', chinese: '她每天刻苦学习，以提高英语水平。' },
      { english: 'This study shows that exercise improves memory.', chinese: '这项研究表明，运动能改善记忆力。' },
    ],
  },
  'word-student': {
    id: 'word-student',
    symbol: 'student',
    type: 'word',
    phonetic: '/ˈstuːdənt/',
    chineseMeaning: 'n. 学生；研究者',
    pictographDescription:
      '【stud】= 敲击·钻研 + 【ent】= …的人。完整意象：持续敲击知识的人（ent），即"学生"——象形英语揭示了"学生"的本质：主动出击，反复锤炼。',
    parts: [
      { symbol: 'stud', meaning: '敲击·钻研', cardId: 'root-tud', ...ROOT_STYLE },
      { symbol: 'ent', meaning: '…的人', cardId: 'suffix-ent', ...SUFFIX_STYLE },
    ],
    siblingCardIds: ['word-study', 'word-studio', 'word-studious'],
    levels: ['CET-4'],
    hasVideo: true,
    frequency: 5,
    examples: [
      { english: 'He is an excellent student of history.', chinese: '他是一位出色的历史研究者。' },
    ],
  },
  'word-studio': {
    id: 'word-studio',
    symbol: 'studio',
    type: 'word',
    phonetic: '/ˈstuːdiəʊ/',
    chineseMeaning: 'n. 工作室；画室；录音棚',
    pictographDescription:
      '【studi】= 钻研·专注 + 【o】= 场所。完整意象：专注钻研（studi）的地方（o）——工作室是艺术家反复锤炼作品的空间。',
    parts: [
      { symbol: 'studi', meaning: '钻研·专注', cardId: 'root-tud', ...ROOT_STYLE },
      { symbol: 'o', meaning: '场所', cardId: '', ...SUFFIX_STYLE },
    ],
    siblingCardIds: ['word-study', 'word-student', 'word-studious'],
    levels: ['CET-6'],
    hasVideo: false,
    frequency: 4,
    examples: [
      { english: 'The artist worked in her studio all night.', chinese: '艺术家在她的工作室里工作了整整一夜。' },
    ],
  },
  'word-studious': {
    id: 'word-studious',
    symbol: 'studious',
    type: 'word',
    phonetic: '/ˈstuːdiəs/',
    chineseMeaning: 'adj. 勤学的；好学的',
    pictographDescription:
      '由 study + -ious（充满…的）构成。充满钻研精神的，即"勤学好问的"。',
    parts: [
      { symbol: 'studi', meaning: '钻研', cardId: 'root-tud', ...ROOT_STYLE },
      { symbol: 'ous', meaning: '充满…的', cardId: '', ...SUFFIX_STYLE },
    ],
    siblingCardIds: ['word-study', 'word-student', 'word-studio'],
    levels: ['CET-6'],
    hasVideo: false,
    frequency: 3,
  },
  'word-transport': {
    id: 'word-transport',
    symbol: 'transport',
    type: 'word',
    phonetic: '/ˈtrænspɔːt/',
    chineseMeaning: 'v./n. 运输；运送',
    pictographDescription:
      '【trans】= 穿越·跨越 + 【port】= 携带。完整意象：携带着（port）穿越（trans）——运输的本质就是将物品跨越空间搬运。',
    parts: [
      { symbol: 'trans', meaning: '穿越·跨越', cardId: 'prefix-trans', ...PREFIX_STYLE },
      { symbol: 'port', meaning: '携带·搬运', cardId: 'root-port', ...ROOT_STYLE },
    ],
    levels: ['CET-4'],
    hasVideo: false,
    frequency: 4,
    examples: [
      { english: 'Public transport is efficient in this city.', chinese: '这座城市的公共交通很高效。' },
    ],
  },
  'word-export': {
    id: 'word-export',
    symbol: 'export',
    type: 'word',
    phonetic: '/ˈekspɔːt/',
    chineseMeaning: 'v./n. 出口；输出',
    pictographDescription:
      '【ex】= 出·外 + 【port】= 携带。向外携带——出口。',
    parts: [
      { symbol: 'ex', meaning: '出·外', cardId: 'prefix-ex', ...PREFIX_STYLE },
      { symbol: 'port', meaning: '携带', cardId: 'root-port', ...ROOT_STYLE },
    ],
    levels: ['CET-4'],
    hasVideo: false,
    frequency: 4,
    examples: [
      { english: 'China exports a large amount of goods worldwide.', chinese: '中国向全球出口大量商品。' },
    ],
  },
  'word-import': {
    id: 'word-import',
    symbol: 'import',
    type: 'word',
    phonetic: '/ˈɪmpɔːt/',
    chineseMeaning: 'v./n. 进口；输入',
    pictographDescription:
      '【im】= im(in)·向内 + 【port】= 携带。向内携带——进口。',
    parts: [
      { symbol: 'im', meaning: '向内·进入', cardId: 'prefix-in', ...PREFIX_STYLE },
      { symbol: 'port', meaning: '携带', cardId: 'root-port', ...ROOT_STYLE },
    ],
    levels: ['CET-4'],
    hasVideo: false,
    frequency: 4,
  },
  'word-support': {
    id: 'word-support',
    symbol: 'support',
    type: 'word',
    phonetic: '/səˈpɔːt/',
    chineseMeaning: 'v./n. 支持；支撑',
    pictographDescription:
      '【sup】= sub·在下方 + 【port】= 携带·撑起。在下方承托——支撑。',
    parts: [
      { symbol: 'sup', meaning: '在下方', cardId: 'prefix-in', ...PREFIX_STYLE },
      { symbol: 'port', meaning: '撑起·承载', cardId: 'root-port', ...ROOT_STYLE },
    ],
    levels: ['CET-4'],
    hasVideo: false,
    frequency: 5,
    examples: [
      { english: 'Thank you for your support throughout the project.', chinese: '感谢你在整个项目中的支持。' },
    ],
  },
  'word-report': {
    id: 'word-report',
    symbol: 'report',
    type: 'word',
    phonetic: '/rɪˈpɔːt/',
    chineseMeaning: 'v./n. 报告；汇报；报道',
    pictographDescription:
      '【re】= 再·回 + 【port】= 携带。带回来——汇报消息。',
    parts: [
      { symbol: 're', meaning: '再·回', cardId: 'prefix-re', ...PREFIX_STYLE },
      { symbol: 'port', meaning: '携带', cardId: 'root-port', ...ROOT_STYLE },
    ],
    levels: ['CET-4'],
    hasVideo: false,
    frequency: 5,
    examples: [
      { english: 'The journalist filed her report from the front line.', chinese: '记者从前线发回了她的报道。' },
    ],
  },
  'word-structure': {
    id: 'word-structure',
    symbol: 'structure',
    type: 'word',
    phonetic: '/ˈstrʌktʃə/',
    chineseMeaning: 'n. 结构；构造\nv. 组织；安排',
    pictographDescription:
      '【struct】= 建造·堆叠 + 【ure】= 结果·状态。建造的结果——结构。',
    parts: [
      { symbol: 'struct', meaning: '建造·堆叠', cardId: 'root-struct', ...ROOT_STYLE },
      { symbol: 'ure', meaning: '结果·状态', cardId: 'suffix-ure', ...SUFFIX_STYLE },
    ],
    levels: ['CET-4'],
    hasVideo: false,
    frequency: 4,
    examples: [
      { english: 'The sentence structure in English differs from Chinese.', chinese: '英语句子结构与中文不同。' },
    ],
  },
  'word-construct': {
    id: 'word-construct',
    symbol: 'construct',
    type: 'word',
    phonetic: '/kənˈstrʌkt/',
    chineseMeaning: 'v. 建造；构建\nn. 概念；建构',
    pictographDescription:
      '【con】= 共同·一起 + 【struct】= 建造。共同建造——构建。',
    parts: [
      { symbol: 'con', meaning: '共同·一起', cardId: 'prefix-con', ...PREFIX_STYLE },
      { symbol: 'struct', meaning: '建造', cardId: 'root-struct', ...ROOT_STYLE },
    ],
    levels: ['CET-4'],
    hasVideo: false,
    frequency: 4,
  },
  'word-instructor': {
    id: 'word-instructor',
    symbol: 'instructor',
    type: 'word',
    phonetic: '/ɪnˈstrʌktə/',
    chineseMeaning: 'n. 讲师；教练；指导员',
    pictographDescription:
      '【in】= 向内 + 【struct】= 建造 + 【or】= …的人。向内建造（知识体系）的人——讲师。',
    parts: [
      { symbol: 'in', meaning: '向内', cardId: 'prefix-in', ...PREFIX_STYLE },
      { symbol: 'struct', meaning: '建造', cardId: 'root-struct', ...ROOT_STYLE },
      { symbol: 'or', meaning: '…的人', cardId: 'suffix-or', ...SUFFIX_STYLE },
    ],
    levels: ['CET-4'],
    hasVideo: false,
    frequency: 4,
  },
  'word-describe': {
    id: 'word-describe',
    symbol: 'describe',
    type: 'word',
    phonetic: '/dɪˈskraɪb/',
    chineseMeaning: 'v. 描述；描写；形容',
    pictographDescription:
      '【de】= 向下·完全 + 【scribe】= 刻写。把（细节）完整地刻写下来——描述。',
    parts: [
      { symbol: 'de', meaning: '向下·完全', cardId: 'prefix-de', ...PREFIX_STYLE },
      { symbol: 'scribe', meaning: '刻写·书写', cardId: 'root-scrib', ...ROOT_STYLE },
    ],
    levels: ['CET-4'],
    hasVideo: false,
    frequency: 4,
    examples: [
      { english: 'Can you describe what you saw?', chinese: '你能描述一下你所看到的吗？' },
    ],
  },
  'word-prescribe': {
    id: 'word-prescribe',
    symbol: 'prescribe',
    type: 'word',
    phonetic: '/prɪˈskraɪb/',
    chineseMeaning: 'v. 规定；开处方；指定',
    pictographDescription:
      '【pre】= 提前·在前 + 【scribe】= 刻写。提前写好——规定、开处方。',
    parts: [
      { symbol: 'pre', meaning: '提前·在前', cardId: '', ...PREFIX_STYLE },
      { symbol: 'scribe', meaning: '刻写', cardId: 'root-scrib', ...ROOT_STYLE },
    ],
    levels: ['CET-6'],
    hasVideo: false,
    frequency: 3,
  },
};

// 单词库列表（用于 WordList 页面）
export const WORD_LIST_ITEMS = [
  { id: 'word-study', word: 'study', phonetic: '/ˈstʌdi/', meaning: 'v. 学习；n. 研究', level: 'CET-4', mastered: true },
  { id: 'word-student', word: 'student', phonetic: '/ˈstuːdənt/', meaning: 'n. 学生', level: 'CET-4', mastered: true },
  { id: 'word-transport', word: 'transport', phonetic: '/ˈtrænspɔːt/', meaning: 'v./n. 运输', level: 'CET-4', mastered: false },
  { id: 'word-export', word: 'export', phonetic: '/ˈekspɔːt/', meaning: 'v./n. 出口', level: 'CET-4', mastered: false },
  { id: 'word-import', word: 'import', phonetic: '/ˈɪmpɔːt/', meaning: 'v./n. 进口', level: 'CET-4', mastered: false },
  { id: 'word-support', word: 'support', phonetic: '/səˈpɔːt/', meaning: 'v./n. 支持', level: 'CET-4', mastered: false },
  { id: 'word-report', word: 'report', phonetic: '/rɪˈpɔːt/', meaning: 'v./n. 报告', level: 'CET-4', mastered: true },
  { id: 'word-structure', word: 'structure', phonetic: '/ˈstrʌktʃə/', meaning: 'n. 结构', level: 'CET-4', mastered: false },
  { id: 'word-construct', word: 'construct', phonetic: '/kənˈstrʌkt/', meaning: 'v. 建造', level: 'CET-4', mastered: false },
  { id: 'word-instructor', word: 'instructor', phonetic: '/ɪnˈstrʌktə/', meaning: 'n. 讲师', level: 'CET-4', mastered: false },
  { id: 'word-describe', word: 'describe', phonetic: '/dɪˈskraɪb/', meaning: 'v. 描述', level: 'CET-4', mastered: true },
  { id: 'word-studio', word: 'studio', phonetic: '/ˈstuːdiəʊ/', meaning: 'n. 工作室', level: 'CET-6', mastered: false },
  { id: 'word-studious', word: 'studious', phonetic: '/ˈstuːdiəs/', meaning: 'adj. 勤学的', level: 'CET-6', mastered: false },
  { id: 'word-prescribe', word: 'prescribe', phonetic: '/prɪˈskraɪb/', meaning: 'v. 规定；开处方', level: 'CET-6', mastered: false },
];

// 热门搜索词
export const HOT_SEARCHES = ['study', 'transport', 'structure', 'describe', 'support', 'import'];

// 象形字母展示
export const LETTER_SHOWCASES = [
  { letter: 't', hieroglyph: '𓂝', meaning: '手', color: '#2563EB', bgColor: '#EFF6FF' },
  { letter: 'u', hieroglyph: '∪', meaning: '包含', color: '#7C3AED', bgColor: '#F3F0FF' },
  { letter: 'd', hieroglyph: '▷', meaning: '得', color: '#059669', bgColor: '#ECFDF5' },
  { letter: 's', hieroglyph: '∿', meaning: '流动', color: '#C9973A', bgColor: '#FFFBEB' },
  { letter: 'p', hieroglyph: '⊳', meaning: '向前', color: '#DC2626', bgColor: '#FEF2F2' },
  { letter: 'r', hieroglyph: '↩', meaning: '回旋', color: '#0E7490', bgColor: '#ECFEFF' },
];
