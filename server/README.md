# Pictographic English API

Minimal local API server for the Pictographic English project.

## Requirements

- Node.js 18 or newer
- npm

## Install

```powershell
npm.cmd install
```

## Run

```powershell
npm.cmd start
```

The server reads `PORT` from the environment and defaults to `3001`.

For development with automatic restart:

```powershell
npm.cmd run dev
```

## Health Check

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

Expected response:

```json
{
  "ok": true,
  "service": "pictographic-english-api",
  "time": "2026-05-28T00:00:00.000Z",
  "version": "0.1.0"
}
```
