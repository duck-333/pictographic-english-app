const root = '/game-baxiaota/static/'
export const assets = {
  gate: root + 'gate.jpg', wave: root + 'wave.png', compass: root + 'compass.png',
  celebrate: root + 'celebrate.png', reading: root + 'reading.png'
}
export const guides = ['search', 'results', 'detail', 'video'].map(name => root + 'guide-' + name + '.png')

// Generation invalidates all image completions after retry/replay/unload.
export function createAssetLoader() {
  let sequence = 0
  return {
    invalidate() { sequence++ },
    async load(canvas) {
      const ticket = ++sequence
      const pairs = await Promise.all(Object.entries(assets).map(([key, src]) => new Promise((resolve, reject) => {
        const image = canvas.createImage()
        image.onload = () => resolve([key, image])
        image.onerror = () => reject(new Error('图片加载失败，请重试'))
        image.src = src
      })))
      return ticket === sequence ? Object.fromEntries(pairs) : null
    }
  }
}
