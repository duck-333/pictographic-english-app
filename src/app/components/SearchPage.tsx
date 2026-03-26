import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, Bell, Flame, ChevronRight, Sparkles, BookOpen } from 'lucide-react';
import { motion } from 'motion/react';
import { HOT_SEARCHES } from '../data/wordData';

const RECENT_WORDS = [
  { id: 'word-transport', word: 'transport' },
  { id: 'word-structure', word: 'structure' },
  { id: 'word-describe', word: 'describe' },
  { id: 'word-student', word: 'student' },
];

const TODAY_WORD = {
  id: 'word-study',
  word: 'study',
  phonetic: '/ˈstʌdi/',
  meaning: 'v. 学习；研究；n. 书房',
  parts: [
    { text: 's', meaning: '即·ex·外出', color: '#7C3AED' },
    { text: 'tud', meaning: '敲击·钻研', color: '#C9973A' },
    { text: 'y', meaning: '后缀', color: '#0E7490' },
  ],
  tip: '用力敲击（tud）知识，向外出发（s）——这就是"学习"！',
};

export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const handleSearch = (word: string) => {
    const id = `word-${word.toLowerCase()}`;
    navigate(`/word/${id}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      handleSearch(query.trim().toLowerCase());
    }
  };

  return (
    <div style={{ background: '#F0F9FF', minHeight: '100%' }}>
      {/* Header */}
      <div
        className="relative px-5 pt-12 pb-6"
        style={{ background: 'linear-gradient(160deg, #0E3A5C 0%, #1A5A8A 100%)' }}
      >
        {/* Decorative bg */}
        <div className="absolute inset-0 overflow-hidden opacity-5" style={{ fontFamily: 'serif', fontSize: 80, color: 'white', letterSpacing: 8 }}>
          <div style={{ position: 'absolute', top: -20, right: -10 }}>𓂝𓆑𓂋𓏏𓀀</div>
        </div>

        <div className="relative flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span style={{ fontSize: 22, fontFamily: "'Playfair Display', serif", color: '#FFEBA2', fontWeight: 700 }}>象形英语</span>
              <span style={{ fontSize: 10, color: 'rgba(255,235,162,0.8)', background: 'rgba(255,235,162,0.15)', padding: '1px 6px', borderRadius: 8, fontWeight: 500 }}>BETA</span>
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', margin: 0 }}>用象形逻辑，读懂每个英语单词</p>
          </div>
          <button
            className="relative flex items-center justify-center rounded-full"
            style={{ width: 38, height: 38, background: 'rgba(169,226,255,0.12)' }}
          >
            <Bell size={18} color="white" />
            <span className="absolute top-1.5 right-1.5 rounded-full" style={{ width: 6, height: 6, background: '#FE8500' }} />
          </button>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSubmit}>
          <div
            className="flex items-center gap-3 px-4 rounded-2xl transition-all duration-200"
            style={{
              background: 'rgba(255,255,255,0.13)',
              border: focused ? '1.5px solid #A9E2FF' : '1.5px solid rgba(255,255,255,0.15)',
              height: 48,
            }}
          >
            <Search size={18} color={focused ? '#A9E2FF' : 'rgba(255,255,255,0.6)'} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="搜索单词… 试试 study"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'white', fontSize: 15, fontFamily: 'inherit' }}
            />
            {query && (
              <button type="submit" style={{ color: '#FFEBA2', fontSize: 12, fontWeight: 600 }}>搜索</button>
            )}
          </div>
        </form>

        {/* Quick streak */}
        <div className="flex items-center gap-4 mt-4">
          <div className="flex items-center gap-1.5">
            <Flame size={14} color="#FE8500" />
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>连续学习 <strong style={{ color: '#FE8500' }}>7</strong> 天</span>
          </div>
          <div className="flex items-center gap-1.5">
            <BookOpen size={14} color="#A9E2FF" />
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>已掌握 <strong style={{ color: '#A9E2FF' }}>128</strong> 词</span>
          </div>
        </div>

        {/* Hot Searches - moved under search bar */}
        <div className="mt-4">
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>热门搜索</p>
          <div className="flex flex-wrap gap-2">
            {HOT_SEARCHES.map((word) => (
              <button
                key={word}
                onClick={() => handleSearch(word)}
                className="rounded-full px-3 py-1 transition-all duration-150 active:scale-95"
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: 12,
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 500,
                }}
              >
                {word}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-5">

        {/* Today's Featured Word */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={15} color="#FE8500" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0E3A5C' }}>今日象形词</span>
            </div>
            <button onClick={() => navigate(`/word/${TODAY_WORD.id}`)} style={{ fontSize: 12, color: '#FE8500' }} className="flex items-center gap-0.5">
              查看详情 <ChevronRight size={13} />
            </button>
          </div>

          {/* ✨ Tap-to-rotate featured word card */}
          <motion.div
            onClick={() => navigate(`/word/${TODAY_WORD.id}`)}
            className="cursor-pointer rounded-2xl p-5 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #0E3A5C 0%, #1A5A8A 100%)',
              boxShadow: '0 8px 28px rgba(14,58,92,0.28)',
            }}
            whileTap={{ rotate: 1.8, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 500, damping: 14 }}
          >
            <div className="absolute right-0 top-0 opacity-10 text-right" style={{ fontSize: 60, lineHeight: 1, color: '#A9E2FF', fontFamily: 'serif' }}>𓂝</div>
            <div className="relative">
              <div className="flex items-end gap-3 mb-3">
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, color: 'white', fontWeight: 700, letterSpacing: -1 }}>{TODAY_WORD.word}</span>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>{TODAY_WORD.phonetic}</span>
              </div>

              {/* Morpheme chips */}
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                {TODAY_WORD.parts.map((part, i) => (
                  <span key={i}>
                    <span className="inline-flex flex-col items-center rounded-lg px-2.5 py-1" style={{ background: `${part.color}22`, border: `1px solid ${part.color}55` }}>
                      <span style={{ color: part.color, fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 15 }}>{part.text}</span>
                      <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 9 }}>{part.meaning}</span>
                    </span>
                    {i < TODAY_WORD.parts.length - 1 && (
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, margin: '0 2px' }}>+</span>
                    )}
                  </span>
                ))}
              </div>

              <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: 1.6, margin: 0 }}>💡 {TODAY_WORD.tip}</p>

              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-full px-2.5 py-0.5 text-xs" style={{ background: 'rgba(255,235,162,0.18)', color: '#FFEBA2', fontWeight: 600, fontSize: 11 }}>四级必备</span>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>点击查看完整解析 →</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Recent Searches */}
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#0E3A5C', marginBottom: 10 }}>最近查看</p>
          <div className="space-y-2">
            {RECENT_WORDS.map(({ id, word }) => (
              <motion.button
                key={id}
                onClick={() => navigate(`/word/${id}`)}
                className="w-full flex items-center justify-between rounded-xl px-4 py-3"
                style={{ background: 'white', border: '1px solid #ECECEC', boxShadow: '0 2px 6px rgba(14,58,92,0.05)' }}
                whileTap={{ scale: 0.97, rotate: -1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 15 }}
              >
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: '#0E3A5C', fontWeight: 500 }}>{word}</span>
                <ChevronRight size={16} color="#FE8500" />
              </motion.button>
            ))}
          </div>
        </div>

        {/* Bottom Promo */}
        <div
          className="rounded-2xl p-4 flex items-center gap-3 cursor-pointer active:scale-[0.99] transition-all"
          style={{ background: 'linear-gradient(135deg, #EBF8FF 0%, #DBEEFF 100%)', border: '1px solid #A9E2FF' }}
          onClick={() => navigate('/classroom')}
        >
          <div className="text-3xl">🎓</div>
          <div>
            <p style={{ fontWeight: 600, color: '#0E3A5C', margin: 0, fontSize: 13 }}>象形英语·系列课程</p>
            <p style={{ color: '#2A6A9A', margin: 0, fontSize: 11, lineHeight: 1.5 }}>从象形文字到现代英语，系统解锁词汇密码</p>
          </div>
          <ChevronRight size={16} color="#FE8500" style={{ marginLeft: 'auto', flexShrink: 0 }} />
        </div>

        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}