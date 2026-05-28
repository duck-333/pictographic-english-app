import express from 'express'
import { fileURLToPath } from 'node:url'

import { config } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { healthRouter } from './routes/health.routes.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))
  app.use('/api', healthRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export function startServer(port = config.port) {
  const app = createApp()
  const server = app.listen(port, () => {
    console.log(`${config.serviceName} listening on port ${port}`)
  })
  return server
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isDirectRun) {
  startServer()
}
