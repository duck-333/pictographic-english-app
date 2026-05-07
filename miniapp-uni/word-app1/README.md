# 象形英语小程序运行说明

这个目录才是当前要在 HBuilderX 里运行的 uni-app 小程序项目：

`F:\Word Learning App(Clone)\pictographic-english-app\miniapp-uni\word-app1`

## 三个软件各自负责什么

- HBuilderX：写代码、编译 uni-app 项目。
- 微信开发者工具：预览 HBuilderX 编译出来的小程序。
- GitHub Desktop：保存版本，不负责运行项目。

## 正确运行方式

1. 在 HBuilderX 里打开 `word-app1` 这个文件夹。
2. 确认 `manifest.json` 里的 `mp-weixin.appid` 是自己的微信小程序 AppID。
3. 在微信开发者工具里登录账号，并开启服务端口。
4. 回到 HBuilderX，点击 `运行 -> 运行到小程序模拟器 -> 微信开发者工具`。

## 不要直接这样做

不要在微信开发者工具里直接打开：

`F:\Word Learning App(Clone)\pictographic-english-app\miniapp-uni`

也不要直接打开：

`F:\Word Learning App(Clone)\pictographic-english-app\miniapp-uni\word-app1`

微信开发者工具需要的是 HBuilderX 编译后的目录。

如果 HBuilderX 没有自动拉起微信开发者工具，可以先在 HBuilderX 运行一次，生成这个目录后再手动导入：

`F:\Word Learning App(Clone)\pictographic-english-app\miniapp-uni\word-app1\unpackage\dist\dev\mp-weixin`

