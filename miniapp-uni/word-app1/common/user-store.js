import { getWordById } from './word-repository.js'

export const USER_PROFILE_KEY = 'pictographic:userProfile'
export const USER_STATE_KEY = 'pictographic:userState'
export const FEEDBACKS_KEY = 'pictographic:feedbacks'
export const PENDING_WORD_ID_KEY = 'pictographic:pendingWordId'

const DEFAULT_PROFILE = {
  nickname: '象形英语学习者',
  avatarUrl: '',
  syncStatus: '本机保存'
}

const DEFAULT_STATE = {
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

export function getUserProfile() {
  return readStorage(USER_PROFILE_KEY, DEFAULT_PROFILE)
}

export function saveUserProfile(profile) {
  return writeStorage(USER_PROFILE_KEY, {
    ...getUserProfile(),
    ...profile
  })
}

export function getUserState() {
  const state = readStorage(USER_STATE_KEY, DEFAULT_STATE)
  return {
    ...state,
    recentWordIds: Array.isArray(state.recentWordIds) ? state.recentWordIds : [],
    favoriteWordIds: Array.isArray(state.favoriteWordIds) ? state.favoriteWordIds : [],
    searchCount: Number(state.searchCount) || 0,
    streakDays: Number(state.streakDays) || 0,
    lastActiveDate: state.lastActiveDate || ''
  }
}

export function saveUserState(state) {
  return writeStorage(USER_STATE_KEY, {
    ...DEFAULT_STATE,
    ...state
  })
}

export function addRecentWord(wordId, options = {}) {
  if (!getWordById(wordId)) {
    return getUserState()
  }
  const state = touchActiveDay(getUserState())
  const recentWordIds = [wordId, ...state.recentWordIds.filter((id) => id !== wordId)].slice(0, 12)
  const shouldCountSearch = options.countSearch !== false
  return saveUserState({
    ...state,
    recentWordIds,
    searchCount: shouldCountSearch ? state.searchCount + 1 : state.searchCount
  })
}

export function toggleFavorite(wordId) {
  const state = getUserState()
  const hasFavorite = state.favoriteWordIds.includes(wordId)
  const favoriteWordIds = hasFavorite
    ? state.favoriteWordIds.filter((id) => id !== wordId)
    : [wordId, ...state.favoriteWordIds]
  saveUserState({
    ...state,
    favoriteWordIds
  })
  return !hasFavorite
}

export function isFavorite(wordId) {
  return getUserState().favoriteWordIds.includes(wordId)
}

export function getRecentWords() {
  return getUserState()
    .recentWordIds.map((id) => getWordById(id))
    .filter((item) => item)
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
    .favoriteWordIds.map((id) => getWordById(id))
    .filter((item) => item)
}

export function getFeedbacks() {
  try {
    const feedbacks = uni.getStorageSync(FEEDBACKS_KEY)
    return Array.isArray(feedbacks) ? feedbacks : []
  } catch (error) {
    return []
  }
}

export function submitMissingWordFeedback(payload) {
  const word = (payload.missingWord || '').trim().toLowerCase()
  const feedback = {
    id: `feedback-${Date.now()}`,
    missingWord: word,
    bookPageHint: (payload.bookPageHint || '').trim(),
    note: (payload.note || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString()
  }
  const feedbacks = [feedback, ...getFeedbacks()].slice(0, 50)
  uni.setStorageSync(FEEDBACKS_KEY, feedbacks)
  return feedback
}

export function clearUserData() {
  uni.removeStorageSync(USER_PROFILE_KEY)
  uni.removeStorageSync(USER_STATE_KEY)
  uni.removeStorageSync(FEEDBACKS_KEY)
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
