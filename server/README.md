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

Default local development endpoint:

```text
http://127.0.0.1:3001
```

For local development from another device on the same private network, expose the development port `3001` and use:

```text
http://SERVER_IP:3001
```

Do not treat the local development port as the production deployment port.

## Production Deployment

Current production API deployment, as of 2026-07-15:

```text
PM2 process: pictographic-english-api-new
Local API port: 3002
Public HTTPS entry: https://baxiaota.com/api/*
Nginx config: /etc/nginx/sites-enabled/baxiaota.com
Nginx upstream: http://127.0.0.1:3002
```

The previous production API service was:

```text
PM2 process: pictographic-english-api-full
Local API port: 3001
Status: old production service
```

The 2026-07-15 migration changed Nginx from:

```nginx
proxy_pass http://127.0.0.1:3001;
```

to:

```nginx
proxy_pass http://127.0.0.1:3002;
```

Verification performed after migration:

```bash
curl http://127.0.0.1:3002/api/health
curl https://baxiaota.com/api/health
pm2 list
pm2 save
```

Observed status:

```text
local health ok=true
public health ok=true
pictographic-english-api-new online
pm2 save succeeded
```

Admin login is configured with server-side environment variables:

```text
ADMIN_USERNAME=
ADMIN_PASSWORD=
JWT_SECRET=
npm.cmd run dev:api
```

Production must set private values for `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `JWT_SECRET`. Do not commit real credentials or real `.env` files.

## Admin Unlock Flow

The admin portal uses server-side username/password login and a server-signed session token:

1. Open `admin-portal/pictographic-admin`.
2. Enter the configured admin username and password.
3. The portal calls `POST /api/admin/login`.
4. The server verifies `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
5. The server returns a signed session token.
6. The portal stores the session token locally as `pictographic:adminSessionToken`.
7. Admin APIs use `Authorization: Bearer <admin-session-token>`.
8. The portal can call `GET /api/admin/auth/check` to verify the session.
9. Click `锁定/退出` to clear the local session token and return to the login card.

This is still not a complete role-based admin system. It is the current minimum administrator login layer for the content management API.

## Data

The API stores local test data in:

```text
server/local-data/words.json
```

This file is ignored by Git. It is test data, not production content.

## API

### GET /api/health

Returns API status and word count.

### POST /api/auth/wechat-login

Creates or refreshes a mini program user session from a WeChat `wx.login` / `uni.login` code.

Request body:

```json
{
  "code": "one-time-wechat-login-code"
}
```

Server behavior:

- Calls WeChat `jscode2session` from the server only.
- Uses `wechat_user_bindings.openid` as the only WeChat identity lookup source.
- Creates a row in `users` when the WeChat binding does not exist.
- Returns a project-owned token. It never returns `openid`, `session_key`, or `WECHAT_MINIAPP_SECRET`.
- Existing `users.openid`, if present in the database, is not used as the login identity source.

Success response:

```json
{
  "ok": true,
  "token": "server-signed-session-token",
  "tokenType": "Bearer",
  "expiresAt": "2026-07-06T00:00:00.000Z",
  "user": {
    "id": "1",
    "hasWechatBinding": true,
    "isNew": true
  }
}
```

Required server environment:

```text
ADMIN_USERNAME=
ADMIN_PASSWORD=
WECHAT_MINIAPP_APPID=
WECHAT_MINIAPP_SECRET=
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=baxiaota
DB_USER=app_user
DB_PASSWORD=
JWT_SECRET=
PHONE_HASH_SECRET=
```

`PHONE_HASH_SECRET` is used by the planned phone identity system to create HMAC-SHA256 phone hashes. It must remain server-side and must not be exposed to the mini program.

Do not commit real `.env` files, admin passwords, database passwords, WeChat secrets, phone hash secrets, or token signing secrets.

### GET /api/words

Returns published words only.

Optional query:

```text
GET /api/words?q=study
```

### GET /api/words/:id

Returns one published word by stable `id`.

Published search and detail responses explicitly pass through `normalizePublicWord()` in `server/word-store.mjs`. A valid stored `illustrationImage` is returned with the word:

```json
{
  "illustrationImage": {
    "url": "https://cdn.baxiaota.com/images/student.png",
    "title": "student 示意图",
    "alt": "student 象形讲解"
  }
}
```

If the stored image URL is empty or is not a production HTTPS URL, the public response uses an empty `illustrationImage` object. Unsafe stored URLs are never returned to the mini program.

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

When `word` is present, it uses the same `normalizePublicWord()` projection as public search and detail responses, including the cleaned `illustrationImage`.

### GET /api/admin/auth/check

Checks whether the provided admin session token can access management APIs.

Requires:

```text
Authorization: Bearer <admin-session-token>
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
Authorization: Bearer <admin-session-token>
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
Authorization: Bearer <admin-session-token>
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
- Admin write APIs require a Bearer admin session token from `POST /api/admin/login`.
- `GET /api/admin/auth/check` verifies the current admin session token before showing the workbench.
- The frontend stores the admin session token in local browser storage. Do not treat browser storage as a high-security secret store.
- Do not commit real `.env` files, admin passwords, WeChat secrets, database passwords, phone hash secrets, or `JWT_SECRET` values.
- Production must set private `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, and, before phone login is enabled, `PHONE_HASH_SECRET`.
- Development may use `http://127.0.0.1:3001` or `http://SERVER_IP:3001`.
- Production currently uses Nginx to proxy `https://baxiaota.com/api/*` to `http://127.0.0.1:3002`.
- Production must use a filed HTTPS domain configured in the WeChat mini program allowed request domains.
- `npm.cmd run check:production` blocks local HTTP API bases in production or unknown runtime.
