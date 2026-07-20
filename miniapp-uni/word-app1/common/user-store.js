import { getCachedPublishedRemoteWordById } from './word-repository.js'

export const USER_STATE_KEY = 'pictographic:userState'
export const PENDING_WORD_ID_KEY = 'pictographic:pendingWordId'
export const SEARCH_HISTORY_VERSION = 2

const DEFAULT_STATE = {
  searchHistoryVersion: SEARCH_HISTORY_VERSION,
  recentWordIds: [],
  favoriteWordIds: [],
  searchCount: 0,
  streakDays: 0,
  lastActiveDate: ''
}

function todayKey() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function yesterdayKey() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function readStorage(key, fallback) {
  try {
    const value = uni.getStorageSync(key)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ...fallback }
    }
    return { ...fallback, ...value }
  } catch (error) {
    return { ...fallback }
  }
}

function writeStorage(key, value) {
  uni.setStorageSync(key, value)
  return value
}

function normalizeHistoryId(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return String(value.id || value.word || '').trim()
  }
  return String(value || '').trim()
}

export function isBlockedLegacyHistoryId(value) {
  const id = normalizeHistoryId(value).toLowerCase()
  return (
    !id ||
    id === 'word-study' ||
    id.indexOf('mock-') === 0 ||
    id.indexOf('demo-') === 0
  )
}

function normalizeHistoryIds(values) {
  const result = []
  const used = {}
  ;(Array.isArray(values) ? values : []).forEach((value) => {
    const id = normalizeHistoryId(value)
    if (!id || isBlockedLegacyHistoryId(id) || used[id]) return
    used[id] = true
    result.push(id)
  })
  return result.slice(0, 12)
}

function normalizeFavoriteIds(values) {
  const result = []
  const used = {}
  ;(Array.isArray(values) ? values : []).forEach((value) => {
    const id = normalizeHistoryId(value)
    if (!id || isBlockedLegacyHistoryId(id) || used[id]) return
    used[id] = true
    result.push(id)
  })
  return result
}

function touchActiveDay(state) {
  const today = todayKey()
  if (state.lastActiveDate === today) {
    return state
  }
  const nextStreak = state.lastActiveDate === yesterdayKey() ? state.streakDays + 1 : 1
  return {
    ...state,
    lastActiveDate: today,
    streakDays: nextStreak
  }
}

export function getUserState() {
  const state = readStorage(USER_STATE_KEY, DEFAULT_STATE)
  const normalized = {
    ...state,
    searchHistoryVersion: SEARCH_HISTORY_VERSION,
    recentWordIds: normalizeHistoryIds(state.recentWordIds),
    favoriteWordIds: normalizeFavoriteIds(state.favoriteWordIds),
    searchCount: Number(state.searchCount) || 0,
    streakDays: Number(state.streakDays) || 0,
    lastActiveDate: state.lastActiveDate || ''
  }

  if (
    state.searchHistoryVersion !== SEARCH_HISTORY_VERSION ||
    JSON.stringify(state.recentWordIds || []) !== JSON.stringify(normalized.recentWordIds) ||
    JSON.stringify(state.favoriteWordIds || []) !== JSON.stringify(normalized.favoriteWordIds)
  ) {
    saveUserState(normalized)
  }

  return normalized
}

export function saveUserState(state) {
  return writeStorage(USER_STATE_KEY, {
    ...DEFAULT_STATE,
    ...state
  })
}

export function addRecentWord(wordId, options = {}) {
  const id = normalizeHistoryId(wordId)
  if (isBlockedLegacyHistoryId(id) || (!options.skipPublishedCacheCheck && !getCachedPublishedRemoteWordById(id))) {
    return getUserState()
  }
  const state = touchActiveDay(getUserState())
  const recentWordIds = [id, ...state.recentWordIds.filter((item) => item !== id)].slice(0, 12)
  const shouldCountSearch = options.countSearch !== false
  return saveUserState({
    ...state,
    recentWordIds,
    searchCount: shouldCountSearch ? state.searchCount + 1 : state.searchCount
  })
}

export function recordLearningActivity(options = {}) {
  const state = touchActiveDay(getUserState())
  const shouldCountSearch = options.countSearch !== false
  return saveUserState({
    ...state,
    searchCount: shouldCountSearch ? state.searchCount + 1 : state.searchCount
  })
}

export function toggleFavorite(wordId) {
  const id = normalizeHistoryId(wordId)
  if (isBlockedLegacyHistoryId(id)) return false
  const state = getUserState()
  const hasFavorite = state.favoriteWordIds.includes(id)
  const favoriteWordIds = hasFavorite
    ? state.favoriteWordIds.filter((item) => item !== id)
    : [id, ...state.favoriteWordIds]
  saveUserState({
    ...state,
    favoriteWordIds
  })
  return !hasFavorite
}

export function isFavorite(wordId) {
  const id = normalizeHistoryId(wordId)
  return !isBlockedLegacyHistoryId(id) && getUserState().favoriteWordIds.includes(id)
}

export function getRecentWordIds() {
  return getUserState().recentWordIds
}

export function getRecentWords() {
  return getUserState()
    .recentWordIds.map((id) => getCachedPublishedRemoteWordById(id))
    .filter((item) => item)
}

export function removeRecentWord(wordId) {
  const id = normalizeHistoryId(wordId)
  const state = getUserState()
  return saveUserState({
    ...state,
    recentWordIds: state.recentWordIds.filter((item) => item !== id)
  })
}

export function replaceRecentWordId(previousWordId, nextWordId) {
  const previousId = normalizeHistoryId(previousWordId)
  const nextId = normalizeHistoryId(nextWordId)
  if (!previousId || !nextId || isBlockedLegacyHistoryId(nextId)) return getUserState()
  const state = getUserState()
  const recentWordIds = state.recentWordIds
    .map((item) => (item === previousId ? nextId : item))
    .filter((item, index, list) => list.indexOf(item) === index)
  return saveUserState({
    ...state,
    recentWordIds
  })
}

export function clearRecentWords() {
  const state = getUserState()
  return saveUserState({
    ...state,
    recentWordIds: []
  })
}

export function getFavoriteWords() {
  return getUserState()
    .favoriteWordIds.map((id) => getCachedPublishedRemoteWordById(id))
    .filter((item) => item)
}

export function clearUserData() {
  uni.removeStorageSync(USER_STATE_KEY)
  uni.removeStorageSync(PENDING_WORD_ID_KEY)
}

export function savePendingWordId(wordId) {
  try {
    uni.setStorageSync(PENDING_WORD_ID_KEY, wordId || '')
  } catch (error) {}
}

export function getPendingWordId() {
  try {
    return uni.getStorageSync(PENDING_WORD_ID_KEY) || ''
  } catch (error) {
    return ''
  }
}
