---
name: prisma
description: "Prisma ORM conventions -- schema design, migrations, relations, queries, transactions. Use when project has prisma/ directory or @prisma/client in package.json."
---

# Prisma ORM Standards

**Detection:** Check `package.json` for `@prisma/client` OR `prisma` directory at project root. If neither exists, skip this skill.

## Schema Design

### Models and Relations

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client"  // Prisma v6+. For v4/v5 use "prisma-client-js"
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  role      Role     @default(USER)
  posts     Post[]
  profile   Profile?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([email])
}

model Post {
  id         String     @id @default(cuid())
  title      String
  content    String?
  published  Boolean    @default(false)
  author     User       @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId   String
  categories Category[]
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt

  @@index([authorId])
  @@index([published, createdAt])
}

enum Role {
  USER
  ADMIN
}
```

### Schema Rules

- Use `cuid()` or `uuid()` for IDs. Auto-increment only for non-distributed systems.
- Always add `createdAt` + `updatedAt` to every model.
- Always specify `onDelete` behavior on relations (Cascade, SetNull, Restrict).
- Add `@@index` for fields used in WHERE/ORDER BY. Prisma does NOT auto-create indexes on foreign keys.
- Use enums for finite sets (status, role, type).
- `@unique` for business-unique fields (email, slug).
- Keep relation names explicit when a model has multiple relations to the same table.

### Relations

| Type | Pattern |
|------|---------|
| One-to-one | `Profile` has `userId @unique` + `@relation(fields: [userId])` |
| One-to-many | `Post[]` on parent, `authorId` + `@relation(fields: [authorId])` on child |
| Many-to-many (implicit) | `Category[]` on Post, `Post[]` on Category — Prisma creates join table |
| Many-to-many (explicit) | Create join model with `@@id([postId, categoryId])` for extra fields on the relation |

## Queries

### Read Operations

```typescript
// Find with relations (eager loading)
const user = await prisma.user.findUnique({
  where: { id },
  include: { posts: true, profile: true },
});

// Select specific fields (reduces payload)
const users = await prisma.user.findMany({
  select: { id: true, email: true, name: true, _count: { select: { posts: true } } },
});

// Filtering + pagination + sorting
const posts = await prisma.post.findMany({
  where: { published: true, title: { contains: query, mode: 'insensitive' } },
  orderBy: { createdAt: 'desc' },
  skip: (page - 1) * limit,
  take: limit,
});

// Count for pagination
const total = await prisma.post.count({ where: { published: true } });
```

### Write Operations

```typescript
// Create with relation
const post = await prisma.post.create({
  data: {
    title: 'New Post',
    author: { connect: { id: userId } },
    categories: { connect: [{ id: cat1Id }, { id: cat2Id }] },
  },
  include: { author: true, categories: true },
});

// Upsert (create or update)
const user = await prisma.user.upsert({
  where: { email },
  update: { name },
  create: { email, name },
});

// Update many
await prisma.post.updateMany({
  where: { authorId: userId, published: false },
  data: { published: true },
});

// Delete with cascade
await prisma.user.delete({ where: { id } }); // cascades to posts if onDelete: Cascade
```

### Transactions

```typescript
// Interactive transaction — multiple operations in one ACID transaction
const [order, payment] = await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ data: { userId, total } });
  const payment = await tx.payment.create({ data: { orderId: order.id, amount: total } });
  await tx.user.update({ where: { id: userId }, data: { balance: { decrement: total } } });
  return [order, payment];
});

// Sequential transaction — simpler, auto-rolled back on failure
const [users, posts] = await prisma.$transaction([
  prisma.user.findMany(),
  prisma.post.findMany({ where: { published: true } }),
]);
```

## Migrations

```bash
# Create migration from schema changes
npx prisma migrate dev --name add_user_profile

# Apply in production
npx prisma migrate deploy

# Reset database (dev only)
npx prisma migrate reset

# Generate client after schema changes
npx prisma generate
```

- Migrations are immutable once deployed. Never edit a deployed migration.
- Use `migrate dev` locally (creates + applies). Use `migrate deploy` in CI/production (applies only).
- Run `prisma generate` after every schema change to update the client types.
- Seed data: create `prisma/seed.ts` and configure in `package.json`: `"prisma": { "seed": "tsx prisma/seed.ts" }`

## Performance

- **Select only needed fields** — use `select` instead of returning entire models. Reduces memory + network.
- **Avoid N+1** — use `include` for eager loading, not separate queries in loops.
- **Use `findMany` with `take`** — always paginate. Never fetch unbounded lists.
- **Add indexes** — `@@index` on filter/sort columns. Check with `prisma db execute --stdin < explain.sql`.
- **Connection pooling** — use Prisma Accelerate or PgBouncer in production. Set `connection_limit` in DATABASE_URL.
- **Batch operations** — `createMany`, `updateMany`, `deleteMany` for bulk work.

## Common Pitfalls

- **Missing `@@index` on foreign keys** — Prisma does NOT auto-index foreign keys. Add explicitly.
- **Forgetting `onDelete`** — default is `Restrict`, which blocks parent deletion. Use `Cascade` or `SetNull` intentionally.
- **N+1 in loops** — querying inside `map()` or `forEach()`. Use `include` or `findMany` with `where: { id: { in: ids } }`.
- **Not running `prisma generate`** — schema changes don't update the client until you regenerate.
- **Raw SQL without parameterization** — `$queryRaw` with template literals is safe (`Prisma.sql`). String concatenation is SQL injection.
- **Missing `@updatedAt`** — forgetting to add `updatedAt DateTime @updatedAt` means no automatic timestamp tracking.
- **Implicit many-to-many with extra data** — if you need fields on the join (like `assignedAt`), use explicit relation model.

## Context7

- **Prisma:** `/websites/prisma_io` or `/prisma/prisma` — schema, queries, migrations, client API
