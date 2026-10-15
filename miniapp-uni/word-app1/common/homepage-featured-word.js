import { toPublicWord } from './public-word.js'

// Kept only in the current homepage response, never in shared word caches.
export function toHomepageFeaturedWord(source = {}) {
  return {
    ...toPublicWord(source),
    parts: Array.isArray(source.parts) ? source.parts
      .filter(part => part && typeof part === 'object' && !Array.isArray(part))
      .map(part => {
        return {
          text: typeof part.text === 'string' && part.text ? part.text : typeof part.label === 'string' ? part.label : '',
          meaning: typeof part.meaning === 'string' && part.meaning ? part.meaning : typeof part.title === 'string' ? part.title : ''
        }
      }) : [],
    explanation: typeof source.explanation === 'string' ? source.explanation : ''
  }
}
