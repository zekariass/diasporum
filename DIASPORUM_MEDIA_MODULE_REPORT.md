# Diasporum — Media Module Report
**Date:** 2026-10-30 — no new migrations; V3/V4 still pending on `diasporum_dev`. No commits.

## Schema (reused — zero new tables)
`media_objects(id, owner_user_id, bucket_name, object_key UNIQUE(bucket,key), purpose CHECK enum, access_scope, status media_status, mime_type, size_bytes, checksum_sha256, detected_mime_type, uploaded_at, deleted_at)` + `media_processing_jobs` (incl. `DELETE_OBJECT` retry queue). The object row doubles as the upload session (`PENDING_UPLOAD` + TTL) — no `media_upload_sessions` table needed.

## R2 integration
`software.amazon.awssdk:s3:2.29.52` added (S3-compatible API; no Stream). `StorageClient` interface (internal) → `R2StorageAdapter` (S3Presigner + S3Client, path-style, `endpoint` override, region `auto`). Bean only created when `diasporum.media.r2.endpoint` is set — tests substitute a fake.

## `MediaProperties` — `diasporum.media.r2.*`
`endpoint`, `accessKeyId`, `secretAccessKey`, `bucket`, `region`, `uploadUrlTtl`, `downloadUrlTtl`. Env vars per spec (`CLOUDFLARE_R2_*`). No credentials in code/tests/logs.

## `MediaApi` (root)
`asset`, `assets(Collection)` batch, `isReady`, `validateForAttach(id,owner,purpose)`, `authorizedDownloadUrl` (caller owns parent-resource authz), `deleteAsset`. No R2 keys/buckets/SDK types exposed.

## Upload workflow
`POST /api/v1/media/uploads` → validates purpose+MIME+declared size → inserts `PENDING_UPLOAD` with server-generated key `{owner}/{purpose}/{id}` → presigned PUT URL. `POST /uploads/{id}/complete` → owner check → HEAD verifies actual size/type → `READY` (or `REJECTED` on expiry/oversize). `DELETE /uploads/{id}` cancels. Client never supplies keys/owner.

## REST
`GET /{id}` (owner-only), `POST /{id}/download-url` (owner-only, READY-only), `DELETE /{id}` (owner-only, idempotent, enqueues `DELETE_OBJECT` on storage failure).

## Security
Purpose→MIME allowlist (AVATAR/FEED_IMAGE: jpeg/png/webp; FEED_VIDEO: mp4/quicktime; MESSAGE_AUDIO: mpeg/ogg/mp4; DOCUMENT: pdf); 25 MiB cap; server-generated keys; private-bucket presigned URLs only; owner-only access; JWT actor; no permanent URLs; expired sessions → REJECTED; delete retries via `media_processing_jobs`.

## Tests — Media suite 5/5 (full backend 88/88 incl. all prior modules)
Validation rejects (purpose/MIME/size), complete verifies+READY+idempotent, download-url owner-only+READY-only, delete owner-only+idempotent, full HTTP lifecycle. Fake StorageClient — no real R2 required. Architecture tests green.

## Deferred / needs approval
1. Real R2 credentials + CORS config for browser direct-upload (documented env vars; no live infra touched)
2. `media_processing_jobs` worker (retry queue exists; executor deferred — DeleteObject jobs enqueue on failure)
3. `media_access_scope` AUTHORIZED_VIEWERS / PUBLIC semantics — currently owner-only REST; cross-module `authorizedDownloadUrl` defers authz to caller
4. Multipart uploads (documented 25 MiB limit makes single-part sufficient; large-video multipart deferred until size requirement demands it)
5. File-signature (magic bytes) inspection — MIME verified from stored object; signature sniffing deferred

---

## R2 Runtime Configuration (completed 2026-10-30)

**Properties** (`diasporum.media.r2.*`, all env-driven — `application.yaml`):

| Property | Env var | Default |
|---|---|---|
| `enabled` | `R2_ENABLED` | `false` — bean never created unless `true` |
| `endpoint` | `CLOUDFLARE_R2_ENDPOINT` | (blank) — `https://<account-id>.r2.cloudflarestorage.com` |
| `region` | `CLOUDFLARE_R2_REGION` | `auto` |
| `bucket` | `CLOUDFLARE_R2_BUCKET` | (blank) |
| `access-key-id` | `CLOUDFLARE_R2_ACCESS_KEY_ID` | (blank) |
| `secret-access-key` | `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | (blank) |
| `upload-url-ttl` | `R2_UPLOAD_URL_TTL` | `PT15M` |
| `download-url-ttl` | `R2_DOWNLOAD_URL_TTL` | `PT2M` |
| `session-ttl` | `R2_UPLOAD_SESSION_TTL` | `PT15M` (approved limit preserved) |
| `max-upload-bytes` | `R2_MAX_UPLOAD_BYTES` | `26214400` (25 MiB preserved) |

**Activation behaviour (empty-placeholder bug eliminated):**
- `StorageClient` bean only created when `enabled=true` **and** all four credential fields are non-blank — `MediaProperties.configured()` + `@ConditionalOnProperty` + fail-fast `Assert` guard
- `enabled=true` + blank creds → context **fails fast** (no silent half-broken client)
- With R2 disabled, `MediaService` still loads — storage calls answer `503 MEDIA_STORAGE_DISABLED` via `ObjectProvider<StorageClient>`, so the app and all other modules start normally
- All env var names + empty placeholders in `diasporum-backend/.env.example`; no secrets in tracked files

## R2 Bucket CORS (required for browser/mobile direct PUT)
Direct upload = client's `fetch` PUTs **straight to R2** with the presigned URL — the request hits the bucket CORS check before storage:

| Origin | When |
|---|---|
| `http://localhost:8081` + Expo dev (`exp://`, `localhost:1900x`) | local dev |
| `https://app.<domain>` + `https://<domain>` | prod web |

- **Allowed methods:** `PUT` (upload), `GET` (download), `HEAD`
- **Allowed headers:** `content-type` (+ `x-amz-*`/`x-amz-content-sha256` if SDK-signed)
- **Expose headers:** `etag`, `content-length` — client needs `etag` for completion verification
- **Max age:** `300`

**Remaining manual Cloudflare setup (not automated — no live infra touched):**
1. Create R2 bucket (private) → account dashboard
2. Generate R2 API token (Object Read & Write, bucket-scoped) → access key + secret
3. Apply CORS policy above to the bucket
4. Set env vars in `.env` (local) / platform secrets (prod), `R2_ENABLED=true`

## Config test results — `MediaConfigTest` 5/5 (full suite 93/93)
defaults-disabled/no-bean, empty-placeholders→context-fails (not silently enabled), enabled+valid→adapter bean, disabled+valid→no bean, custom-value binding. StorageClient faked in integration tests — no real R2 required.
