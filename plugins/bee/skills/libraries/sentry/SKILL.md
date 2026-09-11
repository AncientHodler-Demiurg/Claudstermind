---
name: sentry
description: "Sentry error tracking conventions -- SDK setup, error boundaries, performance monitoring, source maps. Use when project has @sentry/* in package.json."
---

# Sentry Standards

**Detection:** Check `package.json` for `@sentry/node`, `@sentry/react`, `@sentry/nextjs`, `@sentry/vue`, or `@sentry/browser`. If absent, skip.

## Setup

```typescript
// Next.js: sentry.client.config.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
});
```

## Error Boundaries (React)

```tsx
import * as Sentry from '@sentry/react';

<Sentry.ErrorBoundary fallback={<ErrorFallback />} showDialog>
  <App />
</Sentry.ErrorBoundary>
```

## Capturing Errors

```typescript
// Automatic — unhandled exceptions are captured by default

// Manual capture with context
try {
  await processPayment(orderId);
} catch (error) {
  Sentry.captureException(error, {
    tags: { feature: 'payments', orderId },
    extra: { amount: order.total, customerId: order.customerId },
  });
  throw error; // re-throw if needed
}

// Breadcrumbs (context trail)
Sentry.addBreadcrumb({ category: 'checkout', message: `Started checkout for order ${orderId}`, level: 'info' });
```

## Performance Monitoring

```typescript
// Custom span (Sentry v8+ API)
await Sentry.startSpan({ name: 'process-order', op: 'task' }, async (span) => {
  await Sentry.startSpan({ name: 'fetch order items', op: 'db.query' }, async () => {
    await fetchOrderItems(orderId);
  });
});
```

## Rules

- **Set `tracesSampleRate` to 0.1 in production** — 100% sampling generates excessive data and cost
- **Source maps** — upload via `@sentry/webpack-plugin` or `@sentry/nextjs`. Without them, stack traces are unreadable.
- **User context** — set `Sentry.setUser({ id, email })` after authentication
- **Environment tags** — always set `environment` to distinguish production/staging/dev errors
- **Release tracking** — set `release` to git SHA or version for release health tracking

## Common Pitfalls

- **Missing source maps** — production errors show minified code. Configure source map upload in CI.
- **100% sampling** — `tracesSampleRate: 1.0` in production generates thousands of transactions. Use 0.1 or lower.
- **Catching errors without reporting** — `catch (e) { /* ignore */ }` hides errors from Sentry. Capture then handle.
- **PII in error context** — don't send passwords, tokens, or full credit card numbers in `extra`. Scrub sensitive data.
- **No release tagging** — without `release`, you can't correlate errors to deploys or track regression.
