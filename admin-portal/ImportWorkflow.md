# 象形英语批量导入工作流

这份文档用于把书本、Word、Markdown 或 Excel 内容，批量转成后台可导入的词条 JSON。

## 推荐流程

1. 先把书本内容整理成 Markdown 或 Excel。
2. 每次只让 AI 处理一小批，比如 20-50 个词。
3. AI 输出纯 JSON，不要输出解释文字。
4. 在后台“批量导入”区域选择 JSON 文件，或粘贴 JSON 文本。
5. 点击“校验并加入未上传”，通过校验的词条先进入左侧“未上传”待检查队列。
6. 在“未上传”列表中逐条点开检查和修改，确认无误后点击“批量加入草稿”。
7. 新增或更新的词条进入“已上传”草稿库。
8. 最后点击顶部“发布全部草稿”，才算进入最终发布状态。

## 为什么不建议直接上传 Word 一键入库

- Word 排版很自由，标题、表格、图片、脚注混在一起时，AI 容易误判字段。
- 一次处理几百个词，AI 更容易漏词、重复 ID 或把拆解层级弄乱。
- MVP 阶段先用 Markdown / Excel / JSON 这种稳定结构，更容易校验和回滚。

## 最推荐的源格式

### Markdown 表格

适合从书稿整理内容，复制给 AI 最稳定。

```md
| id | word | type | phonetic | meaning | explanation | parts | videoTitle | videoUrl | startSec | endSec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| study | study | word | /ˈstʌdi/ | 学习；研究 | 用力敲击 tud 知识，向外出发。 | s:外出:s;tud:敲击+钻研:tud;y:后缀:y | study 的象形讲解 |  | 0 | 120 |
```

### Excel / CSV

适合一次整理几百个词。字段越固定，AI 和后台越不容易出错。

建议列名：
- `id`
- `word`
- `entryType`
- `phonetic`
- `meaning`
- `explanation`
- `parts`
- `videoUrl`
- `videoTitle`
- `startSec`
- `endSec`

## 后台导入 JSON 格式

后台接受两种格式：

```json
{
  "words": [
    {
      "id": "study",
      "word": "study",
      "entryType": "word",
      "phonetic": "/ˈstʌdi/",
      "meaning": "学习；研究",
      "explanation": "用力敲击 tud 知识，向外出发，这就是学习。",
      "parts": [
        { "label": "s", "title": "外出", "targetId": "s" },
        { "label": "tud", "title": "敲击 + 钻研", "targetId": "tud" },
        { "label": "y", "title": "后缀", "targetId": "y" }
      ],
      "video": {
        "url": "https://example.com/videos/study.mp4",
        "title": "study 的象形讲解",
        "startSec": 0,
        "endSec": 120
      }
    }
  ]
}
```

也可以直接粘贴数组：

```json
[
  {
    "id": "tud",
    "word": "tud",
    "entryType": "root",
    "meaning": "敲击、钻研的象形节点",
    "parts": [
      { "label": "t", "title": "手", "targetId": "t" },
      { "label": "u", "title": "包含", "targetId": "u" },
      { "label": "d", "title": "得", "targetId": "d" }
    ]
  }
]
```

## entryType 规则

- `word`：完整单词，比如 `study`、`transport`。
- `root`：词根、词块、象形节点，比如 `tud`、`trans`、`port`。
- `letter`：单个字母，比如 `a`、`s`、`t`。

## 视频处理建议

- 后台词条里不要直接存视频文件，只存视频地址和时间点。
- 视频文件后续放在云存储或对象存储里，比如 uniCloud 云存储、腾讯云 COS、阿里云 OSS。
- 一个长视频可以服务多个词条，每个词条只记录 `startSec` 和 `endSec`。
- MVP 阶段先录入视频元数据，不急着做上传器。

## 后台操作链路

- `未上传`：批量导入后的待检查队列，适合放 AI 生成、还没有人工确认的词条。
- `批量加入草稿`：把未上传队列里已检查的词条合并到后台草稿库；已有 ID 会更新，新 ID 会新增。
- `已上传`：当前后台本地草稿库，包含草稿、已发布、待复核词条。
- `发布全部草稿`：最终发布动作，只处理已上传草稿库里的草稿词条；不会直接发布未上传队列。
- `一键清除`：只清空批量导入输入框，不影响已上传草稿库和未上传队列。

## 给 AI 的转换提示词模板

```text
你是象形英语内容整理助手。
请把我提供的书稿内容转换为后台可导入 JSON。

要求：
1. 只输出纯 JSON，不要解释。
2. 顶层格式必须是 { "words": [...] }。
3. 每个词条字段包含：
   id, word, entryType, phonetic, meaning, explanation, parts, video。
4. entryType 只能是 word、root、letter。
5. parts 每一项必须包含 label、title、targetId。
6. id 和 word 必须以英文字母开头。
7. 不确定的视频字段留空：
   video: { "url": "", "title": "", "startSec": "", "endSec": "" }
8. 不要编造书里没有的信息；不确定的内容用空字符串。

下面是书稿内容：
```

## 验收标准

- 后台能通过“选择 JSON 文件”或粘贴 JSON 导入未上传队列。
- 导入后左侧“未上传”字母目录能看到新增词条。
- 检查后点击“批量加入草稿”，词条会移动到“已上传”列表。
- 已有 ID 会更新，新 ID 会新增；更新已有词条时，空字段不会清空旧内容。
- 导入内容不会直接发布，必须先加入草稿，再执行发布。
- 视频时间点必须是非负数字，且结束秒不能小于开始秒。
- 抽查 5-10 个词条，拆解卡片和视频时间点无明显错误。
