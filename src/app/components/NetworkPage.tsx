import { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ZoomIn, ZoomOut, RotateCcw, X, ChevronRight, Sparkles } from 'lucide-react';
import { CardType, WORD_CARDS } from '../data/wordData';

interface NetworkNode {
  id: string;
  label: string;
  subLabel: string;
  type: CardType;
  x: number;
  y: number;
  size: number;
}

interface NetworkEdge {
  id: string;
  from: string;
  to: string;
  type: 'contains' | 'family';
}

interface NebulaCluster {
  id: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  nodeIds: string[];
}

// Star color palette per type (new 巴小塔 palette)
const TYPE_STAR: Record<CardType, { lit: string; glow: string; dim: string; ring: string }> = {
  word:   { lit: '#FFEBA2', glow: '#FFEBA2', dim: '#1B3550', ring: '#FFEBA2' },
  root:   { lit: '#A9E2FF', glow: '#A9E2FF', dim: '#0F2840', ring: '#A9E2FF' },
  letter: { lit: '#FE8500', glow: '#FE8500', dim: '#1A2535', ring: '#FE8500' },
  prefix: { lit: '#D4B8FF', glow: '#D4B8FF', dim: '#1A2040', ring: '#D4B8FF' },
  suffix: { lit: '#A9E2FF', glow: '#A9E2FF', dim: '#0F2030', ring: '#A9E2FF' },
};

const TYPE_LABELS: Record<CardType, string> = {
  word: '单词', root: '词根', letter: '字母', prefix: '前缀', suffix: '后缀',
};

const INITIAL_NODES: NetworkNode[] = [
  // Core study cluster
  { id: 'word-study',     label: 'study',      subLabel: '学习·研究', type: 'word',   x: 500, y: 370, size: 22 },
  { id: 'letter-s',       label: 's',          subLabel: '外出',      type: 'prefix', x: 290, y: 265, size: 14 },
  { id: 'root-tud',       label: 'tud',        subLabel: '敲击',      type: 'root',   x: 490, y: 195, size: 19 },
  { id: 'suffix-y',       label: 'y',          subLabel: '后缀',      type: 'suffix', x: 680, y: 270, size: 13 },
  // Letters
  { id: 'letter-t',       label: 't',          subLabel: '手·臂',    type: 'letter', x: 355, y: 95,  size: 13 },
  { id: 'letter-u',       label: 'u',          subLabel: '包含',      type: 'letter', x: 500, y: 70,  size: 13 },
  { id: 'letter-d',       label: 'd',          subLabel: '得·受',    type: 'letter', x: 640, y: 100, size: 13 },
  // tud word family
  { id: 'word-student',   label: 'student',    subLabel: '学生',      type: 'word',   x: 740, y: 385, size: 19 },
  { id: 'word-studio',    label: 'studio',     subLabel: '工作室',    type: 'word',   x: 705, y: 495, size: 18 },
  { id: 'word-studious',  label: 'studious',   subLabel: '好学的',    type: 'word',   x: 510, y: 510, size: 18 },
  // struct family
  { id: 'root-struct',    label: 'struct',     subLabel: '建造',      type: 'root',   x: 235, y: 455, size: 18 },
  { id: 'word-structure', label: 'structure',  subLabel: '结构',      type: 'word',   x: 120, y: 545, size: 18 },
  { id: 'word-construct', label: 'construct',  subLabel: '建造',      type: 'word',   x: 175, y: 415, size: 18 },
  { id: 'word-instructor',label: 'instructor', subLabel: '讲师',      type: 'word',   x: 75,  y: 480, size: 17 },
  // port family
  { id: 'root-port',      label: 'port',       subLabel: '携带',      type: 'root',   x: 845, y: 200, size: 18 },
  { id: 'word-transport', label: 'transport',  subLabel: '运输',      type: 'word',   x: 945, y: 315, size: 19 },
  { id: 'word-export',    label: 'export',     subLabel: '出口',      type: 'word',   x: 955, y: 430, size: 18 },
  { id: 'word-support',   label: 'support',    subLabel: '支持',      type: 'word',   x: 860, y: 530, size: 18 },
  { id: 'word-report',    label: 'report',     subLabel: '报告',      type: 'word',   x: 760, y: 600, size: 18 },
  // Prefixes
  { id: 'prefix-ex',      label: 'ex',         subLabel: '出·外',    type: 'prefix', x: 135, y: 215, size: 13 },
  { id: 'prefix-trans',   label: 'trans',      subLabel: '穿越',      type: 'prefix', x: 760, y: 130, size: 14 },
  { id: 'prefix-con',     label: 'con',        subLabel: '共同',      type: 'prefix', x: 90,  y: 365, size: 13 },
  { id: 'prefix-re',      label: 're',         subLabel: '再·回',    type: 'prefix', x: 640, y: 600, size: 13 },
  { id: 'prefix-in',      label: 'in',         subLabel: '向内',      type: 'prefix', x: 80,  y: 300, size: 13 },
];

const EDGES: NetworkEdge[] = [
  { id: 'e1',  from: 'word-study',     to: 'letter-s',        type: 'contains' },
  { id: 'e2',  from: 'word-study',     to: 'root-tud',        type: 'contains' },
  { id: 'e3',  from: 'word-study',     to: 'suffix-y',        type: 'contains' },
  { id: 'e4',  from: 'root-tud',       to: 'letter-t',        type: 'contains' },
  { id: 'e5',  from: 'root-tud',       to: 'letter-u',        type: 'contains' },
  { id: 'e6',  from: 'root-tud',       to: 'letter-d',        type: 'contains' },
  { id: 'e7',  from: 'root-tud',       to: 'word-student',    type: 'family'   },
  { id: 'e8',  from: 'root-tud',       to: 'word-studio',     type: 'family'   },
  { id: 'e9',  from: 'root-tud',       to: 'word-studious',   type: 'family'   },
  { id: 'e11', from: 'root-port',      to: 'word-transport',  type: 'contains' },
  { id: 'e12', from: 'root-port',      to: 'word-export',     type: 'contains' },
  { id: 'e13', from: 'root-port',      to: 'word-support',    type: 'contains' },
  { id: 'e14', from: 'root-port',      to: 'word-report',     type: 'contains' },
  { id: 'e15', from: 'prefix-trans',   to: 'word-transport',  type: 'contains' },
  { id: 'e16', from: 'prefix-ex',      to: 'word-export',     type: 'contains' },
  { id: 'e17', from: 'prefix-re',      to: 'word-report',     type: 'contains' },
  { id: 'e18', from: 'root-struct',    to: 'word-structure',  type: 'contains' },
  { id: 'e19', from: 'root-struct',    to: 'word-construct',  type: 'contains' },
  { id: 'e20', from: 'root-struct',    to: 'word-instructor', type: 'contains' },
  { id: 'e21', from: 'prefix-con',     to: 'word-construct',  type: 'contains' },
  { id: 'e22', from: 'prefix-in',      to: 'word-instructor', type: 'contains' },
  { id: 'e23', from: 'letter-s',       to: 'prefix-ex',       type: 'family'   },
];

const NEBULA_CLUSTERS: NebulaCluster[] = [
  { id: 'tud',    cx: 520, cy: 310, r: 220, color: '#A9E2FF',
    nodeIds: ['word-study','root-tud','word-student','word-studio','word-studious','letter-t','letter-u','letter-d','letter-s','suffix-y'] },
  { id: 'struct', cx: 165, cy: 450, r: 185, color: '#FFEBA2',
    nodeIds: ['root-struct','word-structure','word-construct','word-instructor','prefix-con','prefix-in','prefix-ex'] },
  { id: 'port',   cx: 870, cy: 400, r: 200, color: '#A9E2FF',
    nodeIds: ['root-port','word-transport','word-export','word-support','word-report','prefix-trans','prefix-re'] },
];

// Deterministic background star positions
const BG_STARS = Array.from({ length: 70 }, (_, i) => ({
  cx: (i * 241 + 37) % 1100,
  cy: (i * 173 + 19) % 700,
  r: i % 5 === 0 ? 1.5 : i % 3 === 0 ? 1.1 : 0.7,
  opacity: 0.08 + (i % 7) * 0.04,
  twinkleDelay: (i % 8) * 0.6,
  twinkleDur: 2.5 + (i % 5) * 0.8,
}));

export function NetworkPage() {
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan] = useState({ x: -200, y: -80 });
  const [scale, setScale] = useState(0.72);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [hasMoved, setHasMoved] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>('word-study');
  const [filterType, setFilterType] = useState<CardType | 'all'>('all');
  const [learnedIds, setLearnedIds] = useState<Set<string>>(new Set(['word-study']));
  const [burstIds, setBurstIds] = useState<Set<string>>(new Set());

  const visibleNodes = filterType === 'all'
    ? INITIAL_NODES
    : INITIAL_NODES.filter((n) => n.type === filterType || n.id === 'word-study');
  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = EDGES.filter((e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to));

  const selectedCard = selectedId ? WORD_CARDS[selectedId] : null;
  const selectedNode = INITIAL_NODES.find((n) => n.id === selectedId);

  const markLearned = useCallback((id: string) => {
    setLearnedIds((prev) => new Set([...prev, id]));
    setBurstIds((prev) => new Set([...prev, id]));
    setTimeout(() => {
      setBurstIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }, 1800);
  }, []);

  const totalLit = learnedIds.size;

  // Nebula opacity based on lit ratio in cluster
  const getNebulaOpacity = (cluster: NebulaCluster) => {
    const lit = cluster.nodeIds.filter((id) => learnedIds.has(id)).length;
    return Math.min(0.30, (lit / cluster.nodeIds.length) * 0.55);
  };

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    setIsDragging(true);
    setHasMoved(false);
    setDragStart({ x: e.clientX, y: e.clientY });
    setPanStart({ ...pan });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) setHasMoved(true);
    setPan({ x: panStart.x + dx, y: panStart.y + dy });
  }, [isDragging, dragStart, panStart]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (!hasMoved) setSelectedId((prev) => prev === nodeId ? null : nodeId);
  }, [hasMoved]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.max(0.25, Math.min(3, s * (e.deltaY > 0 ? 0.9 : 1.1))));
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Touch support
  const touchRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, panX: pan.x, panY: pan.y };
    setHasMoved(false);
  }, [pan]);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) setHasMoved(true);
    setPan({ x: touchRef.current.panX + dx, y: touchRef.current.panY + dy });
  }, []);
  const handleTouchEnd = useCallback(() => { touchRef.current = null; }, []);

  const zoom = (dir: 'in' | 'out') =>
    setScale((s) => dir === 'in' ? Math.min(3, s * 1.25) : Math.max(0.25, s / 1.25));
  const reset = () => { setPan({ x: -200, y: -80 }); setScale(0.72); };

  const getEdgeCurve = (edge: NetworkEdge, from: NetworkNode, to: NetworkNode) => {
    const hash = edge.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const dir = hash % 2 === 0 ? 1 : -1;
    const offset = 12 + (hash % 20);
    const midX = (from.x + to.x) / 2 + dir * offset;
    const midY = (from.y + to.y) / 2;
    return `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`;
  };

  return (
    <div style={{ height: 'calc(100dvh - 80px)', background: '#050C1A', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>

      {/* Top Bar */}
      <div
        className="flex items-center justify-between px-4 pt-12 pb-3"
        style={{ background: 'rgba(5,12,26,0.97)', backdropFilter: 'blur(10px)', zIndex: 10, borderBottom: '1px solid rgba(169,226,255,0.08)', flexShrink: 0 }}
      >
        <div>
          <h2 style={{ color: 'white', margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: 0.3 }}>词语星图</h2>
          <p style={{ color: 'rgba(169,226,255,0.45)', margin: 0, fontSize: 11 }}>
            {totalLit} / {INITIAL_NODES.length} 颗星已点亮
          </p>
        </div>
        {/* Lit progress bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 80, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${(totalLit / INITIAL_NODES.length) * 100}%`,
                background: 'linear-gradient(90deg, #A9E2FF, #FFEBA2)',
                borderRadius: 2,
                transition: 'width 0.5s ease',
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: '#FFEBA2', fontWeight: 600 }}>
            {Math.round((totalLit / INITIAL_NODES.length) * 100)}%
          </span>
        </div>
      </div>

      {/* Type Filter */}
      <div
        className="flex gap-2 px-4 py-2.5 overflow-x-auto"
        style={{ background: 'rgba(5,12,26,0.8)', scrollbarWidth: 'none', flexShrink: 0, borderBottom: '1px solid rgba(169,226,255,0.05)' }}
      >
        {(['all', 'word', 'root', 'letter', 'prefix'] as const).map((t) => {
          const c = t !== 'all' ? TYPE_STAR[t as CardType] : null;
          return (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className="flex-shrink-0 rounded-full px-3 py-1 text-xs transition-all"
              style={{
                background: filterType === t
                  ? (c ? `${c.lit}22` : 'rgba(169,226,255,0.15)')
                  : 'rgba(255,255,255,0.05)',
                color: filterType === t
                  ? (c ? c.lit : '#A9E2FF')
                  : 'rgba(255,255,255,0.4)',
                border: filterType === t
                  ? `1px solid ${c ? c.lit : '#A9E2FF'}55`
                  : '1px solid rgba(255,255,255,0.07)',
                fontWeight: filterType === t ? 600 : 400,
              }}
            >
              {t === 'all' ? '✦ 全部' : TYPE_LABELS[t as CardType]}
            </button>
          );
        })}
      </div>

      {/* SVG Canvas */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ cursor: isDragging ? 'grabbing' : 'grab', display: 'block' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <defs>
            {/* Nebula blur */}
            <filter id="glow-nebula" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="38" />
            </filter>
            {/* Strong glow for lit stars */}
            <filter id="glow-lit" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Mild glow for edges */}
            <filter id="glow-edge" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Burst ring filter */}
            <filter id="glow-burst" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
            {/* Dim soft glow */}
            <filter id="glow-dim" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Background micro-stars */}
          {BG_STARS.map((s, i) => (
            <circle
              key={i}
              cx={s.cx} cy={s.cy} r={s.r}
              fill="white"
              opacity={s.opacity}
              style={{ animation: `bg-twinkle ${s.twinkleDur}s ${s.twinkleDelay}s ease-in-out infinite` }}
            />
          ))}

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>

            {/* ── Nebula blobs ── */}
            {NEBULA_CLUSTERS.map((cluster) => {
              const baseOpacity = getNebulaOpacity(cluster);
              return (
                <g key={cluster.id}>
                  {/* Outer soft haze */}
                  <circle
                    cx={cluster.cx} cy={cluster.cy}
                    r={cluster.r * 1.6}
                    fill={cluster.color}
                    opacity={baseOpacity * 0.4}
                    filter="url(#glow-nebula)"
                  />
                  {/* Inner glow core */}
                  <circle
                    cx={cluster.cx} cy={cluster.cy}
                    r={cluster.r}
                    fill={cluster.color}
                    opacity={baseOpacity}
                    filter="url(#glow-nebula)"
                  />
                </g>
              );
            })}

            {/* ── Edges ── */}
            {visibleEdges.map((edge) => {
              const from = visibleNodes.find((n) => n.id === edge.from);
              const to   = visibleNodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;

              const fromLit = learnedIds.has(edge.from);
              const toLit   = learnedIds.has(edge.to);
              const bothLit = fromLit && toLit;
              const anyLit  = fromLit || toLit;
              const isConnectedSelected = edge.from === selectedId || edge.to === selectedId;
              const curve = getEdgeCurve(edge, from, to);

              const fromColor = TYPE_STAR[from.type].lit;
              const toColor   = TYPE_STAR[to.type].lit;
              const edgeColor = bothLit
                ? fromColor
                : anyLit
                ? 'rgba(169,226,255,0.25)'
                : 'rgba(255,255,255,0.045)';
              const edgeWidth = bothLit ? 1.4 : anyLit ? 0.8 : 0.5;
              const edgeDash  = !bothLit ? '3 5' : 'none';
              const edgeOpacity = isConnectedSelected ? 1 : bothLit ? 0.75 : anyLit ? 0.4 : 0.6;

              return (
                <g key={edge.id}>
                  {bothLit && (
                    <path
                      d={curve} fill="none"
                      stroke={edgeColor}
                      strokeWidth={3}
                      opacity={0.12}
                      filter="url(#glow-edge)"
                    />
                  )}
                  <path
                    d={curve} fill="none"
                    stroke={edgeColor}
                    strokeWidth={edgeWidth}
                    strokeDasharray={edgeDash}
                    opacity={edgeOpacity}
                    style={{ transition: 'stroke 0.6s ease, opacity 0.6s ease' }}
                  />
                </g>
              );
            })}

            {/* ── Stars (nodes) ── */}
            {visibleNodes.map((node) => {
              const lit = learnedIds.has(node.id);
              const burst = burstIds.has(node.id);
              const isSelected = node.id === selectedId;
              const isConnected = EDGES.some(
                (e) => (e.from === selectedId && e.to === node.id) || (e.to === selectedId && e.from === node.id)
              );
              const dimmed = !!selectedId && !isSelected && !isConnected;
              const colors = TYPE_STAR[node.type];

              // Compute displayed size (lit stars are slightly bigger)
              const displaySize = isSelected
                ? node.size * 1.35
                : lit ? node.size * 1.1 : node.size;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => handleNodeClick(node.id)}
                  style={{ cursor: 'pointer', opacity: dimmed ? 0.25 : 1, transition: 'opacity 0.4s ease' }}
                >
                  {/* Burst ring (newly lit) */}
                  {burst && (
                    <>
                      <circle r={displaySize + 30} fill={colors.glow} opacity={0.18} filter="url(#glow-burst)"
                        style={{ animation: 'burst-ring 1.8s ease-out forwards' }} />
                      <circle r={displaySize + 14} fill="none" stroke={colors.lit} strokeWidth="1"
                        opacity={0.5} style={{ animation: 'burst-ring 1.8s ease-out forwards' }} />
                    </>
                  )}

                  {/* Outer halo for lit */}
                  {lit && (
                    <circle
                      r={displaySize + 10}
                      fill={colors.glow}
                      opacity={isSelected ? 0.18 : 0.10}
                      filter="url(#glow-dim)"
                      style={{ transition: 'r 0.5s ease, opacity 0.5s ease' }}
                    />
                  )}

                  {/* Selected pulse rings */}
                  {isSelected && (
                    <>
                      <circle r={displaySize + 18} fill="none" stroke={lit ? colors.ring : 'rgba(169,226,255,0.5)'}
                        strokeWidth="1.2" opacity={0.4}
                        style={{ animation: 'pulse-ring 2s ease-in-out infinite' }} />
                      <circle r={displaySize + 28} fill="none" stroke={lit ? colors.ring : 'rgba(169,226,255,0.3)'}
                        strokeWidth="0.7" opacity={0.2}
                        style={{ animation: 'pulse-ring 2s ease-in-out infinite 0.5s' }} />
                    </>
                  )}

                  {/* Star body */}
                  <circle
                    r={displaySize}
                    fill={lit ? colors.lit : colors.dim}
                    stroke={lit ? colors.lit : 'rgba(255,255,255,0.15)'}
                    strokeWidth={lit ? 0 : 1}
                    filter={lit ? 'url(#glow-lit)' : undefined}
                    style={{ transition: 'fill 0.6s ease, r 0.4s ease' }}
                  />

                  {/* Cross sparkle rays for lit stars */}
                  {lit && (
                    <g opacity={isSelected ? 0.9 : 0.65} style={{ animation: `twinkle-star ${2 + node.size * 0.1}s ease-in-out infinite` }}>
                      {/* Long rays */}
                      <line x1={0} y1={-(displaySize + 12)} x2={0} y2={-(displaySize + 5)} stroke={colors.lit} strokeWidth="1.5" strokeLinecap="round" />
                      <line x1={0} y1={displaySize + 5}  x2={0} y2={displaySize + 12}  stroke={colors.lit} strokeWidth="1.5" strokeLinecap="round" />
                      <line x1={-(displaySize + 12)} y1={0} x2={-(displaySize + 5)} y2={0} stroke={colors.lit} strokeWidth="1.5" strokeLinecap="round" />
                      <line x1={displaySize + 5}  y1={0} x2={displaySize + 12}  y2={0} stroke={colors.lit} strokeWidth="1.5" strokeLinecap="round" />
                      {/* Diagonal short rays */}
                      <line x1={-(displaySize + 6) * 0.7} y1={-(displaySize + 6) * 0.7}
                            x2={-(displaySize + 2) * 0.7} y2={-(displaySize + 2) * 0.7}
                            stroke={colors.lit} strokeWidth="0.9" strokeLinecap="round" opacity={0.7} />
                      <line x1={(displaySize + 2) * 0.7}  y1={-(displaySize + 2) * 0.7}
                            x2={(displaySize + 6) * 0.7}  y2={-(displaySize + 6) * 0.7}
                            stroke={colors.lit} strokeWidth="0.9" strokeLinecap="round" opacity={0.7} />
                      <line x1={-(displaySize + 6) * 0.7} y1={(displaySize + 6) * 0.7}
                            x2={-(displaySize + 2) * 0.7} y2={(displaySize + 2) * 0.7}
                            stroke={colors.lit} strokeWidth="0.9" strokeLinecap="round" opacity={0.7} />
                      <line x1={(displaySize + 2) * 0.7}  y1={(displaySize + 2) * 0.7}
                            x2={(displaySize + 6) * 0.7}  y2={(displaySize + 6) * 0.7}
                            stroke={colors.lit} strokeWidth="0.9" strokeLinecap="round" opacity={0.7} />
                    </g>
                  )}

                  {/* Dim star center dot */}
                  {!lit && (
                    <circle r={Math.max(2, displaySize * 0.35)} fill="rgba(169,226,255,0.2)" />
                  )}

                  {/* Label */}
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{
                      fontFamily: "'Playfair Display', serif",
                      fontSize: displaySize > 18 ? 10 : displaySize > 13 ? 9 : 8,
                      fill: lit ? (node.type === 'letter' ? '#fff' : '#0B1A2C') : 'rgba(255,255,255,0.55)',
                      fontWeight: 700,
                      pointerEvents: 'none',
                      userSelect: 'none',
                      transition: 'fill 0.5s ease',
                    }}
                  >
                    {node.label}
                  </text>

                  {/* Sub-label */}
                  <text
                    y={displaySize + 11}
                    textAnchor="middle"
                    style={{
                      fontSize: 8,
                      fill: lit ? colors.lit : 'rgba(255,255,255,0.3)',
                      fontFamily: 'system-ui',
                      pointerEvents: 'none',
                      userSelect: 'none',
                      fontWeight: lit ? 600 : 400,
                      transition: 'fill 0.5s ease',
                    }}
                  >
                    {node.subLabel}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Zoom Controls */}
        <div className="absolute right-4 flex flex-col gap-2" style={{ top: 16, zIndex: 5 }}>
          {[{ dir: 'in' as const, icon: <ZoomIn size={15} /> }, { dir: 'out' as const, icon: <ZoomOut size={15} /> }].map(({ dir, icon }) => (
            <button key={dir} onClick={() => zoom(dir)}
              className="flex items-center justify-center rounded-xl"
              style={{ width: 34, height: 34, background: 'rgba(169,226,255,0.08)', border: '1px solid rgba(169,226,255,0.15)', color: 'rgba(169,226,255,0.7)' }}>
              {icon}
            </button>
          ))}
          <button onClick={reset}
            className="flex items-center justify-center rounded-xl"
            style={{ width: 34, height: 34, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>
            <RotateCcw size={13} />
          </button>
        </div>

        {/* Legend */}
        <div className="absolute left-3 flex flex-col gap-1.5"
          style={{ top: 16, background: 'rgba(5,12,26,0.75)', backdropFilter: 'blur(8px)', borderRadius: 12, padding: '8px 10px', border: '1px solid rgba(169,226,255,0.08)', zIndex: 5 }}>
          {(Object.entries(TYPE_STAR) as [CardType, typeof TYPE_STAR[CardType]][])
            .filter(([t]) => t !== 'suffix')
            .map(([type, c]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="rounded-full" style={{ width: 7, height: 7, background: c.lit, boxShadow: `0 0 4px ${c.lit}` }} />
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9 }}>{TYPE_LABELS[type]}</span>
              </div>
            ))}
          <div className="mt-1 pt-1.5 space-y-1" style={{ borderTop: '1px solid rgba(169,226,255,0.1)' }}>
            <div className="flex items-center gap-1.5">
              <div style={{ width: 14, height: 1, background: '#FFEBA2' }} />
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>包含</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div style={{ width: 14, height: 0, borderTop: '1px dashed rgba(169,226,255,0.6)' }} />
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>同根</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Selected Node Panel ── */}
      {selectedId && selectedCard && selectedNode && (() => {
        const lit = learnedIds.has(selectedId);
        const colors = TYPE_STAR[selectedNode.type];
        return (
          <div
            className="absolute left-0 right-0 mx-3 rounded-2xl overflow-hidden"
            style={{
              bottom: 12,
              background: 'rgba(8,18,35,0.97)',
              border: `1px solid ${lit ? colors.ring + '55' : 'rgba(169,226,255,0.12)'}`,
              boxShadow: lit ? `0 -8px 40px ${colors.glow}18` : '0 -8px 32px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(20px)',
              zIndex: 20,
              transition: 'border-color 0.5s ease, box-shadow 0.5s ease',
            }}
          >
            <div className="p-4">
              <div className="flex items-start justify-between mb-2.5">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {lit && (
                      <span style={{ fontSize: 14, filter: `drop-shadow(0 0 4px ${colors.lit})` }}>✦</span>
                    )}
                    <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: lit ? colors.lit : 'white', fontWeight: 700, transition: 'color 0.5s ease' }}>
                      {selectedCard.symbol}
                    </span>
                    {selectedCard.phonetic && (
                      <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>{selectedCard.phonetic}</span>
                    )}
                    <span className="rounded-full px-2 py-0.5" style={{ fontSize: 9, background: `${colors.lit}22`, color: colors.lit, fontWeight: 600, border: `1px solid ${colors.lit}44` }}>
                      {TYPE_LABELS[selectedNode.type]}
                    </span>
                  </div>
                  <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    {selectedCard.chineseMeaning}
                  </p>
                </div>
                <button onClick={() => setSelectedId(null)} style={{ color: 'rgba(255,255,255,0.25)', marginLeft: 8 }}>
                  <X size={16} />
                </button>
              </div>

              {/* Connected nodes */}
              <div className="flex gap-1.5 mb-3 flex-wrap">
                {EDGES.filter((e) => e.from === selectedId || e.to === selectedId).map((e) => {
                  const otherId = e.from === selectedId ? e.to : e.from;
                  const otherNode = INITIAL_NODES.find((n) => n.id === otherId);
                  if (!otherNode) return null;
                  const otherLit = learnedIds.has(otherId);
                  const oc = TYPE_STAR[otherNode.type];
                  return (
                    <button
                      key={e.id}
                      onClick={() => setSelectedId(otherId)}
                      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-all active:scale-95"
                      style={{
                        background: otherLit ? `${oc.lit}18` : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${otherLit ? oc.lit + '55' : 'rgba(255,255,255,0.12)'}`,
                        color: otherLit ? oc.lit : 'rgba(255,255,255,0.5)',
                      }}
                    >
                      <div className="rounded-full" style={{ width: 5, height: 5, background: oc.lit, boxShadow: otherLit ? `0 0 4px ${oc.lit}` : 'none' }} />
                      {otherNode.label}
                    </button>
                  );
                })}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                {!lit ? (
                  <button
                    onClick={() => markLearned(selectedId)}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 transition-all active:scale-[0.97]"
                    style={{ background: `linear-gradient(135deg, ${colors.lit}CC, ${colors.lit})`, color: '#0B1A2C', fontWeight: 700, fontSize: 13 }}
                  >
                    <Sparkles size={14} /> 点亮这颗星
                  </button>
                ) : (
                  <div
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5"
                    style={{ background: `${colors.lit}18`, border: `1px solid ${colors.lit}44`, color: colors.lit, fontSize: 13, fontWeight: 600 }}
                  >
                    <span style={{ filter: `drop-shadow(0 0 3px ${colors.lit})` }}>✦</span> 已点亮
                  </div>
                )}
                <button
                  onClick={() => navigate(`/word/${selectedId}`)}
                  className="flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 transition-all active:scale-[0.97]"
                  style={{ background: 'rgba(169,226,255,0.08)', border: '1px solid rgba(169,226,255,0.15)', color: 'rgba(169,226,255,0.8)', fontSize: 12, fontWeight: 500 }}
                >
                  查看卡片 <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes pulse-ring {
          0%, 100% { opacity: 0.25; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(1.06); }
        }
        @keyframes burst-ring {
          0%   { transform: scale(0.4); opacity: 0.8; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes bg-twinkle {
          0%, 100% { opacity: var(--tw-opacity, 0.12); }
          50% { opacity: calc(var(--tw-opacity, 0.12) * 3); }
        }
        @keyframes twinkle-star {
          0%, 100% { opacity: 0.65; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
