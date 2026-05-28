const DEFAULT_PORT = 3001

function readPort(value) {
  const port = Number(value)
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    return port
  }
  return DEFAULT_PORT
}

export const config = Object.freeze({
  port: readPort(process.env.PORT),
  serviceName: 'pictographic-english-api',
  version: '0.1.0'
})
