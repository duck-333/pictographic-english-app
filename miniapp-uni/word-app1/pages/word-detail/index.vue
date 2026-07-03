<template>
  <view class="page">
    <view class="topbar">
      <button class="back-button" hover-class="button-pressed" @tap="goBack">返回</button>
      <view class="tools" v-if="word">
        <view
          class="tool-button"
          :class="{ active: bookmarked }"
          hover-class="button-pressed"
          @tap="toggleBookmark"
        >
          <text class="favorite-star">{{ bookmarked ? '★' : '☆' }}</text>
        </view>
      </view>
    </view>

    <view v-if="loading" class="empty-state">
      <view class="empty-mark">象</view>
      <text class="empty-title">正在加载词条</text>
      <text class="empty-description">正在从线上词库获取最新内容。</text>
    </view>

    <view v-else-if="word">
      <view v-if="loadErrorMessage" class="remote-warning">
        <text>{{ loadErrorMessage }}</text>
      </view>
      <view class="hero">
        <view class="type-badge">{{ word.cardType || '单词' }} · {{ word.level }}</view>
        <view class="word-line">
          <text class="word">{{ word.word }}</text>
          <text class="phonetic">{{ word.phonetic }}</text>
          <button
            v-if="hasPronunciationAudio"
            class="pronunciation-button"
            :class="{ active: pronunciationIsPlaying }"
            hover-class="audio-button-pressed"
            @tap.stop="togglePronunciationAudio"
          >
            <view class="speaker-icon">
              <view class="speaker-box"></view>
              <view class="speaker-cone"></view>
              <view class="speaker-wave one"></view>
              <view class="speaker-wave two"></view>
            </view>
          </button>
        </view>
        <text class="meaning">{{ word.meaning }}</text>
        <text v-if="word.bookPage" class="book-page">书中索引：第 {{ word.bookPage }} 页</text>
        <view class="hero-actions">
          <button
            v-if="hasVideoData"
            class="hero-video-button"
            hover-class="button-pressed"
            @tap="openVideoSection"
          >
            <view class="hero-play-icon">
              <view class="play-triangle tiny"></view>
            </view>
            <text>看视频讲解</text>
          </button>
          <button
            class="hero-outline-button"
            hover-class="button-pressed"
            data-target-id="section-breakdown"
            @tap="scrollToLearningSection"
          >
            看象形拆解
          </button>
        </view>
      </view>

      <scroll-view class="learning-tabs" scroll-x :show-scrollbar="false">
        <button
          v-for="tab in learningTabs"
          :key="tab.targetId"
          class="learning-tab"
          :class="{ highlight: tab.highlight }"
          hover-class="tab-pressed"
          :data-target-id="tab.targetId"
          @tap="scrollToLearningSection"
        >
          <text class="learning-tab-label">{{ tab.label }}</text>
          <text v-if="tab.hint" class="learning-tab-hint">{{ tab.hint }}</text>
        </button>
      </scroll-view>

      <view v-if="word.parts && word.parts.length" id="section-breakdown" class="section card">
        <text class="section-eyebrow">象形拆解</text>
        <view class="parts">
          <block v-for="part in displayParts" :key="part.text">
            <view
              class="part-chip"
              :class="{ selected: expandedPart === part.text }"
              :style="part.chipStyle"
              hover-class="chip-pressed"
              :data-part-text="part.text"
              :data-target-id="part.targetId || ''"
              @tap="handlePartTap"
            >
              <text class="part-text" :style="part.textStyle">{{ part.text }}</text>
              <text class="part-meaning">{{ part.meaning }}</text>
              <text v-if="part.targetId" class="part-action">点进</text>
            </view>
            <text v-if="part.showPlus" class="plus">+</text>
          </block>
        </view>
        <view v-if="expandedPart" class="part-detail">
          <text class="part-detail-title">{{ expandedPart }}</text>
          <text class="part-detail-text">{{ activePartMeaning }}</text>
          <text class="part-detail-link">该部分暂无关联词条。</text>
        </view>
      </view>

      <view v-else id="section-breakdown" class="section card">
        <text class="section-eyebrow">节点说明</text>
        <text class="desc">{{ word.tip }}</text>
      </view>

      <view id="section-imagery" class="section card">
        <view class="title-row">
          <text class="section-title">完整意象</text>
          <text v-if="fullImageryText" class="mini-action" hover-class="text-pressed" @tap="toggleDesc">{{ showFullDesc ? '收起' : '展开' }}</text>
        </view>
        <text v-if="fullImageryText" class="desc" :class="{ folded: !showFullDesc }">{{ fullImageryText }}</text>
        <text v-else class="desc imagery-empty">暂无完整意象说明。</text>
      </view>

      <view v-if="hasIllustrationImage" id="section-illustration" class="section card">
        <text class="section-title">示意图</text>
        <view v-if="!illustrationImageFailed" class="illustration-image-wrap" hover-class="image-pressed" @tap="previewIllustrationImage">
          <image
            class="illustration-image"
            :src="illustrationImage.url"
            mode="widthFix"
            :lazy-load="true"
            @error="handleIllustrationImageError"
          />
        </view>
        <text v-else class="illustration-error">图片暂时无法加载。</text>
        <text v-if="illustrationImageCaption" class="illustration-caption">{{ illustrationImageCaption }}</text>
      </view>

      <view v-if="displayExamples.length" id="section-examples" class="section card">
        <text class="section-title">例句</text>
        <view>
          <view v-for="item in displayExamples" :key="item.key" class="example">
            <text v-if="item.english" class="example-en">{{ item.english }}</text>
            <text v-if="item.chinese" class="example-cn">{{ item.chinese }}</text>
          </view>
        </view>
      </view>

      <view v-if="relatedWords.length" id="section-related" class="section card">
        <text class="section-title">同族词</text>
        <view class="related-list">
          <view
            v-for="item in relatedWords"
            :key="item.id"
            class="related-chip"
            hover-class="chip-pressed"
            :data-id="item.id"
            @tap="openDetailFromEvent"
          >
            <text class="related-word">{{ item.word }}</text>
            <text class="related-level">{{ item.level }}</text>
          </view>
        </view>
      </view>

      <view v-if="hasVideoData" id="section-video" class="section video-card">
        <view class="video-head">
          <view>
            <text class="video-title">{{ activeVideoTitle }}</text>
            <text class="video-meta">{{ activeVideoMeta }}</text>
          </view>
          <text class="video-status">{{ videoStatusText }}</text>
        </view>
        <view v-if="hasPlayableVideo" class="segment-player">
          <video
            id="lessonVideo"
            :key="activeVideoKey"
            class="lesson-video"
            :src="currentVideoUrl"
            :poster="activeVideoPoster"
            :initial-time="currentVideoInitialTime"
            :controls="isFullVideoMode"
            :show-center-play-btn="isFullVideoMode"
            :show-play-btn="isFullVideoMode"
            :show-progress="isFullVideoMode"
            :show-fullscreen-btn="isFullVideoMode"
            :show-mute-btn="false"
            :enable-progress-gesture="isFullVideoMode"
            :enable-play-gesture="isFullVideoMode"
            :vslide-gesture="isFullVideoMode"
            :vslide-gesture-in-fullscreen="isFullVideoMode"
            @tap="toggleVideoPlayback"
            @loadedmetadata="handleVideoLoadedMetadata"
            @canplay="handleVideoCanPlay"
            @error="handleVideoError"
            @play="handleVideoPlay"
            @pause="handleVideoPause"
            @timeupdate="handleVideoTimeUpdate"
            @ended="handleVideoEnded"
          ></video>
          <view v-if="!isFullVideoMode" class="segment-control-panel">
            <button class="segment-play-button" hover-class="button-pressed" @tap.stop="toggleActiveClipPlayback">
              <view v-if="clipIsPlaying" class="pause-bars">
                <view class="pause-bar"></view>
                <view class="pause-bar"></view>
              </view>
              <view v-else class="play-triangle small"></view>
            </button>
            <view class="segment-progress-wrap">
              <view class="segment-progress-head">
                <text class="segment-progress-title">{{ clipIsPlaying ? '正在播放当前片段' : '当前讲解片段' }}</text>
                <text class="segment-progress-time">{{ clipProgressText }}</text>
              </view>
              <slider
                class="segment-slider"
                :min="0"
                :max="activeClipDuration"
                :value="clipSliderValue"
                :step="1"
                activeColor="#fe8500"
                backgroundColor="rgba(255, 255, 255, 0.18)"
                block-color="#ffeba2"
                block-size="18"
                @changing="handleClipSliderChanging"
                @change="handleClipSliderChange"
              />
              <view class="segment-progress-bar">
                <view class="segment-progress-fill" :style="{ width: clipProgressPercent }"></view>
              </view>
            </view>
          </view>
          <view class="full-video-lock">
            <button
              v-if="hasPlayableFullVideo"
              class="full-video-button"
              hover-class="button-pressed"
              @tap.stop="toggleFullVideoPlayback"
            >
              {{ fullVideoButtonText }}
            </button>
            <text class="lock-text">{{ fullVideoHintText }}</text>
          </view>
        </view>
        <view v-else class="video-placeholder" @tap="showVideoTip">
          <view class="play-button">
            <view class="play-triangle"></view>
          </view>
          <text class="video-placeholder-text">{{ videoPlaceholderText }}</text>
        </view>
        <view v-if="displayVideoClips.length" class="clip-list">
          <view
            v-for="clip in displayVideoClips"
            :key="clip.clipId"
            class="clip-item"
            :class="{ active: clip.active }"
            hover-class="clip-pressed"
            :data-index="clip.index"
            @tap="selectVideoClip"
          >
            <view class="clip-main">
              <text class="clip-title">{{ clip.displayTitle }}</text>
              <text class="clip-focus">{{ clip.focus }}</text>
              <text class="clip-note">{{ clip.note }}</text>
            </view>
            <view class="clip-side">
              <text class="clip-part">{{ clip.targetPart }}</text>
              <text class="clip-time">{{ clip.rangeText }}</text>
            </view>
          </view>
        </view>
        <view v-else class="clip-empty">
          <text class="clip-empty-title">暂无视频讲解</text>
          <text class="clip-empty-text">暂无更多讲解内容。</text>
        </view>
      </view>
    </view>

    <view v-else class="empty-state">
      <view class="empty-mark">象</view>
      <text class="empty-title">{{ notFoundTitle }}</text>
      <text class="empty-description">{{ notFoundDescription }}</text>
    </view>

    <bottom-nav current="/pages/index/index" />
  </view>
</template>

<script>
import BottomNav from '../../components/BottomNav.vue'
import {
  fetchWordById,
  fetchWordByWord,
  getRelatedWords,
  isProductionIllustrationImageUrl,
  isPlayableMediaUrl
} from '../../common/word-repository.js'
import {
  getPartFallbackStyle as resolvePartFallbackStyle,
  getPartVisualStyle as resolvePartVisualStyle
} from '../../common/part-visual-style.js'
import { addRecentWord, getPendingWordId, isFavorite, savePendingWordId, toggleFavorite } from '../../common/user-store.js'

const ENABLE_VIDEO_MODULE = true

function normalizeDisplayText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function firstDisplayText(values) {
  for (let index = 0; index < values.length; index += 1) {
    const text = normalizeDisplayText(values[index])
    if (text) return text
  }
  return ''
}

function normalizeDisplayExample(example, index) {
  if (typeof example === 'string') {
    const english = normalizeDisplayText(example)
    return english ? { key: `example-${index}-${english}`, english, chinese: '' } : null
  }
  if (!example || typeof example !== 'object') return null

  const english = firstDisplayText([
    example.english,
    example.text,
    example.en,
    example.sentence
  ])
  const chinese = firstDisplayText([
    example.chinese,
    example.zh,
    example.translation
  ])
  if (!english && !chinese) return null

  return {
    key: `example-${index}-${english}-${chinese}`,
    english,
    chinese
  }
}

export default {
  components: {
    BottomNav
  },
  data() {
    return {
      word: null,
      relatedWords: [],
      bookmarked: false,
      expandedPart: '',
      activePartMeaning: '',
      showFullDesc: true,
      activeClipIndex: 0,
      videoPlaybackMode: 'clip',
      clipCurrentTime: 0,
      clipIsPlaying: false,
      fullVideoIsPlaying: false,
      enforcingClipBoundary: false,
      pausedAtClipEnd: false,
      clipPlaybackToken: 0,
      clipPlaybackTimer: null,
      pendingClipAutoplay: false,
      clipIsSeeking: false,
      resumeAfterSeeking: false,
      pronunciationAudioContext: null,
      pronunciationIsPlaying: false,
      illustrationImageFailed: false,
      loading: true,
      loadErrorMessage: '',
      notFoundQuery: '',
      notFoundTitle: '暂未收录这个单词',
      notFoundDescription: '这个单词还没有讲解内容。'
    }
  },
  onLoad(options) {
    this.loadWord(options)
  },
  onUnload() {
    this.clearClipPlaybackTimer()
    this.destroyPronunciationAudio()
  },
  onHide() {
    this.pauseActiveClip()
    this.stopPronunciationAudio()
  },
  computed: {
    fullImageryText() {
      const explanation = this.word ? this.word.explanation : ''
      return typeof explanation === 'string' ? explanation.trim() : ''
    },
    displayExamples() {
      const examples = this.word && Array.isArray(this.word.examples) ? this.word.examples : []
      return examples
        .map((example, index) => normalizeDisplayExample(example, index))
        .filter((example) => example)
    },
    illustrationImage() {
      const image = this.word && this.word.illustrationImage
      return image && typeof image === 'object' ? image : {}
    },
    hasIllustrationImage() {
      return isProductionIllustrationImageUrl(this.illustrationImage.url)
    },
    illustrationImageCaption() {
      return normalizeDisplayText(this.illustrationImage.alt || this.illustrationImage.title)
    },
    displayParts() {
      if (!this.word || !Array.isArray(this.word.parts) || !this.word.parts.length) {
        return []
      }
      return this.word.parts.map((part, index) => {
        const style = this.getPartVisualStyle(part, index)
        return {
          ...part,
          chipStyle: `background-color:${style.bgColor};border-color:${this.expandedPart === part.text ? style.color : style.borderColor};`,
          textStyle: `color:${style.color};`,
          showPlus: index < this.word.parts.length - 1
        }
      })
    },
    videoClips() {
      if (!this.word) return []
      if (Array.isArray(this.word.videoClips) && this.word.videoClips.length) {
        return this.word.videoClips
      }
      const legacyClip = this.word.videoSegment || this.word.video || {}
      if (this.hasVideoPayload(legacyClip)) {
        return [legacyClip]
      }
      return []
    },
    displayVideoClips() {
      return this.videoClips.map((clip, index) => {
        return {
          ...clip,
          index,
          active: index === this.activeClipIndex,
          clipId: clip.clipId || `clip-${index + 1}`,
          displayTitle: this.getVideoClipTitle(clip, index),
          focus: clip.focus || '讲解焦点待补充',
          targetPart: clip.targetPart || '整体',
          note: clip.note || '这个片段暂时没有补充说明。',
          rangeText: this.formatClipRange(clip)
        }
      })
    },
    hasVideoData() {
      return ENABLE_VIDEO_MODULE && this.videoClips.length > 0
    },
    learningTabs() {
      if (!this.word) return []
      const tabs = [
        {
          label: this.word.parts && this.word.parts.length ? '拆解' : '说明',
          targetId: 'section-breakdown',
          hint: this.word.parts && this.word.parts.length ? `${this.word.parts.length}块` : ''
        },
        { label: '意象', targetId: 'section-imagery', hint: '' }
      ]
      if (this.hasIllustrationImage) {
        tabs.push({
          label: '示意图',
          targetId: 'section-illustration',
          hint: ''
        })
      }
      if (this.displayExamples.length) {
        tabs.push({
          label: '例句',
          targetId: 'section-examples',
          hint: `${this.displayExamples.length}句`
        })
      }
      if (this.relatedWords.length) {
        tabs.push({ label: '同族词', targetId: 'section-related', hint: `${this.relatedWords.length}个` })
      }
      if (this.hasVideoData) {
        tabs.push({
          label: '视频',
          targetId: 'section-video',
          hint: `${this.videoClips.length}段`,
          highlight: true
        })
      }
      return tabs
    },
    activeVideo() {
      if (!this.hasVideoData) return {}
      return this.videoClips[this.activeClipIndex] || this.videoClips[0] || {}
    },
    activeVideoKey() {
      return `${this.videoPlaybackMode}-${this.currentVideoUrl || 'no-video'}`
    },
    activeVideoUrl() {
      const video = this.activeVideo || {}
      return String(video.videoUrl || video.url || '').trim()
    },
    isFullVideoMode() {
      return this.videoPlaybackMode === 'full'
    },
    fullVideoUrl() {
      const word = this.word || {}
      const fullVideo = word.fullVideo && typeof word.fullVideo === 'object' && !Array.isArray(word.fullVideo)
        ? word.fullVideo
        : {}
      return String(word.fullVideoUrl || fullVideo.videoUrl || fullVideo.url || this.activeVideoUrl || '').trim()
    },
    currentVideoUrl() {
      return this.isFullVideoMode ? this.fullVideoUrl : this.activeVideoUrl
    },
    currentVideoInitialTime() {
      return this.isFullVideoMode ? 0 : this.activeVideoStart
    },
    activeVideoPoster() {
      const video = this.activeVideo || {}
      return String(video.poster || video.videoPoster || video.video_poster || '').trim()
    },
    activeVideoTitle() {
      if (!this.hasVideoData) {
        return '暂无视频讲解'
      }
      const clipTitle = this.getVideoClipTitle(this.activeVideo, this.activeClipIndex)
      return this.word && (clipTitle || this.word.videoTitle)
        ? (clipTitle || this.word.videoTitle)
        : '讲解视频'
    },
    activeVideoStart() {
      const start = Number(this.activeVideo.startSec || 0)
      return Number.isNaN(start) ? 0 : start
    },
    activeVideoEnd() {
      const end = Number(this.activeVideo.endSec || 0)
      return Number.isNaN(end) ? 0 : end
    },
    activeClipHasValidRange() {
      return this.activeVideoEnd > this.activeVideoStart
    },
    effectiveVideoEnd() {
      if (this.activeClipHasValidRange) {
        return this.activeVideoEnd
      }
      return 0
    },
    activeClipDuration() {
      if (!this.activeClipHasValidRange) return 0
      return Math.max(this.effectiveVideoEnd - this.activeVideoStart, 1)
    },
    clipElapsedTime() {
      if (!this.activeClipDuration) return 0
      const elapsed = Number(this.clipCurrentTime || 0) - this.activeVideoStart
      return Math.min(Math.max(elapsed, 0), this.activeClipDuration)
    },
    clipProgressPercent() {
      if (!this.activeClipDuration) return '0%'
      const progress = Math.min(Math.max(this.clipElapsedTime / this.activeClipDuration, 0), 1)
      return `${Math.round(progress * 100)}%`
    },
    clipProgressText() {
      if (!this.activeClipDuration) return '待配置'
      return `${this.formatDurationLabel(this.clipElapsedTime)} / ${this.formatDurationLabel(this.activeClipDuration)}`
    },
    clipSliderValue() {
      if (!this.activeClipDuration) return 0
      return Math.round(this.clipElapsedTime)
    },
    clipDurationText() {
      if (!this.activeClipDuration) return '待配置'
      return this.formatDurationLabel(this.activeClipDuration)
    },
    activeVideoMeta() {
      if (!this.hasVideoData) {
        return '暂无片段'
      }
      if (!this.activeClipHasValidRange) {
        return '讲解片段'
      }
      const range = this.effectiveVideoEnd > this.activeVideoStart
        ? `${this.activeVideoStart}s - ${this.effectiveVideoEnd}s`
        : `从 ${this.activeVideoStart}s 开始`
      return range
    },
    hasPlayableVideo() {
      if (!ENABLE_VIDEO_MODULE || !this.hasVideoData) return false
      return isPlayableMediaUrl(this.activeVideoUrl) && this.activeClipHasValidRange
    },
    hasPlayableFullVideo() {
      return ENABLE_VIDEO_MODULE && this.hasVideoData && isPlayableMediaUrl(this.fullVideoUrl)
    },
    fullVideoButtonText() {
      if (!this.isFullVideoMode) return '看完整讲解'
      return this.fullVideoIsPlaying ? '暂停完整讲解' : '继续完整讲解'
    },
    fullVideoHintText() {
      if (!this.hasPlayableFullVideo) return `当前讲解片段时长 ${this.clipDurationText}。`
      return this.isFullVideoMode
        ? '正在播放完整视频，可使用视频控件查看进度。'
        : '从头播放当前片段所属视频。'
    },
    videoStatusText() {
      if (!this.hasVideoData) return '暂无视频'
      if (this.isFullVideoMode) return '完整讲解'
      if (!this.activeClipHasValidRange) return '片段待配置'
      return this.hasPlayableVideo ? '讲解片段' : '暂不可播放'
    },
    videoPlaceholderText() {
      if (!this.hasVideoData) {
        return '暂无视频讲解。'
      }
      if (!this.activeClipHasValidRange) {
        return '当前片段缺少有效结束秒，暂不播放，避免误放完整视频。'
      }
      if (this.activeVideoUrl && !this.hasPlayableVideo) {
        return '当前讲解暂不可播放。'
      }
      return '这个片段暂时没有可播放视频地址。'
    },
    pronunciationAudio() {
      if (!this.word) return {}
      return this.word.pronunciationAudio || this.word.audio || {}
    },
    pronunciationAudioUrl() {
      const audio = this.pronunciationAudio || {}
      const word = this.word || {}
      return String(audio.url || audio.audioUrl || word.audioUrl || '').trim()
    },
    hasPronunciationAudio() {
      return this.isPlayableAudioUrl(this.pronunciationAudioUrl)
    }
  },
  methods: {
    async loadWord(options) {
      this.stopPronunciationAudio()
      const optionValue = options && (options.id || options.word) ? options.id || options.word : ''
      const fallbackValue = optionValue || getPendingWordId() || ''
      const raw = decodeURIComponent(fallbackValue)
      const preferWordLookup = Boolean(options && options.word && !options.id)

      this.loading = true
      this.loadErrorMessage = ''
      this.word = null
      this.notFoundQuery = raw
      this.notFoundTitle = '词条暂未发布或已下架'
      this.notFoundDescription = '该词条当前没有可公开展示的内容。'
      this.resetWordViewState()

      let remote = null
      try {
        if (preferWordLookup) {
          remote = await fetchWordByWord(raw)
        } else {
          remote = await fetchWordById(raw)
          if (!remote && raw.indexOf('word-') !== 0 && raw.indexOf('node-') !== 0) {
            remote = await fetchWordByWord(raw)
          }
        }
      } catch (error) {
        const fallback = error && error.fallback && error.fallback.status === 'published'
          ? error.fallback
          : null
        if (fallback) {
          this.applyLoadedWord(fallback)
          this.loadErrorMessage = '线上词库暂时无法连接，当前显示本地备用内容。'
          this.loading = false
          return
        }
        this.notFoundTitle = '暂时无法加载词条'
        this.notFoundDescription = '线上词库连接失败，请检查网络后重试。'
        this.loading = false
        return
      }

      if (!remote || remote.status !== 'published') {
        this.loading = false
        return
      }

      this.applyLoadedWord(remote)
      this.loading = false
    },
    applyLoadedWord(word) {
      if (!word || word.status !== 'published') return
      this.word = word
      this.notFoundQuery = ''
      this.notFoundTitle = ''
      this.notFoundDescription = ''
      this.relatedWords = getRelatedWords(word)
      this.bookmarked = isFavorite(word.id)
      this.resetWordViewState()
      addRecentWord(word.id, {
        countSearch: false,
        skipPublishedCacheCheck: true
      })
    },
    resetWordViewState() {
      this.expandedPart = ''
      this.activePartMeaning = ''
      this.showFullDesc = true
      this.activeClipIndex = 0
      this.videoPlaybackMode = 'clip'
      this.clipCurrentTime = 0
      this.clipIsPlaying = false
      this.fullVideoIsPlaying = false
      this.enforcingClipBoundary = false
      this.pausedAtClipEnd = false
      this.pendingClipAutoplay = false
      this.clipIsSeeking = false
      this.resumeAfterSeeking = false
      this.pronunciationIsPlaying = false
      this.illustrationImageFailed = false
      this.clearClipPlaybackTimer()
    },
    toggleBookmark() {
      if (!this.word) return
      this.bookmarked = toggleFavorite(this.word.id)
      uni.showToast({
        title: this.bookmarked ? '已收藏' : '已取消收藏',
        icon: 'none'
      })
    },
    handlePartTap(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      const targetId = dataset.targetId || ''
      const partText = dataset.partText || ''
      if (targetId) {
        this.openDetail(targetId)
        return
      }
      this.togglePart(partText)
    },
    togglePart(partText) {
      if (!this.word || !partText) return
      if (this.expandedPart === partText) {
        this.expandedPart = ''
        this.activePartMeaning = ''
        return
      }
      const part = this.word.parts.find((item) => item.text === partText)
      this.expandedPart = partText
      this.activePartMeaning = part ? part.meaning : ''
    },
    getPartFallbackStyle(index) {
      return resolvePartFallbackStyle(index)
    },
    getPartVisualStyle(part, index) {
      return resolvePartVisualStyle(part, index)
    },
    toggleDesc() {
      this.showFullDesc = !this.showFullDesc
    },
    scrollToLearningSection(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      this.scrollToSection(dataset.targetId)
    },
    openVideoSection() {
      this.scrollToSection('section-video')
    },
    scrollToSection(targetId) {
      if (!targetId) return
      uni.pageScrollTo({
        selector: `#${targetId}`,
        duration: 260,
        fail: () => {
          uni.showToast({
            title: '暂时无法跳到这一块',
            icon: 'none'
          })
        }
      })
    },
    hasVideoPayload(clip) {
      const source = clip || {}
      return Boolean(
        source.videoUrl ||
          source.url ||
          source.assetId ||
          source.storagePath ||
          source.segmentTitle ||
          source.title ||
          source.focus ||
          source.targetPart ||
          source.note ||
          Number(source.startSec || 0) > 0 ||
          Number(source.endSec || 0) > 0
      )
    },
    getVideoClipTitle(clip, index = 0) {
      const source = clip || {}
      return String(source.title || source.segmentTitle || source.segment_title || `片段 ${index + 1}`).trim()
    },
    formatClipRange(clip) {
      const source = clip || {}
      const start = Number(source.startSec || 0)
      const end = Number(source.endSec || 0)
      const safeStart = Number.isNaN(start) ? 0 : start
      const safeEnd = Number.isNaN(end) ? 0 : end
      return safeEnd > safeStart ? `${safeStart}s - ${safeEnd}s` : `${safeStart}s - 待配置`
    },
    formatDurationLabel(seconds) {
      const safeSeconds = Math.max(Math.floor(Number(seconds || 0)), 0)
      const minutes = Math.floor(safeSeconds / 60)
      const remainSeconds = safeSeconds % 60
      return `${minutes}:${String(remainSeconds).padStart(2, '0')}`
    },
    clearClipPlaybackTimer() {
      if (this.clipPlaybackTimer) {
        clearTimeout(this.clipPlaybackTimer)
        this.clipPlaybackTimer = null
      }
      this.clipPlaybackToken += 1
    },
    scheduleClipPlayback(delay = 0, callback) {
      this.clearClipPlaybackTimer()
      const token = this.clipPlaybackToken
      this.clipPlaybackTimer = setTimeout(() => {
        if (token !== this.clipPlaybackToken) return
        this.clipPlaybackTimer = null
        if (!this.hasPlayableVideo) return
        if (typeof callback === 'function') {
          callback()
          return
        }
        this.playActiveClipFromStart()
      }, delay)
    },
    selectVideoClip(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      const index = Number(dataset.index)
      if (Number.isNaN(index) || index < 0 || index >= this.videoClips.length) return

      const previousUrl = this.activeVideoUrl
      this.activeClipIndex = index
      this.videoPlaybackMode = 'clip'
      this.clipCurrentTime = 0
      this.clipIsPlaying = false
      this.fullVideoIsPlaying = false
      this.enforcingClipBoundary = false
      this.pausedAtClipEnd = false
      this.pendingClipAutoplay = false
      this.clipIsSeeking = false
      this.resumeAfterSeeking = false
      this.clearClipPlaybackTimer()

      this.$nextTick(() => {
        if (!this.hasPlayableVideo) {
          this.showVideoTip()
          return
        }
        if (previousUrl && previousUrl !== this.activeVideoUrl) {
          this.pendingClipAutoplay = true
          this.scheduleClipPlayback(800, () => {
            this.pendingClipAutoplay = false
            this.playActiveClipFromStart()
          })
          return
        }
        this.scheduleClipPlayback(0)
      })
    },
    playActiveClipFromStart() {
      this.videoPlaybackMode = 'clip'
      this.fullVideoIsPlaying = false
      const context = this.getVideoContext()
      if (!context || !this.hasPlayableVideo) return
      this.clipIsSeeking = false
      this.resumeAfterSeeking = false
      this.pausedAtClipEnd = false
      this.enforcingClipBoundary = true
      this.clipCurrentTime = this.activeVideoStart
      this.clipIsPlaying = true
      context.seek(this.activeVideoStart)
      this.scheduleClipPlayback(120, () => {
        this.enforcingClipBoundary = false
        context.play()
      })
    },
    toggleVideoPlayback() {
      if (this.isFullVideoMode) {
        this.toggleFullVideoPlayback()
        return
      }
      this.toggleActiveClipPlayback()
    },
    toggleActiveClipPlayback() {
      if (!this.hasPlayableVideo) {
        this.showVideoTip()
        return
      }
      if (this.clipIsPlaying || this.clipPlaybackTimer) {
        this.pauseActiveClip()
        return
      }
      const currentTime = Number(this.clipCurrentTime || 0)
      const shouldRestart =
        this.pausedAtClipEnd ||
        currentTime < this.activeVideoStart - 0.4 ||
        currentTime >= this.effectiveVideoEnd - 0.15
      if (shouldRestart) {
        this.playActiveClipFromStart()
        return
      }
      this.resumeActiveClip()
    },
    playFullVideoFromStart() {
      if (!this.hasPlayableFullVideo) {
        this.showVideoTip()
        return
      }
      this.clearClipPlaybackTimer()
      this.videoPlaybackMode = 'full'
      this.clipIsPlaying = false
      this.fullVideoIsPlaying = false
      this.pendingClipAutoplay = false
      this.clipIsSeeking = false
      this.resumeAfterSeeking = false
      this.pausedAtClipEnd = false
      this.enforcingClipBoundary = false

      this.$nextTick(() => {
        const context = this.getVideoContext()
        if (!context) return
        context.seek(0)
        setTimeout(() => {
          if (!this.isFullVideoMode) return
          context.play()
        }, 120)
      })
    },
    toggleFullVideoPlayback() {
      if (!this.hasPlayableFullVideo) {
        this.showVideoTip()
        return
      }
      if (!this.isFullVideoMode) {
        this.playFullVideoFromStart()
        return
      }
      const context = this.getVideoContext()
      if (!context) return
      if (this.fullVideoIsPlaying) {
        this.fullVideoIsPlaying = false
        context.pause()
        return
      }
      context.play()
    },
    resumeActiveClip() {
      this.videoPlaybackMode = 'clip'
      this.fullVideoIsPlaying = false
      const context = this.getVideoContext()
      if (!context || !this.hasPlayableVideo) return
      const targetTime = this.getClampedClipTime(this.clipCurrentTime || this.activeVideoStart)
      this.clipIsSeeking = false
      this.resumeAfterSeeking = false
      this.pausedAtClipEnd = false
      this.enforcingClipBoundary = true
      this.clipCurrentTime = targetTime
      this.clipIsPlaying = true
      context.seek(targetTime)
      this.scheduleClipPlayback(120, () => {
        this.enforcingClipBoundary = false
        context.play()
      })
    },
    getClampedClipTime(time) {
      const safeTime = Number(time || 0)
      if (Number.isNaN(safeTime)) return this.activeVideoStart
      return Math.min(Math.max(safeTime, this.activeVideoStart), this.effectiveVideoEnd)
    },
    getClipSliderEventValue(event) {
      const detail = event && event.detail ? event.detail : {}
      const value = Number(detail.value || 0)
      if (Number.isNaN(value)) return 0
      return Math.min(Math.max(value, 0), this.activeClipDuration)
    },
    handleClipSliderChanging(event) {
      if (!this.hasPlayableVideo) return
      const value = this.getClipSliderEventValue(event)
      if (!this.clipIsSeeking) {
        this.resumeAfterSeeking = this.clipIsPlaying
        this.clearClipPlaybackTimer()
        const context = this.getVideoContext()
        if (context) {
          context.pause()
        }
      }
      this.clipIsSeeking = true
      this.pausedAtClipEnd = false
      this.clipCurrentTime = this.activeVideoStart + value
    },
    handleClipSliderChange(event) {
      if (!this.hasPlayableVideo) return
      const value = this.getClipSliderEventValue(event)
      this.seekActiveClipToOffset(value, { autoplay: this.resumeAfterSeeking })
    },
    seekActiveClipToOffset(offsetSeconds, options = {}) {
      const context = this.getVideoContext()
      if (!context || !this.hasPlayableVideo) return
      const offset = Math.min(Math.max(Number(offsetSeconds || 0), 0), this.activeClipDuration)
      const targetTime = this.getClampedClipTime(this.activeVideoStart + offset)
      const shouldAutoplay = Boolean(options.autoplay && targetTime < this.effectiveVideoEnd - 0.15)
      this.clearClipPlaybackTimer()
      this.clipIsSeeking = false
      this.resumeAfterSeeking = false
      this.pausedAtClipEnd = targetTime >= this.effectiveVideoEnd - 0.15
      this.enforcingClipBoundary = true
      this.clipCurrentTime = targetTime
      context.seek(targetTime)
      this.scheduleClipPlayback(120, () => {
        this.enforcingClipBoundary = false
        if (shouldAutoplay) {
          context.play()
          return
        }
        context.pause()
      })
    },
    getVideoContext() {
      if (!this.hasPlayableVideo && !this.hasPlayableFullVideo) return null
      return uni.createVideoContext('lessonVideo', this)
    },
    pauseActiveClip() {
      if (this.isFullVideoMode) {
        this.fullVideoIsPlaying = false
        const context = this.getVideoContext()
        if (context) {
          context.pause()
        }
        return
      }
      this.pendingClipAutoplay = false
      this.clipIsSeeking = false
      this.resumeAfterSeeking = false
      this.clipIsPlaying = false
      this.clearClipPlaybackTimer()
      const context = this.getVideoContext()
      if (context) {
        context.pause()
      }
    },
    showVideoTip() {
      uni.showToast({
        title: this.videoPlaceholderText,
        icon: 'none'
      })
    },
    handleIllustrationImageError() {
      this.illustrationImageFailed = true
    },
    previewIllustrationImage() {
      if (!this.hasIllustrationImage || this.illustrationImageFailed) return
      uni.previewImage({
        current: this.illustrationImage.url,
        urls: [this.illustrationImage.url],
        fail: () => {
          uni.showToast({
            title: '图片暂时无法预览',
            icon: 'none'
          })
        }
      })
    },
    isPlayableAudioUrl(url) {
      return isPlayableMediaUrl(url)
    },
    getPronunciationAudioContext() {
      if (this.pronunciationAudioContext) return this.pronunciationAudioContext
      if (!uni.createInnerAudioContext) return null

      const context = uni.createInnerAudioContext()
      context.autoplay = false
      context.obeyMuteSwitch = false
      context.onPlay(() => {
        this.pronunciationIsPlaying = true
      })
      context.onPause(() => {
        this.pronunciationIsPlaying = false
      })
      context.onStop(() => {
        this.pronunciationIsPlaying = false
      })
      context.onEnded(() => {
        this.pronunciationIsPlaying = false
      })
      context.onError(() => {
        this.pronunciationIsPlaying = false
        uni.showToast({
          title: '发音音频暂时无法播放，请检查音频地址',
          icon: 'none'
        })
      })
      this.pronunciationAudioContext = context
      return context
    },
    togglePronunciationAudio() {
      if (!this.hasPronunciationAudio) return
      if (this.pronunciationIsPlaying) {
        this.stopPronunciationAudio()
        return
      }
      const context = this.getPronunciationAudioContext()
      if (!context) return
      context.src = this.pronunciationAudioUrl
      context.play()
    },
    stopPronunciationAudio() {
      if (!this.pronunciationAudioContext) return
      this.pronunciationIsPlaying = false
      if (this.pronunciationAudioContext.stop) {
        this.pronunciationAudioContext.stop()
      } else if (this.pronunciationAudioContext.pause) {
        this.pronunciationAudioContext.pause()
      }
    },
    destroyPronunciationAudio() {
      this.stopPronunciationAudio()
      if (this.pronunciationAudioContext && this.pronunciationAudioContext.destroy) {
        this.pronunciationAudioContext.destroy()
      }
      this.pronunciationAudioContext = null
    },
    handleVideoLoadedMetadata() {
      const context = this.getVideoContext()
      if (!context) return
      if (this.isFullVideoMode) {
        this.enforcingClipBoundary = false
        this.clipIsPlaying = false
        return
      }
      this.clipCurrentTime = this.activeVideoStart
      this.clipIsPlaying = false
      this.enforcingClipBoundary = true
      context.seek(this.activeVideoStart)
      const token = this.clipPlaybackToken
      setTimeout(() => {
        if (token !== this.clipPlaybackToken) return
        this.enforcingClipBoundary = false
      }, 180)
    },
    handleVideoCanPlay() {
      if (this.isFullVideoMode) return
      if (!this.pendingClipAutoplay) return
      this.pendingClipAutoplay = false
      this.playActiveClipFromStart()
    },
    handleVideoTimeUpdate(event) {
      if (this.isFullVideoMode) return
      if (!this.hasPlayableVideo) return
      const detail = event && event.detail ? event.detail : {}
      const currentTime = Number(detail.currentTime || 0)
      if (Number.isNaN(currentTime)) return
      if (this.clipIsSeeking) return
      this.clipCurrentTime = currentTime

      if (this.enforcingClipBoundary) return

      if (currentTime < this.activeVideoStart - 0.4) {
        const context = this.getVideoContext()
        if (context) {
          this.enforcingClipBoundary = true
          context.seek(this.activeVideoStart)
          const token = this.clipPlaybackToken
          setTimeout(() => {
            if (token !== this.clipPlaybackToken) return
            this.enforcingClipBoundary = false
          }, 160)
        }
        return
      }

      if (this.pausedAtClipEnd) {
        if (currentTime < this.effectiveVideoEnd - 0.5) {
          this.pausedAtClipEnd = false
        } else {
          return
        }
      }

      if (currentTime < this.effectiveVideoEnd - 0.15) return

      this.pausedAtClipEnd = true
      this.clipCurrentTime = this.effectiveVideoEnd
      this.clipIsPlaying = false
      const context = this.getVideoContext()
      if (context) {
        context.pause()
      }
    },
    handleVideoPlay() {
      if (this.isFullVideoMode) {
        this.fullVideoIsPlaying = true
        this.clipIsPlaying = false
        return
      }
      if (this.pausedAtClipEnd || this.clipCurrentTime < this.activeVideoStart - 0.4) {
        this.playActiveClipFromStart()
        return
      }
      this.clipIsPlaying = true
      this.pausedAtClipEnd = false
    },
    handleVideoPause() {
      if (this.isFullVideoMode) {
        this.fullVideoIsPlaying = false
        return
      }
      this.clipIsPlaying = false
    },
    handleVideoEnded() {
      if (this.isFullVideoMode) {
        this.fullVideoIsPlaying = false
        return
      }
      this.clipIsPlaying = false
      this.pausedAtClipEnd = true
    },
    handleVideoError() {
      this.clipIsPlaying = false
      this.fullVideoIsPlaying = false
      uni.showToast({
        title: '视频暂时无法播放，请检查视频地址或小程序合法域名配置',
        icon: 'none'
      })
    },
    openDetailFromEvent(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {}
      this.openDetail(dataset.id)
    },
    openDetail(id) {
      if (!id) return
      savePendingWordId(id)
      uni.navigateTo({
        url: `/pages/word-detail/index?id=${id}`
      })
    },
    goBack() {
      uni.navigateBack({
        fail: () => {
          uni.reLaunch({ url: '/pages/index/index' })
        }
      })
    },
    goHome() {
      uni.reLaunch({
        url: '/pages/index/index'
      })
    },
    goMine() {
      uni.reLaunch({
        url: '/pages/mine/index'
      })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 88rpx 32rpx calc(188rpx + env(safe-area-inset-bottom));
  background: #f0f9ff;
}

.remote-warning {
  margin-bottom: 20rpx;
  padding: 18rpx 22rpx;
  border: 2rpx solid rgba(254, 133, 0, 0.28);
  border-radius: 22rpx;
  background: #fff7df;
  color: #8a4b00;
  font-size: 22rpx;
  line-height: 1.6;
}

.topbar,
.tools,
.title-row,
.related-list,
.hero-actions,
.hero-video-button,
.hero-outline-button,
.hero-play-icon {
  display: flex;
  align-items: center;
}

.topbar {
  justify-content: space-between;
  margin-bottom: 24rpx;
}

.tools {
  gap: 16rpx;
}

.back-button,
.tool-button {
  margin: 0;
  border-radius: 24rpx;
  background: #ffffff;
  color: #0e3a5c;
  font-size: 26rpx;
  box-shadow: 0 4rpx 12rpx rgba(14, 58, 92, 0.06);
}

.back-button {
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 28rpx;
}

.tool-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  transition: background-color 0.16s ease, box-shadow 0.16s ease;
}

.tool-button.active {
  background: #fff7df;
  box-shadow: 0 6rpx 18rpx rgba(254, 133, 0, 0.14);
}

.favorite-star {
  color: #6baed6;
  font-size: 44rpx;
  line-height: 1;
}

.tool-button.active .favorite-star {
  color: #fe8500;
}

.hero {
  position: relative;
  overflow: hidden;
  padding: 40rpx;
  border-radius: 32rpx;
  background: linear-gradient(140deg, #0e3a5c 0%, #1a5a8a 100%);
  box-shadow: 0 24rpx 64rpx rgba(14, 58, 92, 0.22);
}

.type-badge {
  display: inline-block;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.72);
  font-size: 22rpx;
}

.word-line {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 18rpx;
  margin-top: 24rpx;
}

.word {
  color: #ffffff;
  font-size: 76rpx;
  font-weight: 900;
  line-height: 1;
}

.phonetic {
  margin-bottom: 8rpx;
  color: rgba(255, 255, 255, 0.54);
  font-size: 26rpx;
}

.pronunciation-button {
  position: relative;
  flex-shrink: 0;
  width: 48rpx;
  height: 48rpx;
  margin: 0 0 2rpx;
  padding: 0;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.14);
  border: 2rpx solid rgba(255, 255, 255, 0.2);
  line-height: 1;
}

.pronunciation-button::after {
  border: 0;
}

.pronunciation-button.active {
  background: #ffeba2;
  border-color: #ffeba2;
}

.speaker-icon,
.speaker-box,
.speaker-cone,
.speaker-wave {
  position: absolute;
}

.speaker-icon {
  left: 10rpx;
  top: 11rpx;
  width: 28rpx;
  height: 26rpx;
}

.speaker-box {
  left: 0;
  top: 8rpx;
  width: 8rpx;
  height: 10rpx;
  border-radius: 3rpx 0 0 3rpx;
  background: #ffeba2;
}

.speaker-cone {
  left: 7rpx;
  top: 5rpx;
  width: 0;
  height: 0;
  border-top: 8rpx solid transparent;
  border-bottom: 8rpx solid transparent;
  border-right: 12rpx solid #ffeba2;
}

.speaker-wave {
  border: 3rpx solid #ffeba2;
  border-left: 0;
  border-top-color: transparent;
  border-bottom-color: transparent;
  border-radius: 0 999rpx 999rpx 0;
}

.speaker-wave.one {
  left: 19rpx;
  top: 8rpx;
  width: 6rpx;
  height: 10rpx;
}

.speaker-wave.two {
  left: 22rpx;
  top: 4rpx;
  width: 10rpx;
  height: 18rpx;
  opacity: 0.72;
}

.pronunciation-button.active .speaker-box {
  background: #0e3a5c;
}

.pronunciation-button.active .speaker-cone {
  border-right-color: #0e3a5c;
}

.pronunciation-button.active .speaker-wave {
  border-right-color: #0e3a5c;
}

.meaning,
.book-page {
  display: block;
}

.meaning {
  margin-top: 24rpx;
  color: rgba(255, 255, 255, 0.86);
  font-size: 28rpx;
  line-height: 1.65;
}

.book-page {
  margin-top: 14rpx;
  color: rgba(255, 235, 162, 0.78);
  font-size: 22rpx;
}

.hero-actions {
  position: relative;
  z-index: 1;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 28rpx;
}

.hero-video-button,
.hero-outline-button {
  justify-content: center;
  min-width: 216rpx;
  min-height: 76rpx;
  margin: 0;
  padding: 14rpx 28rpx;
  border-radius: 999rpx;
  font-size: 26rpx;
  font-weight: 900;
  line-height: 1.2;
}

.hero-video-button {
  gap: 12rpx;
  background: #ffeba2;
  color: #0e3a5c;
  box-shadow: 0 14rpx 34rpx rgba(0, 0, 0, 0.16);
}

.hero-outline-button {
  border: 2rpx solid rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.hero-play-icon {
  position: relative;
  justify-content: center;
  width: 34rpx;
  height: 34rpx;
  border-radius: 999rpx;
  background: #0e3a5c;
}

.play-triangle.tiny {
  top: 9rpx;
  left: 13rpx;
  border-top-width: 8rpx;
  border-bottom-width: 8rpx;
  border-left-width: 12rpx;
  border-left-color: #ffeba2;
}

.learning-tabs {
  width: 100%;
  margin: 22rpx 0 4rpx;
  white-space: nowrap;
}

.learning-tab {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  min-height: 68rpx;
  margin: 0 12rpx 0 0;
  padding: 0 24rpx;
  border: 2rpx solid #dbeeff;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.88);
  color: #0e3a5c;
  line-height: 1.2;
  vertical-align: top;
  box-shadow: 0 6rpx 18rpx rgba(14, 58, 92, 0.05);
}

.learning-tab.highlight {
  border-color: rgba(254, 133, 0, 0.34);
  background: #fff7df;
}

.learning-tab-label {
  font-size: 25rpx;
  font-weight: 900;
}

.learning-tab-hint {
  color: #6baed6;
  font-size: 20rpx;
  font-weight: 700;
}

.section {
  margin-top: 24rpx;
  padding: 30rpx;
}

.card {
  border-radius: 28rpx;
  background: #ffffff;
  box-shadow: 0 4rpx 16rpx rgba(14, 58, 92, 0.06);
}

.section-eyebrow {
  color: #6baed6;
  font-size: 24rpx;
  font-weight: 800;
}

.section-title {
  display: block;
  color: #0e3a5c;
  font-size: 30rpx;
  font-weight: 800;
}

.parts {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 24rpx;
}

.part-chip {
  min-width: 116rpx;
  padding: 16rpx;
  border: 3rpx solid;
  border-radius: 22rpx;
  text-align: center;
  box-shadow: 0 8rpx 20rpx rgba(14, 58, 92, 0.06);
}

.part-chip.selected {
  transform: translateY(-6rpx);
  box-shadow: 0 12rpx 28rpx rgba(14, 58, 92, 0.12);
}

.part-text,
.part-meaning,
.desc,
.example-en,
.example-cn,
.video-title,
.video-meta,
.part-detail-title,
.part-detail-text,
.part-detail-link,
.mini-action,
.related-word,
.related-level {
  display: block;
}

.part-text {
  font-size: 34rpx;
  font-weight: 900;
}

.part-meaning {
  margin-top: 6rpx;
  color: #315c82;
  font-size: 20rpx;
}

.part-action {
  display: inline-block;
  margin-top: 8rpx;
  padding: 3rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.62);
  color: #0e3a5c;
  font-size: 18rpx;
  font-weight: 800;
}

.plus {
  color: #7bbfe8;
  font-size: 36rpx;
  font-weight: 900;
}

.imagery-empty {
  color: #6baed6;
}

.illustration-image-wrap {
  margin-top: 20rpx;
  overflow: hidden;
  border-radius: 22rpx;
  background: #f5fbff;
}

.illustration-image {
  display: block;
  width: 100%;
  max-width: 100%;
}

.illustration-caption,
.illustration-error {
  display: block;
  margin-top: 14rpx;
  color: #6baed6;
  font-size: 23rpx;
  line-height: 1.65;
}

.illustration-error {
  padding: 24rpx;
  border-radius: 20rpx;
  background: #f5fbff;
  text-align: center;
}

.image-pressed {
  opacity: 0.86;
}

.part-detail {
  margin-top: 24rpx;
  padding: 22rpx;
  border: 2rpx solid #dbeeff;
  border-radius: 22rpx;
  background: #f5fbff;
}

.part-detail-title {
  color: #0e3a5c;
  font-size: 32rpx;
  font-weight: 800;
}

.part-detail-text {
  margin-top: 8rpx;
  color: #315c82;
  font-size: 26rpx;
}

.part-detail-link {
  margin-top: 10rpx;
  color: #fe8500;
  font-size: 22rpx;
}

.title-row {
  justify-content: space-between;
}

.mini-action {
  color: #fe8500;
  font-size: 24rpx;
}

.desc {
  margin-top: 18rpx;
  color: #315c82;
  font-size: 28rpx;
  line-height: 1.8;
}

.desc.folded {
  max-height: 140rpx;
  overflow: hidden;
}

.example {
  margin-top: 18rpx;
  padding: 20rpx;
  border-radius: 22rpx;
  background: #f5fbff;
}

.example-en {
  color: #0e3a5c;
  font-size: 26rpx;
  line-height: 1.6;
}

.example-cn {
  margin-top: 8rpx;
  color: #6baed6;
  font-size: 24rpx;
  line-height: 1.5;
}

.related-list {
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 20rpx;
}

.related-chip {
  min-width: 172rpx;
  padding: 18rpx 20rpx;
  border: 2rpx solid #a9e2ff;
  border-radius: 22rpx;
  background: #ebf8ff;
}

.related-word {
  color: #0e3a5c;
  font-size: 28rpx;
  font-weight: 800;
}

.related-level {
  margin-top: 6rpx;
  color: #6baed6;
  font-size: 20rpx;
}

.video-card {
  border-radius: 32rpx;
  background: #0e3a5c;
}

.video-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}

.video-title {
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 800;
}

.video-meta {
  margin-top: 8rpx;
  color: rgba(255, 255, 255, 0.58);
  font-size: 24rpx;
}

.video-status {
  flex-shrink: 0;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 235, 162, 0.16);
  color: #ffeba2;
  font-size: 22rpx;
  font-weight: 800;
}

.lesson-video {
  width: 100%;
  height: 360rpx;
  margin-top: 24rpx;
  border-radius: 24rpx;
  overflow: hidden;
  background: #08263d;
}

.segment-player {
  margin-top: 24rpx;
}

.segment-control-panel {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-top: 16rpx;
  padding: 18rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.1);
}

.segment-play-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 78rpx;
  height: 78rpx;
  margin: 0;
  padding: 0;
  border-radius: 999rpx;
  background: #ffeba2;
}

.pause-bars {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
}

.pause-bar {
  width: 9rpx;
  height: 30rpx;
  border-radius: 999rpx;
  background: #0e3a5c;
}

.segment-progress-wrap {
  flex: 1;
  min-width: 0;
}

.segment-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
}

.segment-progress-title {
  color: #ffffff;
  font-size: 24rpx;
  font-weight: 800;
}

.segment-progress-time {
  color: rgba(255, 255, 255, 0.62);
  font-size: 22rpx;
}

.segment-slider {
  margin: 6rpx -8rpx 0;
}

.segment-progress-bar {
  height: 10rpx;
  margin-top: -8rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.18);
}

.segment-progress-fill {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #ffeba2, #fe8500);
  transition: width 0.16s ease;
}

.full-video-lock {
  margin-top: 14rpx;
  padding: 16rpx 18rpx;
  border: 2rpx solid rgba(255, 235, 162, 0.18);
  border-radius: 22rpx;
  background: rgba(8, 38, 61, 0.46);
}

.lock-title,
.lock-text {
  display: block;
}

.lock-title {
  color: #ffeba2;
  font-size: 23rpx;
  font-weight: 800;
}

.full-video-button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64rpx;
  margin: 0;
  padding: 0 24rpx;
  border-radius: 18rpx;
  background: #ffeba2;
  color: #0e3a5c;
  font-size: 24rpx;
  font-weight: 900;
  line-height: 1.2;
}

.full-video-button::after {
  border: 0;
}

.lock-text {
  margin-top: 6rpx;
  color: rgba(255, 255, 255, 0.62);
  font-size: 21rpx;
  line-height: 1.45;
}

.video-placeholder {
  display: flex;
  align-items: center;
  gap: 22rpx;
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.1);
}

.video-placeholder-text {
  flex: 1;
  color: rgba(255, 255, 255, 0.72);
  font-size: 24rpx;
  line-height: 1.5;
}

.clip-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 24rpx;
}

.clip-item {
  display: flex;
  justify-content: space-between;
  gap: 18rpx;
  padding: 20rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.1);
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.08);
}

.clip-item.active {
  border-color: rgba(255, 235, 162, 0.76);
  background: rgba(255, 235, 162, 0.16);
}

.clip-main {
  flex: 1;
}

.clip-title,
.clip-focus,
.clip-note,
.clip-part,
.clip-time,
.clip-empty-title,
.clip-empty-text {
  display: block;
}

.clip-title {
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 800;
}

.clip-focus {
  margin-top: 8rpx;
  color: rgba(255, 255, 255, 0.72);
  font-size: 23rpx;
  line-height: 1.45;
}

.clip-note {
  margin-top: 8rpx;
  color: rgba(169, 226, 255, 0.8);
  font-size: 21rpx;
  line-height: 1.45;
}

.clip-side {
  flex-shrink: 0;
  width: 138rpx;
  text-align: right;
}

.clip-part {
  color: #ffeba2;
  font-size: 24rpx;
  font-weight: 900;
}

.clip-time {
  margin-top: 10rpx;
  color: rgba(255, 255, 255, 0.64);
  font-size: 20rpx;
}

.clip-empty {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.08);
  text-align: center;
}

.clip-empty-title {
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 800;
}

.clip-empty-text {
  margin-top: 8rpx;
  color: rgba(255, 255, 255, 0.64);
  font-size: 23rpx;
}

.play-button {
  position: relative;
  flex-shrink: 0;
  width: 84rpx;
  height: 84rpx;
  margin: 0;
  border-radius: 999rpx;
  background: #ffeba2;
}

.play-triangle {
  position: absolute;
  top: 27rpx;
  left: 34rpx;
  width: 0;
  height: 0;
  border-top: 15rpx solid transparent;
  border-bottom: 15rpx solid transparent;
  border-left: 22rpx solid #0e3a5c;
}

.play-triangle.small {
  top: 24rpx;
  left: 31rpx;
  border-top-width: 14rpx;
  border-bottom-width: 14rpx;
  border-left-width: 20rpx;
}

.button-pressed,
.audio-button-pressed,
.chip-pressed,
.text-pressed,
.clip-pressed {
  opacity: 0.76;
  transform: scale(0.98);
}

.tab-pressed {
  opacity: 0.78;
  transform: translateY(2rpx);
}
</style>
