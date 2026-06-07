# Pictographic English Local API

This folder contains the smallest development API used to connect:

- admin content editor
- mini program word repository
- local/server test storage

It is for development and server testing before the mini program has a filed HTTPS domain.

## Run

From the repository root:

```text
npm.cmd run dev:api
```

Default endpoint:

```text
http://127.0.0.1:3001
```

To test from another device or a server, expose port `3001` and use:

```text
http://SERVER_IP:3001
```

## Data

The API stores local test data in:

```text
server/local-data/words.json
```

This file is ignored by Git. It is test data, not production content.

## API

### GET /api/health

Returns API status and word count.

### GET /api/words

Returns published words only.

Optional query:

```text
GET /api/words?q=study
```

### GET /api/words/:id

Returns one published word by stable `id`.

### POST /api/admin/words

Saves or updates one word for development testing.

Request body:

```json
{
  "word": {
    "id": "word-study",
    "word": "study",
    "status": "published",
    "meaning": "learn; research",
    "pictograph": "..."
  }
}
```

The server reuses `miniapp-uni/word-app1/common/content-schema.js` to normalize and validate records.

## Safety Boundaries

- No admin token or secret is stored in the frontend.
- This is not a production auth system.
- Development may use `http://127.0.0.1:3001` or `http://SERVER_IP:3001`.
- Production must use a filed HTTPS domain configured in the WeChat mini program allowed request domains.
- `npm.cmd run check:production` blocks local HTTP API bases in production or unknown runtime.
