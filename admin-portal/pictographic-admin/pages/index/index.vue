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
						<text class="panel-note">先填视频链接和时间点；正式上线后再接云存储上传。</text>
					</view>
				</view>
				<view class="form-grid">
					<label class="field">
						<text>视频链接</text>
						<input v-model="form.video.url" placeholder="https://.../study.mp4" />
					</label>
					<label class="field">
						<text>视频标题</text>
						<input v-model="form.video.title" placeholder="study 的象形讲解" />
					</label>
					<label class="field">
						<text>开始秒</text>
						<input v-model="form.video.startSec" type="number" placeholder="0" />
					</label>
					<label class="field">
						<text>结束秒</text>
						<input v-model="form.video.endSec" type="number" placeholder="120" />
					</label>
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
						<view v-if="form.video && form.video.url" class="preview-video">
							<text class="preview-video-title">讲解视频</text>
							<text class="preview-video-time">{{ form.video.title || '未命名视频' }} · {{ form.video.startSec || 0 }}s - {{ form.video.endSec || '?' }}s</text>
						</view>
					</view>
				</view>

				<view class="next-box">
					<text class="section-title">下一步接云时会做什么？</text>
					<text class="next-line">1. 把本地草稿变成 words 数据表。</text>
					<text class="next-line">2. 给管理员加登录和角色权限。</text>
					<text class="next-line">3. 小程序只读取已发布内容。</text>
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
			saveState: '未保存',
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
			return JSON.stringify(this.form, null, 2)
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
				} else if (source === 'uploaded') {
					this.selectedSource = 'uploaded'
					this.selectedId = ''
					this.form = clone(seedWords[0])
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
				parts: []
			}
			this.words.unshift(next)
			this.selectedId = next.id
			this.form = clone(next)
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
			uni.setStorageSync(STORAGE_KEY, clone(this.words))
			uni.setStorageSync(PENDING_STORAGE_KEY, clone(this.pendingWords))
			this.saveState = '已保存全部本地草稿'
			uni.showToast({ title: '已保存全部草稿', icon: 'success' })
		},
		saveCurrentAsDraft() {
			if (!this.validateCurrent()) return
			if (this.selectedSource === 'pending') {
				this.persistFormToList()
				uni.setStorageSync(PENDING_STORAGE_KEY, clone(this.pendingWords))
				this.saveState = '未上传词条修改已暂存'
				uni.showToast({ title: '已保存未上传修改', icon: 'success' })
				return
			}
			this.form.status = 'draft'
			this.persistFormToList()
			if (!this.validateAllWords()) return
			uni.setStorageSync(STORAGE_KEY, clone(this.words))
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
				uni.setStorageSync(STORAGE_KEY, clone(this.words))
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
				if (current) this.form = clone(current)
				uni.setStorageSync(STORAGE_KEY, clone(this.words))
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
		validateCurrent() {
			if (!String(this.form.id || '').trim()) {
				uni.showToast({ title: '请先填写单词 ID', icon: 'none' })
				return false
			}
			if (!String(this.form.word || '').trim()) {
				uni.showToast({ title: '请先填写单词', icon: 'none' })
				return false
			}
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
			const video = next.video || {}
			const startSec = Number(video.startSec)
			const endSec = Number(video.endSec)
			next.video = {
				url: String(video.url || video.videoUrl || '').trim(),
				title: String(video.title || video.videoTitle || '').trim(),
				startSec: video.startSec === '' || video.startSec === undefined || Number.isNaN(startSec) ? '' : startSec,
				endSec: video.endSec === '' || video.endSec === undefined || Number.isNaN(endSec) ? '' : endSec
			}
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
					}
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
				const parsed = JSON.parse(text)
				const words = Array.isArray(parsed) ? parsed : parsed.words
				if (!Array.isArray(words) || !words.length) {
					return { ok: false, message: 'JSON 里需要有 words 数组' }
				}
				return { ok: true, words }
			} catch (error) {
				return { ok: false, message: 'JSON 格式不正确，请让 AI 重新输出纯 JSON' }
			}
		},
		normalizeImportedWord(raw) {
			raw = raw || {}
			return this.normalizeWord({
				id: raw.id || raw.wordId || raw.word,
				word: raw.word || raw.id || raw.wordId,
				entryType: raw.entryType || raw.type,
				phonetic: raw.phonetic || raw.pronunciation || '',
				meaning: raw.meaning || raw.definition || raw.translation || '',
				explanation: raw.explanation || raw.analysis || raw.note || '',
				status: 'draft',
				parts: this.normalizeImportedParts(raw.parts || raw.breakdown || raw.children || []),
				video: raw.video || {
					url: raw.videoUrl || '',
					title: raw.videoTitle || '',
					startSec: raw.startSec === undefined ? '' : raw.startSec,
					endSec: raw.endSec === undefined ? '' : raw.endSec
				}
			})
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
			const hasStart = video.startSec !== '' && video.startSec !== undefined
			const hasEnd = video.endSec !== '' && video.endSec !== undefined
			const start = Number(video.startSec)
			const end = Number(video.endSec)
			if (hasStart && (Number.isNaN(start) || start < 0)) {
				return { ok: false, message: `第 ${rowNumber} 条视频开始秒必须是非负数字` }
			}
			if (hasEnd && (Number.isNaN(end) || end < 0)) {
				return { ok: false, message: `第 ${rowNumber} 条视频结束秒必须是非负数字` }
			}
			if (hasStart && hasEnd && end < start) {
				return { ok: false, message: `第 ${rowNumber} 条视频结束秒不能小于开始秒` }
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
					this.expandedLetters = this.defaultExpandedLetters(this.words)
					this.saveState = '已清空未上传列表'
					uni.showToast({ title: '已清空', icon: 'success' })
				}
			})
		},
		persistPendingWords() {
			uni.setStorageSync(PENDING_STORAGE_KEY, clone(this.pendingWords))
		},
		applyImportedWords(incoming, newCount, updateCount, options) {
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
			const newWords = incoming.filter((item) => !usedIds[item.id]).map((item) => clone(item))
			this.words = newWords.concat(this.words)
			if (incoming[0]) {
				this.selectedId = incoming[0].id
				this.form = clone(incoming[0])
			}
			this.expandedLetters = this.defaultExpandedLetters(this.words)
			this.ensureLetterExpanded(this.getFirstLetter(this.form) || '#')
			uni.setStorageSync(STORAGE_KEY, clone(this.words))
			this.saveState = '已导入批量草稿'
			this.importResult = `导入完成：新增 ${newCount} 条，更新 ${updateCount} 条。请抽查后再发布。`
			if (!options || !options.silentToast) {
				uni.showToast({ title: '导入完成', icon: 'success' })
			}
		},
		mergeImportedWord(existing, incoming) {
			const next = clone(existing)
			;['word', 'entryType', 'phonetic', 'meaning', 'explanation'].forEach((field) => {
				if (incoming[field] !== '' && incoming[field] !== undefined) {
					next[field] = incoming[field]
				}
			})
			if (Array.isArray(incoming.parts) && incoming.parts.length) {
				next.parts = incoming.parts
			}
			const incomingVideo = incoming.video || {}
			next.video = next.video || {}
			;['url', 'title', 'startSec', 'endSec'].forEach((field) => {
				if (incomingVideo[field] !== '' && incomingVideo[field] !== undefined) {
					next.video[field] = incomingVideo[field]
				}
			})
			next.status = 'draft'
			return this.normalizeWord(next)
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
	grid-template-columns: 310px minmax(420px, 1fr) 360px;
	gap: 18px;
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
	align-items: center;
	gap: 10px;
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
	gap: 8px;
	min-width: 0;
}

.entry-word {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
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
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
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

.file-button {
	position: relative;
	overflow: hidden;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0 18px;
	border-radius: 999px;
	background: #0e3a5c;
	color: #fff;
	font-size: 14px;
	font-weight: 800;
	line-height: 36px;
	cursor: pointer;
}

.file-button input {
	position: absolute;
	inset: 0;
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

.next-box {
	margin-top: 18px;
	padding: 18px;
	border-radius: 20px;
	background: #f5fbff;
}

.next-line {
	color: #66869b;
}

@media screen and (max-width: 1180px) {
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
	.section-head {
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

	.editor-actions {
		justify-content: flex-start;
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
