---
name: drizzle
description: "Drizzle ORM conventions -- SQL-first, type-safe schema, queries, migrations. Use when project has drizzle.config.ts or drizzle-orm in package.json."
---

# Drizzle ORM Standards

**Detection:** Check `package.json` for `drizzle-orm` OR `drizzle.config.ts` at project root. If neither exists, skip this skill.

## Schema Definition

Drizzle schemas are TypeScript — no special DSL. Schema IS the migration source.

```typescript
// db/schema/users.ts
import { pgTable, text, timestamp, boolean, pgEnum, index } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['user', 'admin']);

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  name: text('name'),
  role: roleEnum('role').default('user').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
});

export const posts = pgTable('posts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  content: text('content'),
  published: boolean('published').default(false).notNull(),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  index('posts_author_idx').on(table.authorId),
  index('posts_published_idx').on(table.published, table.createdAt),
]);
```

### Schema Rules

- One file per domain: `db/schema/users.ts`, `db/schema/posts.ts`. Re-export from `db/schema/index.ts`.
- Always add `createdAt` + `updatedAt` with `$onUpdate`.
- Add indexes explicitly — Drizzle does not auto-index foreign keys.
- Use `references()` with `onDelete` for all foreign keys.
- Use `pgEnum` / `mysqlEnum` for finite value sets.

## Queries

### SQL-like API (recommended)

```typescript
import { db } from '@/db';
import { users, posts } from '@/db/schema';
import { eq, like, desc, and, count, sql } from 'drizzle-orm';

// Select with filter
const results = await db.select().from(users).where(eq(users.role, 'admin'));

// Join
const userPosts = await db
  .select({ userName: users.name, postTitle: posts.title })
  .from(posts)
  .innerJoin(users, eq(posts.authorId, users.id))
  .where(eq(posts.published, true))
  .orderBy(desc(posts.createdAt))
  .limit(10)
  .offset(0);

// Insert
const [newUser] = await db.insert(users).values({ email, name }).returning();

// Update
await db.update(users).set({ name: 'New Name' }).where(eq(users.id, id));

// Delete
await db.delete(posts).where(eq(posts.authorId, userId));

// Count
const [{ total }] = await db.select({ total: count() }).from(posts).where(eq(posts.published, true));
```

### Relational Query API

```typescript
// Define relations
import { relations } from 'drizzle-orm';

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}));

// Query with relations (like Prisma include)
const result = await db.query.users.findFirst({
  where: eq(users.id, id),
  with: { posts: true, profile: true },
});
```

### Transactions

```typescript
await db.transaction(async (tx) => {
  const [order] = await tx.insert(orders).values({ userId, total }).returning();
  await tx.insert(payments).values({ orderId: order.id, amount: total });
  await tx.update(users).set({ balance: sql`${users.balance} - ${total}` }).where(eq(users.id, userId));
});
```

## Migrations

```bash
# Generate migration from schema changes
npx drizzle-kit generate

# Apply migrations
npx drizzle-kit migrate

# Push schema directly (dev only, no migration file)
npx drizzle-kit push

# Open Drizzle Studio (GUI)
npx drizzle-kit studio
```

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

## Performance

- **Select only needed columns** — `db.select({ id: users.id, name: users.name })` not `db.select().from(users)`
- **Use `prepare()`** for frequently executed queries — avoids re-parsing
- **Add indexes** — define in schema table callback function
- **Batch inserts** — `db.insert(table).values([...array])` for bulk operations
- **Connection pooling** — use `postgres` with pool or serverless adapter

## Common Pitfalls

- **Forgetting `.returning()`** — insert/update/delete don't return data by default. Add `.returning()`.
- **Missing relation definitions** — relational queries (`db.query`) require explicit `relations()` setup.
- **Wrong import path** — `drizzle-orm/pg-core` for PostgreSQL, `drizzle-orm/mysql-core` for MySQL, `drizzle-orm/sqlite-core` for SQLite.
- **Schema not re-exported** — if `drizzle.config.ts` points to `schema/index.ts`, all tables must be exported from there.
- **`push` in production** — `push` applies schema directly without migration files. Use `generate` + `migrate` in production.

## Context7

- **Drizzle ORM:** `/drizzle-team/drizzle-orm` or `/websites/orm_drizzle_team` — schema, queries, migrations, config
