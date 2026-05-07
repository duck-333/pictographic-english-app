# miniapp-uni

这是一个给 HBuilderX 用的最小 `uni-app` 微信小程序骨架。

当前目标只有一个：

`先在本地假数据上跑通 查词首页 -> 单词详情页`

## 目录说明

- `App.vue`：小程序全局样式
- `main.js`：uni-app 入口
- `manifest.json`：小程序 AppID 和平台配置
- `pages.json`：页面路由配置
- `common/mock-data.js`：本地假数据
- `pages/index/index.vue`：查词首页
- `pages/word-detail/index.vue`：单词详情页

## 你要做的 4 步

1. 用 HBuilderX 打开这个 `miniapp-uni` 文件夹
2. 在 `manifest.json` 里把微信小程序 `appid` 换成你自己的
3. 在 HBuilderX 里配置微信开发者工具路径
4. 运行到微信开发者工具

## HBuilderX 配置提示

### 1. 配置微信开发者工具路径

在 HBuilderX 里打开：

`工具 -> 设置 -> 运行配置 -> 微信开发者工具路径`

把路径选到你的微信开发者工具安装目录。

如果自动拉起失败，先确认两件事：

1. 微信开发者工具已经手动登录
2. 微信开发者工具已经开启服务端口

### 2. 填写 AppID

打开 `manifest.json`：

- 找到 `mp-weixin.appid`
- 替换成你的小程序 `AppID`

保存后再运行。

### 3. 运行

在 HBuilderX 顶部菜单里选择：

`运行 -> 运行到小程序模拟器 -> 微信开发者工具`

如果第一次没有自动带起项目，也可以手动导入 HBuilderX 编译输出目录。

## 现在这个骨架已经能做什么

1. 首页显示本地假数据
2. 搜索单词
3. 点击结果进入详情页
4. 详情页展示释义、拆解、讲解说明和视频占位按钮

## 现在还没做什么

1. 服务空间
2. 云数据库
3. 用户登录
4. 真实视频播放
5. 管理后台
