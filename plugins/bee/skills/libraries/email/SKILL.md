---
name: email
description: "Transactional email patterns -- Resend, React Email, SendGrid, Nodemailer. Use when project has resend, @sendgrid/mail, or nodemailer in package.json."
---

# Transactional Email Standards

**Detection:** Check `package.json` for `resend`, `@sendgrid/mail`, `nodemailer`, or `@react-email/*`. If absent, skip.

## Resend + React Email (recommended)

```typescript
// Email template with React Email
import { Html, Head, Body, Container, Text, Button, Hr } from '@react-email/components';

interface OrderConfirmationProps {
  customerName: string;
  orderId: string;
  total: string;
  orderUrl: string;
}

export function OrderConfirmation({ customerName, orderId, total, orderUrl }: OrderConfirmationProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif', backgroundColor: '#f6f9fc' }}>
        <Container style={{ maxWidth: 580, margin: '0 auto', padding: '20px 0' }}>
          <Text>Hi {customerName},</Text>
          <Text>Your order #{orderId} has been confirmed. Total: {total}.</Text>
          <Button href={orderUrl} style={{ backgroundColor: '#000', color: '#fff', padding: '12px 20px' }}>
            View Order
          </Button>
          <Hr />
          <Text style={{ color: '#666', fontSize: 12 }}>You received this because you placed an order.</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

```typescript
// Send with Resend
import { Resend } from 'resend';
import { OrderConfirmation } from '@/emails/order-confirmation';

const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'orders@yourapp.com',
  to: customer.email,
  subject: `Order #${order.id} confirmed`,
  react: OrderConfirmation({ customerName: customer.name, orderId: order.id, total: '$99.00', orderUrl }),
});
```

## Rules

- **Send emails async** — queue email sending (Bull, BullMQ, SQS). Never block HTTP response for email.
- **Idempotent sending** — use a unique key to prevent duplicate emails on retry.
- **From address** — use a verified domain, never `@gmail.com`.
- **Unsubscribe link** — required by law (CAN-SPAM, GDPR). Include in every marketing email.
- **Preview emails** — use `npx react-email dev` to preview templates locally before sending.
- **Test with catch-all** — use Resend test mode or Mailtrap for development.

## Common Pitfalls

- **Sending in request handler** — blocks response. Queue it instead.
- **No error handling** — email API fails silently. Log failures, retry with backoff.
- **Hardcoded URLs** — use environment variables for base URL. Emails sent from staging with production URLs break.
- **Missing text version** — some email clients don't render HTML. Provide plaintext fallback.
