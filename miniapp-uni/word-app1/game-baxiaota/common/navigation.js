const HOME_URL = '/pages/index/index'

export function returnToSearchHome() {
  return new Promise((resolve, reject) => {
    const pages = getCurrentPages()
    const homeIndex = pages.map(page => page.route).lastIndexOf(HOME_URL.slice(1))
    if (homeIndex === pages.length - 1 && homeIndex >= 0) { resolve(); return }
    const callbacks = { success: resolve, fail: reject }
    if (homeIndex >= 0) {
      uni.navigateBack({ delta: pages.length - 1 - homeIndex, ...callbacks })
    } else {
      uni.reLaunch({ url: HOME_URL, ...callbacks })
    }
  })
}
