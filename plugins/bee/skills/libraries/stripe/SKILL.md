---
name: stripe
description: "Stripe payment integration -- checkout sessions, webhooks, subscriptions, customer portal. Use when project has stripe in package.json."
---

# Stripe Standards

**Detection:** Check `package.json` for `stripe` (server) or `@stripe/stripe-js` (client). If absent, skip.

## Server Setup

```typescript
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Never expose `STRIPE_SECRET_KEY` to the client. Client-side uses `STRIPE_PUBLISHABLE_KEY` only.

## Checkout Sessions

```typescript
// Create checkout session (server-side)
const session = await stripe.checkout.sessions.create({
  mode: 'payment', // or 'subscription'
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${origin}/cancel`,
  customer_email: user.email,
  metadata: { userId: user.id, orderId: order.id },
});

// Redirect client to Stripe
return Response.json({ url: session.url });
```

## Webhooks (critical for payment confirmation)

```typescript
// Webhook handler — verify signature FIRST
export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return new Response('Invalid signature', { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) { console.error('Missing orderId in session metadata'); break; }
      await fulfillOrder(orderId, session.payment_intent as string);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      await handleFailedPayment(invoice.customer as string);
      break;
    }
  }

  return new Response('OK', { status: 200 });
}
```

### Webhook Rules

- Always verify webhook signature — never trust raw POST bodies
- Use `metadata` to link Stripe objects to your database records
- Make webhook handlers **idempotent** — Stripe retries on failure, you may receive the same event twice
- Return 200 quickly — do heavy processing async (queue jobs)
- Listen to: `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`

## Subscriptions

```typescript
// Create subscription
const subscription = await stripe.subscriptions.create({
  customer: customerId,
  items: [{ price: priceId }],
  payment_behavior: 'default_incomplete',
  expand: ['latest_invoice.payment_intent'],
});

// Cancel at period end (graceful)
await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });

// Customer portal (self-service billing management)
const portal = await stripe.billingPortal.sessions.create({
  customer: customerId,
  return_url: `${origin}/account`,
});
```

## Common Pitfalls

- **Not verifying webhook signatures** — anyone can POST to your webhook endpoint. Always verify.
- **Fulfilling orders on client redirect** — users can manipulate the success URL. Only fulfill via webhook.
- **Non-idempotent webhooks** — duplicate events cause double charges/fulfillment. Use `event.id` for deduplication.
- **Hardcoded prices** — use Stripe Dashboard price IDs, not hardcoded amounts. Prices can change.
- **Missing `STRIPE_WEBHOOK_SECRET`** — different from `STRIPE_SECRET_KEY`. Generated per webhook endpoint.
- **Testing with live keys** — always use `sk_test_` and `pk_test_` keys during development.

## Context7

- **Stripe:** search for `stripe` — checkout, webhooks, subscriptions, API reference
