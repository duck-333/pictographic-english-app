import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const activeProjects = [
  {
    name: 'miniapp',
    root: 'miniapp-uni/word-app1',
    requiredFiles: ['App.vue', 'main.js', 'manifest.json', 'pages.json']
  },
  {
    name: 'admin',
    root: 'admin-portal/pictographic-admin',
    requiredFiles: ['App.vue', 'main.js', 'manifest.json', 'pages.json']
  }
]

const ignoredDirectories = new Set(['.git', '.hbuilderx', 'node_modules', 'unpackage'])
const sourceExtensions = new Set(['.vue', '.js', '.scss', '.css'])
const importExtensions = ['', '.js', '.vue', '.json', '.scss', '.css']
const errors = []
const warnings = []

function addError(message) {
  errors.push(message)
}

function addWarning(message) {
  warnings.push(message)
}

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/')
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    addError(`Cannot parse JSON: ${toRepoPath(filePath)} (${error.message})`)
    return null
  }
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return []

  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue

    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...walkFiles(fullPath))
    } else {
      result.push(fullPath)
    }
  }
  return result
}

function existsWithExtension(targetPath) {
  return importExtensions.some((extension) => fs.existsSync(targetPath + extension))
}

function resolveProjectPath(projectRoot, specifier, currentFile) {
  if (specifier.startsWith('@/')) {
    return path.join(projectRoot, specifier.slice(2))
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return path.resolve(path.dirname(currentFile), specifier)
  }

  return null
}

function checkRequiredFiles(project) {
  const projectRoot = path.join(repoRoot, project.root)

  if (!fs.existsSync(projectRoot)) {
    addError(`${project.name}: project root is missing: ${project.root}`)
    return
  }

  project.requiredFiles.forEach((fileName) => {
    const filePath = path.join(projectRoot, fileName)
    if (!fs.existsSync(filePath)) {
      addError(`${project.name}: missing required file: ${project.root}/${fileName}`)
    }
  })
}

function checkPages(project) {
  const projectRoot = path.join(repoRoot, project.root)
  const pagesJsonPath = path.join(projectRoot, 'pages.json')
  const pagesJson = readJson(pagesJsonPath)
  if (!pagesJson) return

  const pages = Array.isArray(pagesJson.pages) ? pagesJson.pages : []
  if (pages.length === 0) {
    addError(`${project.name}: pages.json has no pages`)
    return
  }

  pages.forEach((page, index) => {
    if (!page.path) {
      addError(`${project.name}: pages[${index}].path is required`)
      return
    }

    const pageFile = path.join(projectRoot, `${page.path}.vue`)
    if (!fs.existsSync(pageFile)) {
      addError(`${project.name}: page file is missing: ${project.root}/${page.path}.vue`)
    }
  })
}

function checkImports(project) {
  const projectRoot = path.join(repoRoot, project.root)
  const files = walkFiles(projectRoot).filter((filePath) => sourceExtensions.has(path.extname(filePath)))
  const importPattern = /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]|@import\s+['"]([^'"]+)['"]/g
  const assetPattern = /url\(['"]?(?:~@\/|@\/)([^)'"]+)['"]?\)/g

  files.forEach((filePath) => {
    const text = fs.readFileSync(filePath, 'utf8')
    let match

    while ((match = importPattern.exec(text))) {
      const specifier = match[1] || match[2]
      if (!specifier || specifier === 'vue') continue

      const targetPath = resolveProjectPath(projectRoot, specifier, filePath)
      if (targetPath && !existsWithExtension(targetPath)) {
        addError(`${project.name}: missing import in ${toRepoPath(filePath)} -> ${specifier}`)
      }
    }

    while ((match = assetPattern.exec(text))) {
      const assetPath = path.join(projectRoot, match[1])
      if (!fs.existsSync(assetPath)) {
        addError(`${project.name}: missing asset in ${toRepoPath(filePath)} -> ${match[1]}`)
      }
    }
  })
}

function checkContentJson() {
  const contentRoot = path.join(repoRoot, 'content-seed')
  walkFiles(contentRoot)
    .filter((filePath) => path.extname(filePath) === '.json')
    .forEach((filePath) => {
      readJson(filePath)
    })
}

function checkKnownLegacyAreas() {
  const legacyPaths = [
    'src',
    'public',
    'dist',
    'miniapp-uni/App.vue',
    'miniapp-uni/pages.json'
  ]

  legacyPaths.forEach((relativePath) => {
    if (fs.existsSync(path.join(repoRoot, relativePath))) {
      addWarning(`Legacy/reference area still exists: ${relativePath}`)
    }
  })
}

function main() {
  activeProjects.forEach((project) => {
    checkRequiredFiles(project)
    checkPages(project)
    checkImports(project)
  })

  checkContentJson()
  checkKnownLegacyAreas()

  if (errors.length > 0) {
    console.error('Project audit failed')
    errors.forEach((message) => console.error(`- ${message}`))
    process.exitCode = 1
    return
  }

  console.log('Project audit passed')
  console.log('- active project entry files exist')
  console.log('- pages.json routes resolve to Vue files')
  console.log('- local imports and @ assets resolve')
  console.log('- content-seed JSON files parse')

  if (warnings.length > 0) {
    console.log('Warnings')
    warnings.forEach((message) => console.log(`- ${message}`))
  }
}

main()
