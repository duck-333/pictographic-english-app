<template>
	<view class="admin-page">
		<view class="hero">
			<view>
				<view class="eyebrow">Pictographic English Admin</view>
				<text class="title">象形英语内容工作台</text>
				<text class="subtitle">本阶段先做本地后台原型，不绑定云空间，也不会影响用户端小程序。</text>
			</view>
			<view class="hero-actions">
				<button class="ghost-button" @click="resetDraft">恢复示例数据</button>
				<button class="outline-button" @click="saveDraft">保存全部本地草稿</button>
				<button class="publish-all-button" @click="publishAllDrafts">发布全部草稿</button>
			</view>
		</view>

		<view class="status-grid">
			<view class="status-card">
				<text class="status-value">{{ stats.total }}</text>
				<text class="status-label">词条总数</text>
			</view>
			<view class="status-card">
				<text class="status-value">{{ stats.published }}</text>
				<text class="status-label">已发布</text>
			</view>
			<view class="status-card">
				<text class="status-value">{{ stats.draft }}</text>
				<text class="status-label">草稿</text>
			</view>
			<view class="status-card accent">
				<text class="status-value">{{ stats.nodes }}</text>
				<text class="status-label">拆解节点</text>
			</view>
		</view>

		<view class="workbench">
			<view class="panel list-panel">
				<view class="panel-head">
					<view>
						<text class="panel-title">词条列表</text>
						<text class="panel-note">先用本地数据模拟数据库</text>
					</view>
					<button class="small-button" @click="createWord">新增</button>
				</view>
				<input class="search-input" v-model="keyword" placeholder="搜索 study / tud / transport" />
				<view class="bucket-tabs">
					<button :class="['bucket-tab', activeBucket === 'uploaded' ? 'active' : '']" @click="switchBucket('uploaded')">
						已上传 {{ stats.total }}
					</button>
					<button :class="['bucket-tab', activeBucket === 'pending' ? 'active' : '']" @click="switchBucket('pending')">
						未上传 {{ pendingWords.length }}
					</button>
				</view>
				<view class="list-summary-card">
					<view>
						<text class="summary-kicker">{{ activeBucketLabel }}</text>
						<text class="summary-main">{{ activeListTotal }} 个词条</text>
					</view>
					<text class="summary-sub">搜索结果 {{ visibleWordCount }} 个</text>
				</view>
				<scroll-view class="word-list accordion-list" scroll-y>
					<view v-for="group in letterGroups" :key="activeBucket + '-' + group.letter" class="letter-group">
						<view
							:class="['accordion-head', group.count === 0 ? 'empty' : '', isLetterExpanded(group.letter) ? 'expanded' : '']"
							@click="toggleLetter(group.letter)"
						>
							<view :class="['letter-ring', group.count > 0 ? 'has-items' : '']"></view>
							<text class="accordion-letter">{{ group.label }}</text>
							<view class="accordion-fill"></view>
							<text class="accordion-count">{{ group.count }}</text>
							<text class="accordion-arrow">{{ isLetterExpanded(group.letter) ? '⌃' : '⌄' }}</text>
						</view>
						<view v-if="isLetterExpanded(group.letter)" class="accordion-body">
							<view
								v-for="word in group.words"
								:key="word.id"
								:class="['accordion-word-row', selectedId === word.id ? 'active' : '', getEntryType(word)]"
								@click.stop="selectEntry(word.id)"
							>
								<view :class="['entry-dot', getEntryType(word)]">
									<text>{{ entryTypeShort(word) }}</text>
								</view>
								<view class="entry-main">
									<view class="entry-title-line">
										<text class="entry-word">{{ word.word }}</text>
										<text :class="['entry-type-pill', getEntryType(word)]">{{ entryTypeText(word) }}</text>
									</view>
									<text class="entry-meaning">{{ word.meaning || '暂无释义' }}</text>
								</view>
								<text :class="['status-pill', word.status]">{{ statusText(word.status) }}</text>
								<text class="entry-chevron">›</text>
							</view>
							<view v-if="!group.words.length" class="group-empty">这个字母下暂无匹配词条</view>
						</view>
					</view>
					<view v-if="!visibleWordCount" class="empty-list">没有匹配词条，可以点击“新增”。</view>
				</scroll-view>
				<view v-if="activeBucket === 'pending'" class="pending-actions">
					<button class="secondary-button" @click="clearPendingWords">清空未上传</button>
					<button class="publish-button" @click="commitPendingWordsToDrafts">批量加入草稿</button>
				</view>
			</view>

			<view class="panel editor-panel">
				<view class="panel-head">
					<view>
						<text class="panel-title">编辑内容</text>
						<text class="panel-note">先保存为草稿，确认无误后再发布</text>
					</view>
					<view class="editor-actions">
						<view class="save-state">{{ saveState }}</view>
						<button class="secondary-button" @click="saveCurrentAsDraft">保存为草稿</button>
						<button class="publish-button" @click="publishCurrent">{{ primaryActionText }}</button>
					</view>
				</view>

				<view class="form-grid">
					<label class="field">
						<text>单词 ID</text>
						<input v-model="form.id" placeholder="study" />
					</label>
					<label class="field">
						<text>单词</text>
						<input v-model="form.word" placeholder="study" />
					</label>
					<label class="field">
						<text>音标</text>
						<input v-model="form.phonetic" placeholder="/ˈstʌdi/" />
					</label>
					<label class="field">
						<text>状态</text>
						<view :class="['picker-box', 'readonly-status', form.status]">{{ statusText(form.status) }}</view>
					</label>
					<label class="field">
						<text>内容类型</text>
						<picker :range="typeOptions" range-key="label" :value="currentTypeIndex" @change="changeEntryType">
							<view :class="['picker-box', 'entry-type-picker', getEntryType(form)]">{{ entryTypeText(form) }}</view>
						</picker>
					</label>
				</view>

				<label class="field">
					<text>中文释义</text>
					<input v-model="form.meaning" placeholder="学习；研究" />
				</label>
				<label class="field">
					<text>一句话讲解</text>
					<textarea v-model="form.explanation" :maxlength="-1" placeholder="用力敲击 tud 知识，向外出发，这就是学习。" />
				</label>

				<view class="section-head">
					<view>
						<text class="section-title">讲解视频</text>
						<text class="panel-note">按真实上传流程演练：选文件、校验、上传、生成视频资产信息。当前不写入云端，后续只替换上传接口。</text>
					</view>
				</view>
				<view class="video-upload-card">
					<view class="video-upload-main">
						<view id="video-native-picker-host" class="video-native-picker-host">
							<text class="native-picker-loading">正在加载文件选择控件...</text>
						</view>
						<view class="video-upload-copy">
							<text class="video-upload-title">{{ videoUpload.fileName || '还没有选择视频' }}</text>
							<text class="video-upload-note">{{ videoUpload.message }}</text>
						</view>
					</view>
					<view class="upload-progress-track">
						<view class="upload-progress-bar" :style="{ width: videoUpload.progress + '%' }"></view>
					</view>
					<view class="video-upload-meta">
						<text>状态：{{ videoUploadStatusText }}</text>
						<text>大小：{{ videoUpload.fileSizeLabel || '未选择' }}</text>
						<text>类型：{{ videoUpload.mimeType || '未知' }}</text>
					</view>
					<video
						v-if="videoUpload.previewUrl"
						ref="adminVideoPreview"
						class="admin-video-preview"
						:src="videoUpload.previewUrl"
						controls
						@loadedmetadata="handleVideoLoadedMetadata"
						@timeupdate="handleVideoTimeUpdate"
					></video>
					<view v-if="videoUpload.previewUrl" class="video-preview-tools">
						<view class="video-time-row">
							<text>当前：{{ formattedVideoCurrentTime }}</text>
							<text>总长：{{ formattedVideoDuration }}</text>
							<text>片段：{{ form.video.startSec || 0 }}s - {{ form.video.endSec || '?' }}s</text>
							<text>已关联：{{ videoClipCount }} 段</text>
						</view>
						<view class="clip-action-row">
							<button class="secondary-button" @click="markVideoStart">设为开始秒</button>
							<button class="secondary-button" @click="markVideoEnd">设为结束秒</button>
							<button class="publish-button" @click="previewSelectedSegment">预览当前片段</button>
						</view>
						<text class="video-preview-tip">先选视频并拖到要展示的位置，设置开始/结束秒；再到下方填写说明并保存为片段。一个词条可以保存多个片段，也可以更换视频来源后继续保存。</text>
					</view>
					<view v-if="form.video && form.video.assetId" class="video-asset-box">
						<text class="video-asset-title">已生成视频资产</text>
						<text class="video-asset-line">Asset ID：{{ form.video.assetId }}</text>
						<text class="video-asset-line">未来存储路径：{{ form.video.storagePath }}</text>
						<button class="secondary-button clear-video-button" @click="clearVideoAsset">清除视频资产</button>
					</view>
				</view>
				<view class="form-grid">
					<label class="field">
						<text>当前片段播放地址</text>
						<input v-model="form.video.url" placeholder="真实上线后这里是 HTTPS 或云存储临时链接" />
					</label>
					<label class="field">
						<text>当前片段标题</text>
						<input v-model="form.video.title" placeholder="例：第 1 段：c 的象形来源" />
					</label>
					<label class="field">
						<text>当前片段讲解焦点</text>
						<input v-model="form.video.focus" placeholder="例：c 的象形 / col 的组合义 / d 的象形" />
					</label>
					<label class="field">
						<text>关联拆解节点</text>
						<input v-model="form.video.targetPart" placeholder="例：c / col / d / whole" />
					</label>
					<label class="field">
						<text>开始秒</text>
						<input v-model="form.video.startSec" type="number" placeholder="0" />
					</label>
					<label class="field">
						<text>结束秒</text>
						<input v-model="form.video.endSec" type="number" placeholder="120" />
					</label>
					<label class="field span-2">
						<text>用户端提示说明</text>
						<input v-model="form.video.note" placeholder="例：这一段解释 c 像弯曲包住冷气的形象。" />
					</label>
				</view>
				<view class="clip-draft-actions" :class="{ editing: editingClipIndex > -1 }">
					<view class="clip-draft-copy">
						<text class="clip-draft-title">{{ clipDraftTitle }}</text>
						<text class="clip-draft-note">{{ clipDraftHint }}</text>
					</view>
					<view class="clip-draft-buttons">
						<button v-if="editingClipIndex > -1" class="secondary-button" @click="cancelVideoClipEditing">取消编辑</button>
						<button class="small-button" @click="commitCurrentVideoClip">{{ currentClipActionText }}</button>
					</view>
				</view>
				<view class="clip-list-card">
					<view class="clip-list-head">
						<view>
							<text class="clip-list-title">已关联视频片段</text>
							<text class="clip-list-note">用户会按这里的顺序观看片段；如果想看完整视频，后续再接付费完整播放。</text>
						</view>
						<text class="clip-list-count">{{ videoClipCount }} 段</text>
					</view>
					<view v-if="videoClipCount" class="clip-list">
						<view class="clip-item" :class="{ editing: editingClipIndex === index }" v-for="(clip, index) in form.videoClips" :key="clip.clipId || index">
							<view class="clip-index">{{ index + 1 }}</view>
							<view class="clip-main">
								<text class="clip-title">{{ getClipDisplayTitle(clip) }}</text>
								<view class="clip-tags">
									<text v-if="clip.focus" class="clip-tag focus">讲：{{ clip.focus }}</text>
									<text v-if="clip.targetPart" class="clip-tag">节点：{{ clip.targetPart }}</text>
								</view>
								<text v-if="clip.note" class="clip-note">{{ clip.note }}</text>
								<text class="clip-meta">{{ clip.fileName || clip.url || '手动链接' }} · {{ formatClipTimeRange(clip) }}</text>
							</view>
							<view class="clip-buttons">
								<button class="clip-mini-button" @click="loadVideoClipForEditing(index)">编辑</button>
								<button class="clip-mini-button" @click="previewVideoClip(clip)">预览</button>
								<button class="clip-mini-button" :disabled="index === 0" @click="moveVideoClip(index, -1)">上移</button>
								<button class="clip-mini-button" :disabled="index === videoClipCount - 1" @click="moveVideoClip(index, 1)">下移</button>
								<button class="clip-mini-button danger" @click="removeVideoClip(index)">删除</button>
							</view>
						</view>
					</view>
					<view v-else class="clip-empty">
						还没有关联片段。先选择视频、设置开始秒和结束秒，再点击“保存为片段”。
					</view>
					<view class="miniapp-sync-card final-sync-card">
						<view class="miniapp-sync-copy">
							<text class="miniapp-sync-title">最后一步：同步到小程序本地预览</text>
							<text class="miniapp-sync-note">
								{{ bridgeSync.message }}。请先把当前草稿保存为片段；再运行 npm run dev:preview-bridge，并同步到用户端详情页。
							</text>
						</view>
						<button class="miniapp-sync-button" :disabled="bridgeSync.busy" @click="syncCurrentToMiniappPreview">
							{{ bridgeSync.busy ? '同步中...' : '同步到小程序预览' }}
						</button>
						<button class="miniapp-sync-button secondary" :disabled="bridgeSync.busy" @click="syncAllToMiniappPreview">
							同步全部词条
						</button>
					</view>
				</view>

				<view class="section-head">
					<view>
						<text class="section-title">拆解卡片</text>
						<text class="panel-note">每个节点未来都可以继续点进下一级</text>
					</view>
					<button class="small-button" @click="addPart">添加拆解</button>
				</view>
				<view class="parts">
					<view class="part-row" v-for="(part, index) in form.parts" :key="index">
						<input v-model="part.label" placeholder="s" />
						<input v-model="part.title" placeholder="外出" />
						<input v-model="part.targetId" placeholder="跳转 ID，如 s" />
						<button class="remove-button" @click="removePart(index)">删除</button>
					</view>
				</view>

				<view class="section-head">
					<view>
						<text class="section-title">后台草稿 JSON</text>
						<text class="panel-note">给未来数据库导入做准备</text>
					</view>
					<button class="small-button" @click="copyJson">复制当前词条</button>
				</view>
				<textarea class="json-box" :value="currentJson" :maxlength="-1" disabled />
			</view>

			<view class="panel preview-panel">
				<view class="panel-head">
					<view>
						<text class="panel-title">小程序预览</text>
						<text class="panel-note">模拟用户看到的单词卡片</text>
					</view>
				</view>
				<view class="phone-preview">
					<view class="preview-card">
						<view class="preview-meta">象形{{ entryTypeText(form) }}</view>
						<view class="preview-title-row">
							<text class="preview-word">{{ form.word || 'new word' }}</text>
							<text class="preview-phonetic">{{ form.phonetic }}</text>
						</view>
						<text class="preview-meaning">{{ form.meaning || '这里显示中文释义' }}</text>
						<view class="preview-parts">
							<view class="preview-part" v-for="(part, index) in form.parts" :key="index">
								<text class="preview-part-label">{{ part.label || '?' }}</text>
								<text class="preview-part-title">{{ part.title || '未填写' }}</text>
							</view>
						</view>
						<text class="preview-explain">{{ form.explanation || '这里显示象形讲解。' }}</text>
						<view v-if="videoClipCount" class="preview-video">
							<text class="preview-video-title">讲解视频 · {{ videoClipCount }} 段</text>
							<view class="preview-video-row" v-for="(clip, index) in form.videoClips" :key="clip.clipId || index">
								<text class="preview-video-index">{{ index + 1 }}</text>
								<view class="preview-video-copy">
									<text class="preview-video-time">{{ getClipDisplayTitle(clip) }} · {{ formatClipTimeRange(clip) }}</text>
									<text v-if="clip.focus || clip.targetPart" class="preview-video-note">
										{{ getClipFocusLine(clip) }}
									</text>
								</view>
							</view>
							<text class="preview-video-time">用户端将按顺序播放这些片段，完整视频后续可接付费解锁。</text>
						</view>
					</view>
				</view>

				<view v-if="videoClipCount" class="viewer-preview-box">
					<view class="viewer-preview-head">
						<view>
							<text class="viewer-preview-title">用户视角连续预览</text>
							<text class="viewer-preview-note">模拟用户看到的“只播放精选片段”路径，进度条上标明每段在讲什么。</text>
						</view>
						<view class="viewer-preview-actions">
							<button class="secondary-button" @click="playUserVideoPreview">连续预览</button>
							<button class="clip-mini-button" @click="stopUserVideoPreview">停止</button>
						</view>
					</view>
					<view class="viewer-timeline">
						<view
							v-for="(clip, index) in form.videoClips"
							:key="clip.clipId || index"
							:class="['viewer-timeline-segment', userPreview.activeIndex === index ? 'active' : '']"
							:style="{ flexGrow: getClipDuration(clip) }"
							@click="playUserPreviewClip(index)"
						>
							<text class="viewer-timeline-title">{{ clip.focus || getClipDisplayTitle(clip) }}</text>
							<text class="viewer-timeline-time">{{ formatClipTimeRange(clip) }}</text>
						</view>
					</view>
					<text class="viewer-preview-status">{{ userPreview.status }}</text>
					<text class="viewer-preview-footnote">建议规则：每段标题写“这一段讲什么”，不要都写“{{ form.word || '单词' }} 的象形讲解”。</text>
				</view>

				<view class="next-box">
					<text class="section-title">下一步接云时会做什么？</text>
					<text class="next-line">1. 把本地草稿变成 words 数据表。</text>
					<text class="next-line">2. 给管理员加登录和角色权限。</text>
					<text class="next-line">3. 把视频上传演练替换成真实云存储上传。</text>
					<text class="next-line">4. 小程序只读取已发布内容。</text>
				</view>
			</view>
		</view>

		<view class="panel import-panel">
			<view class="panel-head">
				<view>
					<text class="panel-title">批量导入</text>
					<text class="panel-note">推荐让 AI 按下方 JSON 格式生成词条；导入后先进入未上传列表，检查无误再加入草稿。</text>
				</view>
				<view class="editor-actions">
					<label class="file-button">
						选择 JSON 文件
						<input type="file" accept=".json,application/json" @change="handleJsonFileChange" />
					</label>
					<button class="secondary-button" @click="fillImportExample">填入示例</button>
					<button class="secondary-button" @click="clearImportText">一键清除</button>
					<button class="publish-button" @click="importWordsFromJson">校验并加入未上传</button>
				</view>
			</view>
			<textarea
				class="import-box"
				v-model="importText"
				:maxlength="-1"
				placeholder="粘贴 { &quot;words&quot;: [...] } 或 [...] 格式的 JSON。Word / Markdown 内容先交给 AI 转成这个 JSON，再粘贴到这里。"
			/>
			<text class="import-help">{{ importResult }}</text>
		</view>
	</view>
</template>

<script>
const STORAGE_KEY = 'pictographic-admin:words-draft'
const PENDING_STORAGE_KEY = 'pictographic-admin:pending-imports'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const VIDEO_MAX_SIZE_MB = 200
const VIDEO_MAX_SIZE_BYTES = VIDEO_MAX_SIZE_MB * 1024 * 1024
const VIDEO_UPLOAD_PROVIDER = 'local-upload-rehearsal'
const BRIDGE_RUNTIME_ASSET_MAX_MB = 80
const BRIDGE_RUNTIME_ASSET_MAX_BYTES = BRIDGE_RUNTIME_ASSET_MAX_MB * 1024 * 1024

const seedWords = [{
	id: 'study',
	word: 'study',
	entryType: 'word',
	phonetic: '/ˈstʌdi/',
	meaning: '学习；研究',
	status: 'published',
	explanation: '用力敲击 tud 知识，向外出发，这就是“学习”。',
	video: {
		url: '',
		title: 'study 的象形讲解',
		startSec: 0,
		endSec: 120
	},
	parts: [
		{ label: 's', title: '即 ex，外出', targetId: 's' },
		{ label: 'tud', title: '敲击 + 钻研', targetId: 'tud' },
		{ label: 'y', title: '后缀', targetId: 'y' }
	]
}, {
	id: 'tud',
	word: 'tud',
	entryType: 'root',
	phonetic: '',
	meaning: '敲击、钻研的象形节点',
	status: 'published',
	explanation: 'tud 可以继续拆成 t、u、d，表示动作、容纳和获得。',
	video: {
		url: '',
		title: 'tud 的象形拆解',
		startSec: 0,
		endSec: 90
	},
	parts: [
		{ label: 't', title: '手', targetId: 't' },
		{ label: 'u', title: '包含', targetId: 'u' },
		{ label: 'd', title: '得', targetId: 'd' }
	]
}, {
	id: 'transport',
	word: 'transport',
	entryType: 'word',
	phonetic: '/ˈtrænspɔːrt/',
	meaning: '运输；运送',
	status: 'draft',
	explanation: 'trans 表示穿过，port 表示携带，合起来就是把东西带过去。',
	video: {
		url: '',
		title: 'transport 的象形讲解',
		startSec: 0,
		endSec: 150
	},
	parts: [
		{ label: 'trans', title: '穿过', targetId: 'trans' },
		{ label: 'port', title: '携带', targetId: 'port' }
	]
}]

function clone(value) {
	return JSON.parse(JSON.stringify(value))
}

export default {
	data() {
		return {
			keyword: '',
			expandedLetters: [],
			importText: '',
			importResult: '可以先导入 20-50 条试跑，确认字段和拆解无误后再导入整章。',
			words: [],
			pendingWords: [],
			activeBucket: 'uploaded',
			selectedSource: 'uploaded',
			selectedId: '',
			form: clone(seedWords[0]),
			videoUpload: {
				status: 'idle',
				progress: 0,
				fileName: '',
				fileSizeLabel: '',
				mimeType: '',
				message: '选择一个本地视频文件，系统会按未来上传流程做格式、大小和元数据校验。',
				previewUrl: ''
			},
			videoUploadTimer: null,
			videoUploadJob: null,
			videoFileTriggerEl: null,
			runtimeVideoInputEl: null,
			editingClipIndex: -1,
			videoPreview: {
				currentSec: 0,
				durationSec: 0,
				isPreviewingSegment: false
			},
			userPreview: {
				activeIndex: -1,
				isPlaying: false,
				status: '还未开始连续预览。点击时间轴片段可单段预览，点击“连续预览”可按顺序播放。'
			},
			saveState: '未保存',
			bridgeSync: {
				busy: false,
				port: 8787,
				message: '本地预览桥未同步'
			},
			statusOptions: [
				{ label: '草稿', value: 'draft' },
				{ label: '已发布', value: 'published' },
				{ label: '待复核', value: 'review' },
				{ label: '未上传', value: 'pending' }
			],
			typeOptions: [
				{ label: '单词', value: 'word' },
				{ label: '词根', value: 'root' },
				{ label: '字母', value: 'letter' }
			]
		}
	},
	computed: {
		activeWords() {
			return this.activeBucket === 'pending' ? this.pendingWords : this.words
		},
		activeBucketLabel() {
			return this.activeBucket === 'pending' ? '未上传待检查' : '已上传草稿库'
		},
		activeListTotal() {
			return this.activeWords.length
		},
		primaryActionText() {
			return this.selectedSource === 'pending' ? '加入草稿列表' : '发布当前词条'
		},
		filteredWords() {
			return this.activeWords.filter((item) => this.matchesKeyword(item))
		},
		stats() {
			return {
				total: this.words.length,
				published: this.words.filter((item) => item.status === 'published').length,
				draft: this.words.filter((item) => item.status === 'draft').length,
				nodes: this.words.reduce((sum, item) => sum + (Array.isArray(item.parts) ? item.parts.length : 0), 0)
			}
		},
		currentJson() {
			return JSON.stringify(this.stripRuntimeVideoFields(this.normalizeWord(this.form)), null, 2)
		},
		videoClipCount() {
			return Array.isArray(this.form.videoClips) ? this.form.videoClips.length : 0
		},
		currentClipActionText() {
			return this.editingClipIndex > -1 ? '保存片段修改' : '保存为片段'
		},
		clipDraftTitle() {
			return this.editingClipIndex > -1 ? `正在编辑第 ${this.editingClipIndex + 1} 段` : '当前片段草稿'
		},
		clipDraftHint() {
			return this.editingClipIndex > -1
				? '修改标题、焦点、节点、时间或说明后，点击“保存片段修改”。不想改了可以取消编辑。'
				: '先选视频、设开始/结束秒、填好说明，再点击“保存为片段”。保存后的片段会进入下方清单。'
		},
		videoUploadStatusText() {
			const statusMap = {
				idle: '待选择',
				ready: '已选择，待上传',
				uploading: '上传演练中',
				done: '上传演练完成',
				error: '需要处理'
			}
			return statusMap[this.videoUpload.status] || '待选择'
		},
		formattedVideoCurrentTime() {
			return this.formatVideoClock(this.videoPreview.currentSec)
		},
		formattedVideoDuration() {
			return this.formatVideoClock(this.videoPreview.durationSec)
		},
		letterGroups() {
			const groups = LETTERS.map((letter) => {
				const words = this.activeWords.filter((item) => this.getFirstLetter(item) === letter && this.matchesKeyword(item))
				return {
					letter,
					label: letter,
					count: words.length,
					words
				}
			})
			const otherWords = this.activeWords.filter((item) => !this.getFirstLetter(item) && this.matchesKeyword(item))
			if (otherWords.length) {
				groups.push({
					letter: '#',
					label: '其他',
					count: otherWords.length,
					words: otherWords
				})
			}
			return groups
		},
		visibleWordCount() {
			return this.filteredWords.length
		},
		currentTypeIndex() {
			const currentType = this.getEntryType(this.form)
			const index = this.typeOptions.findIndex((item) => item.value === currentType)
			return index > -1 ? index : 0
		},
		listSummary() {
			return `全部分类 · ${this.visibleWordCount} 个词条`
		}
	},
	onLoad() {
		this.loadDraft()
	},
	mounted() {
		this.installNativeVideoButtonHandler()
	},
	beforeDestroy() {
		this.releaseVideoPreview()
		this.removeNativeVideoButtonHandler()
		this.cancelVideoUploadTimer()
	},
	methods: {
		loadDraft() {
			const saved = uni.getStorageSync(STORAGE_KEY)
			const savedPending = uni.getStorageSync(PENDING_STORAGE_KEY)
			const source = saved && saved.length ? saved : seedWords
			this.words = clone(source).map((item) => this.normalizeWord(item))
			this.pendingWords = savedPending && savedPending.length ? clone(savedPending).map((item) => this.normalizePendingWord(item)) : []
			this.activeBucket = 'uploaded'
			this.selectedSource = 'uploaded'
			this.selectedId = this.words[0] ? this.words[0].id : ''
			this.form = this.words[0] ? clone(this.words[0]) : clone(seedWords[0])
			this.saveState = saved ? '已读取本地草稿' : '使用示例数据'
			this.expandedLetters = this.defaultExpandedLetters(this.words)
			this.syncVideoUploadStateFromForm()
		},
		switchBucket(bucket) {
			if (this.activeBucket === bucket) return
			if (!this.validateCurrent()) return
			this.persistFormToList()
			this.activeBucket = bucket
			const source = bucket === 'pending' ? 'pending' : 'uploaded'
			const list = source === 'pending' ? this.pendingWords : this.words
			this.expandedLetters = this.defaultExpandedLetters(list)
			if (list[0]) {
				this.selectFromList(list[0].id, source, true)
			} else {
				if (source === 'pending' && this.words[0]) {
					this.selectedSource = 'uploaded'
					this.selectedId = this.words[0].id
					this.form = clone(this.words[0])
					this.syncVideoUploadStateFromForm()
				} else if (source === 'uploaded') {
					this.selectedSource = 'uploaded'
					this.selectedId = ''
					this.form = clone(seedWords[0])
					this.syncVideoUploadStateFromForm()
				}
				this.saveState = source === 'pending' ? '未上传列表为空，仍在编辑当前词条' : '已上传列表为空'
			}
		},
		selectEntry(id) {
			this.selectFromList(id, this.activeBucket === 'pending' ? 'pending' : 'uploaded')
		},
		selectWord(id) {
			this.selectFromList(id, 'uploaded')
		},
		selectFromList(id, source, skipPersist) {
			if (!this.validateCurrent()) return
			if (!skipPersist) this.persistFormToList()
			const list = source === 'pending' ? this.pendingWords : this.words
			const target = list.find((item) => item.id === id)
			if (!target) return
			this.activeBucket = source === 'pending' ? 'pending' : 'uploaded'
			this.selectedSource = source
			this.selectedId = id
			this.form = source === 'pending' ? this.normalizePendingWord(target) : this.normalizeWord(target)
			this.syncVideoUploadStateFromForm()
			this.saveState = (source === 'pending' ? '正在检查未上传 ' : '正在编辑 ') + target.word
		},
		createWord() {
			if (!this.validateCurrent()) return
			this.persistFormToList()
			this.activeBucket = 'uploaded'
			this.selectedSource = 'uploaded'
			const nextIndex = this.words.length + 1
			const next = {
				id: 'new-word-' + nextIndex,
				word: 'new word',
				entryType: 'word',
				phonetic: '',
				meaning: '',
				status: 'draft',
				explanation: '',
				video: {
					url: '',
					title: '',
					startSec: '',
					endSec: ''
				},
				videoClips: [],
				parts: []
			}
			this.words.unshift(next)
			this.selectedId = next.id
			this.form = clone(next)
			this.syncVideoUploadStateFromForm()
			this.ensureLetterExpanded(this.getFirstLetter(next))
			this.saveState = '已创建新草稿'
		},
		persistFormToList() {
			this.form.id = (this.form.id || '').trim()
			this.form.word = (this.form.word || '').trim()
			if (!this.form.id) return false
			const targetList = this.selectedSource === 'pending' ? this.pendingWords : this.words
			const index = targetList.findIndex((item) => item.id === this.selectedId)
			const nextForm = this.selectedSource === 'pending' ? this.normalizePendingWord(this.form) : this.normalizeWord(this.form)
			if (index > -1) {
				targetList.splice(index, 1, nextForm)
			} else {
				targetList.unshift(nextForm)
			}
			this.selectedId = nextForm.id
			this.form = clone(nextForm)
			return true
		},
		saveDraft() {
			if (!this.validateCurrent()) return
			this.persistFormToList()
			if (!this.validateAllWords()) return
			uni.setStorageSync(STORAGE_KEY, this.stripRuntimeVideoFields(this.words))
			uni.setStorageSync(PENDING_STORAGE_KEY, this.stripRuntimeVideoFields(this.pendingWords))
			this.saveState = '已保存全部本地草稿'
			uni.showToast({ title: '已保存全部草稿', icon: 'success' })
		},
		saveCurrentAsDraft() {
			if (!this.validateCurrent()) return
			if (this.selectedSource === 'pending') {
				this.persistFormToList()
				uni.setStorageSync(PENDING_STORAGE_KEY, this.stripRuntimeVideoFields(this.pendingWords))
				this.saveState = '未上传词条修改已暂存'
				uni.showToast({ title: '已保存未上传修改', icon: 'success' })
				return
			}
			this.form.status = 'draft'
			this.persistFormToList()
			if (!this.validateAllWords()) return
			uni.setStorageSync(STORAGE_KEY, this.stripRuntimeVideoFields(this.words))
			this.saveState = '当前词条已保存为草稿'
			uni.showToast({ title: '已保存为草稿', icon: 'success' })
		},
		publishCurrent() {
			if (!this.validateCurrent()) return
			if (this.selectedSource === 'pending') {
				this.commitCurrentPendingToDraft()
				return
			}
			this.confirmPublish('发布当前词条', `确认发布「${this.form.word}」吗？发布后小程序未来会读取这个词条。`, () => {
				this.form.status = 'published'
				this.persistFormToList()
				if (!this.validateAllWords()) return
				uni.setStorageSync(STORAGE_KEY, this.stripRuntimeVideoFields(this.words))
				this.saveState = '当前词条已发布到本地列表'
				uni.showToast({ title: '已发布当前词条', icon: 'success' })
			})
		},
		publishAllDrafts() {
			if (!this.validateCurrent()) return
			this.persistFormToList()
			if (this.selectedSource === 'pending') {
				this.persistPendingWords()
			}
			if (!this.validateAllWords()) return
			const draftCount = this.words.filter((item) => item.status === 'draft').length
			if (!draftCount) {
				uni.showToast({ title: '当前没有草稿', icon: 'none' })
				return
			}
			this.confirmPublish('发布全部草稿', `确认发布 ${draftCount} 个草稿词条吗？`, () => {
				this.words = this.words.map((item) => {
					const next = clone(item)
					if (next.status === 'draft') {
						next.status = 'published'
					}
					return next
				})
				const current = this.words.find((item) => item.id === this.selectedId)
				if (current) {
					this.form = clone(current)
					this.syncVideoUploadStateFromForm()
				}
				uni.setStorageSync(STORAGE_KEY, this.stripRuntimeVideoFields(this.words))
				this.saveState = '全部草稿已发布到本地列表'
				uni.showToast({ title: '已发布全部草稿', icon: 'success' })
			})
		},
		confirmPublish(title, content, onConfirm) {
			uni.showModal({
				title,
				content,
				confirmText: '确认发布',
				cancelText: '再检查',
				confirmColor: '#fe8500',
				success: (result) => {
					if (result.confirm) onConfirm()
				}
			})
		},
		validateCurrent(options = {}) {
			if (!String(this.form.id || '').trim()) {
				uni.showToast({ title: '请先填写单词 ID', icon: 'none' })
				return false
			}
			if (!String(this.form.word || '').trim()) {
				uni.showToast({ title: '请先填写单词', icon: 'none' })
				return false
			}
			if (!options.skipVideoClipFlush && !this.flushEditingVideoClip()) return false
			const id = String(this.form.id).trim()
			const word = String(this.form.word).trim()
			if (!this.startsWithEnglish(id) || !this.startsWithEnglish(word)) {
				uni.showToast({ title: '单词和 ID 必须以英文字母开头', icon: 'none' })
				return false
			}
			const targetList = this.selectedSource === 'pending' ? this.pendingWords : this.words
			const duplicate = targetList.find((item) => item.id === id && item.id !== this.selectedId)
			if (duplicate) {
				uni.showToast({ title: '单词 ID 已存在', icon: 'none' })
				return false
			}
			const videoResult = this.validateVideoTime(this.form, 1)
			if (!videoResult.ok) {
				uni.showToast({ title: videoResult.message, icon: 'none' })
				return false
			}
			return true
		},
		validateAllWords() {
			const seen = {}
			for (const item of this.words) {
				const id = String(item.id || '').trim()
				const word = String(item.word || '').trim()
				if (!id || !word) {
					uni.showToast({ title: '存在未填完整的词条', icon: 'none' })
					return false
				}
				if (!this.startsWithEnglish(id) || !this.startsWithEnglish(word)) {
					uni.showToast({ title: '词条必须以英文字母开头', icon: 'none' })
					return false
				}
				if (seen[id]) {
					uni.showToast({ title: '存在重复单词 ID', icon: 'none' })
					return false
				}
				const videoResult = this.validateVideoTime(item, id)
				if (!videoResult.ok) {
					uni.showToast({ title: videoResult.message, icon: 'none' })
					return false
				}
				seen[id] = true
			}
			return true
		},
		resetDraft() {
			uni.removeStorageSync(STORAGE_KEY)
			uni.removeStorageSync(PENDING_STORAGE_KEY)
			this.words = clone(seedWords)
			this.pendingWords = []
			this.activeBucket = 'uploaded'
			this.selectedSource = 'uploaded'
			this.selectedId = this.words[0].id
			this.form = clone(this.words[0])
			this.syncVideoUploadStateFromForm()
			this.expandedLetters = this.defaultExpandedLetters(this.words)
			this.saveState = '已恢复示例数据'
		},
		addPart() {
			this.form.parts.push({ label: '', title: '', targetId: '' })
		},
		removePart(index) {
			this.form.parts.splice(index, 1)
		},
		statusText(status) {
			const target = this.statusOptions.find((item) => item.value === status)
			return target ? target.label : '草稿'
		},
		changeEntryType(event) {
			const index = Number(event.detail.value)
			const target = this.typeOptions[index]
			if (!target) return
			this.$set(this.form, 'entryType', target.value)
		},
		startsWithEnglish(value) {
			return /^[a-z]/i.test(String(value || '').trim())
		},
		getFirstLetter(item) {
			const source = String(item.word || item.id || '').trim()
			const first = source.charAt(0).toUpperCase()
			return LETTERS.indexOf(first) > -1 ? first : ''
		},
		matchesKeyword(item) {
			const keyword = this.keyword.trim().toLowerCase()
			if (!keyword) return true
			return String(item.word || '').toLowerCase().indexOf(keyword) > -1 ||
				String(item.id || '').toLowerCase().indexOf(keyword) > -1 ||
				String(item.meaning || '').toLowerCase().indexOf(keyword) > -1
		},
		getGroupWords(letter) {
			const list = this.activeWords
			if (letter === '#') {
				return list.filter((item) => !this.getFirstLetter(item) && this.matchesKeyword(item))
			}
			return list.filter((item) => this.getFirstLetter(item) === letter && this.matchesKeyword(item))
		},
		isLetterExpanded(letter) {
			if (this.keyword.trim()) {
				return this.getGroupWords(letter).length > 0
			}
			return this.expandedLetters.indexOf(letter) > -1
		},
		toggleLetter(letter) {
			if (this.keyword.trim()) return
			const index = this.expandedLetters.indexOf(letter)
			if (index > -1) {
				this.expandedLetters.splice(index, 1)
			} else {
				this.expandedLetters.push(letter)
			}
		},
		ensureLetterExpanded(letter) {
			if (!letter || this.expandedLetters.indexOf(letter) > -1) return
			this.expandedLetters.push(letter)
		},
		defaultExpandedLetters(source) {
			const letters = []
			;(source || this.activeWords).forEach((item) => {
				const letter = this.getFirstLetter(item) || '#'
				if (letter && letters.indexOf(letter) === -1) {
					letters.push(letter)
				}
			})
			return letters.slice(0, 4)
		},
		ensureVideoClipsArray() {
			if (!Array.isArray(this.form.videoClips)) {
				this.$set(this.form, 'videoClips', [])
			}
		},
		hasVideoClipPayload(video) {
			return !!(video && (video.url || video.assetId || video.storagePath || video.localPreviewUrl))
		},
		getDefaultClipTitle(video) {
			const word = String(this.form.word || this.form.id || '当前词条').trim()
			const focus = String(video && video.focus ? video.focus : '').trim()
			const targetPart = String(video && video.targetPart ? video.targetPart : '').trim()
			if (focus) return `${word}：${focus}`
			if (targetPart) return `${word}：${targetPart} 片段`
			return `${word} 的讲解片段`
		},
		getClipDisplayTitle(clip) {
			if (!clip) return '未命名片段'
			return clip.title || this.getDefaultClipTitle(clip)
		},
		getClipFocusLine(clip) {
			const pieces = []
			if (clip && clip.focus) pieces.push(`讲解焦点：${clip.focus}`)
			if (clip && clip.targetPart) pieces.push(`对应节点：${clip.targetPart}`)
			if (clip && clip.note) pieces.push(clip.note)
			return pieces.join(' · ')
		},
		getClipDuration(clip) {
			const start = Number(clip && clip.startSec)
			const end = Number(clip && clip.endSec)
			if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1
			return Math.max(1, end - start)
		},
		formatClipTimeRange(clip) {
			const start = clip && clip.startSec !== '' && clip.startSec !== undefined ? Number(clip.startSec) : 0
			const end = clip && clip.endSec !== '' && clip.endSec !== undefined ? Number(clip.endSec) : ''
			return `${Number.isFinite(start) ? start : 0}s - ${end === '' || !Number.isFinite(end) ? '?' : end}s`
		},
		buildVideoClipId() {
			const base = this.toSafeVideoFileName(this.form.id || this.form.word || 'word').replace(/\.[a-z0-9]+$/i, '')
			return `${base}-clip-${Date.now()}`
		},
		buildCurrentVideoClip(existingClip) {
			this.ensureVideoObject()
			const video = this.form.video || {}
			const start = Number(video.startSec)
			const end = Number(video.endSec)
			if (this.videoUpload.status === 'uploading') {
				uni.showToast({ title: '视频上传演练还没完成，请稍等再添加片段', icon: 'none' })
				return null
			}
			if (!this.hasVideoClipPayload(video)) {
				uni.showToast({ title: '请先选择视频或填写播放地址', icon: 'none' })
				return null
			}
			if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start) {
				uni.showToast({ title: '请设置有效的开始秒和结束秒', icon: 'none' })
				return null
			}
			const clip = this.normalizeVideoClip(Object.assign({}, video, {
				clipId: existingClip && existingClip.clipId ? existingClip.clipId : this.buildVideoClipId(),
				title: video.title || this.getDefaultClipTitle(video)
			}), 0)
			if (existingClip && existingClip.localPreviewUrl) {
				clip.localPreviewUrl = existingClip.localPreviewUrl
			} else if (this.videoUpload && /^(blob:|data:|https?:\/\/)/i.test(String(this.videoUpload.previewUrl || ''))) {
				// 开发态本地预览地址：blob/data 只在后台当前会话有效，正式上线必须替换为云端 HTTPS 地址。
				clip.localPreviewUrl = this.videoUpload.previewUrl
			}
			return clip
		},
		commitCurrentVideoClip() {
			this.ensureVideoClipsArray()
			const existingClip = this.editingClipIndex > -1 ? this.form.videoClips[this.editingClipIndex] : null
			let savedIndex = this.editingClipIndex
			const clip = this.buildCurrentVideoClip(existingClip)
			if (!clip) return false
			if (existingClip) {
				this.form.videoClips.splice(this.editingClipIndex, 1, clip)
				this.saveState = `已更新第 ${this.editingClipIndex + 1} 段讲解片段`
				uni.showToast({ title: '已更新片段', icon: 'success' })
			} else {
				this.form.videoClips.push(clip)
				savedIndex = this.form.videoClips.length - 1
				this.saveState = `已添加第 ${this.form.videoClips.length} 段讲解片段`
				uni.showToast({ title: '已添加片段', icon: 'success' })
			}
			if (this.form.videoClips.length === 1 || this.editingClipIndex === 0) {
				this.syncPrimaryVideoFromClips(this.form)
			}
			if (this.form.videoClips[savedIndex]) {
				this.form.video = Object.assign({}, this.form.video, this.form.videoClips[savedIndex])
			}
			this.editingClipIndex = -1
			return true
		},
		cancelVideoClipEditing() {
			if (this.editingClipIndex < 0) return
			const index = this.editingClipIndex
			this.editingClipIndex = -1
			this.ensureVideoClipsArray()
			if (this.form.videoClips[index]) {
				this.form.video = Object.assign({}, this.form.video, this.form.videoClips[index])
			}
			this.saveState = `已取消编辑第 ${index + 1} 段，片段清单未改动`
		},
		flushEditingVideoClip() {
			if (this.editingClipIndex < 0) return true
			this.ensureVideoClipsArray()
			const existingClip = this.form.videoClips[this.editingClipIndex]
			if (!existingClip) {
				this.editingClipIndex = -1
				return true
			}
			const clip = this.buildCurrentVideoClip(existingClip)
			if (!clip) return false
			this.form.videoClips.splice(this.editingClipIndex, 1, clip)
			if (this.editingClipIndex === 0) {
				this.syncPrimaryVideoFromClips(this.form)
			}
			this.editingClipIndex = -1
			return true
		},
		loadVideoClipForEditing(index) {
			this.ensureVideoClipsArray()
			const clip = this.form.videoClips[index]
			if (!clip) return
			this.ensureVideoObject()
			this.form.video = Object.assign({}, this.form.video, clip)
			this.editingClipIndex = index
			this.saveState = `已载入第 ${index + 1} 段，可调整标题、焦点、秒数后点击“更新当前片段”`
		},
		previewVideoClip(clip) {
			if (!clip) return
			this.stopUserVideoPreview(false)
			this.ensureVideoObject()
			this.form.video = Object.assign({}, this.form.video, clip)
			const playableUrl = this.getPlayableClipUrl(clip)
			if (playableUrl) {
				const sourceChanged = this.videoUpload.previewUrl !== playableUrl
				this.videoUpload.previewUrl = playableUrl
				this.$nextTick(() => {
					if (sourceChanged) {
						const video = this.getVideoElement()
						if (video && typeof video.load === 'function') {
							video.load()
						}
					}
					this.previewSelectedSegment()
				})
			} else {
				uni.showToast({ title: '这个片段暂无本地预览源，请重新选择原视频或接入云地址', icon: 'none' })
				return
			}
		},
		getPlayableClipUrl(clip) {
			const localUrl = String(clip && clip.localPreviewUrl ? clip.localPreviewUrl : '').trim()
			if (/^(blob:|data:|https?:\/\/)/i.test(localUrl)) return localUrl
			const url = String(clip && clip.url ? clip.url : '').trim()
			if (/^(blob:|data:|https?:\/\/)/i.test(url)) return url
			return ''
		},
		playUserVideoPreview() {
			if (!this.videoClipCount) {
				uni.showToast({ title: '还没有可预览的视频片段', icon: 'none' })
				return
			}
			this.playUserPreviewClip(0)
		},
		playUserPreviewClip(index) {
			this.ensureVideoClipsArray()
			const clip = this.form.videoClips[index]
			if (!clip) return
			const playableUrl = this.getPlayableClipUrl(clip)
			if (!playableUrl) {
				this.userPreview = {
					activeIndex: index,
					isPlaying: false,
					status: `第 ${index + 1} 段没有可播放预览源：本地刷新后需要重新选择原视频，或未来接入真实 HTTPS 云地址。`
				}
				uni.showToast({ title: '此片段暂无可播放预览源', icon: 'none' })
				return
			}

			this.ensureVideoObject()
			this.form.video = Object.assign({}, this.form.video, clip)
			const sourceChanged = this.videoUpload.previewUrl !== playableUrl
			this.videoUpload.previewUrl = playableUrl
			this.videoPreview.isPreviewingSegment = false
			this.userPreview = {
				activeIndex: index,
				isPlaying: true,
				status: `正在预览第 ${index + 1} 段：${this.getClipDisplayTitle(clip)}`
			}
			this.$nextTick(() => {
				const video = this.getVideoElement()
				if (!video) {
					this.stopUserVideoPreview(false)
					uni.showToast({ title: '请先选择视频文件', icon: 'none' })
					return
				}
				const start = Math.max(0, Number(clip.startSec) || 0)
				const playFromStart = () => {
					video.currentTime = start
					if (typeof video.play === 'function') {
						const playResult = video.play()
						if (playResult && typeof playResult.catch === 'function') {
							playResult.catch(() => {
								this.stopUserVideoPreview(false)
								uni.showToast({ title: '视频暂时无法播放，请检查格式或重新选择文件', icon: 'none' })
							})
						}
					}
				}
				if (sourceChanged && typeof video.load === 'function') {
					video.load()
				}
				if (!sourceChanged && video.readyState >= 1) {
					playFromStart()
					return
				}
				const onLoaded = () => {
					video.removeEventListener('loadedmetadata', onLoaded)
					playFromStart()
				}
				video.addEventListener('loadedmetadata', onLoaded)
				if (typeof video.load === 'function') {
					video.load()
				}
			})
		},
		stopUserVideoPreview(showToast = true) {
			if (this.userPreview && this.userPreview.isPlaying) {
				const video = this.getVideoElement()
				if (video && typeof video.pause === 'function') {
					video.pause()
				}
			}
			this.userPreview = {
				activeIndex: -1,
				isPlaying: false,
				status: showToast ? '已停止连续预览。' : '还未开始连续预览。点击时间轴片段可单段预览，点击“连续预览”可按顺序播放。'
			}
			this.videoPreview.isPreviewingSegment = false
		},
		handleUserPreviewTimeUpdate(video, current) {
			const index = this.userPreview.activeIndex
			const clip = Array.isArray(this.form.videoClips) ? this.form.videoClips[index] : null
			if (!clip) {
				this.stopUserVideoPreview(false)
				return
			}
			const end = Number(clip.endSec)
			if (!Number.isFinite(end) || current < end) return
			if (video && typeof video.pause === 'function') {
				video.pause()
			}
			const nextIndex = index + 1
			if (nextIndex < this.videoClipCount) {
				this.playUserPreviewClip(nextIndex)
				return
			}
			this.userPreview = {
				activeIndex: index,
				isPlaying: false,
				status: '连续预览完成。用户端后续可以在这里提示“查看完整视频需付费解锁”。'
			}
		},
		moveVideoClip(index, direction) {
			this.ensureVideoClipsArray()
			if (this.editingClipIndex > -1 && !this.flushEditingVideoClip()) return
			const nextIndex = index + direction
			if (nextIndex < 0 || nextIndex >= this.form.videoClips.length) return
			const clips = this.form.videoClips
			const target = clips.splice(index, 1)[0]
			clips.splice(nextIndex, 0, target)
			this.syncPrimaryVideoFromClips(this.form)
			this.saveState = '已调整视频片段顺序'
		},
		removeVideoClip(index) {
			this.ensureVideoClipsArray()
			if (index < 0 || index >= this.form.videoClips.length) return
			if (this.editingClipIndex > -1 && this.editingClipIndex !== index && !this.flushEditingVideoClip()) return
			if (this.editingClipIndex === index) {
				this.editingClipIndex = -1
			}
			const removedClip = this.form.videoClips.splice(index, 1)[0]
			if (
				removedClip &&
				removedClip.localPreviewUrl &&
				this.videoUpload.previewUrl !== removedClip.localPreviewUrl &&
				!this.isPreviewUrlUsedByClip(removedClip.localPreviewUrl)
			) {
				this.releaseVideoPreview(removedClip.localPreviewUrl)
			}
			if (this.form.videoClips.length) {
				this.syncPrimaryVideoFromClips(this.form)
			} else {
				this.form.video = this.emptyVideoObject()
			}
			this.saveState = '已移除视频片段'
		},
		syncPrimaryVideoFromClips(target) {
			if (!target || !Array.isArray(target.videoClips) || !target.videoClips.length) return target
			target.video = Object.assign({}, target.video || {}, target.videoClips[0])
			return target
		},
		syncVideoUploadStateFromForm() {
			this.cancelVideoUploadTimer()
			this.releaseVideoPreview()
			const video = this.form && this.form.video ? this.form.video : {}
			if (video.assetId || video.url) {
				this.videoUpload = {
					status: video.assetId ? 'done' : 'ready',
					progress: video.assetId ? 100 : 0,
					fileName: video.fileName || '',
					fileSizeLabel: video.size ? this.formatFileSize(video.size) : '',
					mimeType: video.mimeType || '',
					message: video.assetId
						? '当前词条已经有视频资产信息。'
						: '当前词条只有视频地址，还没有上传资产元数据。',
					previewUrl: ''
				}
				return
			}
			this.videoUpload = {
				status: 'idle',
				progress: 0,
				fileName: '',
				fileSizeLabel: '',
				mimeType: '',
				message: '选择一个本地视频文件，系统会按未来上传流程做格式、大小和元数据校验。',
				previewUrl: ''
			}
			this.resetVideoPreviewState()
		},
		handleNativeVideoFileChange(event) {
			this.handleVideoFileChange(event)
			if (event && event.target) {
				event.target.value = ''
			}
		},
		installNativeVideoButtonHandler() {
			if (typeof document === 'undefined') return
			this.$nextTick(() => {
				const trigger = document.getElementById('video-native-picker-host')
				if (!trigger) return
				if (trigger === this.videoFileTriggerEl && this.runtimeVideoInputEl) return
				this.removeNativeVideoButtonHandler()
				trigger.innerHTML = ''
				const input = document.createElement('input')
				input.type = 'file'
				input.accept = 'video/mp4,video/webm,video/quicktime,video/*'
				input.multiple = false
				input.className = 'runtime-video-file-input'
				input.setAttribute('aria-label', '选择视频文件')
				input.style.display = 'block'
				input.style.width = '260px'
				input.style.maxWidth = '100%'
				input.style.minHeight = '44px'
				input.style.padding = '8px 12px'
				input.style.border = '2px solid #0e3a5c'
				input.style.borderRadius = '999px'
				input.style.background = '#ffffff'
				input.style.color = '#0e3a5c'
				input.style.cursor = 'pointer'
				input.style.margin = '0'
				input.style.fontWeight = '800'
				input.addEventListener('change', this.handleNativeVideoFileChange)
				trigger.appendChild(input)
				this.videoFileTriggerEl = trigger
				this.runtimeVideoInputEl = input
			})
		},
		removeNativeVideoButtonHandler() {
			if (this.runtimeVideoInputEl) {
				this.runtimeVideoInputEl.removeEventListener('change', this.handleNativeVideoFileChange)
				if (this.runtimeVideoInputEl.parentNode) {
					this.runtimeVideoInputEl.parentNode.removeChild(this.runtimeVideoInputEl)
				}
			}
			this.videoFileTriggerEl = null
			this.runtimeVideoInputEl = null
		},
		handleVideoFileChange(eventOrFile) {
			const file = eventOrFile && eventOrFile.name
				? eventOrFile
				: eventOrFile && eventOrFile.target && eventOrFile.target.files
					? eventOrFile.target.files[0]
					: null
			if (!file) return

			this.cancelVideoUploadTimer()
			const validation = this.validateVideoFile(file)
			if (!validation.ok) {
				this.releaseVideoPreview()
				this.resetVideoPreviewState()
				this.videoUpload = {
					status: 'error',
					progress: 0,
					fileName: file.name || '',
					fileSizeLabel: this.formatFileSize(file.size || 0),
					mimeType: file.type || '未知',
					message: validation.message,
					previewUrl: ''
				}
				uni.showToast({ title: validation.message, icon: 'none' })
				return
			}

			this.releaseVideoPreview()
			this.resetVideoPreviewState()
			const previewUrl = URL.createObjectURL(file)
			this.resetCurrentVideoDraftForFile(file)
			this.videoUpload = {
				status: 'ready',
				progress: 0,
				fileName: file.name,
				fileSizeLabel: this.formatFileSize(file.size),
				mimeType: file.type || 'video/*',
				message: '文件已选择，正在模拟上传到未来云存储。',
				previewUrl
			}
			this.simulateVideoUpload(file)
		},
		resetCurrentVideoDraftForFile(file) {
			this.ensureVideoObject()
			this.editingClipIndex = -1
			this.form.video = Object.assign({}, this.emptyVideoObject(), {
				fileName: file && file.name ? file.name : '',
				mimeType: file && file.type ? file.type : '',
				size: file && file.size ? file.size : '',
				startSec: 0,
				endSec: ''
			})
			this.saveState = '已选择新视频，请重新填写这个片段的标题、焦点和时间点'
		},
		validateVideoFile(file) {
			const fileName = file && file.name ? file.name.toLowerCase() : ''
			const mimeType = file && file.type ? file.type : ''
			const allowedExtension = /\.(mp4|mov|m4v|webm)$/i.test(fileName)
			const allowedMime = mimeType.indexOf('video/') === 0

			if (!allowedExtension && !allowedMime) {
				return { ok: false, message: '请选择 mp4、mov、m4v 或 webm 视频文件' }
			}
			if (file.size > VIDEO_MAX_SIZE_BYTES) {
				return { ok: false, message: `视频不能超过 ${VIDEO_MAX_SIZE_MB}MB` }
			}
			return { ok: true }
		},
		simulateVideoUpload(file) {
			this.cancelVideoUploadTimer()
			const uploadJob = {
				formRef: this.form,
				startedAt: Date.now()
			}
			this.videoUploadJob = uploadJob
			if (this.videoUploadTimer) {
				clearInterval(this.videoUploadTimer)
			}

			this.videoUpload.status = 'uploading'
			this.videoUpload.progress = 8
			this.videoUpload.message = '上传演练中：正在生成资产 ID、存储路径和播放地址。'

			this.videoUploadTimer = setInterval(() => {
				if (this.videoUploadJob !== uploadJob) return
				const nextProgress = Math.min(this.videoUpload.progress + 18, 100)
				this.videoUpload.progress = nextProgress

				if (nextProgress < 100) return
				clearInterval(this.videoUploadTimer)
				this.videoUploadTimer = null
				this.videoUploadJob = null
				this.completeVideoUpload(file, uploadJob)
			}, 220)
		},
		cancelVideoUploadTimer() {
			if (this.videoUploadTimer) {
				clearInterval(this.videoUploadTimer)
				this.videoUploadTimer = null
			}
			this.videoUploadJob = null
		},
		completeVideoUpload(file, uploadJob) {
			if (uploadJob && uploadJob.formRef !== this.form) return
			const safeName = this.toSafeVideoFileName(file.name || 'lesson-video.mp4')
			const assetId = `${this.form.id || this.form.word || 'word'}-${Date.now()}`
			const storagePath = `videos/${this.form.id || 'draft'}/${assetId}-${safeName}`

			this.ensureVideoObject()
			this.form.video = Object.assign({}, this.form.video, {
				// mock-cloud 只是上传演练占位符，不是真实云文件地址；正式上线时由云存储 HTTPS 地址替换。
				url: `mock-cloud://${storagePath}`,
				provider: VIDEO_UPLOAD_PROVIDER,
				assetId,
				storagePath,
				fileName: file.name || safeName,
				mimeType: file.type || 'video/*',
				size: file.size || 0,
				uploadStatus: 'uploaded',
				uploadedAt: new Date().toISOString()
			})
			this.videoUpload.status = 'done'
			this.videoUpload.progress = 100
			this.videoUpload.message = '上传演练完成：字段已写入当前词条，正式接云时会把 mock-cloud 替换成真实 HTTPS/云文件地址。'
			this.saveState = '视频资产已写入当前词条'
		},
		clearVideoAsset() {
			this.cancelVideoUploadTimer()
			this.stopUserVideoPreview(false)
			this.ensureVideoObject()
			const previewUrls = []
			if (this.videoUpload && this.videoUpload.previewUrl) previewUrls.push(this.videoUpload.previewUrl)
			if (Array.isArray(this.form.videoClips)) {
				this.form.videoClips.forEach((clip) => {
					if (clip && clip.localPreviewUrl) previewUrls.push(clip.localPreviewUrl)
				})
			}
			this.editingClipIndex = -1
			this.form.video = this.emptyVideoObject()
			this.$set(this.form, 'videoClips', [])
			previewUrls.forEach((url) => this.releaseVideoPreview(url))
			this.videoUpload = {
				status: 'idle',
				progress: 0,
				fileName: '',
				fileSizeLabel: '',
				mimeType: '',
				message: '视频资产已清除，可以重新选择文件。',
				previewUrl: ''
			}
			this.resetVideoPreviewState()
		},
		emptyVideoObject() {
			return {
				url: '',
				title: '',
				focus: '',
				targetPart: '',
				note: '',
				startSec: '',
				endSec: '',
				provider: '',
				assetId: '',
				storagePath: '',
				fileName: '',
				mimeType: '',
				size: '',
				uploadStatus: '',
				uploadedAt: ''
			}
		},
		ensureVideoObject() {
			if (!this.form.video) {
				this.$set(this.form, 'video', this.emptyVideoObject())
			}
		},
		isPreviewUrlUsedByClip(url) {
			if (!url || !Array.isArray(this.form.videoClips)) return false
			return this.form.videoClips.some((clip) => clip && clip.localPreviewUrl === url)
		},
		releaseVideoPreview(url) {
			const targetUrl = url || (this.videoUpload && this.videoUpload.previewUrl)
			if (!targetUrl || !/^blob:/i.test(String(targetUrl))) return
			if (this.isPreviewUrlUsedByClip(targetUrl)) return
			URL.revokeObjectURL(targetUrl)
		},
		resetVideoPreviewState() {
			this.videoPreview = {
				currentSec: 0,
				durationSec: 0,
				isPreviewingSegment: false
			}
		},
		handleVideoLoadedMetadata(event) {
			const video = this.getVideoElement(event)
			const duration = video && Number.isFinite(video.duration) ? video.duration : 0
			this.videoPreview.durationSec = Math.max(0, Math.round(duration))
		},
		handleVideoTimeUpdate(event) {
			const video = this.getVideoElement(event)
			const current = video && Number.isFinite(video.currentTime) ? video.currentTime : 0
			this.videoPreview.currentSec = Math.max(0, Math.round(current))
			if (this.userPreview && this.userPreview.isPlaying) {
				this.handleUserPreviewTimeUpdate(video, current)
				return
			}
			if (!this.videoPreview.isPreviewingSegment) return

			const end = Number(this.form.video && this.form.video.endSec)
			if (!Number.isFinite(end) || end <= 0) return
			if (current >= end) {
				this.videoPreview.isPreviewingSegment = false
				if (video && typeof video.pause === 'function') {
					video.pause()
				}
			}
		},
		getVideoElement(event) {
			if (event && event.target && typeof event.target.currentTime === 'number') {
				return event.target
			}
			const ref = this.$refs.adminVideoPreview
			if (ref && ref.$el) return ref.$el
			if (ref && typeof ref.currentTime === 'number') return ref
			if (typeof document !== 'undefined') {
				return document.querySelector('.admin-video-preview')
			}
			return null
		},
		markVideoStart() {
			this.ensureVideoObject()
			const current = this.getCurrentVideoSecond()
			this.$set(this.form.video, 'startSec', current)
			if (this.form.video.endSec !== '' && Number(this.form.video.endSec) <= current) {
				this.$set(this.form.video, 'endSec', current + 10)
			}
			this.saveState = `已把 ${current}s 设为当前卡片片段开始`
		},
		markVideoEnd() {
			this.ensureVideoObject()
			const current = this.getCurrentVideoSecond()
			const start = Number(this.form.video.startSec || 0)
			this.$set(this.form.video, 'endSec', current > start ? current : start + 10)
			this.saveState = `已把 ${this.form.video.endSec}s 设为当前卡片片段结束`
		},
		previewSelectedSegment() {
			const video = this.getVideoElement()
			if (!video) {
				uni.showToast({ title: '请先选择视频文件', icon: 'none' })
				return
			}
			const start = Number(this.form.video && this.form.video.startSec)
			const end = Number(this.form.video && this.form.video.endSec)
			if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
				uni.showToast({ title: '请先设置有效的开始秒和结束秒', icon: 'none' })
				return
			}
			video.currentTime = Math.max(0, start)
			this.videoPreview.isPreviewingSegment = true
			if (typeof video.play === 'function') {
				const playResult = video.play()
				if (playResult && typeof playResult.catch === 'function') {
					playResult.catch(() => {
						this.videoPreview.isPreviewingSegment = false
						uni.showToast({ title: '视频暂时无法播放，请检查格式或重新选择文件', icon: 'none' })
					})
				}
			}
		},
		getCurrentVideoSecond() {
			const video = this.getVideoElement()
			const current = video && Number.isFinite(video.currentTime)
				? video.currentTime
				: this.videoPreview.currentSec
			return Math.max(0, Math.round(Number(current) || 0))
		},
		formatVideoClock(seconds) {
			const total = Math.max(0, Math.round(Number(seconds) || 0))
			const minutes = Math.floor(total / 60)
			const rest = String(total % 60).padStart(2, '0')
			return `${minutes}:${rest}`
		},
		formatFileSize(size) {
			const value = Number(size || 0)
			if (value < 1024 * 1024) {
				return `${Math.max(1, Math.round(value / 1024))}KB`
			}
			return `${(value / 1024 / 1024).toFixed(1)}MB`
		},
		toSafeVideoFileName(fileName) {
			const normalized = String(fileName || 'lesson-video.mp4').trim().toLowerCase()
			return normalized.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'lesson-video.mp4'
		},
		stripRuntimeVideoFields(value) {
			const stripClip = (clip) => {
				if (!clip || typeof clip !== 'object') return clip
				delete clip.localPreviewUrl
				delete clip.local_preview_url
				return clip
			}
			const stripWord = (word) => {
				if (!word || typeof word !== 'object') return word
				if (word.video) stripClip(word.video)
				if (Array.isArray(word.videoClips)) {
					word.videoClips = word.videoClips.map((clip) => stripClip(clip))
				}
				return word
			}
			if (value === undefined || value === null) return value
			const next = clone(value)
			return Array.isArray(next) ? next.map((item) => stripWord(item)) : stripWord(next)
		},
		normalizeVideoClip(raw, index) {
			const source = raw || {}
			const startSec = Number(source.startSec !== undefined ? source.startSec : source.start_sec)
			const endSec = Number(source.endSec !== undefined ? source.endSec : source.end_sec)
			const videoSize = Number(source.size)
			return {
				clipId: String(source.clipId || source.clip_id || source.id || `clip-${(index || 0) + 1}`).trim(),
				url: String(source.url || source.videoUrl || source.video_url || '').trim(),
				title: String(source.title || source.segmentTitle || source.segment_title || source.videoTitle || source.video_title || '').trim(),
				focus: String(source.focus || source.topic || source.clipFocus || source.clip_focus || source.learningPoint || source.learning_point || '').trim(),
				targetPart: String(source.targetPart || source.target_part || source.part || source.partLabel || source.part_label || source.node || source.nodeId || source.node_id || '').trim(),
				note: String(source.note || source.description || source.summary || source.clipNote || source.clip_note || '').trim(),
				localPreviewUrl: /^(blob:|data:|https?:\/\/)/i.test(String(source.localPreviewUrl || source.local_preview_url || ''))
					? String(source.localPreviewUrl || source.local_preview_url).trim()
					: '',
				startSec: source.startSec === '' || source.start_sec === '' || (source.startSec === undefined && source.start_sec === undefined) || Number.isNaN(startSec) ? '' : startSec,
				endSec: source.endSec === '' || source.end_sec === '' || (source.endSec === undefined && source.end_sec === undefined) || Number.isNaN(endSec) ? '' : endSec,
				provider: String(source.provider || '').trim(),
				assetId: String(source.assetId || source.asset_id || source.videoId || source.video_id || '').trim(),
				wordId: String(source.wordId || source.word_id || '').trim(),
				segmentTitle: String(source.segmentTitle || source.segment_title || source.title || '').trim(),
				storagePath: String(source.storagePath || source.storage_path || '').trim(),
				fileName: String(source.fileName || source.file_name || '').trim(),
				mimeType: String(source.mimeType || source.mime_type || '').trim(),
				size: source.size === '' || source.size === undefined || Number.isNaN(videoSize) ? '' : videoSize,
				uploadStatus: String(source.uploadStatus || source.upload_status || '').trim(),
				uploadedAt: String(source.uploadedAt || source.uploaded_at || '').trim()
			}
		},
		normalizeWord(item) {
			const next = clone(item)
			next.id = String(next.id || '').trim()
			next.word = String(next.word || next.id || '').trim()
			next.phonetic = String(next.phonetic || '').trim()
			next.meaning = String(next.meaning || '').trim()
			next.explanation = String(next.explanation || '')
			next.status = next.status === 'published' || next.status === 'review' ? next.status : 'draft'
			next.parts = Array.isArray(next.parts) ? next.parts.map((part) => ({
				label: String(part.label || '').trim(),
				title: String(part.title || '').trim(),
				targetId: String(part.targetId || '').trim()
			})) : []
			const video = this.normalizeVideoClip(next.video || {}, 0)
			const explicitClips = Array.isArray(next.videoClips)
			const rawClips = explicitClips
				? next.videoClips
				: (Array.isArray(next.video_clips) ? next.video_clips : (Array.isArray(next.clips) ? next.clips : []))
			const videoClips = rawClips
				.map((clip, index) => this.normalizeVideoClip(clip, index))
				.filter((clip) => this.hasVideoClipPayload(clip))
			if (!explicitClips && !videoClips.length && this.hasVideoClipPayload(video)) {
				videoClips.push(Object.assign({}, video, {
					clipId: video.clipId || `${next.id || next.word || 'word'}-clip-1`
				}))
			}
			next.videoClips = videoClips
			next.video = videoClips.length ? Object.assign({}, video, videoClips[0]) : video
			next.entryType = this.getEntryType(next)
			return next
		},
		normalizePendingWord(item) {
			const next = this.normalizeWord(item)
			next.status = 'pending'
			return next
		},
		getEntryType(item) {
			const rawType = String(item.entryType || '').trim().toLowerCase()
			if (rawType === 'letter' || rawType === '字母') {
				return 'letter'
			}
			if (rawType === 'root' || rawType === '词根' || rawType === '词根/节点') {
				return 'root'
			}
			if (rawType === 'word' || rawType === '单词') {
				return 'word'
			}
			const word = String(item.word || item.id || '').trim()
			if (word.length === 1) return 'letter'
			if (word.length <= 4 && Array.isArray(item.parts) && item.parts.length) return 'root'
			return 'word'
		},
		entryTypeText(item) {
			const typeMap = {
				letter: '字母',
				root: '词根',
				word: '单词'
			}
			return typeMap[this.getEntryType(item)] || '单词'
		},
		entryTypeShort(item) {
			const shortMap = {
				letter: '字',
				root: '根',
				word: '词'
			}
			return shortMap[this.getEntryType(item)] || '词'
		},
		fillImportExample() {
			// 示例 URL 只用于演示 JSON 字段格式，正式内容必须替换为真实 HTTPS 或云存储地址。
			this.importText = JSON.stringify({
				words: [{
					id: 'apple',
					word: 'apple',
					entryType: 'word',
					phonetic: '/ˈæpl/',
					meaning: 'n. 苹果',
					explanation: 'a 像苹果或人头，pple 可以继续按你的课程拆解。',
					parts: [
						{ label: 'a', title: '苹果、人头', targetId: 'a' },
						{ label: 'pple', title: '后续拆解节点', targetId: 'pple' }
					],
					video: {
						url: 'https://example.com/videos/apple.mp4',
						title: 'apple 的象形讲解',
						startSec: 0,
						endSec: 120
					},
					videoClips: [
						{
							clipId: 'apple-clip-1',
							url: 'https://example.com/videos/apple.mp4',
							title: '第 1 段：a 的象形',
							focus: 'a 像苹果或人头',
							targetPart: 'a',
							note: '先解释 apple 里 a 的图像含义。',
							startSec: 0,
							endSec: 10
						},
						{
							clipId: 'apple-clip-2',
							url: 'https://example.com/videos/apple.mp4',
							title: '第 2 段：pple 的后续拆解',
							focus: 'pple 后续拆解',
							targetPart: 'pple',
							note: '再补充 pple 如何继续拆成下一层节点。',
							startSec: 30,
							endSec: 45
						}
					]
				}]
			}, null, 2)
			this.importResult = '已填入示例。正式使用时，把 AI 生成的 words 数组粘贴进来即可。'
		},
		clearImportText() {
			this.importText = ''
			this.importResult = '已清空。可以重新选择 JSON 文件，或粘贴 AI 生成的 words JSON。'
		},
		handleJsonFileChange(event) {
			const input = event && event.target
			const file = input && input.files && input.files[0]
			if (!file) return
			if (!/\.json$/i.test(file.name || '')) {
				this.importResult = '请选择 .json 文件'
				uni.showToast({ title: '请选择 JSON 文件', icon: 'none' })
				input.value = ''
				return
			}
			const reader = new FileReader()
			reader.onload = () => {
				this.importText = String(reader.result || '')
				this.importResult = `已读取文件：${file.name}。请点击“校验并加入未上传”。`
				input.value = ''
			}
			reader.onerror = () => {
				this.importResult = '文件读取失败，请重新选择或改用复制粘贴。'
				uni.showToast({ title: '文件读取失败', icon: 'none' })
				input.value = ''
			}
			reader.readAsText(file, 'utf-8')
		},
		importWordsFromJson() {
			if (!this.validateCurrent()) return
			this.persistFormToList()
			const parsed = this.parseImportPayload(this.importText)
			if (!parsed.ok) {
				this.importResult = parsed.message
				uni.showToast({ title: parsed.message, icon: 'none' })
				return
			}
			const malformedIndex = parsed.words.findIndex((item) => !item || typeof item !== 'object' || Array.isArray(item))
			if (malformedIndex > -1) {
				this.importResult = `第 ${malformedIndex + 1} 条不是有效词条对象`
				uni.showToast({ title: this.importResult, icon: 'none' })
				return
			}
			const incoming = parsed.words.map((item) => this.normalizeImportedWord(item))
			const validation = this.validateImportedWords(incoming)
			if (!validation.ok) {
				this.importResult = validation.message
				uni.showToast({ title: validation.message, icon: 'none' })
				return
			}
			const existingIds = this.words.reduce((result, item) => {
				result[item.id] = true
				return result
			}, {})
			const pendingIds = this.pendingWords.reduce((result, item) => {
				result[item.id] = true
				return result
			}, {})
			const updateCount = incoming.filter((item) => existingIds[item.id] || pendingIds[item.id]).length
			const newCount = incoming.length - updateCount
			uni.showModal({
				title: '加入未上传列表',
				content: `将校验通过的 ${incoming.length} 条词条加入“未上传”待检查队列：新增 ${newCount} 条，覆盖待检查/已存在 ${updateCount} 条。`,
				confirmText: '加入未上传',
				cancelText: '再检查',
				confirmColor: '#fe8500',
				success: (result) => {
					if (result.confirm) {
						this.stageImportedWords(incoming, newCount, updateCount)
					}
				}
			})
		},
		parseImportPayload(text) {
			if (!String(text || '').trim()) {
				return { ok: false, message: '请先粘贴 JSON 内容' }
			}
			try {
				const parsed = JSON.parse(this.normalizeImportJsonText(text))
				const words = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.words) ? parsed.words : [parsed])
				if (!Array.isArray(words) || !words.length) {
					return { ok: false, message: 'JSON 里需要有 words 数组，或直接粘贴一个词条对象' }
				}
				return { ok: true, words }
			} catch (error) {
				return { ok: false, message: 'JSON 格式不正确，请让 AI 重新输出纯 JSON' }
			}
		},
		normalizeImportJsonText(text) {
			return String(text || '')
				.trim()
				.replace(/^\uFEFF/, '')
				.replace(/,\s*$/, '')
		},
		normalizeImportedWord(raw) {
			raw = raw || {}
			const rawVideo = raw.video || {}
			const rawVideoClips = Array.isArray(raw.videoClips)
				? raw.videoClips
				: (Array.isArray(raw.video_clips) ? raw.video_clips : (Array.isArray(raw.clips) ? raw.clips : undefined))
			const firstNonEmpty = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '')
			const valueOrBlank = (value) => value === undefined ? '' : value
			const normalized = this.normalizeWord({
				id: raw.id || raw.wordId || raw.word,
				word: raw.word || raw.id || raw.wordId,
				entryType: raw.entryType || raw.type,
				phonetic: raw.phonetic || raw.pronunciation || '',
				meaning: raw.meaning || raw.definition || raw.translation || '',
				explanation: raw.explanation || raw.analysis || raw.note || '',
				status: 'draft',
				parts: this.normalizeImportedParts(raw.parts || raw.breakdown || raw.children || []),
				video: {
					url: valueOrBlank(firstNonEmpty(rawVideo.url, rawVideo.videoUrl, rawVideo.video_url, raw.videoUrl, raw.video_url)),
					title: valueOrBlank(firstNonEmpty(rawVideo.title, rawVideo.segmentTitle, rawVideo.segment_title, rawVideo.videoTitle, rawVideo.video_title, raw.videoTitle, raw.video_title, raw.segment_title)),
					focus: valueOrBlank(firstNonEmpty(rawVideo.focus, rawVideo.topic, rawVideo.clipFocus, rawVideo.clip_focus, rawVideo.learningPoint, rawVideo.learning_point, raw.focus, raw.topic, raw.clipFocus, raw.clip_focus, raw.learning_point)),
					targetPart: valueOrBlank(firstNonEmpty(rawVideo.targetPart, rawVideo.target_part, rawVideo.partLabel, rawVideo.part_label, rawVideo.nodeId, rawVideo.node_id, raw.targetPart, raw.target_part, raw.partLabel, raw.part_label)),
					note: valueOrBlank(firstNonEmpty(rawVideo.note, rawVideo.description, rawVideo.summary, rawVideo.clipNote, rawVideo.clip_note, raw.videoNote, raw.video_note, raw.clip_note)),
					startSec: valueOrBlank(firstNonEmpty(rawVideo.startSec, raw.startSec)),
					endSec: valueOrBlank(firstNonEmpty(rawVideo.endSec, raw.endSec)),
					provider: valueOrBlank(firstNonEmpty(rawVideo.provider, raw.provider)),
					assetId: valueOrBlank(firstNonEmpty(rawVideo.assetId, rawVideo.asset_id, raw.assetId)),
					storagePath: valueOrBlank(firstNonEmpty(rawVideo.storagePath, rawVideo.storage_path, raw.storagePath)),
					fileName: valueOrBlank(firstNonEmpty(rawVideo.fileName, rawVideo.file_name, raw.fileName)),
					mimeType: valueOrBlank(firstNonEmpty(rawVideo.mimeType, rawVideo.mime_type, raw.mimeType)),
					size: valueOrBlank(firstNonEmpty(rawVideo.size, raw.size)),
					uploadStatus: valueOrBlank(firstNonEmpty(rawVideo.uploadStatus, rawVideo.upload_status, raw.uploadStatus)),
					uploadedAt: valueOrBlank(firstNonEmpty(rawVideo.uploadedAt, rawVideo.uploaded_at, raw.uploadedAt))
				},
				videoClips: rawVideoClips === undefined ? undefined : rawVideoClips
			})
			normalized._providedFields = this.getImportedProvidedFields(raw)
			return normalized
		},
		getImportedProvidedFields(raw) {
			const hasOwn = (target, key) => Object.prototype.hasOwnProperty.call(target || {}, key)
			const hasNonEmpty = (...values) => values.some((value) => value !== undefined && value !== null && String(value).trim() !== '')
			const video = raw.video || {}
			return {
				word: hasNonEmpty(raw.word),
				entryType: hasNonEmpty(raw.entryType, raw.type),
				phonetic: hasNonEmpty(raw.phonetic, raw.pronunciation),
				meaning: hasNonEmpty(raw.meaning, raw.definition, raw.translation),
				explanation: hasNonEmpty(raw.explanation, raw.analysis, raw.note),
				parts: (hasOwn(raw, 'parts') && Array.isArray(raw.parts) && raw.parts.length > 0) ||
					(hasOwn(raw, 'breakdown') && Array.isArray(raw.breakdown) && raw.breakdown.length > 0) ||
					(hasOwn(raw, 'children') && Array.isArray(raw.children) && raw.children.length > 0),
				videoClips: (hasOwn(raw, 'videoClips') && Array.isArray(raw.videoClips)) ||
					(hasOwn(raw, 'video_clips') && Array.isArray(raw.video_clips)) ||
					(hasOwn(raw, 'clips') && Array.isArray(raw.clips)),
				video: {
					url: hasNonEmpty(video.url, video.videoUrl, video.video_url, raw.videoUrl, raw.video_url),
					title: hasNonEmpty(video.title, video.segmentTitle, video.segment_title, video.videoTitle, video.video_title, raw.videoTitle, raw.video_title, raw.segment_title),
					focus: hasNonEmpty(video.focus, video.topic, video.clipFocus, video.clip_focus, video.learningPoint, video.learning_point, raw.focus, raw.topic, raw.clipFocus, raw.clip_focus, raw.learning_point),
					targetPart: hasNonEmpty(video.targetPart, video.target_part, video.partLabel, video.part_label, video.nodeId, video.node_id, raw.targetPart, raw.target_part, raw.partLabel, raw.part_label),
					note: hasNonEmpty(video.note, video.description, video.summary, video.clipNote, video.clip_note, raw.videoNote, raw.video_note, raw.clip_note),
					startSec: hasNonEmpty(video.startSec, raw.startSec),
					endSec: hasNonEmpty(video.endSec, raw.endSec),
					provider: hasNonEmpty(video.provider, raw.provider),
					assetId: hasNonEmpty(video.assetId, video.asset_id, raw.assetId),
					storagePath: hasNonEmpty(video.storagePath, video.storage_path, raw.storagePath),
					fileName: hasNonEmpty(video.fileName, video.file_name, raw.fileName),
					mimeType: hasNonEmpty(video.mimeType, video.mime_type, raw.mimeType),
					size: hasNonEmpty(video.size, raw.size),
					uploadStatus: hasNonEmpty(video.uploadStatus, video.upload_status, raw.uploadStatus),
					uploadedAt: hasNonEmpty(video.uploadedAt, video.uploaded_at, raw.uploadedAt)
				}
			}
		},
		normalizeImportedParts(parts) {
			return Array.isArray(parts) ? parts.filter((part) => part && typeof part === 'object' && !Array.isArray(part)).map((part) => ({
				label: part.label || part.text || part.id || '',
				title: part.title || part.meaning || part.name || '',
				targetId: part.targetId || part.target || part.id || part.label || ''
			})) : []
		},
		validateImportedWords(words) {
			const seen = {}
			for (let index = 0; index < words.length; index += 1) {
				const item = words[index]
				if (!item.id || !item.word) {
					return { ok: false, message: `第 ${index + 1} 条缺少 id 或 word` }
				}
				if (!this.startsWithEnglish(item.id) || !this.startsWithEnglish(item.word)) {
					return { ok: false, message: `第 ${index + 1} 条必须以英文字母开头` }
				}
				if (seen[item.id]) {
					return { ok: false, message: `导入内容里有重复 ID：${item.id}` }
				}
				const videoResult = this.validateVideoTime(item, index + 1)
				if (!videoResult.ok) return videoResult
				seen[item.id] = true
			}
			return { ok: true }
		},
		validateVideoTime(item, rowNumber) {
			const video = item.video || {}
			const clips = Array.isArray(item.videoClips) && item.videoClips.length ? item.videoClips : [video]
			for (let index = 0; index < clips.length; index += 1) {
				const clip = clips[index] || {}
				const hasStart = clip.startSec !== '' && clip.startSec !== undefined
				const hasEnd = clip.endSec !== '' && clip.endSec !== undefined
				const start = Number(clip.startSec)
				const end = Number(clip.endSec)
				const label = clips.length > 1 ? `第 ${rowNumber} 条第 ${index + 1} 段视频` : `第 ${rowNumber} 条视频`
				if (hasStart && (Number.isNaN(start) || start < 0)) {
					return { ok: false, message: `${label}开始秒必须是非负数字` }
				}
				if (hasEnd && (Number.isNaN(end) || end < 0)) {
					return { ok: false, message: `${label}结束秒必须是非负数字` }
				}
				if (hasStart && hasEnd && end <= start) {
					return { ok: false, message: `${label}结束秒必须大于开始秒` }
				}
			}
			return { ok: true }
		},
		stageImportedWords(incoming, newCount, updateCount) {
			const incomingById = incoming.reduce((result, item) => {
				result[item.id] = this.normalizePendingWord(item)
				return result
			}, {})
			const usedIds = {}
			this.pendingWords = this.pendingWords.map((item) => {
				if (incomingById[item.id]) {
					usedIds[item.id] = true
					return this.normalizePendingWord(this.mergeImportedWord(item, incomingById[item.id]))
				}
				return this.normalizePendingWord(item)
			})
			const newPending = incoming.filter((item) => !usedIds[item.id]).map((item) => this.normalizePendingWord(item))
			this.pendingWords = newPending.concat(this.pendingWords)
			if (this.pendingWords[0]) {
				this.activeBucket = 'pending'
				this.selectedSource = 'pending'
				this.selectedId = this.pendingWords[0].id
				this.form = clone(this.pendingWords[0])
				this.syncVideoUploadStateFromForm()
			}
			this.expandedLetters = this.defaultExpandedLetters(this.pendingWords)
			this.ensureLetterExpanded(this.getFirstLetter(this.form) || '#')
			this.persistPendingWords()
			this.saveState = '已加入未上传待检查'
			this.importResult = `已加入未上传列表：新增 ${newCount} 条，覆盖 ${updateCount} 条。请逐条检查后再批量加入草稿。`
			uni.showToast({ title: '已加入未上传', icon: 'success' })
		},
		commitCurrentPendingToDraft() {
			this.persistFormToList()
			const target = this.pendingWords.find((item) => item.id === this.selectedId)
			if (!target) return
			uni.showModal({
				title: '加入草稿列表',
				content: `确认把「${target.word}」加入已上传草稿库吗？之后还需要点击顶部“发布全部草稿”才会最终发布。`,
				confirmText: '加入草稿',
				cancelText: '再检查',
				confirmColor: '#fe8500',
				success: (result) => {
					if (!result.confirm) return
					const draft = this.normalizeWord(Object.assign({}, target, { status: 'draft' }))
					const existed = this.words.some((item) => item.id === draft.id)
					this.applyImportedWords([draft], existed ? 0 : 1, existed ? 1 : 0, { silentToast: true })
					this.pendingWords = this.pendingWords.filter((item) => item.id !== target.id)
					this.persistPendingWords()
					this.activeBucket = 'uploaded'
					this.selectedSource = 'uploaded'
					this.selectedId = draft.id
					this.form = clone(draft)
					this.syncVideoUploadStateFromForm()
					this.expandedLetters = this.defaultExpandedLetters(this.words)
					this.ensureLetterExpanded(this.getFirstLetter(draft) || '#')
					this.saveState = '已加入草稿列表'
					uni.showToast({ title: '已加入草稿', icon: 'success' })
				}
			})
		},
		commitPendingWordsToDrafts() {
			if (!this.pendingWords.length) {
				uni.showToast({ title: '未上传列表为空', icon: 'none' })
				return
			}
			if (!this.validateCurrent()) return
			this.persistFormToList()
			const validation = this.validateImportedWords(this.pendingWords)
			if (!validation.ok) {
				this.importResult = validation.message
				uni.showToast({ title: validation.message, icon: 'none' })
				return
			}
			const existingIds = this.words.reduce((result, item) => {
				result[item.id] = true
				return result
			}, {})
			const updateCount = this.pendingWords.filter((item) => existingIds[item.id]).length
			const newCount = this.pendingWords.length - updateCount
			uni.showModal({
				title: '批量加入草稿',
				content: `确认把未上传列表中的 ${this.pendingWords.length} 条加入已上传草稿库吗？新增 ${newCount} 条，覆盖 ${updateCount} 条。`,
				confirmText: '加入草稿',
				cancelText: '再检查',
				confirmColor: '#fe8500',
				success: (result) => {
					if (!result.confirm) return
					const drafts = this.pendingWords.map((item) => this.normalizeWord(Object.assign({}, item, { status: 'draft' })))
					this.applyImportedWords(drafts, newCount, updateCount, { silentToast: true })
					this.pendingWords = []
					this.persistPendingWords()
					this.activeBucket = 'uploaded'
					this.selectedSource = 'uploaded'
					if (drafts[0]) {
						this.selectedId = drafts[0].id
						this.form = clone(drafts[0])
						this.syncVideoUploadStateFromForm()
					}
					this.expandedLetters = this.defaultExpandedLetters(this.words)
					this.saveState = '未上传词条已批量加入草稿'
					this.importResult = `已批量加入草稿：新增 ${newCount} 条，覆盖 ${updateCount} 条。最后请点击顶部“发布全部草稿”。`
					uni.showToast({ title: '已加入草稿', icon: 'success' })
				}
			})
		},
		clearPendingWords() {
			if (!this.pendingWords.length) {
				uni.showToast({ title: '未上传列表为空', icon: 'none' })
				return
			}
			uni.showModal({
				title: '清空未上传列表',
				content: '确认清空所有未上传待检查词条吗？这不会影响已上传草稿库。',
				confirmText: '确认清空',
				cancelText: '取消',
				confirmColor: '#d0473d',
				success: (result) => {
					if (!result.confirm) return
					this.pendingWords = []
					this.persistPendingWords()
					this.activeBucket = 'uploaded'
					this.selectedSource = 'uploaded'
					this.selectedId = this.words[0] ? this.words[0].id : ''
					this.form = this.words[0] ? clone(this.words[0]) : clone(seedWords[0])
					this.syncVideoUploadStateFromForm()
					this.expandedLetters = this.defaultExpandedLetters(this.words)
					this.saveState = '已清空未上传列表'
					uni.showToast({ title: '已清空', icon: 'success' })
				}
			})
		},
		persistPendingWords() {
			uni.setStorageSync(PENDING_STORAGE_KEY, this.stripRuntimeVideoFields(this.pendingWords))
		},
		applyImportedWords(incoming, newCount, updateCount, options) {
			const firstImportedId = incoming[0] ? incoming[0].id : ''
			const incomingById = incoming.reduce((result, item) => {
				result[item.id] = item
				return result
			}, {})
			const usedIds = {}
			this.words = this.words.map((item) => {
				if (incomingById[item.id]) {
					usedIds[item.id] = true
					return this.mergeImportedWord(item, incomingById[item.id])
				}
				return item
			})
			const newWords = incoming.filter((item) => !usedIds[item.id]).map((item) => this.stripImportMeta(item))
			this.words = newWords.concat(this.words)
			const selected = this.words.find((item) => item.id === firstImportedId)
			if (selected) {
				this.selectedId = selected.id
				this.form = clone(selected)
				this.syncVideoUploadStateFromForm()
			}
			this.expandedLetters = this.defaultExpandedLetters(this.words)
			this.ensureLetterExpanded(this.getFirstLetter(this.form) || '#')
			uni.setStorageSync(STORAGE_KEY, this.stripRuntimeVideoFields(this.words))
			this.saveState = '已导入批量草稿'
			this.importResult = `导入完成：新增 ${newCount} 条，更新 ${updateCount} 条。请抽查后再发布。`
			if (!options || !options.silentToast) {
				uni.showToast({ title: '导入完成', icon: 'success' })
			}
		},
		mergeImportedWord(existing, incoming) {
			const next = clone(existing)
			const provided = incoming._providedFields || {}
			const hasProvidedMeta = !!incoming._providedFields
			;['word', 'entryType', 'phonetic', 'meaning', 'explanation'].forEach((field) => {
				if ((!hasProvidedMeta || provided[field]) && incoming[field] !== '' && incoming[field] !== undefined) {
					next[field] = incoming[field]
				}
			})
			if ((!hasProvidedMeta || provided.parts) && Array.isArray(incoming.parts) && incoming.parts.length) {
				next.parts = incoming.parts
			}
			if ((!hasProvidedMeta || provided.videoClips) && Array.isArray(incoming.videoClips)) {
				next.videoClips = incoming.videoClips
			}
			const incomingVideo = incoming.video || {}
			const providedVideo = provided.video || {}
			next.video = next.video || {}
			;['url', 'title', 'focus', 'targetPart', 'note', 'startSec', 'endSec', 'provider', 'assetId', 'wordId', 'segmentTitle', 'storagePath', 'fileName', 'mimeType', 'size', 'uploadStatus', 'uploadedAt'].forEach((field) => {
				if ((!hasProvidedMeta || providedVideo[field]) && incomingVideo[field] !== '' && incomingVideo[field] !== undefined) {
					next.video[field] = incomingVideo[field]
				}
			})
			const hasProvidedVideoField = Object.keys(providedVideo).some((field) => providedVideo[field])
			if ((!hasProvidedMeta || hasProvidedVideoField) && !provided.videoClips) {
				const normalizedVideo = this.normalizeVideoClip(next.video, 0)
				if (this.hasVideoClipPayload(normalizedVideo)) {
					const currentClips = Array.isArray(next.videoClips) ? next.videoClips : []
					const firstClip = currentClips[0] || {}
					const mergedFirstClip = Object.assign({}, firstClip, normalizedVideo, {
						clipId: firstClip.clipId || normalizedVideo.clipId || `${next.id || next.word || 'word'}-clip-1`
					})
					next.videoClips = [mergedFirstClip].concat(currentClips.slice(1))
				}
			}
			next.status = 'draft'
			return this.stripImportMeta(this.normalizeWord(next))
		},
		stripImportMeta(item) {
			const next = clone(item)
			delete next._providedFields
			return next
		},
		buildMiniappPreviewWord(sourceWord) {
			const source = this.stripRuntimeVideoFields(this.normalizeWord(sourceWord || this.form))
			const parts = Array.isArray(source.parts) ? source.parts.map((part) => ({
				...part,
				text: part.text || part.label || '',
				meaning: part.meaning || part.title || '',
				targetId: part.targetId || ''
			})) : []
			return {
				...source,
				cardType: source.cardType || this.entryTypeText(source),
				level: source.level || this.entryTypeText(source),
				parts,
				tip: source.tip || source.explanation || '',
				pictograph: source.pictograph || source.explanation || '',
				videoTitle: source.videoTitle || (source.video && source.video.title) || '',
				videoDuration: source.videoDuration || ''
			}
		},
		async buildRuntimeVideoAssets(sourceWord, warnings) {
			const source = sourceWord || this.form
			const clips = Array.isArray(source.videoClips) ? source.videoClips : []
			const assets = []
			for (let index = 0; index < clips.length; index += 1) {
				const clip = clips[index]
				const previewUrl = this.getRuntimePreviewUrlForClip(source, clip)
				// 只把后台当前会话中的 blob/data 临时视频同步给本地 bridge；线上不能依赖这种地址。
				if (!/^(blob:|data:)/i.test(previewUrl)) {
					if (this.hasMockCloudVideo(clip) && Array.isArray(warnings)) {
						warnings.push(`${source.word || source.id || '词条'} 第 ${index + 1} 段只有 mock-cloud 占位地址；请重新选择本地视频后再同步，或上线后接入云存储 HTTPS 地址`)
					}
					continue
				}
				const clipSize = Number(clip && clip.size ? clip.size : 0)
				if (clipSize > BRIDGE_RUNTIME_ASSET_MAX_BYTES) {
					if (Array.isArray(warnings)) {
						warnings.push(`${source.word || source.id || '词条'} 第 ${index + 1} 段超过 ${BRIDGE_RUNTIME_ASSET_MAX_MB}MB，只同步片段信息`)
					}
					continue
				}
				const dataUrl = await this.readPreviewUrlAsDataUrl(previewUrl)
				if (!dataUrl) {
					if (Array.isArray(warnings)) {
						warnings.push(`${source.word || source.id || '词条'} 第 ${index + 1} 段本地视频读取失败；请重新选择视频文件后再同步`)
					}
					continue
				}
				assets.push({
					clipId: clip.clipId || `clip-${index + 1}`,
					fileName: clip.fileName || `${source.id || source.word || 'word'}-${index + 1}.mp4`,
					dataUrl
				})
			}
			return assets
		},
		readPreviewUrlAsDataUrl(previewUrl) {
			if (/^data:/i.test(previewUrl)) {
				return Promise.resolve(previewUrl)
			}
			if (!/^blob:/i.test(previewUrl) || typeof fetch !== 'function' || typeof FileReader === 'undefined') {
				return Promise.resolve('')
			}
			return fetch(previewUrl)
				.then((response) => response.blob())
				.then((blob) => new Promise((resolve) => {
					const reader = new FileReader()
					reader.onload = () => resolve(String(reader.result || ''))
					reader.onerror = () => resolve('')
					reader.readAsDataURL(blob)
				}))
				.catch(() => '')
		},
		hasMockCloudVideo(clip) {
			const url = String(clip && clip.url ? clip.url : '').trim()
			return url.indexOf('mock-cloud://') === 0
		},
		getRuntimePreviewUrlForClip(source, clip) {
			const directUrl = String(clip && clip.localPreviewUrl ? clip.localPreviewUrl : '').trim()
			if (/^(blob:|data:)/i.test(directUrl)) return directUrl

			const sourceId = String(source && source.id ? source.id : '').trim()
			const currentId = String(this.form && this.form.id ? this.form.id : '').trim()
			const currentPreviewUrl = String(this.videoUpload && this.videoUpload.previewUrl ? this.videoUpload.previewUrl : '').trim()
			if (!sourceId || sourceId !== currentId || !/^(blob:|data:)/i.test(currentPreviewUrl)) return ''

			const uploadFileName = String(this.videoUpload && this.videoUpload.fileName ? this.videoUpload.fileName : '').trim()
			const uploadSizeLabel = String(this.videoUpload && this.videoUpload.fileSizeLabel ? this.videoUpload.fileSizeLabel : '').trim()
			const clipFileName = String(clip && clip.fileName ? clip.fileName : '').trim()
			const clipSize = Number(clip && clip.size ? clip.size : 0)
			const currentVideo = source && source.video ? source.video : {}
			const sameFileName = uploadFileName && clipFileName && uploadFileName === clipFileName
			const sameAsset = clip && currentVideo && clip.assetId && currentVideo.assetId && clip.assetId === currentVideo.assetId
			const sameStorage = clip && currentVideo && clip.storagePath && currentVideo.storagePath && clip.storagePath === currentVideo.storagePath
			const sameSize = clipSize > 0 && uploadSizeLabel && this.formatFileSize(clipSize) === uploadSizeLabel

			return sameFileName || sameAsset || sameStorage || sameSize ? currentPreviewUrl : ''
		},
		hasCurrentVideoDraftPayload() {
			const video = this.form && this.form.video ? this.form.video : {}
			if (this.hasVideoClipPayload(video)) return true
			if (this.videoUpload && this.videoUpload.previewUrl) return true
			return ['title', 'focus', 'targetPart', 'note', 'startSec', 'endSec'].some((field) => {
				const value = video[field]
				return value !== undefined && value !== null && String(value).trim() !== ''
			})
		},
		getComparableVideoClipKey(clip) {
			const source = clip || {}
			const fields = ['url', 'localPreviewUrl', 'title', 'focus', 'targetPart', 'note', 'startSec', 'endSec', 'provider', 'assetId', 'storagePath', 'fileName', 'mimeType', 'size']
			return fields.map((field) => {
				const value = source[field]
				return value === undefined || value === null ? '' : String(value).trim()
			}).join('|')
		},
		isCurrentVideoDraftAlreadySaved() {
			if (!this.hasCurrentVideoDraftPayload()) return true
			const clips = Array.isArray(this.form.videoClips) ? this.form.videoClips : []
			const currentKey = this.getComparableVideoClipKey(this.form.video || {})
			return clips.some((clip) => this.getComparableVideoClipKey(clip) === currentKey)
		},
		confirmUnsavedVideoDraftBeforeSync() {
			if (this.isCurrentVideoDraftAlreadySaved()) return Promise.resolve(true)
			const isEditing = this.editingClipIndex > -1
			return new Promise((resolve) => {
				uni.showModal({
					title: isEditing ? '当前片段修改未保存' : '当前片段还没保存',
					content: isEditing
						? '你正在编辑一个已关联片段。建议先保存片段修改，再同步到小程序预览。'
						: '你已经填写了当前片段信息，但还没有保存到下方片段清单。建议先保存为片段，再同步到小程序预览。',
					confirmText: isEditing ? '保存修改' : '保存片段',
					cancelText: '暂不同步',
					success: (res) => {
						if (!res || !res.confirm) {
							resolve(false)
							return
						}
						resolve(this.commitCurrentVideoClip())
					},
					fail: () => resolve(false)
				})
			})
		},
		async syncCurrentToMiniappPreview() {
			if (this.bridgeSync.busy) return
			if (!this.validateCurrent({ skipVideoClipFlush: true })) return
			if (!(await this.confirmUnsavedVideoDraftBeforeSync())) return
			this.persistFormToList()

			this.bridgeSync.busy = true
			this.bridgeSync.message = '正在同步到小程序预览桥...'
			this.saveState = '正在同步到小程序预览桥...'

			try {
				const warnings = []
				const result = await this.syncWordToMiniappPreview(this.form, warnings)
				const word = this.buildMiniappPreviewWord(this.form)
				const warningText = warnings.length ? `；${warnings[0]}` : ''

				this.bridgeSync.message = `已同步 ${result.word || word.word}，${result.clipCount || 0} 段视频${warningText}`
				this.saveState = warnings.length
					? '已同步到小程序预览，但部分视频未写入本地桥'
					: '已同步到小程序预览，HBuilderX 保存后微信开发者工具会刷新'
				uni.showToast({ title: '已同步到小程序预览', icon: 'success' })
			} catch (error) {
				const message = error && error.message ? error.message : '同步失败'
				this.bridgeSync.message = message
				this.saveState = '同步失败：请先运行 npm run dev:preview-bridge'
				uni.showModal({
					title: '本地预览桥未连接',
					content: '请先在项目根目录运行 npm run dev:preview-bridge，然后再点击同步到小程序预览。',
					showCancel: false
				})
			} finally {
				this.bridgeSync.busy = false
			}
		},
		async syncAllToMiniappPreview() {
			if (this.bridgeSync.busy) return
			if (!this.validateCurrent({ skipVideoClipFlush: true })) return
			if (!(await this.confirmUnsavedVideoDraftBeforeSync())) return
			this.persistFormToList()
			if (!this.validateAllWords()) return

			const sourceWords = this.words.filter((item) => item && item.id && item.word)
			if (!sourceWords.length) {
				uni.showToast({ title: '暂无可同步词条', icon: 'none' })
				return
			}

			this.bridgeSync.busy = true
			this.bridgeSync.message = `正在同步 ${sourceWords.length} 个词条到小程序预览...`
			this.saveState = '正在批量同步到小程序预览桥...'

			try {
				let clipCount = 0
				const warnings = []
				for (let index = 0; index < sourceWords.length; index += 1) {
					const item = sourceWords[index]
					this.bridgeSync.message = `正在同步 ${index + 1}/${sourceWords.length}：${item.word}`
					const result = await this.syncWordToMiniappPreview(item, warnings)
					clipCount += Number(result.clipCount || 0)
				}

				const warningText = warnings.length ? `；${warnings.length} 个视频片段未写入本地桥` : ''
				this.bridgeSync.message = `已同步 ${sourceWords.length} 个词条，${clipCount} 段视频${warningText}`
				this.saveState = warnings.length
					? '已批量同步到小程序预览，但部分视频只同步了片段信息'
					: '已批量同步到小程序预览，HBuilderX 保存后微信开发者工具会刷新'
				uni.showToast({ title: warnings.length ? '已同步，部分视频待重选' : '已同步全部词条', icon: 'success' })
			} catch (error) {
				const message = error && error.message ? error.message : '批量同步失败'
				this.bridgeSync.message = message
				this.saveState = '批量同步失败：请确认本地预览桥已运行'
				uni.showModal({
					title: '批量同步失败',
					content: '请先在项目根目录运行 npm run dev:preview-bridge，然后重新点击“同步全部到小程序预览”。',
					showCancel: false
				})
			} finally {
				this.bridgeSync.busy = false
			}
		},
		async syncWordToMiniappPreview(sourceWord, warnings) {
			const word = this.buildMiniappPreviewWord(sourceWord)
			const runtimeAssets = await this.buildRuntimeVideoAssets(sourceWord, warnings)
			// 本地 preview bridge 只给电脑端微信开发者工具调试使用；正式上线不能请求 127.0.0.1。
			const response = await fetch(`http://127.0.0.1:${this.bridgeSync.port}/sync-word`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ word, runtimeAssets })
			})
			const result = await response.json()
			if (!response.ok || !result.ok) {
				throw new Error(result.message || 'Preview bridge sync failed')
			}
			return result
		},
		copyJson() {
			uni.setClipboardData({
				data: this.currentJson,
				success: () => {
					this.saveState = '已复制 JSON'
				}
			})
		}
	}
}
</script>

<style lang="scss" scoped>
.admin-page {
	min-height: 100vh;
	padding: 28px;
	background: #eef7fb;
	color: #12344d;
	box-sizing: border-box;
}

.hero {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 24px;
	padding: 28px;
	border-radius: 28px;
	background: linear-gradient(135deg, #0e3a5c, #1d6799);
	color: #fff;
	box-shadow: 0 20px 50px rgba(14, 58, 92, 0.22);
}

.eyebrow,
.subtitle,
.panel-note,
.status-label,
.next-line {
	display: block;
	color: rgba(255, 255, 255, 0.72);
	font-size: 13px;
	line-height: 1.7;
}

.title {
	display: block;
	margin-top: 8px;
	font-size: 30px;
	font-weight: 800;
	letter-spacing: 1px;
}

.hero-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 12px;
}

button {
	margin: 0;
	border: 0;
	border-radius: 999px;
	font-size: 14px;
	line-height: 40px;
}

button::after {
	border: 0;
}

.primary-button {
	padding: 0 24px;
	background: #ffbd59;
	color: #143852;
	font-weight: 700;
}

.outline-button {
	padding: 0 24px;
	background: #eaf7ff;
	color: #0e3a5c;
	font-weight: 700;
}

.publish-all-button {
	padding: 0 32px;
	background: #ffbd59;
	color: #12344d;
	font-size: 16px;
	font-weight: 800;
	line-height: 48px;
	box-shadow: 0 12px 28px rgba(254, 133, 0, 0.24);
}

.ghost-button {
	padding: 0 24px;
	background: rgba(255, 255, 255, 0.14);
	color: #fff;
}

.small-button {
	padding: 0 16px;
	background: #0e3a5c;
	color: #fff;
	line-height: 34px;
}

.secondary-button,
.publish-button {
	padding: 0 18px;
	line-height: 36px;
	font-weight: 700;
}

.secondary-button {
	background: #edf7fc;
	color: #0e3a5c;
}

.publish-button {
	background: #fe8500;
	color: #fff;
}

.status-grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 16px;
	margin: 18px 0;
}

.status-card {
	padding: 20px;
	border-radius: 22px;
	background: #fff;
	box-shadow: 0 12px 30px rgba(14, 58, 92, 0.08);
}

.status-card.accent {
	background: #fff6df;
}

.status-value {
	display: block;
	font-size: 30px;
	font-weight: 800;
	color: #0e3a5c;
}

.status-label {
	color: #6c8799;
}

.workbench {
	display: grid;
	grid-template-columns: minmax(390px, 420px) minmax(500px, 1fr) minmax(320px, 360px);
	gap: 16px;
	align-items: start;
}

.panel {
	border-radius: 26px;
	background: #fff;
	box-shadow: 0 16px 40px rgba(14, 58, 92, 0.09);
	padding: 20px;
	box-sizing: border-box;
}

.panel-head,
.section-head {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 16px;
	margin-bottom: 16px;
}

.panel-title,
.section-title {
	display: block;
	font-size: 18px;
	font-weight: 800;
	color: #12344d;
}

.panel-note {
	color: #7793a6;
}

.search-input,
.field input,
.picker-box,
.field textarea,
.json-box,
.part-row input {
	width: 100%;
	border-radius: 14px;
	border: 1px solid #d8e9f2;
	background: #f8fcff;
	box-sizing: border-box;
	font-size: 14px;
	color: #12344d;
}

.search-input,
.field input,
.picker-box,
.part-row input {
	height: 42px;
	padding: 0 14px;
}

.bucket-tabs {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 10px;
	margin-top: 14px;
}

.bucket-tab {
	background: #f3f9fd;
	color: #6f8da0;
	font-weight: 800;
	border: 1px solid #d8e9f2;
	line-height: 40px;
}

.bucket-tab.active {
	background: #0e3a5c;
	color: #fff;
	border-color: #0e3a5c;
	box-shadow: 0 10px 20px rgba(14, 58, 92, 0.16);
}

.word-list {
	height: 560px;
	margin-top: 14px;
}

.accordion-list {
	padding-right: 4px;
	box-sizing: border-box;
}

.list-summary-card {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
	margin-top: 14px;
	padding: 14px;
	border-radius: 18px;
	background: linear-gradient(135deg, #f5fbff, #e7f5fc);
	border: 1px solid #d8e9f2;
}

.summary-kicker,
.summary-main,
.summary-sub {
	display: block;
}

.summary-kicker,
.summary-sub {
	font-size: 12px;
	color: #7793a6;
}

.summary-main {
	margin-top: 4px;
	font-size: 20px;
	font-weight: 800;
	color: #0e3a5c;
}

.letter-group {
	margin-bottom: 8px;
	border-radius: 18px;
	overflow: hidden;
	background: #f5fbff;
	border: 1px solid #e0edf4;
}

.accordion-head {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 50px;
	padding: 0 14px;
	background: #ecf7fd;
	cursor: pointer;
}

.accordion-head.expanded {
	background: #0e3a5c;
	color: #fff;
}

.accordion-head.empty {
	opacity: 0.58;
}

.accordion-head.expanded.empty {
	opacity: 1;
}

.letter-ring {
	width: 24px;
	height: 24px;
	border-radius: 50%;
	border: 2px solid #b9c9d4;
	box-sizing: border-box;
}

.letter-ring.has-items {
	border-color: #15a27e;
	box-shadow: inset 0 0 0 4px rgba(21, 162, 126, 0.08);
}

.accordion-head.expanded .letter-ring.has-items {
	border-color: #ffbd59;
}

.accordion-letter {
	min-width: 32px;
	font-size: 18px;
	font-weight: 800;
	color: #0e3a5c;
}

.accordion-head.expanded .accordion-letter,
.accordion-head.expanded .accordion-count,
.accordion-head.expanded .accordion-arrow {
	color: #fff;
}

.accordion-fill {
	flex: 1;
}

.accordion-count,
.accordion-arrow {
	color: #66869b;
	font-size: 16px;
	font-weight: 700;
}

.accordion-body {
	padding: 8px 10px 12px;
	background: #fff;
}

.accordion-word-row {
	display: grid;
	grid-template-columns: 34px minmax(0, 1fr) auto 14px;
	align-items: start;
	gap: 12px;
	padding: 12px 10px;
	margin-top: 8px;
	border-radius: 16px;
	background: #f8fcff;
	border: 1px solid transparent;
	cursor: pointer;
}

.accordion-word-row.active {
	border-color: #7ac7ef;
	background: #e9f7ff;
}

.accordion-word-row.letter {
	background: #fff9e8;
}

.accordion-word-row.root {
	background: #f4efff;
}

.accordion-word-row.word {
	background: #f5fbff;
}

.entry-dot {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 30px;
	height: 30px;
	border-radius: 50%;
	font-size: 12px;
	font-weight: 800;
}

.entry-dot.letter {
	background: #ffeba2;
	color: #8a5d00;
}

.entry-dot.root {
	background: #e6d9ff;
	color: #6c35bc;
}

.entry-dot.word {
	background: #dff5ef;
	color: #13795b;
}

.entry-main {
	min-width: 0;
}

.entry-title-line {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
	min-width: 0;
}

.entry-word {
	overflow: visible;
	text-overflow: clip;
	white-space: normal;
	word-break: break-word;
	line-height: 1.2;
	font-size: 18px;
	font-weight: 800;
	color: #0e3a5c;
}

.entry-type-pill {
	flex: 0 0 auto;
	padding: 3px 8px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 700;
}

.entry-type-pill.letter {
	background: #fff1c6;
	color: #8a5d00;
}

.entry-type-pill.root {
	background: #ebe0ff;
	color: #6c35bc;
}

.entry-type-pill.word {
	background: #e4f8ee;
	color: #1b8b55;
}

.entry-meaning {
	display: -webkit-box;
	overflow: hidden;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	white-space: normal;
	line-height: 1.45;
	margin-top: 4px;
	font-size: 12px;
	color: #7892a4;
}

.entry-chevron {
	color: #9bb0be;
	font-size: 20px;
	font-weight: 700;
}

.group-empty {
	padding: 16px 10px 8px;
	color: #8ba1b1;
	text-align: center;
	font-size: 13px;
}

.status-pill {
	flex: 0 0 auto;
	align-self: start;
	margin-top: 2px;
	padding: 4px 10px;
	border-radius: 999px;
	font-size: 12px;
	background: #eef3f7;
	color: #61788a;
}

.status-pill.published {
	background: #e4f8ee;
	color: #1b8b55;
}

.status-pill.review {
	background: #fff1d6;
	color: #a06600;
}

.status-pill.pending {
	background: #f2e8ff;
	color: #6c35bc;
}

.empty-list {
	padding: 24px;
	text-align: center;
	color: #8ba1b1;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 14px;
}

.field {
	display: block;
	margin-bottom: 14px;
}

.field.span-2 {
	grid-column: 1 / -1;
}

.field text {
	display: block;
	margin-bottom: 8px;
	font-size: 13px;
	font-weight: 700;
	color: #466578;
}

.field textarea {
	min-height: 96px;
	padding: 12px 14px;
	line-height: 1.7;
}

.video-upload-card {
	margin-bottom: 16px;
	padding: 16px;
	border: 1px solid #d8e9f2;
	border-radius: 20px;
	background: #f8fcff;
}

.video-upload-main {
	display: flex;
	align-items: center;
	gap: 14px;
}

.video-upload-copy {
	min-width: 0;
}

.video-upload-title,
.video-upload-note {
	display: block;
}

.video-upload-title {
	color: #12344d;
	font-size: 14px;
	font-weight: 800;
}

.video-upload-note {
	margin-top: 4px;
	color: #66869b;
	font-size: 12px;
	line-height: 1.5;
}

.upload-progress-track {
	overflow: hidden;
	height: 8px;
	margin-top: 14px;
	border-radius: 999px;
	background: #e1edf5;
}

.upload-progress-bar {
	height: 100%;
	border-radius: inherit;
	background: #fe8500;
	transition: width 0.2s ease;
}

.video-upload-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	margin-top: 10px;
	color: #66869b;
	font-size: 12px;
}

.admin-video-preview {
	width: 100%;
	height: 300px;
	margin-top: 14px;
	border-radius: 16px;
	background: #0e3a5c;
}

.video-preview-tools {
	margin-top: 12px;
	padding: 12px;
	border: 1px solid #d8e9f2;
	border-radius: 16px;
	background: #ffffff;
}

.video-time-row {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	color: #466578;
	font-size: 12px;
	font-weight: 700;
}

.clip-action-row {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 10px;
}

.video-preview-tip {
	display: block;
	margin-top: 8px;
	color: #7b96a8;
	font-size: 12px;
	line-height: 1.6;
}

.video-asset-box {
	margin-top: 14px;
	padding: 12px;
	border-radius: 16px;
	background: #ebf8ff;
	border: 1px solid #cce9f8;
}

.video-asset-title,
.video-asset-line {
	display: block;
}

.video-asset-title {
	color: #0e3a5c;
	font-size: 13px;
	font-weight: 800;
}

.video-asset-line {
	margin-top: 4px;
	color: #466578;
	font-size: 12px;
	word-break: break-all;
}

.clear-video-button {
	margin-top: 10px;
}

.miniapp-sync-card {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	margin-top: 14px;
	padding: 14px;
	border: 1px solid #bfe3f7;
	border-radius: 18px;
	background: linear-gradient(135deg, #f8fcff 0%, #e9f7ff 100%);
}

.miniapp-sync-copy {
	min-width: 0;
}

.miniapp-sync-title,
.miniapp-sync-note {
	display: block;
}

.miniapp-sync-title {
	color: #0e3a5c;
	font-size: 14px;
	font-weight: 800;
}

.miniapp-sync-note {
	margin-top: 4px;
	color: #66869b;
	font-size: 12px;
	line-height: 1.5;
}

.miniapp-sync-button {
	flex-shrink: 0;
	padding: 0 20px;
	line-height: 38px;
	border-radius: 999px;
	background: #0e3a5c;
	color: #fff;
	font-size: 13px;
	font-weight: 800;
}

.miniapp-sync-button + .miniapp-sync-button {
	margin-left: 10px;
}

.miniapp-sync-button.secondary {
	background: #e8f6ff;
	color: #0e3a5c;
}

.miniapp-sync-button::after {
	border: 0;
}

.miniapp-sync-button[disabled] {
	opacity: 0.62;
}

.final-sync-card {
	margin-top: 14px;
	border-color: #0e3a5c;
	background: linear-gradient(135deg, #eef9ff 0%, #dff3ff 100%);
}

.clip-draft-actions {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 14px;
	margin: -4px 0 16px;
	padding: 14px 16px;
	border: 1px solid #cde6f5;
	border-radius: 18px;
	background: #f8fcff;
}

.clip-draft-actions.editing {
	border-color: #fe8500;
	background: #fff9ef;
}

.clip-draft-copy {
	min-width: 0;
}

.clip-draft-title,
.clip-draft-note {
	display: block;
}

.clip-draft-title {
	color: #0e3a5c;
	font-size: 14px;
	font-weight: 900;
}

.clip-draft-note {
	margin-top: 4px;
	color: #66869b;
	font-size: 12px;
	line-height: 1.5;
}

.clip-draft-buttons {
	display: flex;
	flex-shrink: 0;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: 8px;
}

.clip-list-card {
	margin: 0 0 18px;
	padding: 16px;
	border: 1px solid #d8e9f2;
	border-radius: 20px;
	background: #ffffff;
}

.clip-list-head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 12px;
}

.clip-list-title,
.clip-list-note {
	display: block;
}

.clip-list-title {
	color: #0e3a5c;
	font-size: 15px;
	font-weight: 900;
}

.clip-list-note {
	margin-top: 4px;
	color: #66869b;
	font-size: 12px;
	line-height: 1.5;
}

.clip-list-count {
	flex-shrink: 0;
	padding: 6px 12px;
	border-radius: 999px;
	background: #eaf7ff;
	color: #0e3a5c;
	font-size: 12px;
	font-weight: 900;
}

.clip-list {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.clip-item {
	display: grid;
	grid-template-columns: 34px minmax(0, 1fr) auto;
	align-items: center;
	gap: 12px;
	padding: 12px;
	border: 1px solid #e0edf5;
	border-radius: 16px;
	background: #f8fcff;
}

.clip-item.editing {
	border-color: #fe8500;
	background: #fffaf0;
}

.clip-index {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 34px;
	height: 34px;
	border-radius: 50%;
	background: #eaf7ff;
	color: #0e3a5c;
	font-weight: 900;
}

.clip-title,
.clip-meta {
	display: block;
}

.clip-title {
	color: #12344d;
	font-size: 14px;
	font-weight: 800;
}

.clip-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 6px;
}

.clip-tag {
	display: inline-flex;
	padding: 3px 8px;
	border-radius: 999px;
	background: #eef7fb;
	color: #466578;
	font-size: 11px;
	font-weight: 800;
}

.clip-tag.focus {
	background: #fff4db;
	color: #9c5b00;
}

.clip-note {
	display: block;
	margin-top: 6px;
	color: #466578;
	font-size: 12px;
	line-height: 1.5;
}

.clip-meta {
	margin-top: 4px;
	color: #66869b;
	font-size: 12px;
	word-break: break-all;
}

.clip-buttons {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: 6px;
}

.clip-mini-button {
	min-width: 48px;
	padding: 0 10px;
	border-radius: 999px;
	background: #eef7fb;
	color: #0e3a5c;
	font-size: 12px;
	line-height: 30px;
}

.clip-mini-button::after {
	border: 0;
}

.clip-mini-button[disabled] {
	opacity: 0.45;
}

.clip-mini-button.danger {
	background: #fff0ed;
	color: #c74a36;
}

.clip-empty {
	padding: 14px;
	border-radius: 14px;
	background: #f5fbff;
	color: #66869b;
	font-size: 13px;
	line-height: 1.6;
}

.save-state {
	color: #fe8500;
	font-size: 13px;
}

.editor-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 10px;
}

.pending-actions {
	display: grid;
	grid-template-columns: 1fr 1.2fr;
	gap: 10px;
	margin-top: 14px;
	padding-top: 14px;
	border-top: 1px solid #e4eef5;
}

.readonly-status {
	font-weight: 700;
}

.readonly-status.published {
	background: #e4f8ee;
	border-color: #b9ebcd;
	color: #1b8b55;
}

.readonly-status.draft {
	background: #f4f8fb;
	color: #61788a;
}

.readonly-status.review {
	background: #fff1d6;
	border-color: #ffd894;
	color: #a06600;
}

.readonly-status.pending {
	background: #f6f0ff;
	border-color: #ddc9ff;
	color: #6c35bc;
}

.entry-type-picker {
	font-weight: 800;
}

.entry-type-picker.letter {
	background: #fff9e8;
	border-color: #ffdfa0;
	color: #8a5d00;
}

.entry-type-picker.root {
	background: #f6f0ff;
	border-color: #ddc9ff;
	color: #6c35bc;
}

.entry-type-picker.word {
	background: #ecfbf4;
	border-color: #bdebd5;
	color: #13795b;
}

.parts {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-bottom: 18px;
}

.part-row {
	display: grid;
	grid-template-columns: 0.8fr 1.1fr 1.1fr 72px;
	gap: 10px;
}

.remove-button {
	background: #fff0ed;
	color: #c74a36;
	line-height: 42px;
}

.json-box {
	height: 160px;
	padding: 12px;
	font-family: Consolas, Monaco, monospace;
	font-size: 12px;
	color: #37566b;
}

.import-panel {
	margin-top: 18px;
}

.video-native-picker-host {
	display: flex;
	align-items: center;
	min-width: 260px;
	min-height: 46px;
	cursor: default;
	user-select: none;
}

.native-picker-loading {
	display: inline-flex;
	align-items: center;
	min-height: 44px;
	padding: 0 16px;
	border: 1px dashed #9fc5d9;
	border-radius: 999px;
	color: #466578;
	font-size: 13px;
	font-weight: 700;
}

.file-button {
	position: relative;
	overflow: hidden;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	box-sizing: border-box;
	margin: 0;
	padding: 0 18px;
	border: 0;
	border-radius: 999px;
	background: #0e3a5c;
	color: #fff;
	font-size: 14px;
	font-weight: 800;
	line-height: 36px;
	cursor: pointer;
}

button.file-button::after {
	border: 0;
}

.file-button input {
	position: absolute;
	inset: 0;
	z-index: 2;
	width: 100%;
	height: 100%;
	opacity: 0;
	cursor: pointer;
}

.import-box {
	width: 100%;
	min-height: 220px;
	padding: 14px;
	border-radius: 18px;
	border: 1px solid #d8e9f2;
	background: #f8fcff;
	box-sizing: border-box;
	font-family: Consolas, Monaco, monospace;
	font-size: 13px;
	line-height: 1.7;
	color: #12344d;
}

.import-help {
	display: block;
	margin-top: 10px;
	font-size: 13px;
	color: #66869b;
}

.phone-preview {
	padding: 18px;
	border-radius: 30px;
	background: linear-gradient(180deg, #0e3a5c 0%, #0e3a5c 72px, #eaf7ff 72px, #eaf7ff 100%);
}

.preview-card {
	margin-top: 54px;
	padding: 22px;
	border-radius: 24px;
	background: linear-gradient(135deg, #0e3a5c, #1d6799);
	color: #fff;
	box-shadow: 0 18px 40px rgba(14, 58, 92, 0.22);
}

.preview-meta {
	display: inline-flex;
	padding: 4px 10px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.14);
	font-size: 12px;
	color: #ffeba2;
}

.preview-title-row {
	display: flex;
	align-items: baseline;
	gap: 12px;
	margin-top: 14px;
}

.preview-word {
	font-size: 42px;
	font-weight: 800;
	font-family: Georgia, 'Times New Roman', serif;
}

.preview-phonetic {
	color: rgba(255, 255, 255, 0.62);
}

.preview-meaning,
.preview-explain {
	display: block;
	margin-top: 12px;
	color: rgba(255, 255, 255, 0.78);
	line-height: 1.8;
}

.preview-parts {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 18px;
}

.preview-part {
	min-width: 76px;
	padding: 12px;
	border-radius: 16px;
	background: rgba(255, 255, 255, 0.12);
	border: 1px solid rgba(255, 255, 255, 0.14);
}

.preview-part-label,
.preview-part-title {
	display: block;
	text-align: center;
}

.preview-part-label {
	font-size: 20px;
	font-weight: 800;
	color: #ffeba2;
}

.preview-part-title {
	margin-top: 4px;
	font-size: 12px;
	color: rgba(255, 255, 255, 0.7);
}

.preview-video {
	margin-top: 16px;
	padding: 12px;
	border-radius: 16px;
	background: rgba(255, 255, 255, 0.12);
	border: 1px solid rgba(255, 255, 255, 0.14);
}

.preview-video-title,
.preview-video-time {
	display: block;
}

.preview-video-title {
	font-size: 12px;
	font-weight: 800;
	color: #ffeba2;
}

.preview-video-time {
	margin-top: 4px;
	font-size: 12px;
	color: rgba(255, 255, 255, 0.72);
}

.preview-video-row {
	display: grid;
	grid-template-columns: 24px minmax(0, 1fr);
	gap: 8px;
	margin-top: 10px;
}

.preview-video-index {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.18);
	color: #ffeba2;
	font-size: 12px;
	font-weight: 900;
}

.preview-video-copy {
	min-width: 0;
}

.preview-video-note {
	display: block;
	margin-top: 3px;
	color: rgba(255, 255, 255, 0.58);
	font-size: 11px;
	line-height: 1.5;
}

.viewer-preview-box {
	margin-top: 18px;
	padding: 16px;
	border-radius: 22px;
	background: #f8fcff;
	border: 1px solid #d8e9f2;
}

.viewer-preview-head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
}

.viewer-preview-title,
.viewer-preview-note,
.viewer-preview-status,
.viewer-preview-footnote {
	display: block;
}

.viewer-preview-title {
	color: #0e3a5c;
	font-size: 15px;
	font-weight: 900;
}

.viewer-preview-note,
.viewer-preview-status,
.viewer-preview-footnote {
	color: #66869b;
	font-size: 12px;
	line-height: 1.6;
}

.viewer-preview-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	justify-content: flex-end;
}

.viewer-timeline {
	display: flex;
	gap: 6px;
	margin: 14px 0 10px;
	padding: 8px;
	border-radius: 16px;
	background: #eaf7ff;
}

.viewer-timeline-segment {
	min-width: 74px;
	padding: 10px;
	border-radius: 12px;
	background: #ffffff;
	border: 1px solid #d8e9f2;
	cursor: pointer;
	transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.viewer-timeline-segment.active {
	border-color: #fe8500;
	box-shadow: 0 8px 18px rgba(254, 133, 0, 0.18);
	transform: translateY(-1px);
}

.viewer-timeline-title,
.viewer-timeline-time {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.viewer-timeline-title {
	color: #0e3a5c;
	font-size: 12px;
	font-weight: 900;
}

.viewer-timeline-time {
	margin-top: 4px;
	color: #66869b;
	font-size: 11px;
}

.next-box {
	margin-top: 18px;
	padding: 18px;
	border-radius: 20px;
	background: #f5fbff;
}

.next-line {
	color: #66869b;
}

@media screen and (max-width: 1360px) {
	.workbench {
		grid-template-columns: 1fr;
	}

	.status-grid {
		grid-template-columns: repeat(2, 1fr);
	}
}

@media screen and (max-width: 720px) {
	.admin-page {
		padding: 16px;
	}

	.hero,
	.panel-head,
	.section-head,
	.clip-draft-actions,
	.clip-list-head,
	.viewer-preview-head {
		flex-direction: column;
		align-items: flex-start;
	}

	.hero-actions,
	.editor-actions,
	.form-grid,
	.part-row,
	.status-grid {
		grid-template-columns: 1fr;
		width: 100%;
	}

	.clip-item {
		grid-template-columns: 34px minmax(0, 1fr);
	}

	.clip-buttons {
		grid-column: 1 / -1;
		justify-content: flex-start;
	}

	.clip-draft-buttons {
		width: 100%;
		justify-content: flex-start;
	}

	.editor-actions {
		justify-content: flex-start;
	}

	.viewer-preview-actions {
		justify-content: flex-start;
	}

	.miniapp-sync-card {
		flex-direction: column;
		align-items: flex-start;
	}

	.miniapp-sync-button {
		width: 100%;
	}

	.miniapp-sync-button + .miniapp-sync-button {
		margin-left: 0;
		margin-top: 10px;
	}

	.hero-actions {
		justify-content: flex-start;
	}

	.publish-all-button,
	.outline-button,
	.ghost-button {
		width: 100%;
	}
}
</style>
