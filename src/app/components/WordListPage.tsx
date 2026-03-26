import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Flame, Target, ChevronRight, Check, X, RotateCcw, Trophy, Calendar, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import { WORD_LIST_ITEMS } from '../data/wordData';

const CATEGORIES = [
  { id: 'cet4', label: 'CET-4', count: 1200, color: '#0E3A5C', bg: '#DBEEFF', border: '#A9E2FF' },
  { id: 'cet6', label: 'CET-6', count: 2400, color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  { id: 'ielts', label: 'IELTS', count: 3500, color: '#065F46', bg: '#D1FAE5', border: '#6EE7B7' },
  { id: 'toefl', label: 'TOEFL', count: 4000, color: '#7A3800', bg: '#FFEDCC', border: '#FFBA50' },
  { id: 'gre', label: 'GRE', count: 5000, color: '#9B1C1C', bg: '#FFE4E1', border: '#FCA5A5' },
];

const CALENDAR_DAYS = Array.from({ length: 31 }, (_, i) => ({
  day: i + 1,
  done: i < 7,
  today: i === 7,
}));

function FlipCard({ item, onKnow, onDontKnow }: {
  item: typeof WORD_LIST_ITEMS[0];
  onKnow: () => void;
  onDontKnow: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="px-4 mb-4">
      <motion.div
        className="relative rounded-2xl overflow-hidden cursor-pointer"
        style={{
          background: 'white',
          boxShadow: '0 4px 16px rgba(14,58,92,0.10)',
          border: '1px solid #ECECEC',
          minHeight: 160,
        }}
        onClick={() => setFlipped(!flipped)}
        whileTap={{ rotate: flipped ? -2.5 : 2.5, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 500, damping: 14 }}
      >
        {!flipped ? (
          /* Front */
          <div className="p-6 flex flex-col items-center justify-center" style={{ minHeight: 160 }}>
            <div className="flex items-center gap-2 mb-1">
              {item.levels?.map((lv) => (
                <span key={lv} className="rounded-full px-2 py-0.5" style={{ fontSize: 9, background: '#DBEEFF', color: '#0E3A5C', fontWeight: 600 }}>{lv}</span>
              ))}
            </div>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 34, color: '#0E3A5C', fontWeight: 700, letterSpacing: -0.5 }}>
              {item.symbol}
            </span>
            {item.phonetic && (
              <span style={{ color: '#6BAED6', fontSize: 14, marginTop: 4 }}>{item.phonetic}</span>
            )}
            <p style={{ color: '#A9E2FF', fontSize: 12, marginTop: 10, textAlign: 'center' }}>点击翻面查看释义</p>
          </div>
        ) : (
          /* Back */
          <div className="p-5 flex flex-col" style={{ minHeight: 160, background: 'linear-gradient(135deg, #0E3A5C 0%, #1A5A8A 100%)' }}>
            <div className="flex items-end gap-2 mb-3">
              <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: 'white', fontWeight: 700 }}>
                {item.symbol}
              </span>
              {item.phonetic && (
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 2 }}>{item.phonetic}</span>
              )}
            </div>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 1.6, flex: 1, margin: 0 }}>
              {item.chineseMeaning}
            </p>
            {item.parts && item.parts.length > 0 && (
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                {item.parts.map((p, i) => (
                  <span key={i}>
                    <span className="rounded-lg px-2 py-0.5" style={{ background: `${p.color}33`, color: p.color, fontSize: 11, fontWeight: 600 }}>{p.symbol}</span>
                    {i < item.parts!.length - 1 && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, margin: '0 2px' }}>+</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Flip hint badge */}
        <div className="absolute top-3 right-3 rounded-full px-2 py-0.5" style={{ background: flipped ? 'rgba(255,255,255,0.15)' : '#F0F9FF', border: '1px solid #ECECEC' }}>
          <span style={{ fontSize: 9, color: flipped ? 'rgba(255,255,255,0.6)' : '#6BAED6' }}>{flipped ? '已翻面' : '单词面'}</span>
        </div>
      </motion.div>

      {/* Action buttons */}
      {flipped && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-3 mt-3"
        >
          <motion.button
            onClick={(e) => { e.stopPropagation(); onDontKnow(); }}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5"
            style={{ background: '#FFE4E1', border: '1px solid #FCA5A5', color: '#9B1C1C', fontSize: 13, fontWeight: 500 }}
            whileTap={{ scale: 0.95 }}
          >
            <X size={15} /> 不认识
          </motion.button>
          <motion.button
            onClick={(e) => { e.stopPropagation(); navigate(`/word/${item.id}`); }}
            className="flex items-center justify-center rounded-xl px-3"
            style={{ background: '#F0F9FF', border: '1px solid #ECECEC', color: '#6BAED6' }}
            whileTap={{ scale: 0.92, rotate: 5 }}
          >
            <ChevronRight size={15} />
          </motion.button>
          <motion.button
            onClick={(e) => { e.stopPropagation(); onKnow(); }}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5"
            style={{ background: '#DBEEFF', border: '1px solid #A9E2FF', color: '#0E3A5C', fontSize: 13, fontWeight: 600 }}
            whileTap={{ scale: 0.95 }}
          >
            <Check size={15} /> 认识
          </motion.button>
        </motion.div>
      )}
    </div>
  );
}

export function WordListPage() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState('cet4');
  const [activeTab, setActiveTab] = useState<'study' | 'calendar' | 'stats'>('study');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set());
  const [dontKnowIds, setDontKnowIds] = useState<Set<string>>(new Set());

  const items = WORD_LIST_ITEMS.slice(0, 8);
  const currentItem = items[currentIndex];

  const handleKnow = () => {
    if (!currentItem) return;
    setKnownIds((prev) => new Set([...prev, currentItem.id]));
    setCurrentIndex((i) => Math.min(i + 1, items.length - 1));
  };
  const handleDontKnow = () => {
    if (!currentItem) return;
    setDontKnowIds((prev) => new Set([...prev, currentItem.id]));
    setCurrentIndex((i) => Math.min(i + 1, items.length - 1));
  };

  const progress = Math.round(((knownIds.size + dontKnowIds.size) / Math.max(items.length, 1)) * 100);

  return (
    <div style={{ background: '#F0F9FF', minHeight: '100%' }}>

      {/* Header */}
      <div
        className="relative px-5 pt-12 pb-5"
        style={{ background: 'linear-gradient(160deg, #0E3A5C 0%, #1A5A8A 100%)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 style={{ color: 'white', margin: 0, fontFamily: "'Playfair Display', serif", fontWeight: 700 }}>单词库</h1>
            <p style={{ color: 'rgba(169,226,255,0.7)', margin: 0, fontSize: 12 }}>按分类系统学习</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl px-3 py-1.5" style={{ background: 'rgba(169,226,255,0.12)', border: '1px solid rgba(169,226,255,0.2)' }}>
            <Flame size={14} color="#FE8500" />
            <span style={{ color: 'white', fontSize: 13, fontWeight: 600 }}>7</span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>天连续</span>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className="flex-shrink-0 rounded-full px-3.5 py-1.5 transition-all"
              style={{
                background: activeCategory === cat.id ? 'white' : 'rgba(255,255,255,0.12)',
                color: activeCategory === cat.id ? cat.color : 'rgba(255,255,255,0.65)',
                fontSize: 12,
                fontWeight: activeCategory === cat.id ? 700 : 400,
                border: activeCategory === cat.id ? `1.5px solid ${cat.border}` : '1px solid transparent',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Nav */}
      <div className="flex border-b" style={{ borderColor: '#ECECEC', background: 'white' }}>
        {[
          { id: 'study' as const, label: '背单词', icon: '📖' },
          { id: 'calendar' as const, label: '打卡日历', icon: '📅' },
          { id: 'stats' as const, label: '学习统计', icon: '📊' },
        ].map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-3"
            style={{
              color: activeTab === id ? '#0E3A5C' : '#6BAED6',
              borderBottom: activeTab === id ? '2px solid #FE8500' : '2px solid transparent',
              fontWeight: activeTab === id ? 600 : 400,
              fontSize: 12,
              marginBottom: -1,
              background: 'none',
            }}
          >
            <span style={{ fontSize: 14 }}>{icon}</span> {label}
          </button>
        ))}
      </div>

      {/* Study Tab */}
      {activeTab === 'study' && (
        <div className="pt-4">
          {/* Progress bar */}
          <div className="px-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span style={{ fontSize: 12, color: '#6BAED6' }}>今日进度</span>
              <span style={{ fontSize: 12, color: '#0E3A5C', fontWeight: 600 }}>
                {knownIds.size + dontKnowIds.size} / {items.length}
              </span>
            </div>
            <div style={{ height: 6, background: '#ECECEC', borderRadius: 3, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #A9E2FF, #FE8500)',
                  borderRadius: 3,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span style={{ fontSize: 11, color: '#6BAED6' }}>✓ 认识 {knownIds.size} 个</span>
              <span style={{ fontSize: 11, color: '#6BAED6' }}>✗ 待复习 {dontKnowIds.size} 个</span>
            </div>
          </div>

          {currentIndex < items.length ? (
            <FlipCard item={items[currentIndex]} onKnow={handleKnow} onDontKnow={handleDontKnow} />
          ) : (
            <div className="px-4 py-8 flex flex-col items-center gap-4">
              <Trophy size={48} color="#FE8500" />
              <div className="text-center">
                <p style={{ color: '#0E3A5C', fontWeight: 700, fontSize: 16 }}>今日任务完成！🎉</p>
                <p style={{ color: '#6BAED6', fontSize: 13, marginTop: 4 }}>认识 {knownIds.size} 个 · 待复习 {dontKnowIds.size} 个</p>
              </div>
              <motion.button
                onClick={() => { setCurrentIndex(0); setKnownIds(new Set()); setDontKnowIds(new Set()); }}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5"
                style={{ background: '#0E3A5C', color: 'white', fontSize: 13, fontWeight: 500 }}
                whileTap={{ scale: 0.95, rotate: -5 }}
              >
                <RotateCcw size={14} /> 再来一轮
              </motion.button>
            </div>
          )}

          {/* Word list below */}
          <div className="px-4 mt-2">
            <div className="flex items-center justify-between mb-3">
              <p style={{ fontSize: 13, fontWeight: 600, color: '#0E3A5C', margin: 0 }}>今日单词列表</p>
              <span style={{ fontSize: 11, color: '#6BAED6' }}>{items.length} 个</span>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => {
                const isKnown = knownIds.has(item.id);
                const isDontKnow = dontKnowIds.has(item.id);
                const isCurrent = idx === currentIndex;
                return (
                  <motion.button
                    key={item.id}
                    onClick={() => navigate(`/word/${item.id}`)}
                    className="w-full flex items-center justify-between rounded-xl px-3 py-2.5"
                    style={{
                      background: isCurrent ? '#DBEEFF' : 'white',
                      border: isCurrent ? '1.5px solid #A9E2FF' : '1px solid #ECECEC',
                    }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          width: 24, height: 24,
                          background: isKnown ? '#DBEEFF' : isDontKnow ? '#FFE4E1' : '#F0F9FF',
                          border: `1px solid ${isKnown ? '#A9E2FF' : isDontKnow ? '#FCA5A5' : '#ECECEC'}`,
                        }}
                      >
                        {isKnown ? <Check size={12} color="#0E3A5C" /> : isDontKnow ? <X size={12} color="#9B1C1C" /> : <span style={{ fontSize: 9, color: '#6BAED6' }}>{idx + 1}</span>}
                      </div>
                      <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, color: '#0E3A5C', fontWeight: 500 }}>{item.symbol}</span>
                    </div>
                    <span style={{ fontSize: 12, color: '#6BAED6', maxWidth: 100, textAlign: 'right', lineHeight: 1.3 }}>{item.chineseMeaning?.split('\n')[0]}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Calendar Tab */}
      {activeTab === 'calendar' && (
        <div className="px-4 pt-4">
          <div className="rounded-2xl p-4 mb-4" style={{ background: 'white', border: '1px solid #ECECEC', boxShadow: '0 2px 8px rgba(14,58,92,0.05)' }}>
            <div className="flex items-center justify-between mb-4">
              <p style={{ color: '#0E3A5C', fontWeight: 600, margin: 0 }}>2026年3月</p>
              <div className="flex items-center gap-1.5 rounded-full px-3 py-1" style={{ background: '#FFEDCC', border: '1px solid #FFBA50' }}>
                <Flame size={12} color="#FE8500" />
                <span style={{ fontSize: 12, color: '#7A3800', fontWeight: 600 }}>连续 7 天</span>
              </div>
            </div>

            {/* Day labels */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
                <div key={d} style={{ textAlign: 'center', fontSize: 10, color: '#6BAED6', padding: '2px 0' }}>{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {/* Padding for march start (sunday=0) */}
              {Array.from({ length: 6 }).map((_, i) => <div key={`pad-${i}`} />)}
              {CALENDAR_DAYS.map(({ day, done, today }) => (
                <div
                  key={day}
                  className="flex items-center justify-center rounded-lg"
                  style={{
                    aspectRatio: '1',
                    background: today ? '#0E3A5C' : done ? '#DBEEFF' : '#F0F9FF',
                    border: today ? '2px solid #FE8500' : done ? '1px solid #A9E2FF' : '1px solid #ECECEC',
                  }}
                >
                  <span style={{
                    fontSize: 11,
                    fontWeight: today ? 700 : done ? 600 : 400,
                    color: today ? 'white' : done ? '#0E3A5C' : '#A0BCD0',
                  }}>
                    {done && !today ? '✦' : day}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Category progress */}
          <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #ECECEC', boxShadow: '0 2px 8px rgba(14,58,92,0.05)' }}>
            <p style={{ color: '#0E3A5C', fontWeight: 600, margin: '0 0 14px' }}>各分类进度</p>
            <div className="space-y-4">
              {CATEGORIES.map((cat) => {
                const pct = Math.floor(Math.random() * 60) + 10;
                return (
                  <div key={cat.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full px-2 py-0.5" style={{ background: cat.bg, color: cat.color, fontSize: 10, fontWeight: 600, border: `1px solid ${cat.border}` }}>{cat.label}</span>
                        <span style={{ fontSize: 12, color: '#6BAED6' }}>{Math.floor(cat.count * pct / 100)} / {cat.count}</span>
                      </div>
                      <span style={{ fontSize: 12, color: cat.color, fontWeight: 600 }}>{pct}%</span>
                    </div>
                    <div style={{ height: 5, background: '#F0F9FF', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: cat.border, borderRadius: 3, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Stats Tab */}
      {activeTab === 'stats' && (
        <div className="px-4 pt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '累计掌握', value: '128', unit: '词', icon: <Trophy size={18} color="#FE8500" />, bg: '#FFEDCC', border: '#FFBA50' },
              { label: '学习天数', value: '7', unit: '天', icon: <Calendar size={18} color="#0E3A5C" />, bg: '#DBEEFF', border: '#A9E2FF' },
              { label: '今日新词', value: '20', unit: '个', icon: <Target size={18} color="#5B21B6" />, bg: '#EDE9FE', border: '#C4B5FD' },
              { label: '正确率', value: '84', unit: '%', icon: <TrendingUp size={18} color="#065F46" />, bg: '#D1FAE5', border: '#6EE7B7' },
            ].map(({ label, value, unit, icon, bg, border }) => (
              <div key={label} className="rounded-2xl p-4" style={{ background: bg, border: `1px solid ${border}` }}>
                <div className="flex items-center justify-between mb-2">{icon}<span style={{ fontSize: 10, color: '#6B7280' }}>{label}</span></div>
                <div className="flex items-end gap-1">
                  <span style={{ fontSize: 28, fontFamily: "'Playfair Display', serif", color: '#0E3A5C', fontWeight: 700, lineHeight: 1 }}>{value}</span>
                  <span style={{ fontSize: 13, color: '#6BAED6', marginBottom: 2 }}>{unit}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Weekly chart */}
          <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #ECECEC', boxShadow: '0 2px 8px rgba(14,58,92,0.05)' }}>
            <p style={{ color: '#0E3A5C', fontWeight: 600, margin: '0 0 14px', fontSize: 13 }}>本周每日完成量</p>
            <div className="flex items-end gap-2" style={{ height: 80 }}>
              {[12, 18, 15, 22, 20, 25, 20].map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-md"
                    style={{
                      height: `${(v / 25) * 70}px`,
                      background: i === 6 ? 'linear-gradient(180deg, #A9E2FF, #0E3A5C)' : `#DBEEFF`,
                      border: `1px solid ${i === 6 ? '#A9E2FF' : '#ECECEC'}`,
                      borderBottom: 'none',
                    }}
                  />
                  <span style={{ fontSize: 9, color: '#6BAED6' }}>
                    {['日', '一', '二', '三', '四', '五', '六'][i]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 24 }} />
    </div>
  );
}
