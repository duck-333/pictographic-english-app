<template>
	<view class="admin-page">
		<view v-if="!adminUnlocked" class="admin-login-shell">
			<view class="admin-review-card">
				<view class="admin-review-kicker">公开审核说明</view>
				<text class="admin-review-title">巴小塔（杭州巴别塔文化有限责任公司）——象形英语内容工作台</text>
				<text class="admin-review-copy">本网站用于维护“象形英语”英语单词查询、词义讲解、视频讲解等学习内容。</text>
				<text class="admin-review-copy">后台管理功能仅限管理员使用，需通过 Admin API Token 登录。</text>
				<text class="admin-review-copy">普通用户使用的小程序前台用于英语单词查询和学习内容浏览。</text>
			</view>
			<view class="admin-login-card">
				<view class="admin-login-badge">管理员入口</view>
				<text class="admin-login-title">管理员登录</text>
				<text class="admin-login-desc">请输入 Admin API Token 以进入巴小塔象形英语内容工作台</text>
				<label class="admin-login-field">
					<text>Admin API Token</text>
					<input
						v-model="adminApiTokenDraft"
						class="admin-login-input"
						password
						placeholder="本地开发可输入 dev-admin-token"
						confirm-type="done"
						@confirm="unlockAdmin"
					/>
				</label>
				<button class="admin-login-button" :disabled="adminAuthChecking" @click="unlockAdmin">
					{{ adminAuthChecking ? '校验中...' : '进入后台' }}
				</button>
				<text class="admin-login-error" v-if="adminTokenStatus">{{ adminTokenStatus }}</text>
				<text class="admin-login-tip">本地开发默认可用 dev-admin-token，生产环境必须使用服务器配置的 ADMIN_API_TOKEN。</text>
			</view>
		</view>

		<template v-else>
		<view class="hero">
			<view>
				<view class="eyebrow">Pictographic English Admin</view>
				<text class="title">象形英语内容工作台</text>
				<text class="subtitle">本阶段先做本地后台原型，不绑定云空间，也不会影响用户端小程序。</text>
			</view>
			<view class="hero-actions">
				<view class="admin-session-pill">
					<text>管理员状态：已解锁</text>
					<button class="lock-button" @click="lockAdmin">锁定/退出</button>
				</view>
				<button v-if="activeAdminView === 'workbench'" class="ghost-button" @click="resetDraft">恢复示例数据</button>
				<button v-if="activeAdminView === 'workbench'" class="outline-button" @click="saveDraft">保存全部本地草稿</button>
				<button v-if="activeAdminView === 'workbench'" class="outline-button" :disabled="serverSync.busy" @click="syncPublishedStatusesFromServer">
					{{ serverSync.busy ? '同步中...' : '同步服务器状态' }}
				</button>
				<button v-if="activeAdminView === 'workbench'" class="publish-all-button" :disabled="serverSync.busy" @click="publishAllDrafts">
					{{ serverSync.busy ? '发布中...' : '发布全部本地草稿到服务器' }}
				</button>
			</view>
		</view>

		<view class="admin-view-nav">
			<button
				v-for="item in adminViews"
				:key="item.value"
				:class="['admin-view-tab', activeAdminView === item.value ? 'active' : '']"
				@click="switchAdminView(item.value)"
			>
				<text class="admin-view-title">{{ item.label }}</text>
				<text class="admin-view-desc">{{ item.description }}</text>
			</button>
		</view>

		<view v-if="activeAdminView === 'workbench'" class="admin-view workbench-view">
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
				<view class="list-search-row">
					<input
						class="search-input list-search-input"
						v-model="keywordDraft"
						placeholder="搜索 study / tud / transport"
						confirm-type="search"
						@confirm="applyKeywordSearch"
					/>
					<button class="search-button" @click="applyKeywordSearch">搜索</button>
				</view>
				<view v-if="keyword" class="search-active-row">
					<text>正在搜索：{{ keyword }}</text>
					<button class="clear-search-button" @click="clearKeywordSearch">清空</button>
				</view>
				<view class="bucket-tabs">
					<button :class="['bucket-tab', activeBucket === 'uploaded' ? 'active' : '']" @click="switchBucket('uploaded')">
						已发布 {{ uploadedWords.length }}
					</button>
					<button :class="['bucket-tab', activeBucket === 'draft' ? 'active' : '']" @click="switchBucket('draft')">
						草稿 {{ stats.draft }}
					</button>
					<button :class="['bucket-tab', activeBucket === 'pending' ? 'active' : '']" @click="switchBucket('pending')">
						未上传 {{ pendingWords.length }}
					</button>
					<button :class="['bucket-tab', activeBucket === 'archived' ? 'active' : '']" @click="switchBucket('archived')">
						已归档 {{ stats.archived }}
					</button>
				</view>
				<view class="list-summary-card">
					<view>
						<text class="summary-kicker">{{ activeBucketLabel }}</text>
						<text class="summary-main">{{ activeListTotal }} 个词条</text>
					</view>
					<text class="summary-sub">搜索结果 {{ visibleWordCount }} 个</text>
				</view>
				<view v-if="hasBatchSelectionToolbar" class="batch-toolbar">
					<button class="select-all-control" :class="{ checked: allVisibleSelected }" :disabled="serverSync.busy || !visibleSelectableWords.length" @click="toggleSelectAllVisible">
						<text class="select-box">{{ allVisibleSelected ? '✓' : '' }}</text>
						<text>{{ allVisibleSelected ? '取消全选' : '全选当前结果' }}</text>
					</button>
					<button class="batch-action-button" :disabled="serverSync.busy || !selectedBatchCount" @click="applyBatchOperation">
						{{ batchActionLabel }}
					</button>
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
								:class="['accordion-word-row', hasBatchSelectionToolbar ? 'selectable' : '', selectedId === word.id ? 'active' : '', getEntryType(word)]"
								@click.stop="selectEntry(word.id)"
							>
								<view
									v-if="hasBatchSelectionToolbar"
									:class="['entry-checkbox', isWordSelected(word) ? 'checked' : '']"
									@click.stop="toggleWordSelection(word)"
								>
									<text>{{ isWordSelected(word) ? '✓' : '' }}</text>
								</view>
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
						<button class="secondary-button" @click="saveCurrentAsDraft">{{ draftActionText }}</button>
						<button class="publish-button" :disabled="serverSync.busy" @click="publishCurrent">
							{{ serverSync.busy ? '同步中...' : primaryActionText }}
						</button>
						<button v-if="canUnpublishCurrent" class="danger-button" :disabled="serverSync.busy" @click="unpublishCurrent">撤下当前词条</button>
						<button v-if="canArchiveCurrent" class="archive-button" :disabled="serverSync.busy" @click="archiveCurrent">归档当前词条</button>
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

				<view class="section-head audio-section-head">
					<view>
						<text class="section-title">发音音频</text>
						<text class="panel-note">给单词卡片音标旁边的小喇叭使用。当前先做本地上传演练，正式上线后替换成云存储 HTTPS 地址。</text>
					</view>
				</view>
				<view class="audio-upload-card">
					<view class="video-upload-main">
						<view id="audio-native-picker-host" class="audio-native-picker-host">
							<text class="native-picker-loading">正在加载音频选择控件...</text>
						</view>
						<view class="video-upload-copy">
							<text class="video-upload-title">{{ audioUpload.fileName || '还没有选择发音音频' }}</text>
							<text class="video-upload-note">{{ audioUpload.message }}</text>
						</view>
					</view>
					<view class="upload-progress-track">
						<view class="upload-progress-bar audio" :style="{ width: audioUpload.progress + '%' }"></view>
					</view>
					<view class="video-upload-meta">
						<text>状态：{{ audioUploadStatusText }}</text>
						<text>大小：{{ audioUpload.fileSizeLabel || '未选择' }}</text>
						<text>类型：{{ audioUpload.mimeType || '未知' }}</text>
					</view>
					<audio
						v-if="audioPreviewUrl"
						class="admin-audio-preview"
						:src="audioPreviewUrl"
						controls
					></audio>
					<view v-if="form.pronunciationAudio && form.pronunciationAudio.assetId" class="video-asset-box">
						<text class="video-asset-title">已生成发音音频资产</text>
						<text class="video-asset-line">Asset ID：{{ form.pronunciationAudio.assetId }}</text>
						<text class="video-asset-line">未来存储路径：{{ form.pronunciationAudio.storagePath }}</text>
						<button class="secondary-button clear-video-button" @click="clearPronunciationAudioAsset">清除发音音频</button>
					</view>
				</view>

				<label class="field">
					<text>中文释义</text>
					<input v-model="form.meaning" placeholder="学习；研究" />
				</label>
				<label class="field">
					<text>一句话讲解</text>
					<textarea v-model="form.explanation" :maxlength="-1" placeholder="用力敲击 tud 知识，向外出发，这就是学习。" />
				</label>

				<view v-if="form.illustrationImage" class="section-head illustration-section-head">
					<view>
						<text class="section-title">示意图</text>
						<text class="panel-note">本轮保存图片 HTTPS 地址；后续接入 COS/VOD 时继续复用同一字段结构。</text>
					</view>
					<button
						v-if="hasIllustrationImagePayload"
						class="danger-button"
						@click="clearIllustrationImage"
					>
						删除示意图
					</button>
				</view>
				<view v-if="form.illustrationImage" class="illustration-editor-card">
					<label class="field">
						<text>图片 URL</text>
						<input
							v-model="form.illustrationImage.url"
							placeholder="https://cdn.your-domain.com/images/word.png"
							@input="handleIllustrationUrlInput"
						/>
					</label>
					<view class="illustration-meta-grid">
						<label class="field">
							<text>图片标题 title</text>
							<input v-model="form.illustrationImage.title" placeholder="tud 的敲击动作示意图" />
						</label>
						<label class="field">
							<text>图片说明 alt</text>
							<input v-model="form.illustrationImage.alt" placeholder="展示 t、u、d 的象形关系" />
						</label>
					</view>
					<text :class="['illustration-url-tip', illustrationImageUrlValid ? 'valid' : 'warning']">
						{{ illustrationImageUrlTip }}
					</text>
					<view v-if="illustrationImagePreviewUrl" class="illustration-admin-preview">
						<image
							class="illustration-admin-image"
							:src="illustrationImagePreviewUrl"
							mode="widthFix"
							@error="handleIllustrationPreviewError"
						/>
						<text v-if="illustrationImagePreviewError" class="illustration-preview-error">图片预览失败，请检查地址或图片访问权限。</text>
					</view>
				</view>

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
							<view v-if="hasPronunciationAudioForPreview" class="preview-audio-pill">
								<view class="preview-speaker-dot"></view>
								<text>发音</text>
							</view>
						</view>
						<text class="preview-meaning">{{ form.meaning || '这里显示中文释义' }}</text>
						<view class="preview-parts">
							<view class="preview-part" v-for="(part, index) in form.parts" :key="index">
								<text class="preview-part-label">{{ part.label || '?' }}</text>
								<text class="preview-part-title">{{ part.title || '未填写' }}</text>
							</view>
						</view>
						<text class="preview-explain">{{ form.explanation || '这里显示象形讲解。' }}</text>
						<view v-if="illustrationImagePreviewUrl" class="preview-illustration">
							<text class="preview-illustration-title">{{ form.illustrationImage.title || '示意图' }}</text>
							<image class="preview-illustration-image" :src="illustrationImagePreviewUrl" mode="widthFix" />
							<text v-if="form.illustrationImage.alt" class="preview-illustration-alt">{{ form.illustrationImage.alt }}</text>
						</view>
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
					<button class="file-button" @click="chooseJsonFile">选择 JSON 文件</button>
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

		<view v-else-if="activeAdminView === 'entitlements'" class="admin-view entitlement-view">
			<view class="entitlement-hero panel">
				<view>
					<view class="eyebrow entitlement-kicker">Entitlement Management</view>
					<text class="entitlement-title">用户权益管理</text>
					<text class="entitlement-subtitle">
						在现有后台登录体系下查询用户额度、提交管理员调整，并保留权益流水作为审计依据。
					</text>
				</view>
				<view class="entitlement-status-pill">ADMIN_GRANT / ADMIN_DEDUCT</view>
			</view>

			<view class="entitlement-search-card panel">
				<view class="entitlement-search-row">
					<input
						v-model="entitlementManagement.keyword"
						class="search-input entitlement-search-input"
						placeholder="输入手机号或 user_id"
						confirm-type="search"
						@confirm="searchEntitlementUsers"
					/>
					<button class="search-button" :disabled="entitlementManagement.loading" @click="searchEntitlementUsers">
						{{ entitlementManagement.loading ? '查询中...' : '查询' }}
					</button>
				</view>
				<text class="entitlement-message">{{ entitlementManagement.message }}</text>
			</view>

			<view class="entitlement-layout">
				<view class="panel entitlement-users-panel">
					<view class="panel-head">
						<view>
							<text class="panel-title">用户搜索结果</text>
							<text class="panel-note">按手机号或 user_id 查询，只能在管理员登录后访问。</text>
						</view>
					</view>
					<view class="entitlement-user-list">
						<button
							v-for="user in entitlementManagement.users"
							:key="user.id"
							:class="['entitlement-user-row', entitlementManagement.selectedUser && entitlementManagement.selectedUser.id === user.id ? 'active' : '']"
							@click="selectEntitlementUser(user)"
						>
							<view>
								<text class="entitlement-user-main">user_id: {{ user.id }}</text>
								<text class="entitlement-user-sub">手机号：{{ user.phoneMasked }}</text>
							</view>
							<text class="entitlement-user-status">{{ user.status }}</text>
						</button>
						<view v-if="!entitlementManagement.users.length" class="entitlement-empty">
							输入手机号或 user_id 查询用户。
						</view>
					</view>
				</view>

				<view class="panel entitlement-detail-panel">
					<view class="panel-head">
						<view>
							<text class="panel-title">用户权益详情</text>
							<text class="panel-note">余额读取 user_entitlements 快照，调整操作由后端生成 entitlement_transactions。</text>
						</view>
					</view>

					<view v-if="entitlementManagement.selectedUser" class="entitlement-user-profile">
						<view class="entitlement-profile-grid">
							<view>
								<text class="entitlement-field-label">用户 ID</text>
								<text class="entitlement-field-value">{{ entitlementManagement.selectedUser.id }}</text>
							</view>
							<view>
								<text class="entitlement-field-label">手机号</text>
								<text class="entitlement-field-value">{{ entitlementManagement.selectedUser.phoneMasked }}</text>
							</view>
							<view>
								<text class="entitlement-field-label">微信绑定</text>
								<text class="entitlement-field-value">{{ entitlementManagement.selectedUser.hasWechatBinding ? '已绑定' : '未确认' }}</text>
							</view>
							<view>
								<text class="entitlement-field-label">账号状态</text>
								<text class="entitlement-field-value">{{ entitlementManagement.selectedUser.status }}</text>
							</view>
						</view>
					</view>

					<view v-if="entitlementManagement.entitlement" class="entitlement-summary-grid">
						<view class="entitlement-summary-card accent">
							<text class="entitlement-summary-value">{{ entitlementManagement.entitlement.quotaBalance }}</text>
							<text class="entitlement-summary-label">当前剩余查词次数</text>
						</view>
						<view class="entitlement-summary-card">
							<text class="entitlement-summary-value">{{ entitlementManagement.entitlement.quotaTotalConsumed }}</text>
							<text class="entitlement-summary-label">已使用次数</text>
						</view>
						<view class="entitlement-summary-card">
							<text class="entitlement-summary-value">{{ entitlementManagement.entitlement.quotaTotalGranted }}</text>
							<text class="entitlement-summary-label">累计获得次数</text>
						</view>
						<view class="entitlement-summary-card">
							<text class="entitlement-summary-value">{{ entitlementManagement.entitlement.membershipStatus }}</text>
							<text class="entitlement-summary-label">权益状态</text>
						</view>
					</view>
					<view v-else class="entitlement-empty detail-empty">
						选择用户后显示当前权益快照。
					</view>

					<view class="entitlement-operation-card">
						<view class="operation-mode-row">
							<button
								:class="['operation-mode-button', entitlementManagement.operationType === 'grant' ? 'active' : '']"
								@click="setEntitlementOperationType('grant')"
							>
								增加额度
							</button>
							<button
								:class="['operation-mode-button danger', entitlementManagement.operationType === 'deduct' ? 'active' : '']"
								@click="setEntitlementOperationType('deduct')"
							>
								扣除额度
							</button>
						</view>
						<view class="entitlement-form-grid">
							<label class="entitlement-form-field">
								<text>额度次数</text>
								<input
									v-model="entitlementManagement.amount"
									type="number"
									class="entitlement-form-input"
									placeholder="请输入正整数"
								/>
							</label>
							<label class="entitlement-form-field reason-field">
								<text>操作原因</text>
								<textarea
									v-model="entitlementManagement.reason"
									class="entitlement-reason-input"
									placeholder="例如：测试账号补充额度"
								/>
							</label>
						</view>
						<button
							class="publish-button entitlement-submit-button"
							:disabled="entitlementManagement.adjusting || !entitlementManagement.selectedUser"
							@click="submitEntitlementAdjustment"
						>
							{{ entitlementManagement.adjusting ? '提交中...' : '提交额度调整' }}
						</button>
						<text v-if="entitlementManagement.lastResult" class="entitlement-result">{{ entitlementManagement.lastResult }}</text>
					</view>
				</view>
			</view>

			<view class="panel entitlement-transactions-panel">
				<view class="panel-head">
					<view>
						<text class="panel-title">最近权益流水</text>
						<text class="panel-note">默认显示最近 5 条权益流水，完整记录请进入流水详情页查看。</text>
					</view>
					<button
						class="secondary-button entitlement-detail-link"
						:disabled="!entitlementManagement.selectedUser"
						@click="openEntitlementTransactionsPage"
					>
						查看流水详情
					</button>
				</view>
				<view class="entitlement-transaction-table">
					<view class="entitlement-transaction-row header">
						<text>时间</text>
						<text>类型</text>
						<text>变动</text>
						<text>余额</text>
						<text>来源/原因</text>
						<text>操作人</text>
					</view>
					<view
						v-for="transaction in recentEntitlementTransactions"
						:key="transaction.id"
						class="entitlement-transaction-row"
					>
						<text>{{ formatAdminDate(transaction.createdAt) }}</text>
						<text>{{ transaction.transactionType }}</text>
						<text :class="['transaction-amount', getTransactionAmountClass(transaction)]">
							{{ formatTransactionAmount(transaction) }}
						</text>
						<text>{{ transaction.balanceAfter }}</text>
						<text>{{ transaction.reason || transaction.source || '未记录' }}</text>
						<text>{{ transaction.operatorType || 'system' }} {{ transaction.operatorId || '' }}</text>
					</view>
					<view v-if="!recentEntitlementTransactions.length" class="entitlement-empty">
						暂无权益流水。查询用户后会从后端接口加载。
					</view>
				</view>
			</view>
		</view>

		<view v-else-if="activeAdminView === 'dashboard'" class="admin-view dashboard-view">
			<view class="dashboard-hero panel">
				<view>
					<view class="eyebrow dashboard-kicker">Dashboard Preview</view>
					<text class="dashboard-title">后台数据看板</text>
					<text class="dashboard-subtitle">
						当前为数据看板占位版，真实数据将在 openid 登录、用户行为事件和数据库接入后启用。
					</text>
				</view>
				<view class="dashboard-status-pill">前端壳子 / Mock 数据</view>
			</view>

			<view class="dashboard-notice">
				<text>
					真实数据将在服务器 API、openid 登录、MySQL 数据表和 user_events 行为采集完成后接入。当前页面仅用于确认后台导航和看板布局。
				</text>
			</view>

			<view class="homepage-featured-manager panel">
				<view class="panel-head featured-manager-head">
					<view>
						<text class="panel-title">首页每日象形词</text>
						<text class="panel-note">只允许选择服务器中已发布的词条；保存后小程序首页立即读取新配置。</text>
					</view>
					<view class="featured-manager-actions">
						<button class="secondary-button" :disabled="homepageFeatured.loading || homepageFeatured.saving" @click="loadHomepageFeaturedConfig">
							{{ homepageFeatured.loading ? '加载中...' : '重新加载' }}
						</button>
						<button class="publish-button" :disabled="homepageFeatured.loading || homepageFeatured.saving" @click="saveHomepageFeaturedConfig">
							{{ homepageFeatured.saving ? '保存中...' : '保存首页推荐' }}
						</button>
					</view>
				</view>

				<text class="featured-status-message">{{ homepageFeatured.message }}</text>

				<view class="featured-mode-row">
					<button
						:class="['featured-mode-button', homepageFeatured.mode === 'dailyRotation' ? 'active' : '']"
						@click="setHomepageFeaturedMode('dailyRotation')"
					>
						自动每日轮播
					</button>
					<button
						:class="['featured-mode-button', homepageFeatured.mode === 'manual' ? 'active' : '']"
						@click="setHomepageFeaturedMode('manual')"
					>
						手动指定今日展示
					</button>
				</view>

				<view class="featured-manager-grid">
					<view class="featured-column">
						<text class="featured-column-title">添加已发布词条</text>
						<input
							v-model="homepageFeatured.search"
							class="featured-search-input"
							placeholder="搜索 id、单词或中文释义"
						/>
						<scroll-view class="featured-candidate-list" scroll-y>
							<view v-for="item in homepageFeaturedCandidates" :key="item.id" class="featured-candidate-row">
								<view class="featured-word-copy">
									<text class="featured-word-title">{{ item.word }}</text>
									<text class="featured-word-meta">{{ item.id }} · {{ item.meaning || '暂无释义' }}</text>
								</view>
								<button class="featured-mini-button" @click="addHomepageFeaturedWord(item.id)">添加</button>
							</view>
							<text v-if="!homepageFeaturedCandidates.length" class="featured-empty">没有可添加的已发布词条。</text>
						</scroll-view>
					</view>

					<view class="featured-column">
						<text class="featured-column-title">当前推荐池（按此顺序轮播）</text>
						<view class="featured-pool-list">
							<view v-for="(item, index) in homepageFeaturedPoolWords" :key="item.id" class="featured-pool-row">
								<view class="featured-order">{{ index + 1 }}</view>
								<view class="featured-word-copy">
									<text class="featured-word-title">{{ item.word }}</text>
									<text class="featured-word-meta">{{ item.id }} · {{ item.meaning || '暂无释义' }} · {{ item.status }}</text>
								</view>
								<view class="featured-row-actions">
									<button class="featured-icon-button" :disabled="index === 0" @click="moveHomepageFeaturedWord(index, -1)">上移</button>
									<button class="featured-icon-button" :disabled="index === homepageFeaturedPoolWords.length - 1" @click="moveHomepageFeaturedWord(index, 1)">下移</button>
									<button class="featured-icon-button danger" @click="removeHomepageFeaturedWord(item.id)">移除</button>
								</view>
							</view>
							<text v-if="!homepageFeaturedPoolWords.length" class="featured-empty">推荐池为空，小程序首页将隐藏每日象形词模块。</text>
						</view>
					</view>

					<view class="featured-column featured-preview-column">
						<text class="featured-column-title">当前首页预览</text>
						<view v-if="homepageFeatured.mode === 'manual'" class="featured-manual-picker">
							<text class="featured-field-label">手动指定词条</text>
							<picker
								:range="homepageManualOptions"
								range-key="label"
								:value="homepageManualPickerIndex"
								@change="changeHomepageManualWord"
							>
								<view class="picker-box">{{ homepageManualSelectionLabel }}</view>
							</picker>
						</view>
						<view v-if="homepageFeatured.currentWord" class="featured-current-card">
							<text class="featured-current-source">{{ homepageFeaturedSourceText }}</text>
							<text class="featured-current-word">{{ homepageFeatured.currentWord.word }}</text>
							<text class="featured-current-id">{{ homepageFeatured.currentWord.id }}</text>
							<text class="featured-current-meaning">{{ homepageFeatured.currentWord.meaning || '暂无释义' }}</text>
						</view>
						<view v-else class="featured-current-empty">
							<text>当前没有可公开展示的首页推荐词。</text>
						</view>
					</view>
				</view>
			</view>

			<view class="dashboard-summary-grid">
				<view class="dashboard-summary-card" v-for="item in dashboardSummaryCards" :key="item.label">
					<text class="dashboard-summary-value">{{ item.value }}</text>
					<text class="dashboard-summary-label">{{ item.label }}</text>
					<text class="dashboard-summary-note">{{ item.note }}</text>
				</view>
			</view>

			<view class="dashboard-grid">
				<view class="dashboard-panel panel">
					<view class="panel-head">
						<view>
							<text class="panel-title">高频搜索词</text>
							<text class="panel-note">未来来自 /api/admin/dashboard/top-search-words</text>
						</view>
					</view>
					<view class="dashboard-table">
						<view class="dashboard-table-row head">
							<text>排名</text>
							<text>单词</text>
							<text>搜索次数</text>
							<text>最近搜索时间</text>
						</view>
						<view class="dashboard-table-row" v-for="item in topSearchWords" :key="item.rank">
							<text>{{ item.rank }}</text>
							<text class="table-word">{{ item.word }}</text>
							<text>{{ item.count }}</text>
							<text>{{ item.lastAt }}</text>
						</view>
						<view v-if="!topSearchWords.length" class="dashboard-empty">暂无搜索数据，等待 user_events 接入。</view>
					</view>
				</view>

				<view class="dashboard-panel panel">
					<view class="panel-head">
						<view>
							<text class="panel-title">高频收藏词</text>
							<text class="panel-note">未来来自 /api/admin/dashboard/top-favorite-words</text>
						</view>
					</view>
					<view class="dashboard-table">
						<view class="dashboard-table-row head">
							<text>排名</text>
							<text>单词</text>
							<text>收藏次数</text>
							<text>最近收藏时间</text>
						</view>
						<view class="dashboard-table-row" v-for="item in topFavoriteWords" :key="item.rank">
							<text>{{ item.rank }}</text>
							<text class="table-word">{{ item.word }}</text>
							<text>{{ item.count }}</text>
							<text>{{ item.lastAt }}</text>
						</view>
						<view v-if="!topFavoriteWords.length" class="dashboard-empty">暂无收藏数据，等待 favorites 表接入。</view>
					</view>
				</view>
			</view>

			<view class="dashboard-panel panel">
				<view class="panel-head">
					<view>
						<text class="panel-title">最近用户行为</text>
						<text class="panel-note">未来来自 /api/admin/dashboard/recent-events</text>
					</view>
				</view>
				<view class="dashboard-event-table">
					<view class="dashboard-event-row head">
						<text>时间</text>
						<text>用户标识</text>
						<text>行为类型</text>
						<text>单词</text>
						<text>备注</text>
					</view>
					<view class="dashboard-event-row" v-for="item in recentUserEvents" :key="item.id">
						<text>{{ item.time }}</text>
						<text>{{ item.user }}</text>
						<text>{{ item.type }}</text>
						<text class="table-word">{{ item.word }}</text>
						<text>{{ item.note }}</text>
					</view>
					<view v-if="!recentUserEvents.length" class="dashboard-empty">暂无用户行为，等待 openid 和 user_events 采集完成。</view>
				</view>
			</view>

			<view class="dashboard-api-card panel">
				<text class="panel-title">后续接口预留</text>
				<text class="panel-note">本次不调用真实接口，只预留后台看板的数据边界。</text>
				<view class="api-list">
					<text v-for="endpoint in dashboardApiPlaceholders" :key="endpoint">{{ endpoint }}</text>
				</view>
			</view>
		</view>
		</template>
		<view class="site-record">浙ICP备2026040189号-1</view>
	</view>
</template>

<script>
import {
	checkAdminAuth,
	deductAdminUserQuota,
	getAdminApiToken,
	getAdminHomepageFeatured,
	getAdminUserEntitlement,
	grantAdminUserQuota,
	listAdminUserEntitlementTransactions,
	getPublicWordFromServer,
	saveAdminApiToken,
	saveAdminHomepageFeatured,
	saveAdminWordToServer,
	searchAdminEntitlementUsers,
	searchPublicWordsFromServer
} from '../../common/api-client.js'

const STORAGE_KEY = 'pictographic-admin:words-draft'
const PENDING_STORAGE_KEY = 'pictographic-admin:pending-imports'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const VIDEO_MAX_SIZE_MB = 200
const VIDEO_MAX_SIZE_BYTES = VIDEO_MAX_SIZE_MB * 1024 * 1024
const VIDEO_UPLOAD_PROVIDER = 'local-upload-rehearsal'
const AUDIO_MAX_SIZE_MB = 10
const AUDIO_MAX_SIZE_BYTES = AUDIO_MAX_SIZE_MB * 1024 * 1024
const AUDIO_UPLOAD_PROVIDER = 'local-audio-upload-rehearsal'
const BRIDGE_RUNTIME_ASSET_MAX_MB = 80
const BRIDGE_RUNTIME_ASSET_MAX_BYTES = BRIDGE_RUNTIME_ASSET_MAX_MB * 1024 * 1024
const ADMIN_STATUS_VALUES = ['draft', 'published', 'review', 'unpublished', 'archived']
// Dashboard shell only. Do not call these APIs until server API, openid,
// MySQL, and user_events collection are ready.
const DASHBOARD_API_PLACEHOLDERS = [
	'GET /api/admin/dashboard/summary',
	'GET /api/admin/dashboard/top-search-words',
	'GET /api/admin/dashboard/top-favorite-words',
	'GET /api/admin/dashboard/recent-events'
]

function normalizeAdminStatus(status, fallback = 'draft') {
	const value = String(status || '').trim()
	return ADMIN_STATUS_VALUES.indexOf(value) > -1 ? value : fallback
}

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
			activeAdminView: 'workbench',
			adminViews: [
				{ label: '内容上传工作台', value: 'workbench', description: '词条、音频、视频和发布状态管理' },
				{ label: '后台数据看板', value: 'dashboard', description: '用户、搜索、收藏和行为数据概览' },
				{ label: '用户权益管理', value: 'entitlements', description: '用户额度、调整和流水' }
			],
			dashboardSummaryCards: [
				{ label: '今日新增用户', value: '待接入', note: '等待 openid 登录和用户表' },
				{ label: '今日活跃用户', value: '待接入', note: '等待 user_events 行为采集' },
				{ label: '今日搜索次数', value: '待接入', note: '等待搜索事件入库' },
				{ label: '今日收藏次数', value: '待接入', note: '等待 favorites 表接入' }
			],
			topSearchWords: [
				{ rank: 1, word: 'study', count: '待接入', lastAt: '接口接入后显示' },
				{ rank: 2, word: 'transport', count: '待接入', lastAt: '接口接入后显示' },
				{ rank: 3, word: 'structure', count: '待接入', lastAt: '接口接入后显示' }
			],
			topFavoriteWords: [
				{ rank: 1, word: 'study', count: '待接入', lastAt: '接口接入后显示' },
				{ rank: 2, word: 'tud', count: '待接入', lastAt: '接口接入后显示' },
				{ rank: 3, word: 'support', count: '待接入', lastAt: '接口接入后显示' }
			],
			recentUserEvents: [
				{ id: 'mock-1', time: '待接入', user: 'openid 待接入', type: '搜索', word: 'study', note: '未来由 user_events 提供' },
				{ id: 'mock-2', time: '待接入', user: 'openid 待接入', type: '收藏', word: 'transport', note: '未来由 favorites/user_events 提供' },
				{ id: 'mock-3', time: '待接入', user: 'openid 待接入', type: '查看详情', word: 'tud', note: '当前仅为布局占位' }
			],
			dashboardApiPlaceholders: DASHBOARD_API_PLACEHOLDERS,
			homepageFeatured: {
				loading: false,
				saving: false,
				message: '进入数据看板后加载服务器推荐配置。',
				mode: 'dailyRotation',
				featuredWordIds: [],
				manualWordId: '',
				publishedWords: [],
				currentWord: null,
				source: 'empty',
				search: ''
			},
			entitlementManagement: {
				keyword: '',
				loading: false,
				adjusting: false,
				message: '输入手机号或 user_id 查询用户权益。',
				users: [],
				selectedUser: null,
				entitlement: null,
				transactions: [],
				operationType: 'grant',
				amount: '',
				reason: '',
				lastResult: ''
			},
			keywordDraft: '',
			keyword: '',
			expandedLetters: [],
			importText: '',
			importResult: '可以先导入 20-50 条试跑，确认字段和拆解无误后再导入整章。',
			words: [],
			pendingWords: [],
			uploadedSelectedIds: [],
			draftSelectedIds: [],
			archivedSelectedIds: [],
			activeBucket: 'uploaded',
			selectedSource: 'uploaded',
			selectedId: '',
			form: clone(seedWords[0]),
			illustrationImagePreviewError: false,
			videoUpload: {
				status: 'idle',
				progress: 0,
				fileName: '',
				fileSizeLabel: '',
				mimeType: '',
				message: '选择一个本地视频文件，系统会按未来上传流程做格式、大小和元数据校验。',
				previewUrl: ''
			},
			audioUpload: {
				status: 'idle',
				progress: 0,
				fileName: '',
				fileSizeLabel: '',
				mimeType: '',
				message: '选择一个 mp3、wav、m4a、aac、ogg 或 webm 音频文件，保存后小程序详情页才显示小喇叭。',
				previewUrl: ''
			},
			videoUploadTimer: null,
			videoUploadJob: null,
			videoFileTriggerEl: null,
			runtimeVideoInputEl: null,
			audioUploadTimer: null,
			audioUploadJob: null,
			audioFileTriggerEl: null,
			runtimeAudioInputEl: null,
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
			serverSync: {
				busy: false,
				message: 'Server API not synced'
			},
			adminUnlocked: false,
			adminAuthChecking: false,
			adminApiTokenDraft: '',
			adminTokenStatus: '未保存 Admin API Token，本地开发可填写 dev-admin-token。',
			statusOptions: [
				{ label: '草稿', value: 'draft' },
				{ label: '已发布', value: 'published' },
				{ label: '已撤下', value: 'unpublished' },
				{ label: '已归档', value: 'archived' },
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
		uploadedWords() {
			return this.words.filter((item) =>
				item.status !== 'archived' &&
				item.status !== 'draft' &&
				item.status !== 'pending'
			)
		},
		activeWords() {
			if (this.activeBucket === 'pending') return this.pendingWords
			if (this.activeBucket === 'archived') return this.words.filter((item) => item.status === 'archived')
			if (this.activeBucket === 'draft') return this.words.filter((item) => item.status === 'draft')
			return this.uploadedWords
		},
		activeBucketLabel() {
			if (this.activeBucket === 'pending') return '未上传待检查'
			if (this.activeBucket === 'archived') return '已归档词条'
			if (this.activeBucket === 'draft') return '本地草稿列表'
			return '已发布 / 已撤下词条'
		},
		activeListTotal() {
			return this.activeWords.length
		},
		primaryActionText() {
			if (this.selectedSource === 'pending') return '加入草稿列表'
			if (this.form.status === 'unpublished') return '重新发布'
			if (this.form.status === 'archived') return '重新发布'
			return '发布当前词条'
		},
		draftActionText() {
			return this.form.status === 'archived' ? '恢复为草稿' : '保存为草稿'
		},
		canUnpublishCurrent() {
			return this.selectedSource !== 'pending' && this.form.status === 'published'
		},
		canArchiveCurrent() {
			return this.selectedSource !== 'pending' && this.form.status !== 'archived'
		},
		filteredWords() {
			return this.activeWords.filter((item) => this.matchesKeyword(item))
		},
		hasBatchSelectionToolbar() {
			return ['uploaded', 'draft', 'archived'].includes(this.activeBucket)
		},
		visibleSelectableWords() {
			return this.hasBatchSelectionToolbar
				? this.filteredWords.filter((item) => item && String(item.id || '').trim())
				: []
		},
		currentBatchSelectedIds() {
			const key = this.getSelectionKeyForBucket(this.activeBucket)
			return key ? this[key] : []
		},
		selectedBatchCount() {
			return this.currentBatchSelectedIds.length
		},
		allVisibleSelected() {
			const visibleIds = this.visibleSelectableWords.map((item) => item.id)
			if (!visibleIds.length) return false
			const selected = this.currentBatchSelectedIds.reduce((result, id) => {
				result[id] = true
				return result
			}, {})
			return visibleIds.every((id) => selected[id])
		},
		batchActionText() {
			if (this.activeBucket === 'archived') return '删除所选词条'
			if (this.activeBucket === 'draft') return '归档所选词条'
			return '撤下所选词条到草稿'
		},
		batchActionLabel() {
			return this.selectedBatchCount
				? `${this.batchActionText}（${this.selectedBatchCount}）`
				: this.batchActionText
		},
		recentEntitlementTransactions() {
			return this.entitlementManagement.transactions.slice(0, 5)
		},
		stats() {
			return {
				total: this.words.length,
				manageable: this.words.filter((item) => item.status !== 'archived').length,
				published: this.words.filter((item) => item.status === 'published').length,
				draft: this.words.filter((item) => item.status === 'draft').length,
				unpublished: this.words.filter((item) => item.status === 'unpublished').length,
				archived: this.words.filter((item) => item.status === 'archived').length,
				nodes: this.words.reduce((sum, item) => sum + (Array.isArray(item.parts) ? item.parts.length : 0), 0)
			}
		},
		currentJson() {
			return JSON.stringify(this.buildServerWordPayload(this.form), null, 2)
		},
		hasIllustrationImagePayload() {
			const image = this.form && this.form.illustrationImage ? this.form.illustrationImage : {}
			return this.hasIllustrationImageFields(image)
		},
		illustrationImagePreviewUrl() {
			const image = this.form && this.form.illustrationImage ? this.form.illustrationImage : {}
			const url = String(image.url || '').trim()
			return this.isProductionIllustrationImageUrl(url) ? url : ''
		},
		illustrationImageUrlValid() {
			const image = this.form && this.form.illustrationImage ? this.form.illustrationImage : {}
			const url = String(image.url || '').trim()
			return !url || this.isProductionIllustrationImageUrl(url)
		},
		illustrationImageUrlTip() {
			const image = this.form && this.form.illustrationImage ? this.form.illustrationImage : {}
			const url = String(image.url || '').trim()
			if (!url) return '未填写图片地址时，小程序不会显示示意图模块。'
			if (this.isProductionIllustrationImageUrl(url)) return '图片地址有效，可用于正式小程序。'
			return '正式小程序只允许 HTTPS 图片地址；本地地址、临时预览地址和示例域名不能保存为线上示意图。'
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
		audioUploadStatusText() {
			const statusMap = {
				idle: '待选择',
				ready: '已选择，待上传',
				uploading: '上传演练中',
				done: '上传演练完成',
				error: '需要处理'
			}
			return statusMap[this.audioUpload.status] || '待选择'
		},
		audioPreviewUrl() {
			const uploadUrl = String(this.audioUpload && this.audioUpload.previewUrl ? this.audioUpload.previewUrl : '').trim()
			if (this.isPlayableAdminAudioUrl(uploadUrl)) return uploadUrl
			const audio = this.form && this.form.pronunciationAudio ? this.form.pronunciationAudio : {}
			const previewUrl = String(audio.localPreviewUrl || audio.url || audio.audioUrl || '').trim()
			return this.isPlayableAdminAudioUrl(previewUrl) ? previewUrl : ''
		},
		hasPronunciationAudioForPreview() {
			const audio = this.form && this.form.pronunciationAudio ? this.form.pronunciationAudio : {}
			return this.isPlayableAdminAudioUrl(audio.url || audio.audioUrl || audio.localPreviewUrl || this.audioPreviewUrl)
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
		},
		homepageFeaturedPoolWords() {
			const byId = this.homepageFeatured.publishedWords.reduce((result, word) => {
				result[word.id] = word
				return result
			}, {})
			return this.homepageFeatured.featuredWordIds
				.map((id) => byId[id])
				.filter((word) => word && word.status === 'published')
		},
		homepageFeaturedCandidates() {
			const keyword = String(this.homepageFeatured.search || '').trim().toLowerCase()
			const selectedIds = new Set(this.homepageFeatured.featuredWordIds)
			return this.homepageFeatured.publishedWords
				.filter((word) => word && word.status === 'published' && !selectedIds.has(word.id))
				.filter((word) => {
					if (!keyword) return true
					return [word.id, word.word, word.meaning]
						.some((value) => String(value || '').toLowerCase().includes(keyword))
				})
				.slice(0, 30)
		},
		homepageManualOptions() {
			return [
				{ id: '', label: '请选择一个已发布词条' },
				...this.homepageFeatured.publishedWords
					.filter((word) => word && word.status === 'published')
					.map((word) => ({
						id: word.id,
						label: `${word.word} · ${word.id}`
					}))
			]
		},
		homepageManualPickerIndex() {
			const index = this.homepageManualOptions.findIndex((item) => item.id === this.homepageFeatured.manualWordId)
			return index > -1 ? index : 0
		},
		homepageManualSelectionLabel() {
			const selected = this.homepageManualOptions[this.homepageManualPickerIndex]
			return selected ? selected.label : '请选择一个已发布词条'
		},
		homepageFeaturedSourceText() {
			if (this.homepageFeatured.source === 'manual') return '手动指定'
			if (this.homepageFeatured.source === 'dailyRotation') return '自动每日轮播'
			return '当前无推荐'
		}
	},
	onLoad() {
		this.loadDraft()
		this.loadAdminApiToken()
	},
	mounted() {
		this.installNativeVideoButtonHandler()
		this.installNativeAudioButtonHandler()
	},
	beforeDestroy() {
		this.releaseVideoPreview()
		this.releaseAudioPreview(null, { force: true })
		this.removeNativeVideoButtonHandler()
		this.removeNativeAudioButtonHandler()
		this.cancelVideoUploadTimer()
		this.cancelAudioUploadTimer()
	},
	methods: {
		switchAdminView(view) {
			const allowedViews = ['workbench', 'dashboard', 'entitlements']
			this.activeAdminView = allowedViews.indexOf(view) > -1 ? view : 'workbench'
			if (this.activeAdminView === 'dashboard' && this.adminUnlocked) {
				this.loadHomepageFeaturedConfig()
			}
		},
		getAdminRequestOptions() {
			return {
				adminApiToken: this.adminApiTokenDraft
			}
		},
		normalizeEntitlementUser(user) {
			const source = user && typeof user === 'object' && !Array.isArray(user) ? user : {}
			const id = source.id || source.userId || source.user_id || ''
			const phoneMasked = source.phoneMasked || source.phone_masked || source.maskedPhone || source.masked_phone || source.phone || ''
			return {
				id: id ? String(id) : '',
				phoneMasked: phoneMasked ? String(phoneMasked) : '未提供',
				status: source.status || source.userStatus || source.user_status || '未知',
				createdAt: source.createdAt || source.created_at || '',
				hasWechatBinding: !!(source.hasWechatBinding || source.has_wechat_binding || source.wechatOpenid || source.openid),
				hasPhoneBinding: !!(source.hasPhoneBinding || source.has_phone_binding || phoneMasked)
			}
		},
		normalizeEntitlementSnapshot(entitlement) {
			const source = entitlement && typeof entitlement === 'object' && !Array.isArray(entitlement) ? entitlement : {}
			const quotaBalance = source.quotaBalance !== undefined ? source.quotaBalance : source.quota_balance
			const quotaTotalGranted = source.quotaTotalGranted !== undefined ? source.quotaTotalGranted : source.quota_total_granted
			const quotaTotalConsumed = source.quotaTotalConsumed !== undefined ? source.quotaTotalConsumed : source.quota_total_consumed
			const quotaTotalExpired = source.quotaTotalExpired !== undefined ? source.quotaTotalExpired : source.quota_total_expired
			return {
				quotaBalance: Number(quotaBalance || 0),
				quotaTotalGranted: Number(quotaTotalGranted || 0),
				quotaTotalConsumed: Number(quotaTotalConsumed || 0),
				quotaTotalExpired: Number(quotaTotalExpired || 0),
				membershipType: source.membershipType || source.membership_type || 'none',
				membershipStatus: source.membershipStatus || source.membership_status || 'none',
				membershipExpireAt: source.membershipExpireAt || source.membership_expire_at || ''
			}
		},
		normalizeEntitlementTransaction(transaction) {
			const source = transaction && typeof transaction === 'object' && !Array.isArray(transaction) ? transaction : {}
			const balanceAfter = source.balanceAfter !== undefined ? source.balanceAfter : source.balance_after
			return {
				id: source.id || source.transactionId || source.transaction_id || source.idempotencyKey || source.idempotency_key || '',
				transactionType: source.transactionType || source.transaction_type || 'UNKNOWN',
				amount: Number(source.amount || 0),
				balanceAfter: balanceAfter !== undefined ? balanceAfter : '',
				source: source.source || '',
				reason: source.reason || '',
				operatorType: source.operatorType || source.operator_type || '',
				operatorId: source.operatorId || source.operator_id || '',
				createdAt: source.createdAt || source.created_at || ''
			}
		},
		extractEntitlementSnapshot(data) {
			if (data && data.entitlement) return data.entitlement
			if (data && data.userEntitlement) return data.userEntitlement
			return data || {}
		},
		formatAdminDate(value) {
			if (!value) return '未设置'
			const date = new Date(value)
			if (Number.isNaN(date.getTime())) return String(value)
			const year = date.getFullYear()
			const month = String(date.getMonth() + 1).padStart(2, '0')
			const day = String(date.getDate()).padStart(2, '0')
			const hour = String(date.getHours()).padStart(2, '0')
			const minute = String(date.getMinutes()).padStart(2, '0')
			return `${year}-${month}-${day} ${hour}:${minute}`
		},
		formatTransactionAmount(transaction) {
			const amount = Number(transaction && transaction.amount || 0)
			if (amount > 0) return `+${amount}`
			return String(amount)
		},
		getTransactionAmountClass(transaction) {
			const amount = Number(transaction && transaction.amount || 0)
			if (amount > 0) return 'positive'
			if (amount < 0) return 'negative'
			return 'neutral'
		},
		handleEntitlementAdminError(error, fallbackMessage) {
			if (error && (error.code === 'UNAUTHORIZED' || error.isAuthError)) {
				this.handleAdminUnauthorized()
				return
			}
			this.entitlementManagement.message = error && error.message ? error.message : fallbackMessage
			uni.showModal({
				title: '用户权益管理失败',
				content: this.entitlementManagement.message,
				showCancel: false
			})
		},
		async searchEntitlementUsers() {
			if (!this.adminUnlocked) {
				this.handleAdminUnauthorized()
				return
			}
			const keyword = String(this.entitlementManagement.keyword || '').trim()
			if (!keyword) {
				this.entitlementManagement.message = '请输入手机号或 user_id 后再查询。'
				uni.showToast({ title: '请输入查询条件', icon: 'none' })
				return
			}

			this.entitlementManagement.loading = true
			this.entitlementManagement.message = '正在查询用户权益...'
			this.entitlementManagement.lastResult = ''
			try {
				const result = await searchAdminEntitlementUsers(keyword, this.getAdminRequestOptions())
				const users = Array.isArray(result.users) ? result.users.map((item) => this.normalizeEntitlementUser(item)) : []
				this.entitlementManagement.users = users
				this.entitlementManagement.selectedUser = null
				this.entitlementManagement.entitlement = null
				this.entitlementManagement.transactions = []
				if (!users.length) {
					this.entitlementManagement.message = '未找到匹配用户。'
					return
				}
				this.entitlementManagement.message = `找到 ${users.length} 个匹配用户。`
				await this.selectEntitlementUser(users[0], { keepLoading: true })
			} catch (error) {
				this.handleEntitlementAdminError(error, '用户权益查询失败。')
			} finally {
				this.entitlementManagement.loading = false
			}
		},
		async selectEntitlementUser(user, options = {}) {
			const normalized = this.normalizeEntitlementUser(user)
			if (!normalized.id) {
				this.entitlementManagement.message = '用户记录缺少 user_id，无法加载权益。'
				return
			}
			if (!options.keepLoading) {
				this.entitlementManagement.loading = true
			}
			this.entitlementManagement.selectedUser = normalized
			this.entitlementManagement.entitlement = null
			this.entitlementManagement.transactions = []
			this.entitlementManagement.lastResult = ''
			this.entitlementManagement.message = `正在加载 user_id=${normalized.id} 的权益数据...`
			try {
				await this.loadSelectedUserEntitlement()
				await this.loadSelectedUserEntitlementTransactions()
				this.entitlementManagement.message = `已加载 user_id=${normalized.id} 的权益数据。`
			} catch (error) {
				this.handleEntitlementAdminError(error, '用户权益数据加载失败。')
			} finally {
				if (!options.keepLoading) {
					this.entitlementManagement.loading = false
				}
			}
		},
		async loadSelectedUserEntitlement() {
			const user = this.entitlementManagement.selectedUser
			if (!user || !user.id) return
			const result = await getAdminUserEntitlement(user.id, this.getAdminRequestOptions())
			if (result && result.user) {
				this.entitlementManagement.selectedUser = this.normalizeEntitlementUser(result.user)
			}
			this.entitlementManagement.entitlement = this.normalizeEntitlementSnapshot(this.extractEntitlementSnapshot(result))
		},
		async loadSelectedUserEntitlementTransactions() {
			const user = this.entitlementManagement.selectedUser
			if (!user || !user.id) return
			const result = await listAdminUserEntitlementTransactions(user.id, {
				...this.getAdminRequestOptions(),
				limit: 5,
				offset: 0
			})
			this.entitlementManagement.transactions = Array.isArray(result.transactions)
				? result.transactions.map((item) => this.normalizeEntitlementTransaction(item))
				: []
		},
		openEntitlementTransactionsPage() {
			const user = this.entitlementManagement.selectedUser
			if (!user || !user.id) {
				uni.showToast({ title: '请先选择用户', icon: 'none' })
				return
			}
			uni.navigateTo({
				url: `/pages/entitlement-transactions/index?userId=${encodeURIComponent(user.id)}`
			})
		},
		setEntitlementOperationType(type) {
			this.entitlementManagement.operationType = type === 'deduct' ? 'deduct' : 'grant'
			this.entitlementManagement.lastResult = ''
		},
		async submitEntitlementAdjustment() {
			if (!this.adminUnlocked) {
				this.handleAdminUnauthorized()
				return
			}
			const user = this.entitlementManagement.selectedUser
			if (!user || !user.id) {
				uni.showToast({ title: '请先选择用户', icon: 'none' })
				return
			}
			const amount = Number(this.entitlementManagement.amount)
			const reason = String(this.entitlementManagement.reason || '').trim()
			if (!Number.isFinite(amount) || amount <= 0 || Math.floor(amount) !== amount) {
				uni.showToast({ title: '请输入正整数额度', icon: 'none' })
				return
			}
			if (!reason) {
				uni.showToast({ title: '请填写操作原因', icon: 'none' })
				return
			}

			this.entitlementManagement.adjusting = true
			this.entitlementManagement.lastResult = ''
			const payload = {
				amount,
				reason,
				source: 'admin_portal',
				operatorType: 'admin'
			}
			try {
				const action = this.entitlementManagement.operationType === 'deduct'
					? deductAdminUserQuota
					: grantAdminUserQuota
				await action(user.id, payload, this.getAdminRequestOptions())
				const operationText = this.entitlementManagement.operationType === 'deduct' ? '扣除额度' : '增加额度'
				this.entitlementManagement.lastResult = `${operationText}已提交。`
				this.entitlementManagement.amount = ''
				this.entitlementManagement.reason = ''
				await this.loadSelectedUserEntitlement()
				await this.loadSelectedUserEntitlementTransactions()
				uni.showToast({ title: '操作已提交', icon: 'success' })
			} catch (error) {
				this.handleEntitlementAdminError(error, '额度调整失败。')
			} finally {
				this.entitlementManagement.adjusting = false
			}
		},
		applyHomepageFeaturedResponse(data, options = {}) {
			const config = data && data.config ? data.config : {}
			this.homepageFeatured.mode = config.mode === 'manual' ? 'manual' : 'dailyRotation'
			this.homepageFeatured.featuredWordIds = Array.isArray(config.featuredWordIds)
				? config.featuredWordIds.map((id) => String(id || '').trim()).filter((id) => id)
				: []
			this.homepageFeatured.manualWordId = String(config.manualWordId || '').trim()
			if (Array.isArray(data && data.publishedWords)) {
				this.homepageFeatured.publishedWords = data.publishedWords.filter((word) => word && word.status === 'published')
			}
			this.homepageFeatured.currentWord = data && data.currentWord && data.currentWord.status === 'published'
				? data.currentWord
				: null
			this.homepageFeatured.source = String(data && data.source || 'empty')
			if (!options.keepMessage) {
				this.homepageFeatured.message = this.homepageFeatured.currentWord
					? `当前首页展示：${this.homepageFeatured.currentWord.word}`
					: '当前没有可公开展示的首页推荐词。'
			}
		},
		async loadHomepageFeaturedConfig() {
			if (!this.adminUnlocked || this.homepageFeatured.loading) return
			this.homepageFeatured.loading = true
			this.homepageFeatured.message = '正在加载服务器推荐配置...'
			try {
				const data = await getAdminHomepageFeatured({
					adminApiToken: this.adminApiTokenDraft
				})
				this.applyHomepageFeaturedResponse(data)
			} catch (error) {
				if (error && (error.code === 'UNAUTHORIZED' || error.isAuthError)) {
					this.handleAdminUnauthorized()
					return
				}
				this.homepageFeatured.message = error && error.message
					? error.message
					: '首页推荐配置加载失败。'
			} finally {
				this.homepageFeatured.loading = false
			}
		},
		setHomepageFeaturedMode(mode) {
			this.homepageFeatured.mode = mode === 'manual' ? 'manual' : 'dailyRotation'
			if (this.homepageFeatured.mode === 'dailyRotation') {
				this.homepageFeatured.manualWordId = ''
			}
			this.refreshHomepageFeaturedPreview()
		},
		addHomepageFeaturedWord(id) {
			const wordId = String(id || '').trim()
			const word = this.homepageFeatured.publishedWords.find((item) => item.id === wordId && item.status === 'published')
			if (!word) {
				uni.showToast({ title: '只能添加已发布词条', icon: 'none' })
				return
			}
			if (!this.homepageFeatured.featuredWordIds.includes(wordId)) {
				this.homepageFeatured.featuredWordIds.push(wordId)
			}
			this.refreshHomepageFeaturedPreview()
		},
		removeHomepageFeaturedWord(id) {
			const wordId = String(id || '').trim()
			this.homepageFeatured.featuredWordIds = this.homepageFeatured.featuredWordIds.filter((item) => item !== wordId)
			if (this.homepageFeatured.manualWordId === wordId) {
				this.homepageFeatured.manualWordId = ''
			}
			this.refreshHomepageFeaturedPreview()
		},
		moveHomepageFeaturedWord(index, offset) {
			const targetIndex = Number(index) + Number(offset)
			const ids = [...this.homepageFeatured.featuredWordIds]
			if (index < 0 || index >= ids.length || targetIndex < 0 || targetIndex >= ids.length) return
			const moved = ids.splice(index, 1)[0]
			ids.splice(targetIndex, 0, moved)
			this.homepageFeatured.featuredWordIds = ids
			this.refreshHomepageFeaturedPreview()
		},
		changeHomepageManualWord(event) {
			const index = Number(event && event.detail ? event.detail.value : 0)
			const selected = this.homepageManualOptions[index]
			this.homepageFeatured.manualWordId = selected ? selected.id : ''
			this.refreshHomepageFeaturedPreview()
		},
		refreshHomepageFeaturedPreview() {
			const publishedById = this.homepageFeatured.publishedWords.reduce((result, word) => {
				if (word && word.status === 'published') result[word.id] = word
				return result
			}, {})
			if (this.homepageFeatured.mode === 'manual' && publishedById[this.homepageFeatured.manualWordId]) {
				this.homepageFeatured.currentWord = publishedById[this.homepageFeatured.manualWordId]
				this.homepageFeatured.source = 'manual'
				return
			}
			const pool = this.homepageFeatured.featuredWordIds
				.map((id) => publishedById[id])
				.filter((word) => word)
			if (!pool.length) {
				this.homepageFeatured.currentWord = null
				this.homepageFeatured.source = 'empty'
				return
			}
			const date = new Date()
			const dayNumber = Math.floor((date.getTime() + 8 * 60 * 60 * 1000) / 86400000)
			this.homepageFeatured.currentWord = pool[dayNumber % pool.length]
			this.homepageFeatured.source = 'dailyRotation'
		},
		async saveHomepageFeaturedConfig() {
			if (!this.adminUnlocked || this.homepageFeatured.saving) return
			const publishedIds = new Set(
				this.homepageFeatured.publishedWords
					.filter((word) => word && word.status === 'published')
					.map((word) => word.id)
			)
			const invalidIds = this.homepageFeatured.featuredWordIds.filter((id) => !publishedIds.has(id))
			if (invalidIds.length) {
				uni.showModal({
					title: '无法保存',
					content: `推荐池包含未发布或已下架词条：${invalidIds.join(', ')}`,
					showCancel: false
				})
				return
			}
			if (
				this.homepageFeatured.mode === 'manual' &&
				(!this.homepageFeatured.manualWordId || !publishedIds.has(this.homepageFeatured.manualWordId))
			) {
				uni.showModal({
					title: '无法保存',
					content: '手动指定模式必须选择一个已发布词条。',
					showCancel: false
				})
				return
			}

			this.homepageFeatured.saving = true
			this.homepageFeatured.message = '正在保存首页推荐配置...'
			try {
				const data = await saveAdminHomepageFeatured({
					featuredWordIds: this.homepageFeatured.featuredWordIds,
					mode: this.homepageFeatured.mode,
					manualWordId: this.homepageFeatured.manualWordId
				}, {
					adminApiToken: this.adminApiTokenDraft
				})
				this.applyHomepageFeaturedResponse({
					...data,
					publishedWords: this.homepageFeatured.publishedWords
				}, { keepMessage: true })
				this.homepageFeatured.message = data.currentWord
					? `保存成功，当前首页展示：${data.currentWord.word}`
					: '保存成功，当前没有可公开展示的推荐词。'
				uni.showToast({ title: '首页推荐已保存', icon: 'success' })
			} catch (error) {
				if (error && (error.code === 'UNAUTHORIZED' || error.isAuthError)) {
					this.handleAdminUnauthorized()
					return
				}
				this.homepageFeatured.message = error && error.message
					? error.message
					: '首页推荐配置保存失败。'
				uni.showModal({
					title: '保存失败',
					content: this.homepageFeatured.message,
					showCancel: false
				})
			} finally {
				this.homepageFeatured.saving = false
			}
		},
		loadDraft() {
			const saved = uni.getStorageSync(STORAGE_KEY)
			const savedPending = uni.getStorageSync(PENDING_STORAGE_KEY)
			const source = saved && saved.length ? saved : seedWords
			this.words = clone(source).map((item) => this.normalizeWord(item))
			this.pendingWords = savedPending && savedPending.length ? clone(savedPending).map((item) => this.normalizePendingWord(item)) : []
			const initialUploadedWords = this.words.filter((item) => item.status !== 'archived' && item.status !== 'draft')
			const initialDraftWords = this.words.filter((item) => item.status === 'draft')
			const initialWords = initialUploadedWords.length ? initialUploadedWords : initialDraftWords
			this.activeBucket = initialUploadedWords.length ? 'uploaded' : 'draft'
			this.selectedSource = 'uploaded'
			this.selectedId = initialWords[0] ? initialWords[0].id : ''
			this.form = initialWords[0] ? clone(initialWords[0]) : clone(seedWords[0])
			this.illustrationImagePreviewError = false
			this.saveState = saved ? '已读取本地草稿' : '使用示例数据'
			this.expandedLetters = this.defaultExpandedLetters(initialWords)
			this.syncVideoUploadStateFromForm()
		},
		getSelectionKeyForBucket(bucket) {
			if (bucket === 'uploaded') return 'uploadedSelectedIds'
			if (bucket === 'draft') return 'draftSelectedIds'
			if (bucket === 'archived') return 'archivedSelectedIds'
			return ''
		},
		clearBatchSelection(bucket) {
			const key = this.getSelectionKeyForBucket(bucket)
			if (key) {
				this[key] = []
			}
		},
		clearAllBatchSelections() {
			this.uploadedSelectedIds = []
			this.draftSelectedIds = []
			this.archivedSelectedIds = []
		},
		setBatchSelection(ids) {
			const key = this.getSelectionKeyForBucket(this.activeBucket)
			if (!key) return
			const used = {}
			this[key] = (Array.isArray(ids) ? ids : [])
				.map((id) => String(id || '').trim())
				.filter((id) => {
					if (!id || used[id]) return false
					used[id] = true
					return true
				})
		},
		isWordSelected(word) {
			const id = String(word && word.id ? word.id : '').trim()
			return !!id && this.currentBatchSelectedIds.includes(id)
		},
		toggleWordSelection(word) {
			const id = String(word && word.id ? word.id : '').trim()
			if (!id) return
			const selected = this.currentBatchSelectedIds.slice()
			const index = selected.indexOf(id)
			if (index >= 0) {
				selected.splice(index, 1)
			} else {
				selected.push(id)
			}
			this.setBatchSelection(selected)
		},
		toggleSelectAllVisible() {
			if (!this.visibleSelectableWords.length) return
			if (this.allVisibleSelected) {
				this.setBatchSelection([])
				return
			}
			this.setBatchSelection(this.visibleSelectableWords.map((item) => item.id))
		},
		switchBucket(bucket) {
			if (this.activeBucket === bucket) return
			const previousBucket = this.activeBucket
			const applySwitch = () => {
				this.clearBatchSelection(previousBucket)
				this.applyBucketSwitch(bucket)
			}
			if (this.validateCurrent()) {
				this.persistFormToList()
				applySwitch()
				return
			}
			this.confirmDiscardInvalidEdit(applySwitch)
		},
		applyBucketSwitch(bucket) {
			this.activeBucket = bucket
			const source = bucket === 'pending' ? 'pending' : 'uploaded'
			const list = this.activeWords
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
				this.saveState = source === 'pending' ? '未上传列表为空，仍在编辑当前词条' : '当前列表为空'
			}
		},
		selectEntry(id) {
			this.selectFromList(id, this.activeBucket === 'pending' ? 'pending' : 'uploaded')
		},
		selectWord(id) {
			this.selectFromList(id, 'uploaded')
		},
		selectFromList(id, source, skipPersist) {
			const list = source === 'pending' ? this.pendingWords : this.words
			const target = list.find((item) => item.id === id)
			if (!target) return
			if (source === this.selectedSource && id === this.selectedId) {
				if (this.validateCurrent()) return
				this.confirmDiscardInvalidEdit(() => this.applySelectedEntry(target, source))
				return
			}
			const applySelection = () => this.applySelectedEntry(target, source)
			if (skipPersist) {
				applySelection()
				return
			}
			if (this.validateCurrent()) {
				this.persistFormToList()
				applySelection()
				return
			}
			this.confirmDiscardInvalidEdit(applySelection)
		},
		applySelectedEntry(target, source) {
			if (!target) return
			const id = target.id
			this.editingClipIndex = -1
			this.stopUserVideoPreview(false)
			this.activeBucket = source === 'pending'
				? 'pending'
				: (target.status === 'archived' ? 'archived' : (target.status === 'draft' ? 'draft' : 'uploaded'))
			this.selectedSource = source
			this.selectedId = id
			this.form = source === 'pending' ? this.normalizePendingWord(target) : this.normalizeWord(target)
			this.illustrationImagePreviewError = false
			this.syncVideoUploadStateFromForm()
			this.saveState = (source === 'pending' ? '正在检查未上传 ' : '正在编辑 ') + target.word
		},
		confirmDiscardInvalidEdit(onConfirm) {
			uni.showModal({
				title: '当前编辑未保存',
				content: '当前表单存在重复 ID 或未通过校验，无法自动保存。要放弃当前未保存修改并切换词条吗？',
				confirmText: '放弃并切换',
				cancelText: '继续编辑',
				confirmColor: '#fe8500',
				success: (result) => {
					if (result.confirm && typeof onConfirm === 'function') {
						onConfirm()
					}
				}
			})
		},
		createWord() {
			if (!this.validateCurrent()) return
			this.persistFormToList()
			this.activeBucket = 'draft'
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
				illustrationImage: this.normalizeIllustrationImage({}),
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
			this.activeBucket = 'draft'
			this.ensureLetterExpanded(this.getFirstLetter(this.form) || '#')
			this.saveState = '当前词条已保存为草稿'
			uni.showToast({ title: '已保存为草稿', icon: 'success' })
		},
		loadAdminApiToken() {
			const token = getAdminApiToken()
			this.adminApiTokenDraft = token
			this.adminTokenStatus = token
				? '已加载本地保存的 Admin API Token。'
				: '未保存 Admin API Token，本地开发可填写 dev-admin-token。'
		},
		saveAdminApiTokenDraft() {
			const token = saveAdminApiToken(this.adminApiTokenDraft)
			this.adminApiTokenDraft = token
			this.adminTokenStatus = token
				? 'Admin API Token 已保存到本机 localStorage。'
				: 'Admin API Token 已清除；服务器同步会鉴权失败。'
			uni.showToast({
				title: token ? 'Token 已保存' : 'Token 已清除',
				icon: 'none'
			})
		},
		async saveCurrentToServerApi() {
			if (this.serverSync.busy) return
			if (!this.validateCurrent()) return
			this.persistFormToList()
			const word = this.buildServerWordPayload(this.form)

			this.serverSync.busy = true
			this.serverSync.message = 'Saving current word to server API...'
			this.saveState = 'Saving current word to server API...'
			try {
				const result = await saveAdminWordToServer(word, {
					adminApiToken: this.adminApiTokenDraft
				})
				this.serverSync.message = `Saved ${result.word.word || result.word.id} to server API`
				this.saveState = 'Saved current word to server API'
				uni.showToast({ title: 'Saved to server API', icon: 'success' })
			} catch (error) {
				const message = error && error.message ? error.message : 'Server API save failed'
				const isAuthError = !!(error && error.isAuthError)
				this.serverSync.message = isAuthError ? '管理员鉴权失败，请检查 Admin API Token' : message
				this.saveState = isAuthError ? 'Admin API token check failed' : 'Server API save failed'
				let content = message
				if (isAuthError) {
					content = '管理员鉴权失败，请检查 Admin API Token。'
				}
				if (message.includes('not available')) {
					content = 'Please run npm.cmd run dev:api from the project root, then try saving again.'
				}
				uni.showModal({
					title: 'Save Failed',
					content,
					showCancel: false
				})
			} finally {
				this.serverSync.busy = false
			}
		},
		async loadAdminApiToken() {
			const token = getAdminApiToken()
			this.adminApiTokenDraft = token
			this.adminUnlocked = false
			this.adminTokenStatus = token ? '正在校验已保存的 Admin API Token...' : ''
			if (!token) return

			try {
				await checkAdminAuth(token)
				this.adminUnlocked = true
				this.adminTokenStatus = ''
				this.serverSync.message = '管理员已解锁'
				if (this.activeAdminView === 'dashboard') {
					await this.loadHomepageFeaturedConfig()
				}
			} catch (error) {
				saveAdminApiToken('')
				this.adminApiTokenDraft = ''
				this.adminUnlocked = false
				this.adminTokenStatus = '管理员鉴权失败，请检查 Admin API Token。'
			}
		},
		async unlockAdmin() {
			if (this.adminAuthChecking) return
			const token = String(this.adminApiTokenDraft || '').trim()
			if (!token) {
				this.adminTokenStatus = '请输入 Admin API Token。'
				return
			}

			this.adminAuthChecking = true
			this.adminTokenStatus = '正在校验 Admin API Token...'
			try {
				await checkAdminAuth(token)
				this.adminApiTokenDraft = saveAdminApiToken(token)
				this.adminUnlocked = true
				this.adminTokenStatus = ''
				this.serverSync.message = '管理员已解锁'
				if (this.activeAdminView === 'dashboard') {
					await this.loadHomepageFeaturedConfig()
				}
				uni.showToast({ title: '已进入后台', icon: 'success' })
			} catch (error) {
				saveAdminApiToken('')
				this.adminUnlocked = false
				this.adminTokenStatus = '管理员鉴权失败，请检查 Admin API Token。'
				uni.showModal({
					title: '管理员鉴权失败',
					content: '管理员鉴权失败，请检查 Admin API Token。',
					showCancel: false
				})
			} finally {
				this.adminAuthChecking = false
			}
		},
		lockAdmin() {
			saveAdminApiToken('')
			this.adminApiTokenDraft = ''
			this.adminUnlocked = false
			this.adminTokenStatus = ''
			this.serverSync.message = '管理员已锁定'
			this.homepageFeatured.currentWord = null
			this.homepageFeatured.publishedWords = []
			this.homepageFeatured.message = '管理员已锁定。'
			uni.showToast({ title: '已锁定后台', icon: 'none' })
		},
		handleAdminUnauthorized() {
			saveAdminApiToken('')
			this.adminApiTokenDraft = ''
			this.adminUnlocked = false
			this.adminTokenStatus = '管理员鉴权失败，请重新登录。'
			this.serverSync.message = '管理员鉴权失败，请重新登录'
			this.saveState = '管理员鉴权失败，请重新登录'
			uni.showModal({
				title: '管理员鉴权失败',
				content: '管理员鉴权失败，请重新登录。',
				showCancel: false
			})
		},
		async confirmServerAction(title, content, confirmText = '确认') {
			return new Promise((resolve) => {
				uni.showModal({
					title,
					content,
					confirmText,
					cancelText: '再检查',
					confirmColor: '#fe8500',
					success: (result) => resolve(!!result.confirm)
				})
			})
		},
		async syncWordToServer(word, successMessage) {
			if (!this.adminUnlocked) {
				this.handleAdminUnauthorized()
				return null
			}

			this.serverSync.busy = true
			this.serverSync.message = '正在同步到服务器...'
			this.saveState = '正在同步到服务器...'
			try {
				const result = await saveAdminWordToServer(this.buildServerWordPayload(word), {
					adminApiToken: this.adminApiTokenDraft
				})
				this.serverSync.message = successMessage
				this.saveState = successMessage
				uni.showToast({ title: successMessage, icon: 'success' })
				return result
			} catch (error) {
				if (error && (error.code === 'UNAUTHORIZED' || error.isAuthError)) {
					this.handleAdminUnauthorized()
					return null
				}

				const message = error && error.message ? error.message : 'Server API save failed'
				this.serverSync.message = message
				this.saveState = '服务器同步失败'
				uni.showModal({
					title: '服务器同步失败',
					content: message.includes('not available')
						? '请先在项目根目录运行 npm.cmd run dev:api，然后再重试。'
						: message,
					showCancel: false
				})
				return null
			} finally {
				this.serverSync.busy = false
			}
		},
		normalizePublishIdentityValue(value) {
			return String(value || '').trim()
		},
		normalizeLookupIdentityValue(value) {
			return this.normalizePublishIdentityValue(value).toLowerCase()
		},
		getWordLookupValues(...sources) {
			const values = []
			const used = {}
			const pushValue = (value) => {
				const raw = String(value || '').trim()
				if (!raw) return
				;[raw, raw.toLowerCase()].forEach((item) => {
					if (!item || used[item]) return
					used[item] = true
					values.push(item)
				})
			}
			sources.forEach((source) => {
				if (!source) return
				if (typeof source === 'string') {
					pushValue(source)
					return
				}
				if (typeof source !== 'object' || Array.isArray(source)) return
				pushValue(source.id)
				pushValue(source.word)
			})
			return values
		},
		hasWordIdentityOverlap(leftSources, rightSources) {
			const leftKeys = this.getWordLookupValues(...leftSources)
				.map((value) => this.normalizeLookupIdentityValue(value))
				.filter(Boolean)
			if (!leftKeys.length) return false
			const leftSet = leftKeys.reduce((result, value) => {
				result[value] = true
				return result
			}, {})
			return this.getWordLookupValues(...rightSources)
				.map((value) => this.normalizeLookupIdentityValue(value))
				.some((value) => value && leftSet[value])
		},
		findLocalWordIndexByIdentity(...sources) {
			const lookupKeys = this.getWordLookupValues(...sources)
				.map((value) => this.normalizeLookupIdentityValue(value))
				.filter(Boolean)
			if (!lookupKeys.length) return -1
			const lookupSet = lookupKeys.reduce((result, value) => {
				result[value] = true
				return result
			}, {})
			return this.words.findIndex((item) => this.getWordLookupValues(item)
				.map((value) => this.normalizeLookupIdentityValue(value))
				.some((value) => value && lookupSet[value]))
		},
		isPublishedServerWord(word) {
			return !!word && String(word.status || '').trim() === 'published'
		},
		async findPublishedWordOnServer(sourceWord) {
			const payload = this.buildServerWordPayload(sourceWord)
			const lookupValues = this.getWordLookupValues(sourceWord, payload)
			let lastError = null

			for (const value of lookupValues) {
				try {
					const word = await getPublicWordFromServer(value)
					if (this.isPublishedServerWord(word)) {
						return { found: true, word }
					}
				} catch (error) {
					lastError = error
				}
			}

			const query = payload.word || payload.id
			if (query) {
				try {
					const words = await searchPublicWordsFromServer(query)
					const lookupKeys = this.getWordLookupValues(sourceWord, payload)
						.map((value) => this.normalizeLookupIdentityValue(value))
						.filter(Boolean)
					const lookupSet = lookupKeys.reduce((result, value) => {
						result[value] = true
						return result
					}, {})
					const matched = words.find((item) => this.isPublishedServerWord(item) && this.getWordLookupValues(item)
						.map((value) => this.normalizeLookupIdentityValue(value))
						.some((value) => value && lookupSet[value]))
					if (matched) {
						return { found: true, word: matched }
					}
				} catch (error) {
					lastError = error
				}
			}

			return { found: false, word: null, error: lastError }
		},
		persistWordsToStorage() {
			uni.setStorageSync(STORAGE_KEY, this.stripRuntimeVideoFields(this.words))
		},
		markLocalWordPublished(localWord, serverWord, options = {}) {
			const payload = this.buildServerWordPayload(Object.assign({}, clone(localWord || {}), { status: 'published' }))
			const index = this.findLocalWordIndexByIdentity(localWord, payload, serverWord)
			if (index < 0) return false

			const previousLocal = clone(this.words[index])
			const selectedMatches = this.selectedSource !== 'pending' && this.hasWordIdentityOverlap(
				[{ id: this.selectedId }, this.form],
				[localWord, previousLocal, payload, serverWord]
			)
			const next = clone(previousLocal)
			const canonicalId = this.normalizePublishIdentityValue(
				(serverWord && serverWord.id) || payload.id || next.id
			)
			const canonicalWord = this.normalizePublishIdentityValue(
				(serverWord && serverWord.word) || payload.word || next.word || canonicalId
			)
			next.id = canonicalId || next.id
			next.word = canonicalWord || next.word || next.id
			next.status = 'published'

			const normalized = this.normalizeWord(next)
			this.words.splice(index, 1, normalized)

			if (selectedMatches) {
				this.activeBucket = 'uploaded'
				this.selectedSource = 'uploaded'
				this.selectedId = normalized.id
				this.form = clone(normalized)
				this.syncVideoUploadStateFromForm()
				this.ensureLetterExpanded(this.getFirstLetter(normalized) || '#')
			}

			if (options.persist !== false) {
				this.persistWordsToStorage()
			}
			return true
		},
		syncSelectedWordFromLocalList() {
			if (this.selectedSource === 'pending') return
			const index = this.findLocalWordIndexByIdentity({ id: this.selectedId }, this.form)
			if (index < 0) return
			const current = this.words[index]
			this.selectedId = current.id
			this.form = clone(current)
			this.syncVideoUploadStateFromForm()
			if (this.activeBucket === 'archived' && current.status !== 'archived') {
				this.activeBucket = 'uploaded'
			}
			this.ensureLetterExpanded(this.getFirstLetter(current) || '#')
		},
		getErrorMessage(error) {
			return error && error.message ? error.message : 'Server API save failed'
		},
		async publishLocalWordWithServerVerification(localWord, options = {}) {
			const payload = this.buildServerWordPayload(Object.assign({}, clone(localWord || {}), { status: 'published' }))
			try {
				const result = await saveAdminWordToServer(payload, {
					adminApiToken: this.adminApiTokenDraft
				})
				this.markLocalWordPublished(localWord, (result && result.word) || payload, {
					persist: options.persist
				})
				return {
					status: 'success',
					word: (result && result.word) || payload
				}
			} catch (error) {
				if (error && (error.code === 'UNAUTHORIZED' || error.isAuthError)) {
					throw error
				}

				const verification = await this.findPublishedWordOnServer(payload)
				if (verification.found) {
					this.markLocalWordPublished(localWord, verification.word, {
						persist: options.persist
					})
					return {
						status: 'synced',
						word: verification.word,
						error
					}
				}

				return {
					status: 'failed',
					error,
					verificationError: verification.error
				}
			}
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
				if (this.activeBucket === 'archived') {
					this.activeBucket = 'uploaded'
					this.ensureLetterExpanded(this.getFirstLetter(this.form) || '#')
				}
				this.saveState = '当前词条已发布到本地列表'
				uni.showToast({ title: '已发布当前词条', icon: 'success' })
			})
		},
		unpublishCurrent() {
			if (this.selectedSource === 'pending' || this.form.status !== 'published') return
			if (!this.validateStatusActionTarget()) return
			this.confirmStatusChange(
				'撤下当前词条',
				'撤下后，小程序用户端将看不到该词条，但后台仍会保留，可重新发布。',
				'确认撤下',
				() => {
					this.form.status = 'unpublished'
					this.persistFormToList()
					uni.setStorageSync(STORAGE_KEY, this.stripRuntimeVideoFields(this.words))
					this.saveState = '当前词条已撤下，用户端将不再展示'
					uni.showToast({ title: '已撤下当前词条', icon: 'success' })
				}
			)
		},
		async archiveCurrent() {
			if (this.serverSync.busy) return
			if (this.selectedSource === 'pending' || this.form.status === 'archived') return
			if (!this.validateStatusActionTarget()) return

			const confirmed = await this.confirmServerAction(
				'归档当前词条',
				'归档后，该词条将从默认后台列表隐藏，并同步到服务器；小程序公开接口将不再返回该词条。',
				'确认归档'
			)
			if (!confirmed) return

			const previousForm = clone(this.form)
			const previousWords = clone(this.words)
			this.form.status = 'archived'
			this.persistFormToList()
			const word = this.buildServerWordPayload(this.form)
			const result = await this.syncWordToServer(word, '当前词条已归档并同步到服务器')
			if (!result) {
				this.form = previousForm
				this.words = previousWords
				return
			}

			uni.setStorageSync(STORAGE_KEY, this.stripRuntimeVideoFields(this.words))
			this.activeBucket = 'archived'
			this.ensureLetterExpanded(this.getFirstLetter(this.form) || '#')
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
		async publishCurrent() {
			if (this.serverSync.busy) return
			if (!this.validateCurrent()) return
			if (this.selectedSource === 'pending') {
				this.commitCurrentPendingToDraft()
				return
			}

			const confirmed = await this.confirmServerAction(
				'发布当前词条',
				`确认发布「${this.form.word}」并同步到服务器吗？发布后小程序公开接口会读取这个词条。`,
				'确认发布'
			)
			if (!confirmed) return

			const previousForm = clone(this.form)
			const previousWords = clone(this.words)
			const publishedPayload = this.buildServerWordPayload(Object.assign({}, clone(this.form), { status: 'published' }))
			this.form = this.normalizeWord(Object.assign({}, this.form, {
				id: publishedPayload.id,
				word: publishedPayload.word,
				status: 'published'
			}))
			this.persistFormToList()
			if (!this.validateAllWords()) {
				this.form = previousForm
				this.words = previousWords
				return
			}

			this.serverSync.busy = true
			this.serverSync.message = '正在发布当前词条到服务器...'
			this.saveState = this.serverSync.message
			try {
				const result = await this.publishLocalWordWithServerVerification(this.form)
				if (result.status === 'success') {
					this.serverSync.message = '当前词条已发布到服务器'
					this.saveState = '当前词条已发布到服务器'
					uni.showToast({ title: '已发布到服务器', icon: 'success' })
				} else if (result.status === 'synced') {
					this.serverSync.message = '服务器已存在该词条，已同步为已发布'
					this.saveState = '服务器已存在该词条，已同步为已发布'
					uni.showToast({ title: '已同步为已发布', icon: 'success' })
				} else {
					this.form = previousForm
					this.words = previousWords
					const message = this.getErrorMessage(result.error || result.verificationError)
					this.serverSync.message = message
					this.saveState = '发布当前词条失败'
					uni.showModal({
						title: '发布失败',
						content: message,
						showCancel: false
					})
					return
				}
			} catch (error) {
				this.form = previousForm
				this.words = previousWords
				if (error && (error.code === 'UNAUTHORIZED' || error.isAuthError)) {
					this.handleAdminUnauthorized()
				} else {
					const message = this.getErrorMessage(error)
					this.serverSync.message = message
					this.saveState = '发布当前词条失败'
					uni.showModal({
						title: '发布失败',
						content: message,
						showCancel: false
					})
				}
				return
			} finally {
				this.serverSync.busy = false
			}

			if (this.activeBucket === 'archived') {
				this.activeBucket = 'uploaded'
				this.ensureLetterExpanded(this.getFirstLetter(this.form) || '#')
			}
		},
		async unpublishCurrent() {
			if (this.serverSync.busy) return
			if (this.selectedSource === 'pending' || this.form.status !== 'published') return
			if (!this.validateStatusActionTarget()) return

			const confirmed = await this.confirmServerAction(
				'撤下当前词条',
				'撤下后，小程序用户端将看不到该词条，但后台仍会保留，可重新发布。',
				'确认撤下'
			)
			if (!confirmed) return

			const previousForm = clone(this.form)
			const previousWords = clone(this.words)
			this.form.status = 'unpublished'
			this.persistFormToList()
			const word = this.buildServerWordPayload(this.form)
			const result = await this.syncWordToServer(word, '当前词条已撤下并同步到服务器')
			if (!result) {
				this.form = previousForm
				this.words = previousWords
				return
			}

			uni.setStorageSync(STORAGE_KEY, this.stripRuntimeVideoFields(this.words))
		},
		async publishAllDrafts() {
			if (this.serverSync.busy) return
			if (!this.validateCurrent()) return
			this.persistFormToList()
			if (this.selectedSource === 'pending') {
				this.persistPendingWords()
			}
			if (!this.validateAllWords()) return

			const draftWords = this.words.filter((item) => item.status === 'draft')
			if (!draftWords.length) {
				uni.showToast({ title: '当前没有本地草稿', icon: 'none' })
				return
			}

			const confirmed = await this.confirmServerAction(
				'发布全部本地草稿到服务器',
				`确认把 ${draftWords.length} 个本地草稿发布并逐条同步到服务器吗？`,
				'确认发布'
			)
			if (!confirmed) return

			const draftSnapshots = draftWords.map((item) => clone(item))
			const summary = {
				success: 0,
				synced: 0,
				failed: []
			}

			this.serverSync.busy = true
			this.serverSync.message = `正在发布 ${draftSnapshots.length} 个本地草稿到服务器...`
			this.saveState = this.serverSync.message
			try {
				for (let index = 0; index < draftSnapshots.length; index += 1) {
					const word = draftSnapshots[index]
					this.serverSync.message = `正在发布 ${index + 1}/${draftSnapshots.length}：${word.word || word.id}`
					try {
						const result = await this.publishLocalWordWithServerVerification(word, { persist: false })
						if (result.status === 'success') {
							summary.success += 1
						} else if (result.status === 'synced') {
							summary.synced += 1
						} else {
							summary.failed.push({
								id: word.id || word.word || `第 ${index + 1} 条`,
								reason: this.getErrorMessage(result.error || result.verificationError)
							})
						}
					} catch (error) {
						const reason = this.getErrorMessage(error)
						summary.failed.push({
							id: word.id || word.word || `第 ${index + 1} 条`,
							reason
						})
						if (error && (error.code === 'UNAUTHORIZED' || error.isAuthError)) {
							this.handleAdminUnauthorized()
							break
						}
					}
				}

				this.syncSelectedWordFromLocalList()
				this.persistWordsToStorage()
				const failedLines = summary.failed.map((item) => `${item.id}：${item.reason}`)
				const content = [
					`成功 ${summary.success} 个`,
					`服务器已存在并同步 ${summary.synced} 个`,
					`失败 ${summary.failed.length} 个`
				].concat(failedLines.length ? ['失败词条：'].concat(failedLines) : []).join('\n')
				this.serverSync.message = `批量发布完成：成功 ${summary.success}，同步 ${summary.synced}，失败 ${summary.failed.length}`
				this.saveState = this.serverSync.message
				uni.showModal({
					title: summary.failed.length ? '批量发布完成（有失败）' : '批量发布完成',
					content,
					showCancel: false
				})
			} finally {
				this.serverSync.busy = false
			}
		},
		async syncPublishedStatusesFromServer() {
			if (this.serverSync.busy) return
			if (!this.validateCurrent()) return
			this.persistFormToList()

			const draftWords = this.words.filter((item) => item.status === 'draft').map((item) => clone(item))
			if (!draftWords.length) {
				uni.showToast({ title: '当前没有本地草稿需要同步', icon: 'none' })
				return
			}

			this.serverSync.busy = true
			this.serverSync.message = `正在校准 ${draftWords.length} 个本地草稿的服务器状态...`
			this.saveState = this.serverSync.message
			const summary = {
				synced: 0,
				unchanged: 0,
				failed: []
			}

			try {
				for (let index = 0; index < draftWords.length; index += 1) {
					const word = draftWords[index]
					this.serverSync.message = `正在校准 ${index + 1}/${draftWords.length}：${word.word || word.id}`
					const result = await this.findPublishedWordOnServer(word)
					if (result.found) {
						this.markLocalWordPublished(word, result.word, { persist: false })
						summary.synced += 1
					} else if (result.error) {
						summary.failed.push({
							id: word.id || word.word || `第 ${index + 1} 条`,
							reason: this.getErrorMessage(result.error)
						})
					} else {
						summary.unchanged += 1
					}
				}

				this.syncSelectedWordFromLocalList()
				this.persistWordsToStorage()
				const failedLines = summary.failed.map((item) => `${item.id}：${item.reason}`)
				const content = [
					`已同步为已发布 ${summary.synced} 个`,
					`服务器未发布或不存在 ${summary.unchanged} 个`,
					`查询失败 ${summary.failed.length} 个`
				].concat(failedLines.length ? ['查询失败词条：'].concat(failedLines) : []).join('\n')
				this.serverSync.message = `服务器状态校准完成：同步 ${summary.synced}，未变 ${summary.unchanged}，失败 ${summary.failed.length}`
				this.saveState = this.serverSync.message
				uni.showModal({
					title: '服务器状态同步完成',
					content,
					showCancel: false
				})
			} catch (error) {
				const message = this.getErrorMessage(error)
				this.serverSync.message = message
				this.saveState = '服务器状态同步失败'
				uni.showModal({
					title: '服务器状态同步失败',
					content: message,
					showCancel: false
				})
			} finally {
				this.serverSync.busy = false
			}
		},
		getSelectedWordsForActiveBucket() {
			const selected = this.currentBatchSelectedIds.reduce((result, id) => {
				result[id] = true
				return result
			}, {})
			return this.activeWords.filter((item) => item && selected[item.id])
		},
		refreshActiveListAfterBatchOperation() {
			const list = this.activeWords
			const current = list.find((item) => item.id === this.selectedId)
			if (current) {
				this.form = clone(current)
				this.syncVideoUploadStateFromForm()
				this.ensureLetterExpanded(this.getFirstLetter(current) || '#')
				return
			}

			if (list[0]) {
				this.selectedSource = this.activeBucket === 'pending' ? 'pending' : 'uploaded'
				this.selectedId = list[0].id
				this.form = clone(list[0])
				this.syncVideoUploadStateFromForm()
				this.ensureLetterExpanded(this.getFirstLetter(list[0]) || '#')
				return
			}

			this.selectedId = ''
			this.form = clone(seedWords[0])
			this.syncVideoUploadStateFromForm()
		},
		confirmBatchAction(title, content, confirmText) {
			return new Promise((resolve) => {
				uni.showModal({
					title,
					content,
					confirmText,
					cancelText: '取消',
					confirmColor: '#fe8500',
					success: (result) => resolve(!!result.confirm),
					fail: () => resolve(false)
				})
			})
		},
		async applyBatchOperation() {
			if (this.serverSync.busy) return
			const selectedWords = this.getSelectedWordsForActiveBucket()
			if (!selectedWords.length) {
				uni.showToast({ title: '请先选择词条', icon: 'none' })
				return
			}

			if (this.activeBucket === 'uploaded') {
				await this.batchMoveUploadedWordsToDraft(selectedWords)
				return
			}
			if (this.activeBucket === 'draft') {
				await this.batchArchiveDraftWords(selectedWords)
				return
			}
			if (this.activeBucket === 'archived') {
				await this.batchDeleteArchivedWords(selectedWords)
			}
		},
		async batchMoveUploadedWordsToDraft(selectedWords) {
			const confirmed = await this.confirmBatchAction(
				'撤下所选词条到草稿',
				`确定将已选 ${selectedWords.length} 个词条撤下到草稿吗？`,
				'确认撤下'
			)
			if (!confirmed) return

			const failed = []
			let changed = 0
			this.serverSync.busy = true
			try {
				for (let index = 0; index < selectedWords.length; index += 1) {
					const item = selectedWords[index]
					if (item.status === 'archived' || item.status === 'draft') {
						failed.push(`${item.id || item.word || '未知词条'}：当前状态不可撤下`)
						continue
					}
					const next = this.normalizeWord(Object.assign({}, item, { status: 'draft' }))
					this.serverSync.message = `正在撤下 ${index + 1}/${selectedWords.length}：${item.word || item.id}`
					try {
						const result = await saveAdminWordToServer(this.buildServerWordPayload(next), {
							adminApiToken: this.adminApiTokenDraft
						})
						const savedWord = this.normalizeWord((result && result.word) || next)
						const localIndex = this.findLocalWordIndexByIdentity(item, savedWord)
						if (localIndex >= 0) {
							this.words.splice(localIndex, 1, savedWord)
							changed += 1
						} else {
							failed.push(`${item.id || item.word || '未知词条'}：本地词条未找到`)
						}
					} catch (error) {
						failed.push(`${item.id || item.word || '未知词条'}：${this.getErrorMessage(error)}`)
						if (error && (error.code === 'UNAUTHORIZED' || error.isAuthError)) {
							this.handleAdminUnauthorized()
							break
						}
					}
				}
			} finally {
				this.serverSync.busy = false
			}
			this.persistWordsToStorage()
			this.clearBatchSelection('uploaded')
			this.refreshActiveListAfterBatchOperation()
			this.saveState = `已撤下 ${changed} 个词条到草稿`
			const content = failed.length
				? `已撤下 ${changed} 个。\n失败词条：\n${failed.join('\n')}`
				: `已撤下 ${changed} 个词条到草稿。`
			uni.showModal({
				title: failed.length ? '批量撤下完成（有跳过）' : '批量撤下完成',
				content,
				showCancel: false
			})
		},
		async batchArchiveDraftWords(selectedWords) {
			const confirmed = await this.confirmBatchAction(
				'归档所选草稿',
				`确定将已选 ${selectedWords.length} 个草稿词条归档吗？`,
				'确认归档'
			)
			if (!confirmed) return

			const failed = []
			let changed = 0
			this.serverSync.busy = true
			try {
				for (let index = 0; index < selectedWords.length; index += 1) {
					const item = selectedWords[index]
					if (item.status !== 'draft') {
						failed.push(`${item.id || item.word || '未知词条'}：不是草稿状态`)
						continue
					}
					const next = this.normalizeWord(Object.assign({}, item, { status: 'archived' }))
					this.serverSync.message = `正在归档 ${index + 1}/${selectedWords.length}：${item.word || item.id}`
					try {
						const result = await saveAdminWordToServer(this.buildServerWordPayload(next), {
							adminApiToken: this.adminApiTokenDraft
						})
						const savedWord = this.normalizeWord((result && result.word) || next)
						const localIndex = this.findLocalWordIndexByIdentity(item, savedWord)
						if (localIndex >= 0) {
							this.words.splice(localIndex, 1, savedWord)
							changed += 1
						} else {
							failed.push(`${item.id || item.word || '未知词条'}：本地词条未找到`)
						}
					} catch (error) {
						failed.push(`${item.id || item.word || '未知词条'}：${this.getErrorMessage(error)}`)
						if (error && (error.code === 'UNAUTHORIZED' || error.isAuthError)) {
							this.handleAdminUnauthorized()
							break
						}
					}
				}
			} finally {
				this.serverSync.busy = false
			}
			this.persistWordsToStorage()
			this.clearBatchSelection('draft')
			this.refreshActiveListAfterBatchOperation()
			this.saveState = `已归档 ${changed} 个草稿词条`
			const content = failed.length
				? `已归档 ${changed} 个。\n失败词条：\n${failed.join('\n')}`
				: `已归档 ${changed} 个草稿词条。`
			uni.showModal({
				title: failed.length ? '批量归档完成（有跳过）' : '批量归档完成',
				content,
				showCancel: false
			})
		},
		async batchDeleteArchivedWords(selectedWords) {
			const confirmed = await this.confirmBatchAction(
				'永久删除归档词条',
				`确定永久删除已选 ${selectedWords.length} 个归档词条吗？此操作不可恢复。`,
				'确认删除'
			)
			if (!confirmed) return

			const selected = selectedWords.reduce((result, item) => {
				result[item.id] = true
				return result
			}, {})
			const failed = []
			let changed = 0
			this.words = this.words.filter((item) => {
				if (!selected[item.id]) return true
				if (item.status !== 'archived') {
					failed.push(item.id || item.word || '未知词条')
					return true
				}
				changed += 1
				return false
			})
			this.persistWordsToStorage()
			this.clearBatchSelection('archived')
			this.refreshActiveListAfterBatchOperation()
			this.saveState = `已删除 ${changed} 个归档词条`
			const content = failed.length
				? `已删除 ${changed} 个。以下词条未处理：${failed.join('、')}`
				: `已删除 ${changed} 个归档词条。`
			uni.showModal({
				title: failed.length ? '批量删除完成（有跳过）' : '批量删除完成',
				content,
				showCancel: false
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
		confirmStatusChange(title, content, confirmText, onConfirm) {
			uni.showModal({
				title,
				content,
				confirmText,
				cancelText: '取消',
				confirmColor: '#fe8500',
				success: (result) => {
					if (result.confirm && typeof onConfirm === 'function') {
						onConfirm()
					}
				}
			})
		},
		isHiddenAdminStatus(status) {
			return status === 'unpublished' || status === 'archived'
		},
		validateStatusActionTarget() {
			if (!String(this.form.id || '').trim()) {
				uni.showToast({ title: '请先填写单词 ID', icon: 'none' })
				return false
			}
			if (!String(this.form.word || '').trim()) {
				uni.showToast({ title: '请先填写单词', icon: 'none' })
				return false
			}
			return true
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
			const duplicate = this.isHiddenAdminStatus(this.form.status)
				? null
				: targetList.find((item) =>
					String(item.id || '').trim() === id &&
					String(item.id || '').trim() !== String(this.selectedId || '').trim() &&
					!this.isHiddenAdminStatus(item.status)
				)
			if (duplicate) {
				uni.showToast({ title: '单词 ID 已存在', icon: 'none' })
				return false
			}
			const illustrationResult = this.validateIllustrationImage(this.form)
			if (!illustrationResult.ok) {
				uni.showToast({ title: illustrationResult.message, icon: 'none' })
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
				if (this.isHiddenAdminStatus(item.status)) continue
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
				const illustrationResult = this.validateIllustrationImage(item)
				if (!illustrationResult.ok) {
					uni.showToast({ title: `${id} 的示意图地址无效`, icon: 'none' })
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
			this.clearAllBatchSelections()
			this.words = clone(seedWords)
			this.pendingWords = []
			const initialUploadedWords = this.words.filter((item) => item.status !== 'archived' && item.status !== 'draft')
			const initialDraftWords = this.words.filter((item) => item.status === 'draft')
			const initialWords = initialUploadedWords.length ? initialUploadedWords : initialDraftWords
			this.activeBucket = initialUploadedWords.length ? 'uploaded' : 'draft'
			this.selectedSource = 'uploaded'
			this.selectedId = initialWords[0] ? initialWords[0].id : ''
			this.form = initialWords[0] ? clone(initialWords[0]) : clone(seedWords[0])
			this.syncVideoUploadStateFromForm()
			this.expandedLetters = this.defaultExpandedLetters(initialWords)
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
		applyKeywordSearch() {
			const normalizedKeyword = String(this.keywordDraft || '').trim()
			this.keyword = normalizedKeyword
			this.keywordDraft = normalizedKeyword
			this.clearBatchSelection(this.activeBucket)
			if (!normalizedKeyword) {
				this.expandedLetters = this.defaultExpandedLetters(this.activeWords)
				return
			}
			const firstMatch = this.filteredWords[0]
			if (firstMatch) {
				this.ensureLetterExpanded(this.getFirstLetter(firstMatch) || '#')
			}
		},
		clearKeywordSearch() {
			this.keywordDraft = ''
			this.keyword = ''
			this.clearBatchSelection(this.activeBucket)
			this.expandedLetters = this.defaultExpandedLetters(this.activeWords)
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
				this.syncAudioUploadStateFromForm()
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
			this.syncAudioUploadStateFromForm()
		},
		syncAudioUploadStateFromForm() {
			this.cancelAudioUploadTimer()
			const audio = this.form && this.form.pronunciationAudio ? this.form.pronunciationAudio : {}
			const currentPreviewUrl = this.audioUpload && this.audioUpload.previewUrl ? this.audioUpload.previewUrl : ''
			if (audio.assetId || audio.url || audio.audioUrl) {
				const previewUrl = this.isPlayableAdminAudioUrl(audio.localPreviewUrl || audio.url || audio.audioUrl)
					? String(audio.localPreviewUrl || audio.url || audio.audioUrl).trim()
					: ''
				if (currentPreviewUrl && currentPreviewUrl !== previewUrl) {
					this.releaseAudioPreview(currentPreviewUrl)
				}
				this.audioUpload = {
					status: audio.assetId ? 'done' : 'ready',
					progress: audio.assetId ? 100 : 0,
					fileName: audio.fileName || '',
					fileSizeLabel: audio.size ? this.formatFileSize(audio.size) : '',
					mimeType: audio.mimeType || '',
					message: audio.assetId
						? '当前词条已经有发音音频资产信息。'
						: '当前词条只有音频地址，还没有上传资产元数据。',
					previewUrl
				}
				return
			}
			if (currentPreviewUrl) {
				this.releaseAudioPreview(currentPreviewUrl)
			}
			this.audioUpload = {
				status: 'idle',
				progress: 0,
				fileName: '',
				fileSizeLabel: '',
				mimeType: '',
				message: '选择一个 mp3、wav、m4a、aac、ogg 或 webm 音频文件，保存后小程序详情页才显示小喇叭。',
				previewUrl: ''
			}
		},
		handleNativeAudioFileChange(event) {
			this.handleAudioFileChange(event)
			if (event && event.target) {
				event.target.value = ''
			}
		},
		installNativeAudioButtonHandler() {
			if (typeof document === 'undefined') return
			this.$nextTick(() => {
				const trigger = document.getElementById('audio-native-picker-host')
				if (!trigger) return
				if (trigger === this.audioFileTriggerEl && this.runtimeAudioInputEl) return
				this.removeNativeAudioButtonHandler()
				trigger.innerHTML = ''
				const input = document.createElement('input')
				input.type = 'file'
				input.accept = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/webm,audio/*'
				input.multiple = false
				input.className = 'runtime-audio-file-input'
				input.setAttribute('aria-label', '选择发音音频文件')
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
				input.addEventListener('change', this.handleNativeAudioFileChange)
				trigger.appendChild(input)
				this.audioFileTriggerEl = trigger
				this.runtimeAudioInputEl = input
			})
		},
		removeNativeAudioButtonHandler() {
			if (this.runtimeAudioInputEl) {
				this.runtimeAudioInputEl.removeEventListener('change', this.handleNativeAudioFileChange)
				if (this.runtimeAudioInputEl.parentNode) {
					this.runtimeAudioInputEl.parentNode.removeChild(this.runtimeAudioInputEl)
				}
			}
			this.audioFileTriggerEl = null
			this.runtimeAudioInputEl = null
		},
		handleAudioFileChange(eventOrFile) {
			const file = eventOrFile && eventOrFile.name
				? eventOrFile
				: eventOrFile && eventOrFile.target && eventOrFile.target.files
					? eventOrFile.target.files[0]
					: null
			if (!file) return

			this.cancelAudioUploadTimer()
			const validation = this.validateAudioFile(file)
			if (!validation.ok) {
				this.audioUpload = {
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

			this.releaseAudioPreview(null, { force: true })
			const previewUrl = URL.createObjectURL(file)
			this.ensurePronunciationAudioObject()
			this.form.pronunciationAudio = Object.assign({}, this.emptyPronunciationAudioObject(), {
				fileName: file.name || '',
				mimeType: file.type || '',
				size: file.size || '',
				localPreviewUrl: previewUrl
			})
			this.form.audioUrl = ''
			this.audioUpload = {
				status: 'ready',
				progress: 0,
				fileName: file.name,
				fileSizeLabel: this.formatFileSize(file.size),
				mimeType: file.type || 'audio/*',
				message: '文件已选择，正在模拟上传到未来云存储。',
				previewUrl
			}
			this.simulateAudioUpload(file)
		},
		validateAudioFile(file) {
			const fileName = file && file.name ? file.name.toLowerCase() : ''
			const mimeType = file && file.type ? file.type : ''
			const allowedExtension = /\.(mp3|wav|m4a|aac|ogg|oga|webm)$/i.test(fileName)
			const allowedMime = mimeType.indexOf('audio/') === 0 || mimeType === 'video/webm' || mimeType === 'video/mp4'

			if (!allowedExtension && !allowedMime) {
				return { ok: false, message: '请选择 mp3、wav、m4a、aac、ogg 或 webm 音频文件' }
			}
			if (file.size > AUDIO_MAX_SIZE_BYTES) {
				return { ok: false, message: `发音音频不能超过 ${AUDIO_MAX_SIZE_MB}MB` }
			}
			return { ok: true }
		},
		simulateAudioUpload(file) {
			this.cancelAudioUploadTimer()
			const uploadJob = {
				formRef: this.form,
				startedAt: Date.now()
			}
			this.audioUploadJob = uploadJob

			this.audioUpload.status = 'uploading'
			this.audioUpload.progress = 10
			this.audioUpload.message = '上传演练中：正在生成音频资产 ID、存储路径和播放地址。'

			this.audioUploadTimer = setInterval(() => {
				if (this.audioUploadJob !== uploadJob) return
				const nextProgress = Math.min(this.audioUpload.progress + 30, 100)
				this.audioUpload.progress = nextProgress

				if (nextProgress < 100) return
				clearInterval(this.audioUploadTimer)
				this.audioUploadTimer = null
				this.audioUploadJob = null
				this.completeAudioUpload(file, uploadJob)
			}, 180)
		},
		cancelAudioUploadTimer() {
			if (this.audioUploadTimer) {
				clearInterval(this.audioUploadTimer)
				this.audioUploadTimer = null
			}
			this.audioUploadJob = null
		},
		completeAudioUpload(file, uploadJob) {
			if (uploadJob && uploadJob.formRef !== this.form) return
			const safeName = this.toSafeAudioFileName(file.name || 'pronunciation.mp3')
			const assetId = `${this.form.id || this.form.word || 'word'}-audio-${Date.now()}`
			const storagePath = `audios/pronunciation/${this.form.id || 'draft'}/${assetId}-${safeName}`
			const mockUrl = `mock-cloud://${storagePath}`

			this.ensurePronunciationAudioObject()
			this.form.pronunciationAudio = Object.assign({}, this.form.pronunciationAudio, {
				url: mockUrl,
				audioUrl: mockUrl,
				provider: AUDIO_UPLOAD_PROVIDER,
				assetId,
				storagePath,
				fileName: file.name || safeName,
				mimeType: file.type || 'audio/*',
				size: file.size || 0,
				uploadStatus: 'uploaded',
				uploadedAt: new Date().toISOString(),
				localPreviewUrl: this.audioUpload.previewUrl
			})
			this.form.audioUrl = mockUrl
			this.audioUpload.status = 'done'
			this.audioUpload.progress = 100
			this.audioUpload.message = '上传演练完成：字段已写入当前词条。同步到小程序预览时，本地音频会通过 preview bridge 变成可播放地址。'
			this.saveState = '发音音频资产已写入当前词条'
		},
		clearPronunciationAudioAsset() {
			this.cancelAudioUploadTimer()
			this.ensurePronunciationAudioObject()
			this.releaseAudioPreview(null, { force: true })
			this.form.pronunciationAudio = {}
			this.form.audioUrl = ''
			this.audioUpload = {
				status: 'idle',
				progress: 0,
				fileName: '',
				fileSizeLabel: '',
				mimeType: '',
				message: '发音音频已清除，可以重新选择文件。',
				previewUrl: ''
			}
			this.saveState = '已清除发音音频资产'
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
		toSafeAudioFileName(fileName) {
			const normalized = String(fileName || 'pronunciation.mp3').trim().toLowerCase()
			return normalized.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'pronunciation.mp3'
		},
		isPlayableAdminAudioUrl(url) {
			const value = String(url || '').trim()
			return /^(blob:|data:|https?:\/\/)/i.test(value)
		},
		emptyPronunciationAudioObject() {
			return {
				url: '',
				audioUrl: '',
				provider: '',
				assetId: '',
				storagePath: '',
				fileName: '',
				mimeType: '',
				size: '',
				durationSec: '',
				uploadStatus: '',
				uploadedAt: '',
				localPreviewUrl: ''
			}
		},
		ensurePronunciationAudioObject() {
			if (!this.form.pronunciationAudio || typeof this.form.pronunciationAudio !== 'object') {
				this.$set(this.form, 'pronunciationAudio', this.emptyPronunciationAudioObject())
			}
			if (!Object.prototype.hasOwnProperty.call(this.form, 'audioUrl')) {
				this.$set(this.form, 'audioUrl', '')
			}
		},
		isPreviewUrlUsedByAudio(url) {
			if (!url) return false
			const matches = (word) => {
				const audio = word && word.pronunciationAudio ? word.pronunciationAudio : {}
				return audio.localPreviewUrl === url || audio.local_preview_url === url
			}
			if (matches(this.form)) return true
			const lists = [this.words, this.pendingWords]
			return lists.some((list) => Array.isArray(list) && list.some((item) => matches(item)))
		},
		releaseAudioPreview(url, options = {}) {
			const targetUrl = url || (this.audioUpload && this.audioUpload.previewUrl)
			if (targetUrl && /^blob:/i.test(targetUrl) && typeof URL !== 'undefined') {
				if (!options.force && this.isPreviewUrlUsedByAudio(targetUrl)) return
				URL.revokeObjectURL(targetUrl)
			}
			if (!url && this.audioUpload) {
				this.audioUpload.previewUrl = ''
			}
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
				if (word.pronunciationAudio) stripClip(word.pronunciationAudio)
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
		normalizePronunciationAudio(raw) {
			const source = raw || {}
			const size = Number(source.size)
			const durationSec = Number(source.durationSec !== undefined ? source.durationSec : source.duration_sec)
			const url = String(source.url || source.audioUrl || source.audio_url || '').trim()
			const next = {
				url,
				audioUrl: url,
				provider: String(source.provider || '').trim(),
				assetId: String(source.assetId || source.asset_id || '').trim(),
				storagePath: String(source.storagePath || source.storage_path || '').trim(),
				fileName: String(source.fileName || source.file_name || '').trim(),
				mimeType: String(source.mimeType || source.mime_type || '').trim(),
				size: source.size === '' || source.size === undefined || Number.isNaN(size) ? '' : size,
				durationSec: source.durationSec === '' || source.duration_sec === '' || (source.durationSec === undefined && source.duration_sec === undefined) || Number.isNaN(durationSec) ? '' : durationSec,
				uploadStatus: String(source.uploadStatus || source.upload_status || '').trim(),
				uploadedAt: String(source.uploadedAt || source.uploaded_at || '').trim(),
				localPreviewUrl: /^(blob:|data:|https?:\/\/)/i.test(String(source.localPreviewUrl || source.local_preview_url || ''))
					? String(source.localPreviewUrl || source.local_preview_url).trim()
					: ''
			}
			const hasPayload = ['url', 'assetId', 'storagePath', 'fileName', 'mimeType', 'uploadStatus', 'uploadedAt'].some((field) => next[field]) ||
				next.size !== '' ||
				next.durationSec !== '' ||
				next.localPreviewUrl
			return hasPayload ? next : {}
		},
		isProductionIllustrationImageUrl(value) {
			const url = String(value || '').trim()
			if (!url || /\s/.test(url)) return false
			const match = url.match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/i)
			if (!match) return false
			const authority = (match[1].split('@').pop() || '').toLowerCase()
			let hostname = authority
			if (authority.startsWith('[')) {
				const closingIndex = authority.indexOf(']')
				hostname = closingIndex > -1 ? authority.slice(1, closingIndex) : ''
			} else {
				hostname = authority.split(':')[0].replace(/\.$/, '')
			}
			if (!hostname || hostname === 'localhost' || hostname === '::1') return false
			if (hostname === 'example.com' || hostname.endsWith('.example.com')) return false
			const octets = hostname.split('.')
			if (octets.length === 4 && octets.every((item) => /^\d{1,3}$/.test(item))) {
				return Number(octets[0]) !== 127
			}
			return true
		},
		normalizeIllustrationImage(image) {
			const source = image && typeof image === 'object' && !Array.isArray(image) ? image : {}
			return {
				url: String(source.url || '').trim(),
				title: String(source.title || '').trim(),
				alt: String(source.alt || '').trim(),
				provider: String(source.provider || '').trim(),
				assetId: String(source.assetId || source.asset_id || '').trim(),
				uploadStatus: String(source.uploadStatus || source.upload_status || '').trim(),
				uploadedAt: String(source.uploadedAt || source.uploaded_at || '').trim()
			}
		},
		hasIllustrationImageFields(image) {
			const source = image && typeof image === 'object' && !Array.isArray(image) ? image : {}
			return ['url', 'title', 'alt', 'provider', 'assetId', 'uploadStatus', 'uploadedAt']
				.some((field) => String(source[field] || '').trim())
		},
		buildServerWordPayload(sourceWord) {
			const word = this.stripRuntimeVideoFields(this.normalizeWord(sourceWord || this.form))
			word.id = this.normalizePublishIdentityValue(word.id || word.word)
			word.word = this.normalizePublishIdentityValue(word.word || word.id)
			const illustrationImage = this.normalizeIllustrationImage(
				(word && (word.illustrationImage || word.illustration_image)) ||
					(sourceWord && (sourceWord.illustrationImage || sourceWord.illustration_image)) ||
					{}
			)
			word.illustrationImage = this.hasIllustrationImageFields(illustrationImage)
				? illustrationImage
				: {}
			delete word.illustration_image
			return word
		},
		handleIllustrationUrlInput() {
			this.illustrationImagePreviewError = false
		},
		handleIllustrationPreviewError() {
			this.illustrationImagePreviewError = true
		},
		clearIllustrationImage() {
			this.form.illustrationImage = this.normalizeIllustrationImage({})
			this.illustrationImagePreviewError = false
			this.saveState = '示意图已清空，保存或发布后生效'
		},
		validateIllustrationImage(word) {
			const image = word && word.illustrationImage ? word.illustrationImage : {}
			const url = String(image.url || '').trim()
			if (!url) return { ok: true }
			if (!this.isProductionIllustrationImageUrl(url)) {
				return {
					ok: false,
					message: '示意图必须使用可公开访问的 HTTPS 图片地址'
				}
			}
			return { ok: true }
		},
		normalizeWord(item) {
			const next = clone(item)
			next.id = String(next.id || '').trim()
			next.word = String(next.word || next.id || '').trim()
			next.phonetic = String(next.phonetic || '').trim()
			next.meaning = String(next.meaning || '').trim()
			next.explanation = String(next.explanation || '')
			next.illustrationImage = this.normalizeIllustrationImage(
				next.illustrationImage ||
					next.illustration_image ||
					{}
			)
			next.status = normalizeAdminStatus(next.status)
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
			next.pronunciationAudio = this.normalizePronunciationAudio(
				next.pronunciationAudio ||
					next.pronunciation_audio ||
					next.audio ||
					{
						url: next.audioUrl || next.audio_url || next.pronunciationAudioUrl || next.pronunciation_audio_url || ''
					}
			)
			next.audioUrl = next.pronunciationAudio.url || ''
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
		chooseJsonFile() {
			if (typeof document === 'undefined' || typeof FileReader === 'undefined') {
				this.importResult = '当前环境不支持直接选择本地 JSON 文件，请改用复制粘贴。'
				uni.showToast({ title: '当前环境不支持选择文件', icon: 'none' })
				return
			}

			const input = document.createElement('input')
			let cleaned = false
			let focusHandler = null
			const cleanup = () => {
				if (cleaned) return
				cleaned = true
				input.removeEventListener('change', handleChange)
				if (focusHandler && typeof window !== 'undefined') {
					window.removeEventListener('focus', focusHandler)
				}
				if (input.parentNode) {
					input.parentNode.removeChild(input)
				}
			}
			const handleChange = (event) => {
				this.handleJsonFileChange(event)
				setTimeout(cleanup, 0)
			}

			input.type = 'file'
			input.accept = '.json,application/json'
			input.multiple = false
			input.style.position = 'fixed'
			input.style.left = '-9999px'
			input.style.top = '-9999px'
			input.addEventListener('change', handleChange)

			if (typeof window !== 'undefined') {
				focusHandler = () => {
					setTimeout(() => {
						if (!input.files || !input.files.length) cleanup()
					}, 800)
				}
				window.addEventListener('focus', focusHandler)
			}

			document.body.appendChild(input)
			input.click()
		},
		handleJsonFileChange(event) {
			const input = event && (event.target || event.currentTarget)
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
				this.importResult = `已读取文件：${file.name}。正在校验并准备加入未上传列表。`
				input.value = ''
				this.importWordsFromJson()
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
			const rawAudio = raw.pronunciationAudio || raw.pronunciation_audio || raw.audio || {}
			const rawIllustration = raw.illustrationImage || raw.illustration_image || {}
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
				illustrationImage: {
					url: valueOrBlank(firstNonEmpty(rawIllustration.url, raw.illustrationImageUrl, raw.illustration_image_url)),
					title: valueOrBlank(firstNonEmpty(rawIllustration.title, raw.illustrationTitle, raw.illustration_title)),
					alt: valueOrBlank(firstNonEmpty(rawIllustration.alt, rawIllustration.description, raw.illustrationAlt, raw.illustration_alt)),
					provider: valueOrBlank(firstNonEmpty(rawIllustration.provider, raw.illustrationProvider, raw.illustration_provider)),
					assetId: valueOrBlank(firstNonEmpty(rawIllustration.assetId, rawIllustration.asset_id, raw.illustrationAssetId, raw.illustration_asset_id)),
					uploadStatus: valueOrBlank(firstNonEmpty(rawIllustration.uploadStatus, rawIllustration.upload_status)),
					uploadedAt: valueOrBlank(firstNonEmpty(rawIllustration.uploadedAt, rawIllustration.uploaded_at))
				},
				status: 'draft',
				parts: this.normalizeImportedParts(raw.parts || raw.breakdown || raw.children || []),
				pronunciationAudio: {
					url: valueOrBlank(firstNonEmpty(rawAudio.url, rawAudio.audioUrl, rawAudio.audio_url, raw.audioUrl, raw.audio_url, raw.pronunciationAudioUrl, raw.pronunciation_audio_url)),
					provider: valueOrBlank(firstNonEmpty(rawAudio.provider, raw.audioProvider, raw.audio_provider)),
					assetId: valueOrBlank(firstNonEmpty(rawAudio.assetId, rawAudio.asset_id, raw.audioAssetId, raw.audio_asset_id)),
					storagePath: valueOrBlank(firstNonEmpty(rawAudio.storagePath, rawAudio.storage_path, raw.audioStoragePath, raw.audio_storage_path)),
					fileName: valueOrBlank(firstNonEmpty(rawAudio.fileName, rawAudio.file_name, raw.audioFileName, raw.audio_file_name)),
					mimeType: valueOrBlank(firstNonEmpty(rawAudio.mimeType, rawAudio.mime_type, raw.audioMimeType, raw.audio_mime_type)),
					size: valueOrBlank(firstNonEmpty(rawAudio.size, raw.audioSize, raw.audio_size)),
					durationSec: valueOrBlank(firstNonEmpty(rawAudio.durationSec, rawAudio.duration_sec, raw.audioDurationSec, raw.audio_duration_sec)),
					uploadStatus: valueOrBlank(firstNonEmpty(rawAudio.uploadStatus, rawAudio.upload_status, raw.audioUploadStatus, raw.audio_upload_status)),
					uploadedAt: valueOrBlank(firstNonEmpty(rawAudio.uploadedAt, rawAudio.uploaded_at, raw.audioUploadedAt, raw.audio_uploaded_at))
				},
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
			const audio = raw.pronunciationAudio || raw.pronunciation_audio || raw.audio || {}
			const illustration = raw.illustrationImage || raw.illustration_image || {}
			return {
				word: hasNonEmpty(raw.word),
				entryType: hasNonEmpty(raw.entryType, raw.type),
				phonetic: hasNonEmpty(raw.phonetic, raw.pronunciation),
				meaning: hasNonEmpty(raw.meaning, raw.definition, raw.translation),
				explanation: hasNonEmpty(raw.explanation, raw.analysis, raw.note),
				illustrationImage: hasNonEmpty(
					illustration.url,
					illustration.title,
					illustration.alt,
					illustration.assetId,
					illustration.asset_id,
					raw.illustrationImageUrl,
					raw.illustration_image_url
				),
				pronunciationAudio: hasNonEmpty(audio.url, audio.audioUrl, audio.audio_url, raw.audioUrl, raw.audio_url, raw.pronunciationAudioUrl, raw.pronunciation_audio_url),
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
					this.activeBucket = 'draft'
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
					this.activeBucket = 'draft'
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
			if ((!hasProvidedMeta || provided.illustrationImage) && incoming.illustrationImage) {
				next.illustrationImage = incoming.illustrationImage
			}
			const incomingAudio = incoming.pronunciationAudio || {}
			const incomingAudioUrl = incoming.audioUrl || incomingAudio.url || incomingAudio.audioUrl || ''
			const hasAudioValue = (value) => value !== undefined && value !== null && String(value).trim() !== ''
			const hasIncomingAudio = ['url', 'audioUrl', 'assetId', 'storagePath', 'fileName', 'mimeType', 'uploadStatus', 'uploadedAt', 'size', 'durationSec', 'localPreviewUrl'].some((field) => hasAudioValue(incomingAudio[field]))
			if ((!hasProvidedMeta || provided.pronunciationAudio) && (hasIncomingAudio || incomingAudioUrl)) {
				next.pronunciationAudio = incomingAudio
				next.audioUrl = incomingAudioUrl
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
		async buildRuntimeAudioAsset(sourceWord, warnings) {
			const source = sourceWord || this.form
			const audio = source && source.pronunciationAudio ? source.pronunciationAudio : {}
			const previewUrl = String(audio.localPreviewUrl || '').trim()
			if (!/^(blob:|data:)/i.test(previewUrl)) {
				const audioUrl = String(audio.url || audio.audioUrl || '').trim()
				if (audioUrl.indexOf('mock-cloud://') === 0 && Array.isArray(warnings)) {
					warnings.push(`${source.word || source.id || '词条'} 的发音音频只有 mock-cloud 占位地址；请重新选择本地音频后再同步，或上线后接入云存储 HTTPS 地址`)
				}
				return null
			}
			const audioSize = Number(audio.size || 0)
			if (audioSize > AUDIO_MAX_SIZE_BYTES) {
				if (Array.isArray(warnings)) {
					warnings.push(`${source.word || source.id || '词条'} 的发音音频超过 ${AUDIO_MAX_SIZE_MB}MB，只同步字段信息`)
				}
				return null
			}
			const dataUrl = await this.readPreviewUrlAsDataUrl(previewUrl)
			if (!dataUrl) {
				if (Array.isArray(warnings)) {
					warnings.push(`${source.word || source.id || '词条'} 的本地发音音频读取失败；请重新选择音频后再同步`)
				}
				return null
			}
			return {
				fileName: audio.fileName || `${source.id || source.word || 'word'}-pronunciation.mp3`,
				dataUrl
			}
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
				const audioText = result.audioReady ? '，发音音频已就绪' : ''

				this.bridgeSync.message = `已同步 ${result.word || word.word}，${result.clipCount || 0} 段视频${audioText}${warningText}`
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

			const sourceWords = this.words.filter((item) => item && item.id && item.word && item.status === 'published')
			if (!sourceWords.length) {
				uni.showToast({ title: '暂无可同步词条', icon: 'none' })
				return
			}

			this.bridgeSync.busy = true
			this.bridgeSync.message = `正在同步 ${sourceWords.length} 个词条到小程序预览...`
			this.saveState = '正在批量同步到小程序预览桥...'

			try {
				let clipCount = 0
				let audioReadyCount = 0
				const warnings = []
				for (let index = 0; index < sourceWords.length; index += 1) {
					const item = sourceWords[index]
					this.bridgeSync.message = `正在同步 ${index + 1}/${sourceWords.length}：${item.word}`
					const result = await this.syncWordToMiniappPreview(item, warnings)
					clipCount += Number(result.clipCount || 0)
					if (result.audioReady) audioReadyCount += 1
				}

				const warningText = warnings.length ? `；${warnings.length} 个媒体资源未写入本地桥` : ''
				this.bridgeSync.message = `已同步 ${sourceWords.length} 个词条，${clipCount} 段视频，${audioReadyCount} 条发音音频${warningText}`
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
			const runtimeAudioAsset = await this.buildRuntimeAudioAsset(sourceWord, warnings)
			// 本地 preview bridge 只给电脑端微信开发者工具调试使用；正式上线不能请求 127.0.0.1。
			const response = await fetch(`http://127.0.0.1:${this.bridgeSync.port}/sync-word`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ word, runtimeAssets, runtimeAudioAsset })
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
	display: flex;
	flex-direction: column;
}

.admin-login-shell {
	display: grid;
	grid-template-columns: minmax(0, 1.12fr) minmax(380px, 0.88fr);
	align-items: center;
	justify-content: center;
	gap: 28px;
	width: min(1120px, 100%);
	flex: 1;
	margin: 0 auto;
	padding: 44px 0;
	box-sizing: border-box;
}

.admin-review-card {
	padding: 42px;
	border: 1px solid rgba(14, 58, 92, 0.12);
	border-radius: 30px;
	background: linear-gradient(145deg, #0e3a5c, #1d6799);
	color: #ffffff;
	box-shadow: 0 24px 70px rgba(14, 58, 92, 0.2);
	box-sizing: border-box;
}

.admin-review-kicker,
.admin-review-title,
.admin-review-copy {
	display: block;
}

.admin-review-kicker {
	display: inline-flex;
	padding: 7px 13px;
	border: 1px solid rgba(255, 255, 255, 0.3);
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.12);
	font-size: 13px;
	font-weight: 800;
}

.admin-review-title {
	margin-top: 22px;
	font-size: 30px;
	font-weight: 900;
	line-height: 1.4;
}

.admin-review-copy {
	margin-top: 18px;
	color: rgba(255, 255, 255, 0.88);
	font-size: 15px;
	line-height: 1.8;
}

.admin-login-card {
	width: 100%;
	padding: 34px;
	border: 1px solid rgba(14, 58, 92, 0.12);
	border-radius: 30px;
	background: #ffffff;
	box-shadow: 0 24px 70px rgba(14, 58, 92, 0.16);
	box-sizing: border-box;
}

.admin-login-badge,
.admin-login-title,
.admin-login-desc,
.admin-login-tip,
.admin-login-error {
	display: block;
}

.admin-login-badge {
	display: inline-flex;
	padding: 6px 12px;
	border-radius: 999px;
	background: #eaf7ff;
	color: #0e3a5c;
	font-size: 12px;
	font-weight: 900;
}

.admin-login-title {
	margin-top: 18px;
	color: #0e3a5c;
	font-size: 30px;
	font-weight: 900;
}

.admin-login-desc {
	margin-top: 8px;
	color: #66869b;
	font-size: 15px;
	line-height: 1.7;
}

.admin-login-field {
	display: block;
	margin-top: 24px;
}

.admin-login-field text {
	display: block;
	margin-bottom: 8px;
	color: #466578;
	font-size: 13px;
	font-weight: 800;
}

.admin-login-input {
	height: 48px;
	padding: 0 16px;
	border: 1px solid #cfe4f0;
	border-radius: 16px;
	background: #f8fcff;
	color: #0e3a5c;
	box-sizing: border-box;
}

.admin-login-button {
	width: 100%;
	margin-top: 18px;
	border-radius: 999px;
	background: #0e3a5c;
	color: #fff;
	font-size: 16px;
	font-weight: 900;
	line-height: 48px;
}

.admin-login-button::after {
	border: 0;
}

.admin-login-button[disabled] {
	opacity: 0.64;
}

.admin-login-error {
	margin-top: 12px;
	color: #c74a36;
	font-size: 13px;
	font-weight: 800;
}

.admin-login-tip {
	margin-top: 14px;
	color: #66869b;
	font-size: 12px;
	line-height: 1.7;
}

.site-record {
	flex: none;
	padding: 18px 12px 4px;
	color: #6f8797;
	font-size: 12px;
	line-height: 1.6;
	text-align: center;
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

.admin-session-pill {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	padding: 8px 10px 8px 14px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.16);
	color: #ffeba2;
	font-size: 13px;
	font-weight: 900;
}

.lock-button {
	margin: 0;
	padding: 0 14px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.92);
	color: #0e3a5c;
	font-size: 12px;
	font-weight: 900;
	line-height: 30px;
}

.lock-button::after {
	border: 0;
}

.admin-view-nav {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 14px;
	margin: 18px 0;
}

.admin-view-tab {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	justify-content: center;
	min-height: 82px;
	padding: 16px 20px;
	border-radius: 22px;
	background: rgba(255, 255, 255, 0.86);
	box-shadow: 0 12px 30px rgba(14, 58, 92, 0.08);
	color: #315269;
	line-height: 1.4;
	text-align: left;
}

.admin-view-tab.active {
	background: #0e3a5c;
	color: #fff;
	box-shadow: 0 16px 38px rgba(14, 58, 92, 0.2);
}

.admin-view-title,
.admin-view-desc {
	display: block;
	width: 100%;
	text-align: left;
}

.admin-view-title {
	font-size: 17px;
	font-weight: 800;
}

.admin-view-desc {
	margin-top: 6px;
	color: #7793a6;
	font-size: 13px;
	line-height: 1.5;
}

.admin-view-tab.active .admin-view-desc {
	color: rgba(255, 255, 255, 0.72);
}

.admin-view {
	display: block;
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
.publish-button,
.danger-button,
.archive-button {
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

.danger-button {
	background: #fff1ec;
	color: #c64c24;
}

.archive-button {
	background: #edf0f3;
	color: #415565;
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

.dashboard-view {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.dashboard-hero {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	gap: 18px;
	border: 1px solid rgba(14, 58, 92, 0.08);
}

.dashboard-kicker {
	color: #6a8ea4;
}

.dashboard-title {
	display: block;
	font-size: 28px;
	font-weight: 900;
	color: #0e3a5c;
}

.dashboard-subtitle {
	display: block;
	max-width: 820px;
	margin-top: 8px;
	color: #66869b;
	font-size: 14px;
	line-height: 1.8;
}

.dashboard-status-pill {
	flex-shrink: 0;
	padding: 8px 14px;
	border-radius: 999px;
	background: #fff6df;
	color: #a65a00;
	font-size: 13px;
	font-weight: 800;
}

.entitlement-view {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.entitlement-hero,
.entitlement-search-row,
.entitlement-layout,
.entitlement-profile-grid,
.entitlement-summary-grid,
.operation-mode-row,
.entitlement-form-grid,
.entitlement-transaction-row {
	display: flex;
}

.entitlement-hero {
	justify-content: space-between;
	align-items: flex-start;
	gap: 18px;
	border: 1px solid rgba(14, 58, 92, 0.08);
}

.entitlement-kicker {
	color: #5c8198;
}

.entitlement-title {
	display: block;
	font-size: 28px;
	font-weight: 900;
	color: #0e3a5c;
}

.entitlement-subtitle {
	display: block;
	max-width: 820px;
	margin-top: 8px;
	color: #66869b;
	font-size: 14px;
	line-height: 1.8;
}

.entitlement-status-pill {
	flex-shrink: 0;
	padding: 8px 14px;
	border-radius: 999px;
	background: #eef8f2;
	color: #1f7a45;
	font-size: 13px;
	font-weight: 800;
}

.entitlement-search-card,
.entitlement-users-panel,
.entitlement-detail-panel,
.entitlement-transactions-panel {
	border: 1px solid rgba(14, 58, 92, 0.08);
}

.entitlement-search-row {
	align-items: center;
	gap: 12px;
}

.entitlement-search-input {
	flex: 1;
	min-width: 0;
}

.entitlement-message,
.entitlement-result {
	display: block;
	margin-top: 12px;
	color: #66869b;
	font-size: 13px;
}

.entitlement-layout {
	align-items: flex-start;
	gap: 16px;
}

.entitlement-users-panel {
	width: 320px;
	flex-shrink: 0;
}

.entitlement-detail-panel {
	flex: 1;
	min-width: 0;
}

.entitlement-user-list {
	margin-top: 16px;
}

.entitlement-user-row {
	display: flex;
	width: 100%;
	margin: 0;
	padding: 14px;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
	border: 1px solid #e0eef6;
	border-radius: 16px;
	background: #f9fcfe;
	text-align: left;
}

.entitlement-user-row + .entitlement-user-row {
	margin-top: 10px;
}

.entitlement-user-row.active {
	border-color: #fe8500;
	background: #fff8e8;
	box-shadow: 0 10px 24px rgba(254, 133, 0, 0.12);
}

.entitlement-user-main,
.entitlement-user-sub,
.entitlement-user-status,
.entitlement-field-label,
.entitlement-field-value,
.entitlement-summary-value,
.entitlement-summary-label {
	display: block;
}

.entitlement-user-main {
	color: #0e3a5c;
	font-size: 14px;
	font-weight: 900;
}

.entitlement-user-sub,
.entitlement-user-status {
	margin-top: 4px;
	color: #7892a3;
	font-size: 12px;
}

.entitlement-user-status {
	margin-top: 0;
	flex-shrink: 0;
}

.entitlement-empty {
	padding: 18px;
	border: 1px dashed #cfe3ef;
	border-radius: 16px;
	background: #f9fcfe;
	color: #7892a3;
	font-size: 13px;
	line-height: 1.6;
}

.detail-empty {
	margin-top: 16px;
}

.entitlement-user-profile {
	margin-top: 16px;
	padding: 16px;
	border: 1px solid #e0eef6;
	border-radius: 18px;
	background: #f9fcfe;
}

.entitlement-profile-grid,
.entitlement-summary-grid {
	display: grid;
	gap: 12px;
}

.entitlement-profile-grid {
	grid-template-columns: repeat(4, minmax(0, 1fr));
}

.entitlement-field-label {
	color: #7892a3;
	font-size: 12px;
}

.entitlement-field-value {
	margin-top: 6px;
	color: #12344d;
	font-size: 14px;
	font-weight: 800;
	word-break: break-all;
}

.entitlement-summary-grid {
	margin-top: 16px;
	grid-template-columns: repeat(4, minmax(0, 1fr));
}

.entitlement-summary-card {
	padding: 18px;
	border: 1px solid #e0eef6;
	border-radius: 18px;
	background: #fff;
}

.entitlement-summary-card.accent {
	border-color: rgba(254, 133, 0, 0.26);
	background: #fff8e8;
}

.entitlement-summary-value {
	color: #0e3a5c;
	font-size: 26px;
	font-weight: 900;
}

.entitlement-summary-label {
	margin-top: 6px;
	color: #7892a3;
	font-size: 12px;
}

.entitlement-operation-card {
	margin-top: 16px;
	padding: 16px;
	border: 1px solid #e0eef6;
	border-radius: 18px;
	background: #f9fcfe;
}

.operation-mode-row {
	gap: 10px;
}

.operation-mode-button {
	margin: 0;
	padding: 0 18px;
	border: 1px solid #cfe7f4;
	border-radius: 999px;
	background: #fff;
	color: #315c82;
	font-size: 14px;
	line-height: 38px;
}

.operation-mode-button.active {
	border-color: #2f9f62;
	background: #eef8f2;
	color: #1f7a45;
	font-weight: 800;
}

.operation-mode-button.danger.active {
	border-color: #d8504a;
	background: #fff0ef;
	color: #b03934;
}

.entitlement-form-grid {
	margin-top: 14px;
	gap: 12px;
}

.entitlement-form-field {
	flex: 1;
	min-width: 0;
	color: #315c82;
	font-size: 13px;
	font-weight: 800;
}

.reason-field {
	flex: 2;
}

.entitlement-form-input,
.entitlement-reason-input {
	box-sizing: border-box;
	width: 100%;
	margin-top: 8px;
	border: 1px solid #cfe3ef;
	border-radius: 14px;
	background: #fff;
	color: #12344d;
	font-size: 14px;
}

.entitlement-form-input {
	height: 42px;
	padding: 0 14px;
}

.entitlement-reason-input {
	min-height: 74px;
	padding: 12px 14px;
	line-height: 1.6;
}

.entitlement-submit-button {
	margin-top: 14px;
}

.entitlement-transaction-table {
	margin-top: 16px;
	overflow-x: auto;
}

.entitlement-transaction-row {
	display: grid;
	grid-template-columns: 1.2fr 1.2fr 0.7fr 0.7fr 1.5fr 1fr;
	gap: 12px;
	align-items: center;
	min-width: 920px;
	padding: 12px 14px;
	border-bottom: 1px solid #e6f0f6;
	color: #315c82;
	font-size: 13px;
}

.entitlement-transaction-row.header {
	border-radius: 14px;
	background: #f4f9fc;
	color: #7892a3;
	font-size: 12px;
	font-weight: 900;
}

.transaction-amount {
	font-weight: 900;
}

.transaction-amount.positive {
	color: #1f7a45;
}

.transaction-amount.negative {
	color: #b03934;
}

.transaction-amount.neutral {
	color: #7892a3;
}

.dashboard-notice {
	padding: 16px 20px;
	border: 1px solid rgba(254, 133, 0, 0.22);
	border-radius: 20px;
	background: #fff8e8;
	color: #8a5a11;
	font-size: 14px;
	line-height: 1.8;
	box-shadow: 0 10px 26px rgba(254, 133, 0, 0.08);
}

.homepage-featured-manager {
	border: 1px solid rgba(14, 58, 92, 0.08);
}

.featured-manager-head,
.featured-manager-actions,
.featured-mode-row,
.featured-candidate-row,
.featured-pool-row,
.featured-row-actions {
	display: flex;
	align-items: center;
}

.featured-manager-head {
	justify-content: space-between;
	gap: 18px;
}

.featured-manager-actions,
.featured-mode-row,
.featured-row-actions {
	gap: 10px;
}

.featured-status-message {
	display: block;
	margin-top: 14px;
	color: #66869b;
	font-size: 13px;
}

.featured-mode-row {
	margin-top: 18px;
}

.featured-mode-button {
	margin: 0;
	padding: 0 18px;
	border: 1px solid #cfe7f4;
	border-radius: 999px;
	background: #f5fbff;
	color: #315c82;
	font-size: 14px;
	line-height: 38px;
}

.featured-mode-button.active {
	border-color: #fe8500;
	background: #fff6df;
	color: #a65300;
	font-weight: 800;
}

.featured-manager-grid {
	display: grid;
	grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.2fr) minmax(260px, 0.8fr);
	gap: 16px;
	margin-top: 18px;
}

.featured-column {
	min-width: 0;
	padding: 18px;
	border: 1px solid #e0eef6;
	border-radius: 20px;
	background: #f9fcfe;
}

.featured-column-title,
.featured-field-label,
.featured-word-title,
.featured-word-meta,
.featured-current-source,
.featured-current-word,
.featured-current-id,
.featured-current-meaning,
.featured-empty {
	display: block;
}

.featured-column-title {
	color: #12344d;
	font-size: 15px;
	font-weight: 900;
}

.featured-search-input {
	height: 40px;
	margin-top: 12px;
	padding: 0 14px;
	border: 1px solid #cfe3ef;
	border-radius: 14px;
	background: #fff;
	color: #12344d;
}

.featured-candidate-list,
.featured-pool-list {
	max-height: 330px;
	margin-top: 12px;
	overflow-y: auto;
}

.featured-candidate-row,
.featured-pool-row {
	gap: 12px;
	padding: 12px;
	border-radius: 14px;
	background: #fff;
}

.featured-candidate-row + .featured-candidate-row,
.featured-pool-row + .featured-pool-row {
	margin-top: 8px;
}

.featured-word-copy {
	flex: 1;
	min-width: 0;
}

.featured-word-title {
	color: #0e3a5c;
	font-weight: 900;
}

.featured-word-meta {
	margin-top: 4px;
	overflow: hidden;
	color: #7892a3;
	font-size: 12px;
	line-height: 1.5;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.featured-mini-button,
.featured-icon-button {
	flex-shrink: 0;
	margin: 0;
	padding: 0 10px;
	border-radius: 10px;
	background: #e9f7ff;
	color: #0e3a5c;
	font-size: 12px;
	line-height: 30px;
}

.featured-icon-button.danger {
	background: #fff1ec;
	color: #c64c24;
}

.featured-order {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	width: 28px;
	height: 28px;
	border-radius: 999px;
	background: #0e3a5c;
	color: #fff;
	font-size: 12px;
	font-weight: 900;
}

.featured-preview-column {
	background: linear-gradient(160deg, #eef9ff, #fff8e8);
}

.featured-manual-picker {
	margin-top: 14px;
}

.featured-field-label {
	margin-bottom: 8px;
	color: #66869b;
	font-size: 13px;
}

.featured-current-card,
.featured-current-empty {
	margin-top: 16px;
	padding: 20px;
	border-radius: 20px;
}

.featured-current-card {
	background: linear-gradient(145deg, #0e3a5c, #1a5a8a);
	color: #fff;
}

.featured-current-source {
	color: #ffeba2;
	font-size: 12px;
	font-weight: 800;
}

.featured-current-word {
	margin-top: 12px;
	font-size: 34px;
	font-weight: 900;
}

.featured-current-id,
.featured-current-meaning {
	margin-top: 6px;
	color: rgba(255, 255, 255, 0.72);
	font-size: 13px;
	line-height: 1.6;
}

.featured-current-empty,
.featured-empty {
	color: #7892a3;
	font-size: 13px;
	line-height: 1.7;
}

.featured-current-empty {
	background: rgba(255, 255, 255, 0.72);
}

.dashboard-summary-grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 16px;
}

.dashboard-summary-card {
	padding: 20px;
	border-radius: 22px;
	background: #fff;
	box-shadow: 0 12px 30px rgba(14, 58, 92, 0.08);
}

.dashboard-summary-value {
	display: block;
	font-size: 24px;
	font-weight: 900;
	color: #0e3a5c;
}

.dashboard-summary-label {
	display: block;
	margin-top: 8px;
	color: #12344d;
	font-weight: 800;
}

.dashboard-summary-note {
	display: block;
	margin-top: 6px;
	color: #7793a6;
	font-size: 12px;
	line-height: 1.6;
}

.dashboard-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16px;
}

.dashboard-panel {
	overflow: hidden;
}

.dashboard-table,
.dashboard-event-table {
	display: flex;
	flex-direction: column;
	gap: 8px;
	height: 300px;
	overflow-y: auto;
	padding-right: 6px;
	scrollbar-color: #8cc7e8 #eaf7ff;
	scrollbar-width: thin;
}

.dashboard-table::-webkit-scrollbar,
.dashboard-event-table::-webkit-scrollbar {
	width: 8px;
}

.dashboard-table::-webkit-scrollbar-track,
.dashboard-event-table::-webkit-scrollbar-track {
	border-radius: 999px;
	background: #eaf7ff;
}

.dashboard-table::-webkit-scrollbar-thumb,
.dashboard-event-table::-webkit-scrollbar-thumb {
	border-radius: 999px;
	background: linear-gradient(180deg, #8cc7e8, #0e3a5c);
}

.dashboard-table-row,
.dashboard-event-row {
	display: grid;
	align-items: center;
	gap: 12px;
	padding: 12px 14px;
	border-radius: 14px;
	background: #f5fbff;
	color: #315269;
	font-size: 13px;
	line-height: 1.5;
}

.dashboard-table-row {
	grid-template-columns: 64px minmax(120px, 1fr) 96px 150px;
}

.dashboard-event-row {
	grid-template-columns: 150px 150px 110px 120px minmax(0, 1fr);
}

.dashboard-table-row.head,
.dashboard-event-row.head {
	position: sticky;
	top: 0;
	z-index: 2;
	background: #eaf7ff;
	color: #0e3a5c;
	font-weight: 800;
}

.table-word {
	color: #0e3a5c;
	font-family: Georgia, 'Times New Roman', serif;
	font-size: 16px;
	font-weight: 800;
}

.dashboard-empty {
	padding: 22px;
	border-radius: 16px;
	background: #f5fbff;
	color: #7793a6;
	text-align: center;
}

.dashboard-api-card {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.api-list {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
}

.api-list text {
	display: block;
	padding: 12px 14px;
	border-radius: 14px;
	background: #f5fbff;
	color: #0e3a5c;
	font-family: Consolas, 'Courier New', monospace;
	font-size: 13px;
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

.list-search-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 78px;
	gap: 10px;
	align-items: center;
	margin-bottom: 10px;
}

.list-search-input {
	min-width: 0;
}

.search-button {
	height: 42px;
	line-height: 42px;
	border-radius: 14px;
	background: #0e3a5c;
	color: #fff;
	font-size: 14px;
	font-weight: 800;
}

.search-active-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	margin: -2px 0 12px;
	color: #6c8799;
	font-size: 12px;
}

.clear-search-button {
	height: 28px;
	line-height: 28px;
	padding: 0 12px;
	border-radius: 999px;
	background: #edf7fc;
	color: #0e3a5c;
	font-size: 12px;
	font-weight: 700;
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
	grid-template-columns: repeat(4, 1fr);
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

.batch-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	margin-top: 10px;
	padding: 10px 12px;
	border-radius: 16px;
	border: 1px solid #d8e9f2;
	background: #f8fcff;
}

.select-all-control,
.batch-action-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	min-height: 34px;
	padding: 0 12px;
	border-radius: 999px;
	font-size: 12px;
	font-weight: 800;
}

.select-all-control {
	background: #fff;
	color: #0e3a5c;
	border: 1px solid #d8e9f2;
}

.select-all-control.checked {
	border-color: #15a27e;
	background: #edf9f5;
	color: #13795b;
}

.select-box,
.entry-checkbox {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	box-sizing: border-box;
	border: 2px solid #b9c9d4;
	background: #fff;
	color: #fff;
	font-weight: 900;
}

.select-box {
	width: 18px;
	height: 18px;
	border-radius: 5px;
	font-size: 12px;
}

.select-all-control.checked .select-box,
.entry-checkbox.checked {
	border-color: #15a27e;
	background: #15a27e;
}

.batch-action-button {
	background: #0e3a5c;
	color: #fff;
}

.batch-action-button[disabled],
.select-all-control[disabled] {
	opacity: 0.45;
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

.accordion-word-row.selectable {
	grid-template-columns: 24px 34px minmax(0, 1fr) auto 14px;
}

.entry-checkbox {
	width: 22px;
	height: 22px;
	margin-top: 4px;
	border-radius: 6px;
	font-size: 13px;
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

.status-pill.unpublished {
	background: #e9f3fb;
	color: #2e6f96;
}

.status-pill.archived {
	background: #edf0f3;
	color: #64717d;
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

.video-upload-card,
.audio-upload-card {
	margin-bottom: 16px;
	padding: 16px;
	border: 1px solid #d8e9f2;
	border-radius: 20px;
	background: #f8fcff;
}

.audio-section-head {
	margin-top: 10px;
}

.illustration-section-head {
	margin-top: 20px;
}

.illustration-editor-card {
	margin-bottom: 18px;
	padding: 16px;
	border: 1px solid #d8e9f2;
	border-radius: 20px;
	background: #f8fcff;
}

.illustration-meta-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 14px;
}

.illustration-url-tip,
.illustration-preview-error,
.preview-illustration-title,
.preview-illustration-alt {
	display: block;
}

.illustration-url-tip {
	margin-top: -4px;
	font-size: 12px;
	line-height: 1.7;
}

.illustration-url-tip.valid {
	color: #28855b;
}

.illustration-url-tip.warning {
	color: #bd5a22;
}

.illustration-admin-preview {
	margin-top: 14px;
	padding: 12px;
	border-radius: 16px;
	background: #fff;
}

.illustration-admin-image,
.preview-illustration-image {
	display: block;
	width: 100%;
	border-radius: 14px;
}

.illustration-admin-image {
	max-height: 420px;
	object-fit: contain;
}

.illustration-preview-error {
	margin-top: 10px;
	color: #c64c24;
	font-size: 12px;
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

.upload-progress-bar.audio {
	background: #6baed6;
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

.admin-audio-preview {
	width: 100%;
	margin-top: 14px;
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

.admin-token-card {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
	gap: 14px;
	align-items: center;
	margin-bottom: 18px;
	padding: 16px;
	border: 1px solid #d8e9f2;
	border-radius: 20px;
	background: #f8fcff;
}

.admin-token-title,
.admin-token-note,
.admin-token-status {
	display: block;
}

.admin-token-title {
	color: #0e3a5c;
	font-size: 15px;
	font-weight: 900;
}

.admin-token-note,
.admin-token-status {
	margin-top: 4px;
	color: #66869b;
	font-size: 12px;
	line-height: 1.5;
}

.admin-token-row {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	align-items: center;
	justify-content: flex-end;
}

.admin-token-input {
	flex: 1 1 180px;
	min-width: 0;
	height: 42px;
	padding: 0 14px;
	border: 1px solid #d8e9f2;
	border-radius: 14px;
	background: #ffffff;
	color: #0e3a5c;
}

.admin-token-status {
	grid-column: 1 / -1;
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

.readonly-status.unpublished {
	background: #e9f3fb;
	border-color: #c8dfef;
	color: #2e6f96;
}

.readonly-status.archived {
	background: #edf0f3;
	border-color: #d4dbe1;
	color: #64717d;
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

.preview-audio-pill {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 5px 10px;
	border-radius: 999px;
	background: #ffeba2;
	color: #0e3a5c;
	font-size: 12px;
	font-weight: 800;
}

.preview-speaker-dot {
	width: 8px;
	height: 8px;
	border-radius: 999px;
	background: #fe8500;
	box-shadow: 0 0 0 4px rgba(254, 133, 0, 0.2);
}

.preview-meaning,
.preview-explain {
	display: block;
	margin-top: 12px;
	color: rgba(255, 255, 255, 0.78);
	line-height: 1.8;
}

.preview-illustration {
	margin-top: 16px;
	padding: 12px;
	border-radius: 16px;
	background: rgba(255, 255, 255, 0.1);
}

.preview-illustration-title {
	margin-bottom: 10px;
	color: #ffeba2;
	font-weight: 800;
}

.preview-illustration-alt {
	margin-top: 8px;
	color: rgba(255, 255, 255, 0.66);
	font-size: 12px;
	line-height: 1.6;
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

	.dashboard-grid,
	.dashboard-summary-grid,
	.featured-manager-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.dashboard-event-row {
		grid-template-columns: 140px 140px 100px 110px minmax(0, 1fr);
	}
}

@media screen and (max-width: 720px) {
	.admin-page {
		padding: 16px;
	}

	.admin-login-shell {
		grid-template-columns: 1fr;
		gap: 18px;
		padding: 20px 0;
	}

	.admin-review-card,
	.admin-login-card {
		padding: 26px 22px;
		border-radius: 24px;
	}

	.admin-review-title {
		font-size: 24px;
	}

	.site-record {
		padding-top: 14px;
	}

	.hero,
	.panel-head,
	.section-head,
	.clip-draft-actions,
	.clip-list-head,
	.viewer-preview-head,
	.dashboard-hero,
	.featured-manager-head {
		flex-direction: column;
		align-items: flex-start;
	}

	.hero-actions,
	.editor-actions,
	.form-grid,
	.illustration-meta-grid,
	.part-row,
	.status-grid,
	.admin-view-nav,
	.dashboard-grid,
	.dashboard-summary-grid,
	.featured-manager-grid,
	.api-list {
		grid-template-columns: 1fr;
		width: 100%;
	}

	.featured-manager-actions,
	.featured-mode-row,
	.featured-row-actions {
		flex-wrap: wrap;
	}

	.dashboard-table-row,
	.dashboard-event-row {
		grid-template-columns: 1fr;
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
