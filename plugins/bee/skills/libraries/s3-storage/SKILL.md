---
name: s3-storage
description: "S3-compatible file storage patterns -- uploads, pre-signed URLs, CDN, multipart. Use when project has @aws-sdk/client-s3, aws-sdk, or minio in package.json."
---

# S3 Storage Standards

**Detection:** Check `package.json` for `@aws-sdk/client-s3`, `aws-sdk`, or `minio`. Also check for S3-compatible services: Cloudflare R2, DigitalOcean Spaces, MinIO. If absent, skip.

## Client Setup

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT, // for R2/MinIO/Spaces
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});
```

## Upload Patterns

### Pre-signed URL (recommended — client uploads directly to S3)

```typescript
// Server: generate pre-signed upload URL
async function getUploadUrl(filename: string, contentType: string) {
  const key = `uploads/${crypto.randomUUID()}/${filename}`;
  const url = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  }), { expiresIn: 3600 }); // 1 hour

  return { url, key };
}

// Client: upload directly to S3
const { url, key } = await api.getUploadUrl(file.name, file.type);
await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
// Save `key` in your database
```

### Server-side upload (small files only)

```typescript
await s3.send(new PutObjectCommand({
  Bucket: process.env.S3_BUCKET,
  Key: `avatars/${userId}.jpg`,
  Body: buffer,
  ContentType: 'image/jpeg',
}));
```

## Download / Access

```typescript
// Pre-signed download URL (private files)
const url = await getSignedUrl(s3, new GetObjectCommand({
  Bucket: process.env.S3_BUCKET,
  Key: fileKey,
}), { expiresIn: 3600 });

// Public URL via CDN (public files)
const publicUrl = `${process.env.CDN_URL}/${fileKey}`;
```

## Rules

- **Pre-signed URLs for uploads** — client uploads directly to S3, not through your server. Saves bandwidth and memory.
- **Unique keys** — use UUID prefix to prevent collisions: `uploads/{uuid}/{filename}`
- **Content-Type validation** — validate file type both client-side (accept attribute) and server-side (pre-signed URL ContentType)
- **File size limits** — set max size in pre-signed URL conditions or API validation
- **CDN for public assets** — CloudFront/R2 custom domain for static files. Never expose raw S3 URLs.
- **Delete on record deletion** — when deleting a database record, also delete its S3 objects. Use lifecycle rules for orphan cleanup.

## Common Pitfalls

- **Server-side upload for large files** — memory explosion. Use pre-signed URLs for anything > 5MB.
- **No CORS on bucket** — client-side uploads fail without CORS configuration on the S3 bucket.
- **Hardcoded bucket names** — use environment variables. Different buckets per environment.
- **No lifecycle rules** — incomplete multipart uploads accumulate. Set auto-cleanup after 7 days.
- **Public bucket** — S3 buckets should be private by default. Use pre-signed URLs or CDN for access.
