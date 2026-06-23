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

Development admin token:

```text
dev-admin-token
```

To test from another device or a server, expose port `3001` and use:

```text
http://SERVER_IP:3001
```

To use a custom admin token during development, set `ADMIN_API_TOKEN` before starting the API:

```text
$env:ADMIN_API_TOKEN="replace-with-a-private-token"
npm.cmd run dev:api
```

Production must set a private `ADMIN_API_TOKEN`. If `NODE_ENV=production` and `ADMIN_API_TOKEN` is missing, empty, or `dev-admin-token`, admin write APIs fail closed.

## Admin Unlock Flow

The admin portal is protected by the same minimal Bearer token guard:

1. Open `admin-portal/pictographic-admin`.
2. Enter the Admin API Token on the admin login card.
3. The portal calls `GET /api/admin/auth/check`.
4. Only a valid token unlocks the content workbench.
5. The token is stored locally in `localStorage` as `pictographic:adminApiToken` for development convenience.
6. Click `锁定/退出` to clear the local token and return to the login card.

This is still not a complete user/account system. It is a minimum management password layer for the current admin API.

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

### GET /api/homepage/featured-word

Returns the current published homepage recommendation:

```json
{
  "ok": true,
  "word": null,
  "source": "empty"
}
```

`source` is `manual`, `dailyRotation`, or `empty`. The endpoint never returns draft, unpublished, archived, review, pending, unknown, or missing-status words.

### GET /api/admin/auth/check

Checks whether the provided admin token can access management APIs.

Requires:

```text
Authorization: Bearer <ADMIN_API_TOKEN>
```

Responses:

```json
{ "ok": true }
```

Missing token:

```json
{ "ok": false, "message": "Unauthorized" }
```

Wrong token:

```json
{ "ok": false, "message": "Unauthorized" }
```

### POST /api/admin/words

Saves or updates one admin-managed word. The admin portal uses this endpoint directly for `发布当前词条`, `撤下当前词条`, `归档当前词条`, and `发布全部本地草稿到服务器`.

Requires:

```text
Authorization: Bearer <ADMIN_API_TOKEN>
```

For local development, use:

```text
Authorization: Bearer dev-admin-token
```

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

Word records may include an optional illustration image:

```json
{
  "illustrationImage": {
    "url": "https://cdn.baxiaota.com/images/study.png",
    "title": "study 示意图",
    "alt": "展示 study 的象形拆解关系",
    "provider": "cos",
    "assetId": "images/study.png",
    "uploadStatus": "ready",
    "uploadedAt": "2026-06-23T00:00:00.000Z"
  }
}
```

An empty URL means no public illustration. Non-string URLs and non-production addresses are rejected by the Admin write API. Public records only retain HTTPS image URLs that are not local, temporary, mock, or example-domain addresses.

### GET /api/admin/homepage-featured

Returns the saved homepage recommendation configuration, the currently resolved word, and published words available for selection.

Requires:

```text
Authorization: Bearer <ADMIN_API_TOKEN>
```

### POST /api/admin/homepage-featured

Saves the homepage recommendation configuration:

```json
{
  "featuredWordIds": ["tud", "cool"],
  "mode": "dailyRotation",
  "manualWordId": ""
}
```

The stored configuration is:

```json
{
  "featuredWordIds": ["tud", "cool"],
  "mode": "dailyRotation",
  "manualWordId": "",
  "updatedAt": "2026-06-23T00:00:00.000Z",
  "updatedBy": "admin-api"
}
```

Only published word IDs can be saved. Daily rotation uses the Asia/Shanghai calendar-day number modulo the number of currently published pool words. Manual mode returns `manualWordId` when it is still published; otherwise it falls back to the published recommendation pool. An empty valid pool returns `word: null`.

## Safety Boundaries

- Production mini programs read published text entries from `https://baxiaota.com/api/words` and `https://baxiaota.com/api/words/:id`.
- Public word APIs use strict `status === "published"` filtering. Missing or any other status is treated as non-public.
- `illustrationImage.url` is normalized through the shared content schema. Public mini program rendering accepts production HTTPS images only.
- The public homepage recommendation API applies the same strict published filtering at response time, so later unpublish/archive actions take effect without rewriting the recommendation configuration.
- `GET /api/words` returns at most 20 matching records per request.
- Admin write APIs require a Bearer token. This is the minimum guard for development and deployment testing, not a complete admin login system.
- `GET /api/admin/auth/check` uses the same token guard so the admin portal can verify a token before showing the workbench.
- The frontend may store a local development token in `localStorage` under `pictographic:adminApiToken`. Do not treat it as a real account session.
- Do not commit real `.env` files or real `ADMIN_API_TOKEN` values.
- Production must set `ADMIN_API_TOKEN` to a private, non-default value.
- Development may use `http://127.0.0.1:3001` or `http://SERVER_IP:3001`.
- Production must use a filed HTTPS domain configured in the WeChat mini program allowed request domains.
- `npm.cmd run check:production` blocks local HTTP API bases in production or unknown runtime.
- `npm.cmd run check:production` also verifies that production admin auth rejects empty/default tokens.
