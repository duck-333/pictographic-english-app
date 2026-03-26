import { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import {
  ChevronLeft, Play, Share2, BookmarkPlus, ChevronRight,
  Volume2, ChevronDown, ChevronUp, Network
} from 'lucide-react';
import { motion } from 'motion/react';
import { WORD_CARDS, CardType } from '../data/wordData';

const TYPE_LABELS: Record<CardType, string> = {
  word: '单词',
  root: '词根',
  letter: '字母',
  prefix: '前缀',
  suffix: '后缀',
};

const TYPE_COLORS: Record<CardType, { bg: string; text: string; border: string }> = {
  word:   { bg: '#EBF8FF', text: '#0E3A5C', border: '#A9E2FF' },
  root:   { bg: '#FFFDE8', text: '#7A4800', border: '#FFEBA2' },
  letter: { bg: '#FFF3E8', text: '#A33800', border: '#FFC688' },
  prefix: { bg: '#F3EEFF', text: '#5B1FAF', border: '#C4B5FD' },
  suffix: { bg: '#E8F9FF', text: '#0A6882', border: '#A5F3FC' },
};

const LEVEL_COLORS: Record<string, { bg: string; text: string }> = {
  'CET-4': { bg: '#DBEEFF', text: '#0E3A5C' },
  'CET-6': { bg: '#EDE9FE', text: '#5B21B6' },
  'IELTS': { bg: '#D1FAE5', text: '#065F46' },
  'TOEFL': { bg: '#FFEDCC', text: '#7A3800' },
  'GRE':   { bg: '#FFE4E1', text: '#9B1C1C' },
};

function VideoModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl overflow-hidden"
        style={{ maxWidth: 430, background: '#1E1B4B' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative flex items-center justify-center"
          style={{ background: '#0F0E1A', height: 220 }}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(https://images.unsplash.com/photo-1764312349540-e9a4dfe2f8e2?w=500&q=60)`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: 0.3,
            }}
          />
          <motion.button
            className="relative z-10 flex items-center justify-center rounded-full"
            style={{ width: 64, height: 64, background: '#C9973A', boxShadow: '0 0 30px rgba(201,151,58,0.5)' }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            <Play size={26} color="white" fill="white" style={{ marginLeft: 4 }} />
          </motion.button>
          <div className="absolute bottom-3 right-4">
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>04:32</span>
          </div>
        </div>
        <div className="p-5">
          <p style={{ color: 'white', fontWeight: 600, fontSize: 15, margin: '0 0 4px' }}>象形解析 · 视频讲解</p>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: '0 0 16px' }}>作者亲讲 · 4分32秒 · 含配图说明</p>
          <div className="flex gap-3">
            <button className="flex-1 py-3 rounded-xl" style={{ background: '#C9973A', color: 'white', fontWeight: 600, fontSize: 14 }}>
              立即观看
            </button>
            <button onClick={onClose} className="px-5 py-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WordCardPage() {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedPart, setExpandedPart] = useState<string | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);

  const card = cardId ? WORD_CARDS[cardId] : null;
  const trail: string[] = (location.state as any)?.trail || [];

  if (!card) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 px-8 text-center">
        <div style={{ fontSize: 48 }}>🔍</div>
        <h2 style={{ color: '#1E1B4B', fontWeight: 600 }}>暂未收录该词</h2>
        <p style={{ color: '#9B97C0', fontSize: 14 }}>《象形英语》词库持续更新中</p>
        <button onClick={() => navigate('/')} className="px-6 py-3 rounded-xl" style={{ background: '#1E1B4B', color: 'white', fontSize: 14, fontWeight: 500 }}>
          返回搜索
        </button>
      </div>
    );
  }

  const descLines = card.pictographDescription.split('\n');

  const handlePartClick = (partId: string) => {
    if (!partId) return;
    setExpandedPart(expandedPart === partId ? null : partId);
  };

  const navigateToPart = (partCardId: string) => {
    if (!partCardId) return;
    navigate(`/word/${partCardId}`, { state: { trail: [...trail, cardId!] } });
  };

  const siblingCards = (card.siblingCardIds || []).map((id) => WORD_CARDS[id]).filter(Boolean);

  return (
    <>
      {showVideo && <VideoModal onClose={() => setShowVideo(false)} />}
      <div style={{ background: '#F0F9FF', minHeight: '100%' }}>

        {/* Top Nav */}
        <div className="flex items-center justify-between px-4 pt-12 pb-4" style={{ background: '#F0F9FF' }}>
          <button
            onClick={() => trail.length > 0 ? navigate(`/word/${trail[trail.length - 1]}`, { state: { trail: trail.slice(0, -1) } }) : navigate(-1)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 transition-all active:scale-95"
            style={{ background: 'white', border: '1px solid #ECECEC', color: '#0E3A5C', fontSize: 13 }}
          >
            <ChevronLeft size={16} />
            {trail.length > 0 ? (
              <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 500 }}>
                {WORD_CARDS[trail[trail.length - 1]]?.symbol || '返回'}
              </span>
            ) : '返回'}
          </button>

          {trail.length > 0 && (
            <div className="flex items-center gap-1 overflow-hidden">
              {trail.slice(-2).map((id, i) => (
                <span key={id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={10} color="#A9E2FF" />}
                  <span style={{ fontSize: 11, color: '#6BAED6', fontFamily: "'Playfair Display', serif" }}>
                    {WORD_CARDS[id]?.symbol}
                  </span>
                </span>
              ))}
              <ChevronRight size={10} color="#FE8500" />
              <span style={{ fontSize: 11, color: '#FE8500', fontFamily: "'Playfair Display', serif", fontWeight: 600 }}>
                {card.symbol}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <motion.button
              onClick={() => setBookmarked(!bookmarked)}
              className="flex items-center justify-center rounded-xl"
              style={{ width: 36, height: 36, background: 'white', border: '1px solid #ECECEC' }}
              whileTap={{ scale: 0.85, rotate: bookmarked ? -10 : 10 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
            >
              <BookmarkPlus size={16} color={bookmarked ? '#FE8500' : '#6BAED6'} fill={bookmarked ? '#FE8500' : 'none'} />
            </motion.button>
            <motion.button
              className="flex items-center justify-center rounded-xl"
              style={{ width: 36, height: 36, background: 'white', border: '1px solid #ECECEC' }}
              onClick={() => navigate('/network')}
              whileTap={{ scale: 0.85, rotate: -15 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
            >
              <Network size={16} color="#6BAED6" />
            </motion.button>
          </div>
        </div>

        {/* Card Header */}
        <motion.div
          className="mx-4 rounded-2xl p-5 mb-4 relative overflow-hidden cursor-pointer"
          style={{
            background: 'linear-gradient(140deg, #0E3A5C 0%, #1A5A8A 100%)',
            boxShadow: '0 12px 32px rgba(14,58,92,0.22)',
          }}
          whileTap={{ rotate: 1.5, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 500, damping: 14 }}
        >
          {card.hieroglyph && (
            <div className="absolute right-4 top-4 opacity-10" style={{ fontSize: 64, color: '#A9E2FF', fontFamily: 'serif', lineHeight: 1 }}>
              {card.hieroglyph}
            </div>
          )}

          <div className="relative">
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 mb-3" style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 500 }}>
              {TYPE_LABELS[card.type]}
              {card.levels && card.levels.map((lv) => (
                <span key={lv} className="ml-2 rounded-full px-1.5" style={{ background: LEVEL_COLORS[lv]?.bg || '#E5E7EB', color: LEVEL_COLORS[lv]?.text || '#374151', fontSize: 10 }}>
                  {lv}
                </span>
              ))}
            </span>

            <div className="flex items-end gap-3 mb-2">
              <span style={{ fontFamily: "'Playfair Display', serif", fontSize: card.symbol.length > 10 ? 28 : card.symbol.length > 6 ? 36 : 44, color: 'white', fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.1 }}>
                {card.symbol}
              </span>
              {card.phonetic && (
                <div className="flex items-center gap-1.5 mb-1">
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{card.phonetic}</span>
                  <button><Volume2 size={14} color="rgba(255,255,255,0.4)" /></button>
                </div>
              )}
            </div>

            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, margin: '0 0 4px', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
              {card.chineseMeaning}
            </p>
            {card.englishMeaning && (
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, margin: 0, fontStyle: 'italic' }}>{card.englishMeaning}</p>
            )}
          </div>
        </motion.div>

        <div className="px-4 space-y-4">

          {/* Morpheme Breakdown */}
          {card.parts && card.parts.length > 0 && (
            <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #ECECEC', boxShadow: '0 2px 8px rgba(14,58,92,0.05)' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#6BAED6', letterSpacing: 0.5, marginBottom: 12, textTransform: 'uppercase' }}>
                象形拆解
              </p>

              <div className="flex items-center gap-2 mb-4 flex-wrap">
                {card.parts.map((part, i) => {
                  const partKey = part.cardId || part.symbol;
                  const isExpanded = expandedPart === partKey;
                  return (
                    <span key={i} className="flex items-center gap-2">
                      <motion.button
                        onClick={() => handlePartClick(partKey)}
                        className="flex flex-col items-center rounded-xl px-3 py-2"
                        style={{
                          background: part.bgColor,
                          border: `1.5px solid ${isExpanded ? part.color : part.borderColor}`,
                          outline: 'none',
                          cursor: 'pointer',
                        }}
                        whileTap={{ rotate: i % 2 === 0 ? -8 : 8, scale: 0.88, y: -4 }}
                        animate={isExpanded ? { y: -4, boxShadow: `0 8px 20px ${part.color}40` } : { y: 0, boxShadow: '0 0 0 transparent' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                      >
                        <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: part.color, fontWeight: 700, lineHeight: 1.2 }}>
                          {part.symbol}
                        </span>
                        <span style={{ fontSize: 9, color: part.color, opacity: 0.8, marginTop: 2 }}>
                          {part.meaning}
                        </span>
                      </motion.button>
                      {i < card.parts!.length - 1 && (
                        <span style={{ color: '#A9E2FF', fontSize: 16, fontWeight: 300 }}>+</span>
                      )}
                    </span>
                  );
                })}
                <span style={{ color: '#A9E2FF', fontSize: 16, margin: '0 2px' }}>=</span>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: '#0E3A5C', fontWeight: 700 }}>
                  {card.symbol.split('/')[0].trim()}
                </span>
              </div>

              {/* Expanded Part Detail */}
              {expandedPart && (() => {
                const part = card.parts!.find((p) => (p.cardId || p.symbol) === expandedPart);
                const partCard = part?.cardId ? WORD_CARDS[part.cardId] : null;
                if (!part) return null;
                return (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="rounded-xl p-3.5 mb-2"
                    style={{ background: part.bgColor, border: `1px solid ${part.borderColor}` }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: part.color, fontWeight: 700 }}>{part.symbol}</span>
                        <span style={{ fontSize: 13, color: part.color, marginLeft: 8, fontWeight: 500 }}>= {part.meaning}</span>
                      </div>
                      {part.cardId && (
                        <motion.button
                          onClick={() => navigateToPart(part.cardId)}
                          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs"
                          style={{ background: part.color, color: 'white', fontWeight: 500 }}
                          whileTap={{ scale: 0.93, rotate: -3 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                        >
                          深入探索 <ChevronRight size={12} />
                        </motion.button>
                      )}
                    </div>
                    {partCard && (
                      <p style={{ fontSize: 12, color: '#4A85A8', lineHeight: 1.6, margin: 0 }}>
                        {partCard.pictographDescription.slice(0, 120)}…
                      </p>
                    )}
                  </motion.div>
                );
              })()}
            </div>
          )}

          {/* Video Button */}
          {card.hasVideo && (
            <motion.button
              onClick={() => setShowVideo(true)}
              className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5"
              style={{ background: 'linear-gradient(135deg, #FE8500 0%, #FFAB40 100%)', boxShadow: '0 6px 20px rgba(254,133,0,0.3)' }}
              whileTap={{ scale: 0.96, rotate: -1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 12 }}
            >
              <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.25)' }}>
                <Play size={18} color="white" fill="white" style={{ marginLeft: 2 }} />
              </div>
              <div className="text-left">
                <p style={{ color: 'white', fontWeight: 600, fontSize: 14, margin: 0 }}>观看视频讲解</p>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, margin: 0 }}>作者亲讲 · 象形图解 · 4分32秒</p>
              </div>
              <ChevronRight size={18} color="rgba(255,255,255,0.8)" style={{ marginLeft: 'auto' }} />
            </motion.button>
          )}

          {/* Pictograph Description */}
          <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #ECECEC', boxShadow: '0 2px 8px rgba(14,58,92,0.05)' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#6BAED6', letterSpacing: 0.5, marginBottom: 12, textTransform: 'uppercase' }}>
              象形解析
            </p>
            <div style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.8, overflow: 'hidden', maxHeight: showFullDesc ? 'none' : 80, whiteSpace: 'pre-line' }}>
              {card.pictographDescription}
            </div>
            {card.pictographDescription.length > 120 && (
              <button onClick={() => setShowFullDesc(!showFullDesc)} className="flex items-center gap-1 mt-2" style={{ color: '#FE8500', fontSize: 12, fontWeight: 500 }}>
                {showFullDesc ? <><ChevronUp size={13} /> 收起</> : <><ChevronDown size={13} /> 查看完整解析</>}
              </button>
            )}
          </div>

          {/* Examples */}
          {card.examples && card.examples.length > 0 && (
            <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #ECECEC', boxShadow: '0 2px 8px rgba(14,58,92,0.05)' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#6BAED6', letterSpacing: 0.5, marginBottom: 12, textTransform: 'uppercase' }}>
                例句
              </p>
              <div className="space-y-3">
                {card.examples.map((ex, i) => (
                  <div key={i} className="rounded-xl p-3" style={{ background: '#F0F9FF', borderLeft: '3px solid #A9E2FF' }}>
                    <p style={{ fontSize: 13, color: '#0E3A5C', lineHeight: 1.6, margin: '0 0 4px', fontStyle: 'italic' }}>"{ex.english}"</p>
                    <p style={{ fontSize: 12, color: '#6BAED6', margin: 0 }}>{ex.chinese}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Same-root word family */}
          {siblingCards.length > 0 && (
            <div className="rounded-2xl p-4" style={{ background: 'white', border: '1px solid #ECECEC', boxShadow: '0 2px 8px rgba(14,58,92,0.05)' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#6BAED6', letterSpacing: 0.5, marginBottom: 12, textTransform: 'uppercase' }}>
                同根词族
              </p>
              <div className="grid grid-cols-2 gap-2">
                {siblingCards.map((sibling) => (
                  <motion.button
                    key={sibling.id}
                    onClick={() => navigate(`/word/${sibling.id}`, { state: { trail: [...trail, cardId!] } })}
                    className="flex flex-col items-start rounded-xl p-3 text-left"
                    style={{ background: '#F0F9FF', border: '1px solid #ECECEC' }}
                    whileTap={{ scale: 0.93, rotate: -2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                  >
                    <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: '#0E3A5C', fontWeight: 600 }}>{sibling.symbol}</span>
                    <span style={{ fontSize: 11, color: '#6BAED6', lineHeight: 1.4, marginTop: 2 }}>{sibling.chineseMeaning.split('\n')[0]}</span>
                    {sibling.levels?.[0] && (
                      <span className="mt-1.5 rounded-full px-1.5 py-0.5" style={{ fontSize: 9, background: LEVEL_COLORS[sibling.levels[0]]?.bg || '#E5E7EB', color: LEVEL_COLORS[sibling.levels[0]]?.text || '#374151' }}>
                        {sibling.levels[0]}
                      </span>
                    )}
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {/* Bottom CTA */}
          <div className="flex gap-3 pb-4">
            <motion.button
              onClick={() => navigate('/network')}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3"
              style={{ background: '#0E3A5C', color: 'white', fontSize: 13, fontWeight: 500 }}
              whileTap={{ scale: 0.95, rotate: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
            >
              <Network size={15} />
              在关系网中查看
            </motion.button>
            <motion.button
              className="flex items-center justify-center rounded-xl px-4"
              style={{ background: 'white', border: '1px solid #ECECEC', color: '#6BAED6' }}
              whileTap={{ scale: 0.88, rotate: -8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 14 }}
            >
              <Share2 size={16} />
            </motion.button>
          </div>
        </div>
      </div>
    </>
  );
}