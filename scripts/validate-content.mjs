import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateWordRecord } from '../miniapp-uni/word-app1/common/content-schema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const defaultFile = path.join(repoRoot, 'content-seed', 'words.example.json')
const inputFile = path.resolve(repoRoot, process.argv[2] || defaultFile)

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read JSON file: ${filePath}\n${error.message}`)
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function collectRecords(content) {
  if (content.id || content.word) {
    return [content]
  }
  const words = asArray(content.words)
  const wordNodes = asArray(content.word_nodes || content.wordNodes)
  return [...words, ...wordNodes]
}

function addError(errors, message) {
  errors.push(message)
}

function validateRecordShape(records, errors) {
  records.forEach((record, index) => {
    const result = validateWordRecord(record)
    if (!result.ok) {
      result.errors.forEach((message) => {
        addError(errors, `records[${index}] ${record.id || record.word || '<unknown>'}: ${message}`)
      })
    }
  })
}

function validateUniqueIds(records, errors) {
  const seen = new Map()
  records.forEach((record) => {
    if (!record.id) return
    if (seen.has(record.id)) {
      addError(errors, `duplicate id: ${record.id}`)
      return
    }
    seen.set(record.id, record)
  })
  return seen
}

function validateReferences(records, recordById, errors) {
  records.forEach((record) => {
    asArray(record.parts).forEach((part, index) => {
      if (part.targetId && !recordById.has(part.targetId)) {
        addError(errors, `${record.id}.parts[${index}].targetId not found: ${part.targetId}`)
      }
    })
    asArray(record.siblingIds).forEach((id, index) => {
      if (id && !recordById.has(id)) {
        addError(errors, `${record.id}.siblingIds[${index}] not found: ${id}`)
      }
    })
  })
}

function validateVideoSegments(content, recordById, errors) {
  asArray(content.video_segments || content.videoSegments).forEach((segment, index) => {
    if (!segment.wordId) {
      addError(errors, `video_segments[${index}].wordId is required`)
    } else if (!recordById.has(segment.wordId)) {
      addError(errors, `video_segments[${index}].wordId not found: ${segment.wordId}`)
    }

    const startSec = Number(segment.startSec ?? segment.start_sec ?? 0)
    const endSec = Number(segment.endSec ?? segment.end_sec ?? 0)
    if (Number.isNaN(startSec) || startSec < 0) {
      addError(errors, `video_segments[${index}].startSec must be a non-negative number`)
    }
    if (Number.isNaN(endSec) || endSec < 0) {
      addError(errors, `video_segments[${index}].endSec must be a non-negative number`)
    }
    if (endSec > 0 && startSec >= endSec) {
      addError(errors, `video_segments[${index}] endSec must be greater than startSec`)
    }
  })
}

function main() {
  const content = readJson(inputFile)
  const records = collectRecords(content)
  const errors = []

  if (records.length === 0) {
    addError(errors, 'No records found. Expected a single word record or words/word_nodes arrays.')
  }

  validateRecordShape(records, errors)
  const recordById = validateUniqueIds(records, errors)
  validateReferences(records, recordById, errors)
  validateVideoSegments(content, recordById, errors)

  if (errors.length > 0) {
    console.error('Content validation failed')
    errors.forEach((message) => console.error(`- ${message}`))
    process.exitCode = 1
    return
  }

  console.log('Content validation passed')
  console.log(`- file: ${path.relative(repoRoot, inputFile)}`)
  console.log(`- records: ${records.length}`)
  console.log(`- words: ${content.id || content.word ? records.length : asArray(content.words).length}`)
  console.log(`- word_nodes: ${content.id || content.word ? 0 : asArray(content.word_nodes || content.wordNodes).length}`)
  console.log(`- video_segments: ${asArray(content.video_segments || content.videoSegments).length}`)
}

main()
