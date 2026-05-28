export function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found'
    }
  })
}

export function errorHandler(error, req, res, next) {
  const statusCode = Number(error.statusCode || error.status || 500)
  const safeStatusCode = statusCode >= 400 && statusCode <= 599 ? statusCode : 500
  const message = safeStatusCode >= 500 ? 'Internal server error' : error.message

  res.status(safeStatusCode).json({
    ok: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message
    }
  })
}
