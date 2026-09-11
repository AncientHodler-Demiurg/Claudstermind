---
name: trpc
description: "tRPC type-safe API conventions -- routers, procedures, middleware, subscriptions. Use when project has @trpc/server or @trpc/client in package.json."
---

# tRPC Standards

**Detection:** Check `package.json` for `@trpc/server` or `@trpc/client`. If absent, skip.

## Server Setup

```typescript
// server/trpc.ts
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({ ...shape, data: { ...shape.data, zodError: error.cause instanceof ZodError ? error.cause.flatten() : null } }),
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthenticated);
```

## Routers and Procedures

```typescript
// server/routers/orders.ts
import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';

export const ordersRouter = router({
  list: protectedProcedure
    .input(z.object({ status: z.enum(['active', 'completed']).optional(), page: z.number().default(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.order.findMany({
        where: { userId: ctx.user.id, ...(input.status && { status: input.status }) },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: (input.page - 1) * 20,
      });
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const order = await ctx.db.order.findUnique({ where: { id: input.id } });
      if (!order || order.userId !== ctx.user.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return order;
    }),

  create: protectedProcedure
    .input(z.object({ items: z.array(z.object({ productId: z.string(), quantity: z.number().min(1) })) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.order.create({ data: { userId: ctx.user.id, items: { create: input.items } } });
    }),
});
```

## Middleware

```typescript
const isAuthenticated = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { user: ctx.user } }); // narrows ctx type
});

const isAdmin = t.middleware(async ({ ctx, next }) => {
  if (ctx.user?.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
  return next({ ctx });
});

export const adminProcedure = protectedProcedure.use(isAdmin);
```

## Client Usage (React)

```typescript
// With TanStack Query integration
import { trpc } from '@/utils/trpc';

function OrdersList() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.orders.list.useQuery({ status: 'active' });
  const createOrder = trpc.orders.create.useMutation({
    onSuccess: () => utils.orders.list.invalidate(),
  });

  return (
    <>
      {data?.map(order => <OrderCard key={order.id} order={order} />)}
      <Button onClick={() => createOrder.mutate({ items: selectedItems })}>Create Order</Button>
    </>
  );
}
```

## Common Pitfalls

- **Not using Zod for input validation** — tRPC without input validation accepts anything. Always `.input(z.object({...}))`.
- **Leaking data** — returning full database objects. Use `select` or output validation to control what leaves the server.
- **Missing error handling** — unhandled errors become 500 INTERNAL_SERVER_ERROR. Throw `TRPCError` with proper codes.
- **Huge routers** — split by domain: `ordersRouter`, `usersRouter`, `paymentsRouter`. Merge in `appRouter`.
- **Client without transformer** — if server uses `superjson`, client must too. Dates/Decimals break without it.

## Context7

- **tRPC:** search for `trpc` — routers, procedures, middleware, client, React integration
