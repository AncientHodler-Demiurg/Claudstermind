---
name: nextjs
description: Next.js 15 App Router conventions and patterns
---

# Next.js Standards

These standards apply when the project stack is `nextjs`. All agents and implementations must follow these conventions.

**Also read `skills/standards/frontend/SKILL.md`** for universal frontend standards (component architecture, accessibility, responsive design, CSS methodology, design quality) that apply alongside these Next.js-specific conventions.

## App Router Structure

- File-based routing in the `app/` directory. Each folder is a route segment.
- **`page.tsx`** -- The UI for a route. Required to make a route publicly accessible.
- **`layout.tsx`** -- Shared UI that wraps child routes. Persists across navigation (no re-render).
- **`loading.tsx`** -- Instant loading UI shown while route content streams in. Wraps the page in a Suspense boundary automatically.
- **`error.tsx`** -- Error boundary for a route segment. Must be a Client Component. Receives `error` and `reset` props.
- **`not-found.tsx`** -- UI for 404 within the route segment. Triggered by `notFound()` or when no route matches.
- **`global-error.tsx`** -- Error boundary for the root layout. Must be a Client Component. Must define its own `<html>` and `<body>` tags since it replaces the root layout.
- **`template.tsx`** -- Like layout but re-mounts on navigation. Use for animations or per-page state reset.
- **`default.tsx`** -- Fallback UI for parallel route slots when the slot's active state cannot be recovered after navigation.
- **Route groups** with `(name)` for organizing without affecting URL: `app/(marketing)/about/page.tsx`.
- **Dynamic segments** with `[param]`. In Next.js 15, `params` is a Promise and must be awaited.
- **Catch-all** with `[...param]` and **optional catch-all** with `[[...param]]`.
- **Route handlers** in `route.ts` for API endpoints: `app/api/users/route.ts`.

```
app/
├── layout.tsx                  # Root layout (required)
├── page.tsx                    # Home page (/)
├── global-error.tsx            # Root error boundary
├── not-found.tsx               # Global 404
├── (marketing)/
│   ├── about/page.tsx          # /about
│   └── blog/page.tsx           # /blog
├── dashboard/
│   ├── layout.tsx              # Dashboard layout
│   ├── loading.tsx             # Dashboard loading UI
│   ├── error.tsx               # Dashboard error boundary
│   ├── page.tsx                # /dashboard
│   ├── @sidebar/               # Parallel route slot
│   │   ├── default.tsx         # Fallback for sidebar
│   │   └── page.tsx            # Sidebar content
│   └── orders/
│       ├── page.tsx            # /dashboard/orders
│       └── [id]/page.tsx       # /dashboard/orders/:id
├── @modal/                     # Parallel route for modals
│   ├── default.tsx             # No modal by default
│   └── (.)login/page.tsx       # Intercepted /login as modal
└── api/
    └── users/route.ts          # API: /api/users
```

## Server vs Client Components

- **Default is Server Component.** Every component in `app/` is a Server Component unless marked with `'use client'`.
- Add `'use client'` **only** when the component needs: event handlers, hooks (useState, useEffect, useActionState), browser APIs, or third-party client libraries.
- Keep Client Components **small and at the leaves.** Push `'use client'` as far down the tree as possible.
- Pass server data **down as props** to Client Components. Server Components fetch; Client Components render interactively.
- Use the `server-only` and `client-only` packages to enforce import boundaries at build time.
- **Max 250 lines per visual component.** If larger, extract sub-components or custom hooks.
- **No business logic in visual components.** Extract data fetching, transformations, and validation into separate modules or hooks. Components orchestrate and render JSX -- nothing else.

**Decision tree:** Use a Client Component only if the component uses hooks, attaches event handlers, accesses browser APIs, or depends on a client-only third-party library. Everything else stays as a Server Component.

```tsx
// Server Component (default) -- fetches data directly
export default async function OrdersPage() {
    const orders = await db.orders.findMany();
    return (
        <div>
            <h1>Orders</h1>
            <OrderFilters />  {/* Client Component for interactivity */}
            {orders.map((order) => <OrderCard key={order.id} order={order} />)}
        </div>
    );
}

// Client Component -- handles user interaction
'use client';
export function OrderFilters() {
    const [search, setSearch] = useState('');
    return <input value={search} onChange={(e) => setSearch(e.target.value)} />;
}
```

## React 19 Integration

Next.js 15 uses React 19. Use these hooks in Client Components:

- **`useActionState(fn, initialState)`** -- manage Server Action state with automatic pending tracking. Returns `[state, formAction, isPending]`. Replaces the deprecated `useFormState`.
- **`useOptimistic(state, updateFn)`** -- optimistic UI updates during async Server Actions. Show the expected result immediately, roll back on failure.
- **`useFormStatus()`** (from `react-dom`) -- read parent form submission status. Must be rendered inside a `<form>`. Use in submit buttons for loading state.
- **`use()`** -- read promises and context directly in render. Can be called conditionally. Replaces `useContext` for context reading.

```tsx
'use client';
import { useActionState, useOptimistic } from 'react';
import { useFormStatus } from 'react-dom';
import { addItem } from '@/app/actions';

function SubmitButton() {
    const { pending } = useFormStatus();
    return <button type="submit" disabled={pending}>{pending ? 'Adding...' : 'Add'}</button>;
}

function ItemForm({ items }: { items: Item[] }) {
    const [optimisticItems, addOptimistic] = useOptimistic(items,
        (state, newItem: string) => [...state, { id: crypto.randomUUID(), name: newItem, pending: true }]
    );

    const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
        const name = formData.get('name') as string;
        addOptimistic(name);
        return await addItem(prev, formData);
    }, { errors: {} });

    return (
        <form action={formAction}>
            <input name="name" required />
            {state.errors?.name && <p>{state.errors.name}</p>}
            <SubmitButton />
            <ul>{optimisticItems.map(i => (
                <li key={i.id} style={{ opacity: i.pending ? 0.5 : 1 }}>{i.name}</li>
            ))}</ul>
        </form>
    );
}
```

## Server Actions Deep Dive

- Define with `'use server'` directive at the top of the function or file. Use for **mutations** (form submissions, data updates, deletions).
- **Progressive enhancement:** Forms with `<form action={serverAction}>` work without JavaScript -- submission happens server-side even before hydration.
- **Validation:** Always validate with Zod on the server. Client-side validation is UX only, not a security measure.
- **Redirect:** Call `redirect()` **outside** `try/catch` blocks -- it throws internally and must not be caught.
- **Revalidation:** Call `revalidatePath()` or `revalidateTag()` after mutations to invalidate cached data.
- **Error handling:** Return error state objects to the client. Use `useActionState` to display them.

```tsx
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const OrderSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email'),
    amount: z.coerce.number().positive('Must be positive'),
});

type ActionState = { errors?: Record<string, string[]>; message?: string };

export async function createOrder(prev: ActionState, formData: FormData): Promise<ActionState> {
    const validated = OrderSchema.safeParse({
        name: formData.get('name'),
        email: formData.get('email'),
        amount: formData.get('amount'),
    });

    if (!validated.success) {
        return { errors: validated.error.flatten().fieldErrors };
    }

    try {
        await db.orders.create({ data: validated.data });
    } catch (error) {
        return { message: 'Database error: failed to create order.' };
    }

    revalidatePath('/orders');
    redirect('/orders');  // Outside try/catch -- redirect throws internally
}
```

## Parallel Routes and Intercepting Routes

### Parallel Routes

- Use `@slotName` folders to render multiple page segments **simultaneously** in the same layout.
- The layout receives each slot as a prop alongside `children`.
- Use for: dashboards with independent panels, modals, split views, conditional sections.
- Each slot can have its own `loading.tsx`, `error.tsx`, and independent navigation state.
- **`default.tsx` is required** in each slot as a fallback for soft navigation recovery.

```tsx
// app/dashboard/layout.tsx
export default function DashboardLayout({
    children, sidebar, analytics,
}: {
    children: React.ReactNode;
    sidebar: React.ReactNode;
    analytics: React.ReactNode;
}) {
    return (
        <div className="grid grid-cols-[250px_1fr]">
            <aside>{sidebar}</aside>
            <main>{children}{analytics}</main>
        </div>
    );
}
```

### Intercepting Routes

- Intercept a route to show it in a different context (e.g., modal) while preserving the URL.
- Convention: `(.)` same level, `(..)` one level up, `(..)(..)` two levels up, `(...)` from root.
- On **soft navigation**, the intercepted route renders (e.g., modal). On **hard navigation** (direct URL), the full page renders.
- Combine with parallel routes for modal patterns: `@modal/(.)photo/[id]/page.tsx` intercepts `/photo/[id]` into a modal slot.

## Data Fetching

- Async Server Components can `await` data directly -- no useEffect, no client-side loading states.
- Use `fetch()` with caching options or direct database access (Prisma, Drizzle, raw SQL).
- Co-locate data fetching with the component that uses it.
- Wrap slow fetches in `<Suspense>` boundaries with fallback UI for progressive streaming.
- **Parallel data fetching:** Use `Promise.all` for multiple independent data sources to avoid waterfalls.
- Use **Route Handlers** (`route.ts`) only for endpoints consumed by external clients (mobile apps, webhooks). For internal data, use Server Components directly.

```tsx
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const orders = await db.orders.findMany({ where: { status: searchParams.get('status') } });
    return NextResponse.json(orders);
}
```

## Caching and Revalidation (Next.js 15)

**Breaking change in Next.js 15:** `fetch()` requests are **no longer cached by default.** Caching is now opt-in.

- **Default:** `fetch()` is not cached. Every request hits the server.
- **Opt-in caching:** `cache: 'force-cache'` per fetch, or `export const fetchCache = 'default-cache'` in a layout/page for all fetches in that segment.
- **Time-based revalidation:** `next: { revalidate: 60 }` caches and re-fetches after 60 seconds.
- **Tag-based revalidation:** `next: { tags: ['orders'] }` with `revalidateTag('orders')` for on-demand invalidation.
- **`revalidatePath(path)`** for on-demand revalidation of a specific route.
- **`unstable_cache`** for caching non-fetch data (database queries, ORM calls). Accepts a function, cache keys, and options with `revalidate` and `tags`.
- Static rendering for pages without request-time data. Dynamic rendering when using `cookies()`, `headers()`, or `searchParams`.

```tsx
// Not cached (Next.js 15 default)
const data = await fetch('https://api.example.com/orders');

// Opt-in to caching with time-based revalidation and tags
const data = await fetch('https://api.example.com/orders', {
    next: { revalidate: 60, tags: ['orders'] },
});

// Caching database queries
import { unstable_cache } from 'next/cache';
const getCachedOrders = unstable_cache(
    async () => await db.orders.findMany(),
    ['orders'],
    { revalidate: 3600, tags: ['orders'] }
);
```

## State Management

### Local and Server State

- `useState` for component-level state in Client Components. Keep state close to where it is used.
- `useReducer` when state has multiple sub-values or defined transitions.
- Server Components fetch data directly -- no client-side state needed. Pass server data as props to Client Components.
- Use Server Actions + `revalidatePath`/`revalidateTag` for mutations. The framework re-fetches server data automatically after revalidation.

### External Stores

**Detect what the project uses** -- check `package.json` and follow THAT library's conventions. Do NOT introduce a different state library.

- **Redux / RTK** -- use RTK slices, `createAsyncThunk`, RTK Query. Typed hooks (`useAppDispatch`, `useAppSelector`). Wrap providers in a Client Component.
- **Zustand** -- typed stores, selectors to prevent re-renders. `useStore(selector)` over `useStore()`. Client Components only.
- **TanStack Query** -- client-side server state (caching, refetching, polling). Wrap `QueryClientProvider` in a Client Component.
- **Jotai** -- atomic state, compose atoms. Client Components only.
- **MobX** -- `observer()` HOC, class-based stores if project convention.

**If no external store is installed:** React Context + useReducer for shared client state. For server data, rely on Server Components and Server Actions.

## Forms and Validation

### Server Action Forms

- `<form action={serverAction}>` for progressive enhancement -- works without JavaScript.
- Pair with `useActionState` for pending states, validation errors, and optimistic UI.
- Always validate with **Zod** on the server. Client-side validation is UX only.

### React Hook Form (if installed)

- Follow its patterns: `useForm`, `register`, `handleSubmit`, `formState`. Combine with `zodResolver`.

```tsx
// Pattern: useActionState form with server-side Zod validation
'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createOrder } from '@/app/actions/orders';

function SubmitButton() {
    const { pending } = useFormStatus();
    return <button type="submit" disabled={pending}>{pending ? 'Creating...' : 'Create Order'}</button>;
}

export function CreateOrderForm() {
    const [state, formAction] = useActionState(createOrder, { errors: {} });
    return (
        <form action={formAction}>
            <input name="name" />
            {state.errors?.name && <p>{state.errors.name[0]}</p>}
            <input name="email" type="email" />
            {state.errors?.email && <p>{state.errors.email[0]}</p>}
            {state.message && <p>{state.message}</p>}
            <SubmitButton />
        </form>
    );
}
```

## Error Handling

- **`error.tsx`** -- per-segment error boundary. Must be a Client Component. Receives `error` and `reset`. Catches errors in the page and children but NOT in the layout of the same segment.
- **`not-found.tsx`** -- triggered by `notFound()` from `next/navigation`. Define per segment for granular 404 pages.
- **`global-error.tsx`** -- catches errors in the root layout. Must define `<html>` and `<body>` tags.
- **Server Action errors** -- return error state objects instead of throwing. Use `useActionState` to display. Unexpected errors bubble to the nearest `error.tsx`.

```tsx
// app/dashboard/error.tsx
'use client';
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <div role="alert">
            <h2>Something went wrong</h2>
            <p>{error.message}</p>
            <button onClick={reset}>Try again</button>
        </div>
    );
}

// app/global-error.tsx -- must define <html> and <body>
'use client';
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <html><body>
            <h2>Something went wrong</h2>
            <button onClick={reset}>Try again</button>
        </body></html>
    );
}
```

## Images and Metadata

### next/image

Use `next/image` for all images — it provides automatic optimization, lazy loading, responsive sizing, and WebP/AVIF conversion:

```tsx
import Image from 'next/image';

// Static import — width/height inferred automatically
import heroImage from '@/public/hero.jpg';
<Image src={heroImage} alt="Hero" placeholder="blur" priority />

// Remote image — explicit sizing required
<Image src={user.avatarUrl} alt={user.name} width={96} height={96} className="rounded-full" />

// Fill mode — parent must be positioned (relative/absolute)
<div className="relative aspect-video">
  <Image src={product.imageUrl} alt={product.name} fill className="object-cover rounded-lg" />
</div>
```

- `priority` — set on above-the-fold images (hero, LCP). Disables lazy loading and preloads.
- `placeholder="blur"` — static imports auto-generate blur. For remote images, provide `blurDataURL`.
- `sizes` — responsive hints: `sizes="(max-width: 768px) 100vw, 50vw"` for proper srcset selection.
- Configure `remotePatterns` in `next.config.js` for allowed external image domains.

### Metadata and Fonts

- `metadata` export for static metadata; `generateMetadata` for dynamic. Include title, description, Open Graph.
- `next/font` for font optimization. Fonts are self-hosted automatically.
- In Next.js 15, `params` in `generateMetadata` is a Promise and must be awaited.

```tsx
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const order = await db.orders.findUnique({ where: { id } });
    return { title: `Order #${order?.number}`, description: `Details for order ${order?.number}` };
}
```

## Middleware

- **`middleware.ts`** at the project root (not inside `app/`).
- Use for: auth redirects, locale detection, header manipulation, A/B testing.
- **Matcher config** targets specific routes: `export const config = { matcher: ['/dashboard/:path*'] }`.
- Runs on the **Edge Runtime** -- keep lightweight. No database calls, no heavy computation.
- Set request headers to pass data from middleware to Server Components.

```tsx
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const token = request.cookies.get('session');
    if (!token && request.nextUrl.pathname.startsWith('/dashboard')) {
        return NextResponse.redirect(new URL('/login', request.url));
    }
    const response = NextResponse.next();
    response.headers.set('x-pathname', request.nextUrl.pathname);
    return response;
}

export const config = { matcher: ['/dashboard/:path*', '/api/protected/:path*'] };
```

## Turbopack

- Use `next dev --turbopack` for the dev server. Significantly faster HMR and cold starts.
- Turbopack is the default dev bundler in Next.js 15. Production builds still use Webpack.
- The `--turbo` flag is deprecated; use `--turbopack`.
- Turbopack config goes in `next.config.ts` under the `turbopack` key (not `webpack`).

## Testing

- **React Testing Library** + **Jest** or **Vitest** for component and integration tests.
- Test Server Components by rendering their output (they return JSX).
- Test Client Components with `userEvent` for interactions.
- Test Server Actions as standalone async functions -- call directly, assert return values.
- Mock `next/navigation` (`useRouter`, `usePathname`, `redirect`) and `next/headers` (`cookies`, `headers`).

```tsx
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
    usePathname: () => '/dashboard',
    redirect: vi.fn(),
}));

test('renders dashboard page with orders', async () => {
    const page = await DashboardPage();
    render(page);
    expect(screen.getByText('Orders')).toBeInTheDocument();
});

test('createOrder validates input and returns errors', async () => {
    const formData = new FormData();
    formData.set('name', '');
    formData.set('email', 'invalid');
    const result = await createOrder({ errors: {} }, formData);
    expect(result.errors?.name).toBeDefined();
    expect(result.errors?.email).toBeDefined();
});
```

## Common Pitfalls -- NEVER Rules

- **NEVER** use Pages Router patterns (`getServerSideProps`, `getStaticProps`, `getInitialProps`) in App Router projects.
- **NEVER** add `'use client'` to layouts or pages unless they genuinely need browser APIs or hooks.
- **NEVER** import server-only code in Client Components -- use the `server-only` package to enforce this.
- **NEVER** use `useEffect` for data fetching in Server Components -- fetch data directly with `await`.
- **NEVER** put heavy logic in middleware -- it runs on every matched request on the Edge Runtime.
- **NEVER** forget `loading.tsx` and `error.tsx` per route segment that fetches data.
- **NEVER** use `router.push` for simple navigation -- use the `<Link>` component from `next/link`.
- **NEVER** expose server secrets in Client Components -- they are bundled and sent to the browser.
- **NEVER** nest `'use client'` boundaries unnecessarily -- each boundary adds to the client bundle.
- **NEVER** use Route Handlers for data fetching that Server Components can do directly.
- **NEVER** assume `fetch()` is cached by default -- Next.js 15 requires opt-in with `cache: 'force-cache'` or `next: { revalidate }`.
- **NEVER** call `redirect()` inside a `try/catch` block -- it throws internally and will be caught.
- **NEVER** access `params` or `searchParams` synchronously -- in Next.js 15 they are Promises and must be awaited.
- **NEVER** use `useFormState` -- it is deprecated in React 19. Use `useActionState` instead.
- **NEVER** use `any` type in TypeScript -- define proper interfaces and types.
- **NEVER** create components exceeding 250 lines -- extract sub-components or custom hooks.
- **NEVER** put business logic directly in visual components -- extract into Server Actions, utilities, or hooks.

## Must-Haves

- **TypeScript everywhere.** All files `.ts`/`.tsx`. Strict mode in `tsconfig.json`. No implicit `any`.
- **Server Components by default.** `'use client'` only when hooks, event handlers, or browser APIs are needed.
- **`loading.tsx` and `error.tsx` per route segment.** `error.tsx` must be a Client Component.
- **`global-error.tsx` at the root.** Catches errors in the root layout.
- **Environment variables via `NEXT_PUBLIC_` prefix.** Server-only vars never use this prefix.
- **TDD for all features.** Tests before implementation. Red-Green-Refactor.
- **`not-found.tsx` for custom 404 pages** in segments with dynamic params.
- **`next/link` for navigation.** Never `router.push` for standard page transitions.
- **Zod for runtime validation** in Server Actions and Route Handlers.
- **`server-only` package** on modules with secrets, database clients, or server-only logic.
- **Await `params` and `searchParams`.** In Next.js 15, these are Promises in pages, layouts, and `generateMetadata`.

## Good Practices

- **Co-locate data fetching** with the Server Component that renders it.
- **Route Handlers for external APIs only.** Internal data goes through Server Components.
- **`next/image` for all images.** Never use raw `<img>` tags.
- **`next/dynamic` with `ssr: false`** for heavy client components not needed at initial render.
- **Metadata API for SEO.** `metadata` export for static, `generateMetadata` for dynamic.
- **Suspense boundaries** around slow data fetches for progressive streaming.
- **Server Actions for mutations** paired with `revalidatePath`/`revalidateTag`.
- **`Promise.all` for parallel data fetching** to avoid waterfalls.
- **Progressive enhancement.** `<form action={serverAction}>` works without JS. Layer `useActionState` and `useOptimistic` on top.
- **`default.tsx` in all parallel route slots** to prevent 404 on soft navigation.
- **Match the project's state library.** Check `package.json` first.

## Common Bugs

- **`useState` in Server Components.** Server Components cannot use hooks. Move to a Client Component.
- **Missing `'use client'` directive.** Must be the very first line of the file (before imports).
- **Assuming fetch is cached (Next.js 15).** `fetch()` is NOT cached by default. Migrated Next.js 14 code makes redundant requests without explicit opt-in.
- **Cache invalidation confusion.** Forgetting `revalidatePath`/`revalidateTag` after mutations leaves stale data. Over-revalidating with `revalidatePath('/')` busts the entire cache.
- **Hydration mismatch.** Server/client HTML must match. Avoid `Date.now()`, `Math.random()`, `window`/`localStorage` during initial render.
- **`cookies()`/`headers()` outside allowed contexts.** Only work in Server Components, Server Actions, Route Handlers, and middleware.
- **Forgetting to await `params` (Next.js 15).** `params` and `searchParams` are Promises. Synchronous access yields undefined.
- **`redirect()` inside try/catch.** The internal throw gets caught, preventing the redirect.
- **`useFormState` instead of `useActionState`.** Deprecated in React 19. `useActionState` also provides `isPending`.
- **Missing `default.tsx` in parallel routes.** Causes 404 on soft navigation to unmatched slot routes.
- **Stale optimistic state.** Not handling server errors with `useOptimistic` leaves ghost data in the UI.
- **Incorrect `revalidate` type.** Must be a number or `false`. String `'60'` silently fails.

## Anti-Patterns

- **Fetching in Client Components when Server Components can.** Avoid `useEffect` + `fetch` for data a parent Server Component can provide as props.
- **Mixing Pages Router with App Router.** Do not use `pages/` and `app/` for the same routes.
- **Using `getServerSideProps`/`getStaticProps` in App Router.** Use async Server Components and `generateStaticParams` instead.
- **Giant `'use client'` boundaries.** Extract only interactive parts into small Client Components.
- **Creating API routes for internal data.** Server Components query the database directly -- skip the HTTP hop.
- **Wrapping entire pages in Context Providers.** Create a small Client Component wrapper instead.
- **`useEffect` for form submissions.** Use Server Actions + `useActionState` instead.
- **Ignoring progressive enhancement.** Server Actions provide a no-JS fallback for free.
- **Monolithic 250+ line components.** Split into visual component + hooks + utility modules.
- **Storing server data in `useState`.** Render server-fetched data directly. Use `useState` only for client-side interactive state.
- **Overusing Route Handlers as a backend.** Server Actions and Server Components handle most mutations and data fetching.
- **Prop drilling through layouts.** Use Context (in Client Component providers), parallel data fetching, or shared utilities.

## Standards

- **Lowercase kebab-case for route directories.** `app/user-settings/`, never `app/UserSettings/`.
- **PascalCase for component files.** `OrderCard.tsx`, `DashboardSidebar.tsx`.
- **Reserved file names for route segments.** `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`, `template.tsx`, `default.tsx`, `global-error.tsx`.
- **Route groups for organization.** `(groupName)` folders for logical grouping without URL impact.
- **Parallel routes with `@slotName`.** For modals, split views, independent panels.
- **Colocation of related files.** Components, utils, types, tests near the route that uses them.
- **`server-only` and `client-only` packages** to enforce import boundaries at build time.
- **`@/` import alias.** Configure in `tsconfig.json`. Never use deep relative paths.
- **Server Actions in dedicated files.** `app/actions/orders.ts` with `'use server'` at the top.
- **Feature-based directory structure:**
  ```
  app/
    (dashboard)/
      orders/
        page.tsx
        loading.tsx
        error.tsx
        components/
          OrderCard.tsx
          OrderFilters.tsx
        actions.ts
    actions/
      orders.ts
      auth.ts
    components/     (shared UI components)
    lib/            (utilities, db client, constants)
    hooks/          (shared custom hooks)
  ```

## Context7 Instructions

When looking up framework documentation, use these Context7 library identifiers:

- **Next.js:** `/vercel/next.js` (use version `/vercel/next.js/v15.1.8` for Next.js 15 specifics) -- App Router, Server Components, Server Actions, middleware, caching, parallel routes, intercepting routes
- **React:** `/facebook/react` -- hooks, components, useActionState, useOptimistic, use() (used within Client Components)
- **Testing Library:** `testing-library/react-testing-library` -- render, screen, queries, user events

Always check Context7 for the latest API when working with Next.js 15 and React 19 features. Training data may be outdated for caching behavior changes, async params, and new React hooks.
