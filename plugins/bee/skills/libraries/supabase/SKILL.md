---
name: supabase
description: "Supabase conventions -- database, auth, storage, RLS policies, realtime, edge functions. Use when project has @supabase/supabase-js in package.json or supabase/ directory."
---

# Supabase Standards

**Detection:** Check `package.json` for `@supabase/supabase-js` OR `supabase/` directory with config. If absent, skip.

## Client Setup

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase'; // generated types

export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
```

Generate types from your schema: `npx supabase gen types typescript --project-id <id> > types/supabase.ts`

## Database Queries

```typescript
// Select with filter
const { data, error } = await supabase
  .from('orders')
  .select('*, customer:customers(name, email)')
  .eq('status', 'active')
  .order('created_at', { ascending: false })
  .range(0, 19); // pagination: first 20

// Insert
const { data, error } = await supabase.from('orders').insert({ customer_id, total }).select().single();

// Update
const { error } = await supabase.from('orders').update({ status: 'shipped' }).eq('id', orderId);

// Delete
const { error } = await supabase.from('orders').delete().eq('id', orderId);

// RPC (server function)
const { data, error } = await supabase.rpc('calculate_invoice_total', { invoice_id: id });
```

## Auth

```typescript
// Sign up
const { data, error } = await supabase.auth.signUp({ email, password });

// Sign in
const { data, error } = await supabase.auth.signInWithPassword({ email, password });

// OAuth
const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${origin}/auth/callback` } });

// Get current user
const { data: { user } } = await supabase.auth.getUser();

// Sign out
await supabase.auth.signOut();

// Auth state listener
supabase.auth.onAuthStateChange((event, session) => { /* handle */ });
```

## Row Level Security (RLS)

RLS is non-negotiable with Supabase. Every table exposed to the client MUST have policies:

```sql
-- Enable RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Users see only their own orders
CREATE POLICY "Users see own orders" ON orders
  FOR SELECT USING (auth.uid() = customer_id);

-- Users can insert their own orders
CREATE POLICY "Users create own orders" ON orders
  FOR INSERT WITH CHECK (auth.uid() = customer_id);

-- Users can update their own orders
CREATE POLICY "Users update own orders" ON orders
  FOR UPDATE USING (auth.uid() = customer_id);

-- Admins see everything
CREATE POLICY "Admins see all" ON orders
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

Rules:
- Enable RLS on EVERY table that the client JS accesses
- Use `auth.uid()` to scope queries to the authenticated user
- Test policies with different user roles
- Tables without RLS and with the anon key exposed = full public access (security breach)

## Storage

```typescript
// Upload
const { data, error } = await supabase.storage.from('avatars').upload(`${userId}/avatar.jpg`, file, {
  contentType: 'image/jpeg',
  upsert: true,
});

// Get public URL
const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${userId}/avatar.jpg`);

// Download
const { data, error } = await supabase.storage.from('documents').download(`${path}`);
```

Set storage bucket policies in the dashboard — same RLS concepts apply to storage.

## Realtime

```typescript
// Subscribe to changes
const channel = supabase.channel('orders').on(
  'postgres_changes',
  { event: 'INSERT', schema: 'public', table: 'orders', filter: `customer_id=eq.${userId}` },
  (payload) => { /* handle new order */ },
).subscribe();

// Cleanup
channel.unsubscribe();
```

## Edge Functions

```typescript
// supabase/functions/process-payment/index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { orderId } = await req.json();
  // ... process payment with service role (bypasses RLS)
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
});
```

## Common Pitfalls

- **Missing RLS policies** — tables without RLS are publicly accessible via the anon key. This is the #1 security issue.
- **Using anon key for admin operations** — use service role key ONLY in server-side code (Edge Functions, API routes). Never expose it to the client.
- **Not generating types** — untyped Supabase queries lose all type safety. Run `gen types` after schema changes.
- **Ignoring errors** — every Supabase call returns `{ data, error }`. Always check `error`.
- **Realtime without cleanup** — forgetting `unsubscribe()` causes memory leaks and duplicate handlers.
- **Storage without policies** — storage buckets default to no access. Configure policies in dashboard.

## Context7

- **Supabase:** search for `supabase` — client, auth, RLS, storage, realtime, edge functions
