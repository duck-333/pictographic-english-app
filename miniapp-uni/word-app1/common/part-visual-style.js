const PART_FALLBACK_STYLES = [
  {
    color: '#7C3AED',
    bgColor: '#F3F0FF',
    borderColor: '#C4B5FD'
  },
  {
    color: '#C9973A',
    bgColor: '#FFFBEB',
    borderColor: '#FCD34D'
  },
  {
    color: '#0E7490',
    bgColor: '#ECFEFF',
    borderColor: '#A5F3FC'
  },
  {
    color: '#2563EB',
    bgColor: '#EFF6FF',
    borderColor: '#BFDBFE'
  },
  {
    color: '#E11D48',
    bgColor: '#FFF1F2',
    borderColor: '#FECACA'
  }
]

function normalizeColorField(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function getPartFallbackStyle(index) {
  const safeIndex = Number(index)
  const normalizedIndex = Number.isFinite(safeIndex) && safeIndex >= 0 ? safeIndex : 0
  const style = PART_FALLBACK_STYLES[normalizedIndex % PART_FALLBACK_STYLES.length]
  return { ...style }
}

export function getPartVisualStyle(part, index) {
  const source = part && typeof part === 'object' ? part : {}
  const fallback = getPartFallbackStyle(index)
  return {
    color: normalizeColorField(source.color) || fallback.color,
    bgColor: normalizeColorField(source.bgColor) || fallback.bgColor,
    borderColor: normalizeColorField(source.borderColor) || fallback.borderColor
  }
}

export function buildPartChipStyle(part, index, options = {}) {
  const style = getPartVisualStyle(part, index)
  return `background-color:${style.bgColor};border-color:${options.selected ? style.color : style.borderColor};`
}

export function buildPartTextStyle(part, index) {
  const style = getPartVisualStyle(part, index)
  return `color:${style.color};`
}
