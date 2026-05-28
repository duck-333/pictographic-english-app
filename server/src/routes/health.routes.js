import { Router } from 'express'

import { config } from '../config/env.js'

export const healthRouter = Router()

healthRouter.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: config.serviceName,
    time: new Date().toISOString(),
    version: config.version
  })
})
