---
name: react
description: React 19 standalone conventions and patterns with Vite, React Router v7, TypeScript strict mode
---

# React Standards

These standards apply when the project stack is `react`. All agents and implementations must follow these conventions.

**Also read `skills/standards/frontend/SKILL.md`** for universal frontend standards (component architecture, accessibility, responsive design, CSS methodology, design quality) that apply alongside these React-specific conventions.

## Component Architecture

- **Function components only.** All components are plain functions with TypeScript interfaces for props.
- **Single responsibility:** Each component does one thing. If a component handles form state AND layout AND API calls, split it.
- **Composition over inheritance:** Use children, render props, and compound components -- never extend component classes.
- **Props design:** Destructure in the function signature. Provide defaults via destructuring. Keep prop interfaces narrow.
- **Children pattern:** Use `children` prop for wrapper components (layouts, providers, modals).
- **Compound components:** Group related components under a namespace (`Tabs`, `Tabs.List`, `Tabs.Panel`) using dot notation exports or a parent object.
- **Max 250 lines per visual component.** If larger, extract sub-components or custom hooks.
- **No business logic in visual components.** Components render UI only. Extract data fetching, transformations, validation, and state machines into custom hooks. Components orchestrate hooks and render JSX — nothing else.

```tsx
// Pattern: compound component with context
interface TabsProps { defaultTab: string; children: React.ReactNode; }
interface TabsContextValue { activeTab: string; setActiveTab: (tab: string) => void; }

const TabsContext = createContext<TabsContextValue | null>(null);

function Tabs({ defaultTab, children }: TabsProps) {
    const [activeTab, setActiveTab] = useState(defaultTab);
    return <TabsContext value={{ activeTab, setActiveTab }}>{children}</TabsContext>;
}

function TabsList({ children }: { children: React.ReactNode }) {
    return <div role="tablist">{children}</div>;
}

function TabsPanel({ id, children }: { id: string; children: React.ReactNode }) {
    const { activeTab } = use(TabsContext)!;
    if (activeTab !== id) return null;
    return <div role="tabpanel">{children}</div>;
}

Tabs.List = TabsList;
Tabs.Panel = TabsPanel;
```

## Hooks

### Core Hooks

- `useState` for local reactive state. Always use the setter function, never mutate directly.
- `useEffect` for side effects (subscriptions, timers, DOM manipulation). Always return a cleanup function when needed.
- `useContext` for consuming context values. Pair with a custom hook: `useAuth()` wraps `useContext(AuthContext)`.
- `useReducer` for complex state with multiple sub-values or when next state depends on previous.
- `useMemo` for expensive derived values. Use instead of storing derived state in useState.
- `useCallback` for stable function references passed to child components.
- `useRef` for mutable values that do not trigger re-renders (DOM refs, timers, previous values).

### React 19 Hooks

- **`use()`** — read promises and context directly in render. Replaces `useContext` for context reading and enables Suspense-based async data.
- **`useActionState(fn, initialState)`** — manage form action state with automatic pending tracking. Replaces `useFormState`. Returns `[state, formAction, isPending]`.
- **`useOptimistic(state, updateFn)`** — optimistic UI updates during async actions. Show the expected result immediately, roll back on failure.
- **`useFormStatus()`** (from `react-dom`) — read parent form submission status. Use in submit buttons to show loading state.

```tsx
// Pattern: form with useActionState + useOptimistic
import { useActionState, useOptimistic } from 'react';
import { useFormStatus } from 'react-dom';

function SubmitButton() {
    const { pending } = useFormStatus();
    return <button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save'}</button>;
}

function TodoForm({ todos, addTodo }: { todos: Todo[]; addTodo: (text: string) => Promise<Todo[]> }) {
    const [optimisticTodos, addOptimistic] = useOptimistic(todos, (state, newText: string) => [
        ...state, { id: crypto.randomUUID(), text: newText, pending: true },
    ]);

    const [state, formAction] = useActionState(async (_prev: Todo[], formData: FormData) => {
        const text = formData.get('text') as string;
        addOptimistic(text);
        return await addTodo(text);
    }, todos);

    return (
        <form action={formAction}>
            <input name="text" required />
            <SubmitButton />
            <ul>{optimisticTodos.map(t => <li key={t.id} style={{ opacity: t.pending ? 0.5 : 1 }}>{t.text}</li>)}</ul>
        </form>
    );
}
```

### Rules of Hooks

- Call hooks at the **top level** only -- never inside conditions, loops, or nested functions.
- Call hooks only from **React function components** or **custom hooks**.
- `use()` is the exception — it CAN be called conditionally (inside if/else, try/catch).

### Custom Hooks

- Extract reusable logic into custom hooks: `useFilters()`, `useDebounce()`, `usePagination()`, `useLocalStorage()`.
- Custom hooks follow `use*` naming convention and live in `src/hooks/` directory.
- A custom hook returns state and functions -- it is a self-contained unit of logic.

```tsx
// Pattern: custom hook with cleanup and abort
function useFetch<T>(url: string): { data: T | null; loading: boolean; error: Error | null } {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);

        fetch(url, { signal: controller.signal })
            .then(res => res.json())
            .then(setData)
            .catch(err => { if (err.name !== 'AbortError') setError(err); })
            .finally(() => setLoading(false));

        return () => controller.abort();
    }, [url]);

    return { data, loading, error };
}
```

## State Management

### Local State

- `useState` for component-level state. Keep state as close to where it is used as possible.
- Lift state up only when two siblings need the same data. Avoid premature lifting.

### Complex State

- `useReducer` when state has multiple sub-values or transitions follow a defined pattern.
- Define typed actions: `type Action = { type: 'add'; item: Item } | { type: 'remove'; id: string }`.

### Shared State

- **Context API** for app-wide values: theme, auth, locale. Create a provider and a custom hook.
- Avoid prop drilling by colocating state or using context. Composition (passing components as props) also solves drilling.
- **Context performance:** Split read/write contexts to prevent unnecessary re-renders. Consumers of dispatch don't re-render when state changes.

### External Stores

**Detect what the project uses** — check `package.json` for installed state management libraries and follow THAT library's conventions. Do NOT introduce a different state library than what the project already uses.

Common libraries and their best practices:

- **Redux / Redux Toolkit (RTK)** — if installed, use RTK slices (not legacy reducers), `createAsyncThunk` for async, RTK Query for server state. Never mutate state outside Immer. Use `useSelector` with narrow selectors, `useDispatch` with typed hooks (`useAppDispatch`, `useAppSelector`).
- **Zustand** — lightweight stores with minimal boilerplate. Create typed stores, use selectors to prevent unnecessary re-renders. Prefer `useStore(selector)` over `useStore()`.
- **TanStack Query** — for server state (caching, refetching, pagination, optimistic updates). Preferred over manual fetch + useState for API data. Use query keys consistently, invalidate on mutations.
- **Jotai** — atomic state with fine-grained reactivity. Compose atoms, use `atom` for derived state.
- **MobX** — observable state with decorators/annotations. Use `observer()` HOC, keep stores class-based if project convention.
- **Recoil** — atom/selector model. Follow project's existing atom organization.

**If no external store is installed:** Use Context API + useReducer for shared state. Split read/write contexts for performance.

**Key rule:** Match the project. If the project uses Redux, write Redux. If it uses Zustand, write Zustand. Never mix state libraries without explicit user direction.

**For new projects (no state library installed yet):** Recommend **Zustand** for client state (simple, minimal boilerplate, great TypeScript support) + **TanStack Query** for server state (caching, refetching, optimistic updates). This combination covers most needs without Redux complexity. Context API + useReducer is fine for small apps with minimal shared state.

```tsx
// Pattern: context with split read/write to prevent unnecessary re-renders
const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
    const [state, dispatch] = useReducer(reducer, initialState);
    return (
        <DispatchContext value={dispatch}>
            <StateContext value={state}>
                {children}
            </StateContext>
        </DispatchContext>
    );
}

export function useAppState() {
    const ctx = useContext(StateContext);
    if (!ctx) throw new Error('useAppState must be used within AppProvider');
    return ctx;
}

export function useAppDispatch() {
    const ctx = useContext(DispatchContext);
    if (!ctx) throw new Error('useAppDispatch must be used within AppProvider');
    return ctx;
}
```

## Routing — React Router v7

### Framework Mode (Recommended)

Use React Router v7 in **framework mode** with file-based route modules for type-safe data loading:

```tsx
// routes/products.$pid.tsx — route module with typed loader
import type { Route } from "./+types/products.$pid";

export async function loader({ params }: Route.LoaderArgs) {
    const product = await getProduct(params.pid);
    if (!product) throw new Response("Not found", { status: 404 });
    return { product };
}

export async function action({ request, params }: Route.ActionArgs) {
    const formData = await request.formData();
    await updateProduct(params.pid, Object.fromEntries(formData));
    return { success: true };
}

export default function Product({ loaderData }: Route.ComponentProps) {
    return <div>{loaderData.product.name}</div>;
}
```

### Data Mode (Alternative)

Use `createBrowserRouter` with typed loaders/actions when not using framework mode:

```tsx
const router = createBrowserRouter([
    {
        path: '/',
        element: <Layout />,
        errorElement: <ErrorPage />,
        children: [
            { index: true, element: <Home />, loader: homeLoader },
            { path: 'orders', element: <Orders />, loader: ordersLoader },
            { path: 'orders/:id', element: <OrderDetail />, loader: orderLoader, action: orderAction },
        ],
    },
]);
```

### Navigation Patterns

- **`useFetcher<typeof loader>()`** for non-navigating data mutations (inline forms, like buttons). Note v7 generic syntax uses `typeof loader`, not `LoaderData`.
- **`useNavigation()`** for global pending UI (loading bar, spinner) during page transitions.
- **Protected routes:** Check auth in loader, throw redirect if unauthorized.
- **Error boundaries:** Use `errorElement` on routes for route-level error handling.

```tsx
// Pattern: pending UI with useNavigation
function GlobalNav() {
    const navigation = useNavigation();
    return (
        <nav>
            {navigation.state === 'loading' && <ProgressBar />}
            <Outlet />
        </nav>
    );
}

// Pattern: useFetcher for inline mutation
function LikeButton({ postId }: { postId: string }) {
    const fetcher = useFetcher<typeof action>();
    const isLiking = fetcher.state !== 'idle';
    return (
        <fetcher.Form method="post" action={`/posts/${postId}/like`}>
            <button disabled={isLiking}>{isLiking ? '...' : '♥'}</button>
        </fetcher.Form>
    );
}
```

## Suspense and Error Boundaries

### Suspense

- Wrap async components in `<Suspense fallback={<Loading />}>` for loading states.
- Use with `React.lazy()` for route-level code splitting.
- Use with `use()` hook for promise-based data reading.
- Nest Suspense boundaries: outer for the page, inner for independent sections.

```tsx
// Pattern: nested Suspense boundaries
function Dashboard() {
    return (
        <Suspense fallback={<PageSkeleton />}>
            <DashboardHeader />
            <div className="grid grid-cols-2 gap-4">
                <Suspense fallback={<CardSkeleton />}>
                    <RevenueChart />
                </Suspense>
                <Suspense fallback={<CardSkeleton />}>
                    <RecentOrders />
                </Suspense>
            </div>
        </Suspense>
    );
}
```

### Error Boundaries

- Wrap feature sections in error boundaries so failures don't crash the entire app.
- Use `react-error-boundary` library or write a class-based error boundary.
- Provide a fallback UI and a reset mechanism.

```tsx
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
    return (
        <div role="alert">
            <p>Something went wrong:</p>
            <pre>{error.message}</pre>
            <button onClick={resetErrorBoundary}>Try again</button>
        </div>
    );
}

// Usage: wrap feature sections
<ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => queryClient.clear()}>
    <OrdersFeature />
</ErrorBoundary>
```

## Forms and Validation

### Form Patterns

- **React 19 form actions:** Use the `action` prop on `<form>` with async functions for progressive enhancement.
- **Controlled inputs** with `useState` for real-time validation.
- **Uncontrolled inputs** with `FormData` for simple forms (prefer when no real-time validation needed).
- **Form libraries:** Use **React Hook Form** or **Formik** for complex forms with cross-field validation.
- **Schema validation:** **Zod** for type-safe schema validation. Derive TypeScript types from schemas.

```tsx
// Pattern: Zod schema with React Hook Form
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
    email: z.string().email('Invalid email'),
    password: z.string().min(8, 'Min 8 characters'),
});

type FormData = z.infer<typeof schema>;

function LoginForm() {
    const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
        resolver: zodResolver(schema),
    });

    return (
        <form onSubmit={handleSubmit(onSubmit)}>
            <input {...register('email')} />
            {errors.email && <span>{errors.email.message}</span>}
            <input type="password" {...register('password')} />
            {errors.password && <span>{errors.password.message}</span>}
            <button type="submit">Log in</button>
        </form>
    );
}
```

## Build and Tooling — Vite

- **Vite** as the build tool and dev server.
- **Environment variables:** Use `VITE_` prefix. Access via `import.meta.env.VITE_API_URL`. Never expose secrets without prefix.
- **Path aliases:** Configure in `vite.config.ts` under `resolve.alias` (e.g., `@/` maps to `src/`). Mirror in `tsconfig.json` `paths`.
- **Dev server proxy:** Configure `server.proxy` in Vite config for API calls to avoid CORS during development.
- **Code splitting:** Vite handles this automatically via dynamic imports. Use `React.lazy()` for route-level splitting.
- **Build optimization:** Use `build.rollupOptions.output.manualChunks` for vendor splitting when needed. Default `build.minify` uses oxc (fastest).
- **Environment modes:** `.env`, `.env.local`, `.env.production`, `.env.staging` — loaded based on `--mode` flag.

```ts
// vite.config.ts — typical React project configuration
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
        },
    },
});
```

## Testing

- **React Testing Library** + **Vitest** for all component and hook tests.
- Use `render()`, `screen`, and `userEvent` from `@testing-library/react`.
- **Test user behavior, not implementation details.** Query by role, label, text -- not by class name or test ID.
- **Mock API calls with MSW** (Mock Service Worker) for network-level mocking. Prefer over `vi.mock()` for fetch/axios.
- Test custom hooks with `renderHook()` from `@testing-library/react`.
- **Test loading and error states** — verify Suspense fallbacks and error boundaries render correctly.
- **Snapshot tests:** Use sparingly and only for stable UI. Prefer explicit assertions.

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('submits form and shows success message', async () => {
    const user = userEvent.setup();
    render(<CreateOrderForm />);

    await user.type(screen.getByLabelText('Customer'), 'Acme Corp');
    await user.selectOptions(screen.getByLabelText('Priority'), 'high');
    await user.click(screen.getByRole('button', { name: 'Create Order' }));

    await waitFor(() => {
        expect(screen.getByText('Order created successfully')).toBeInTheDocument();
    });
});

// Pattern: testing loading states
test('shows skeleton while loading', async () => {
    render(
        <Suspense fallback={<Skeleton />}>
            <AsyncComponent />
        </Suspense>
    );
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    await waitFor(() => {
        expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    });
});
```

## Concurrent Rendering

React 19 includes concurrent features that improve responsiveness for heavy UI updates:

### `startTransition` — mark non-urgent updates

```tsx
import { startTransition, useState } from 'react';

function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[]>([]);

  const handleSearch = (value: string) => {
    setQuery(value); // Urgent: update input immediately
    startTransition(() => {
      setResults(filterItems(value)); // Non-urgent: can be interrupted
    });
  };

  return (
    <>
      <input value={query} onChange={(e) => handleSearch(e.target.value)} />
      <ResultsList items={results} />
    </>
  );
}
```

### `useDeferredValue` — defer expensive re-renders

```tsx
import { useDeferredValue } from 'react';

function SearchResults({ query }: { query: string }) {
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  return (
    <div style={{ opacity: isStale ? 0.6 : 1 }}>
      <ExpensiveList query={deferredQuery} />
    </div>
  );
}
```

Use `startTransition` when you CONTROL the state update. Use `useDeferredValue` when you RECEIVE a value from a parent and want to defer the re-render it causes.

### Performance: when to memoize

- **`React.memo()`** — wrap pure child components that receive stable primitive props but re-render due to parent state changes
- **`useMemo()`** — expensive computations (filtering large arrays, complex derivations). Do NOT memoize cheap operations.
- **`useCallback()`** — callback passed to memoized children or added to dependency arrays. Not needed for every handler.

The rule: profile first, memoize second. Premature memoization adds complexity without measurable benefit.

## Common Pitfalls -- NEVER Rules

- **NEVER** use class components -- always use function components with hooks.
- **NEVER** mutate state directly -- always use the setter function from useState or dispatch from useReducer.
- **NEVER** use useEffect for derived state -- use useMemo instead.
- **NEVER** forget cleanup in useEffect -- return a cleanup function for subscriptions, timers, and abort controllers.
- **NEVER** use index as key in lists that reorder -- use a stable unique identifier.
- **NEVER** call hooks conditionally or inside loops -- hooks must be at the top level (exception: `use()` can be conditional).
- **NEVER** store derived state in useState -- compute it with useMemo from the source state.
- **NEVER** use `any` type in TypeScript -- define proper interfaces and types.
- **NEVER** fetch data in useEffect without an abort controller -- always handle cleanup to prevent state updates on unmounted components.
- **NEVER** create inline objects or arrays in JSX props -- they create new references on every render, causing unnecessary child re-renders.
- **NEVER** expose secrets in `import.meta.env` without `VITE_` prefix -- unprefixed vars are not available client-side, but setting `envPrefix` to empty string is a security risk.
- **NEVER** use `useFormState` -- it's deprecated in React 19. Use `useActionState` instead.
- **NEVER** use `useFetcher<DataType>()` -- React Router v7 requires `useFetcher<typeof loader>()` with the function type.

## Must-Haves

- **TypeScript everywhere.** All components, hooks, utilities, and tests are written in TypeScript with strict mode enabled. No `.js` or `.jsx` files in the source tree.
- **Function components only.** Every React component is a plain function with a typed props interface. No class components.
- **Custom hooks for stateful logic.** Extract reusable stateful logic into custom hooks (`use*` prefix). Components orchestrate hooks, not contain raw logic.
- **TDD with Vitest.** All features developed test-first using Vitest and React Testing Library.
- **Stable key props on lists.** Every list element has a stable, unique `key` derived from domain data -- never from array index in dynamic lists.
- **Explicit return types on public APIs.** Exported functions, hooks, and props interfaces have explicit types.
- **Cleanup in useEffect.** Every useEffect with subscriptions, timers, or async must return a cleanup function.
- **Error boundaries around features.** Each major feature section wrapped in an error boundary to prevent cascading failures.
- **Abort controllers on async operations.** All fetch calls in useEffect use AbortController. All React Router loaders handle abort signals.

## Good Practices

- **Composition over prop drilling.** Pass components as children or render props instead of threading data through layers.
- **React.memo for expensive children.** Wrap child components receiving stable props when parent re-renders frequently.
- **useCallback for stable references.** Wrap callbacks passed to memoized children or effect dependency arrays.
- **Split components at responsibility boundaries.** Layout + data fetching = two components.
- **Colocate state with consumers.** Keep state in the lowest common ancestor.
- **Prefer useMemo for derived data.** Never store derived values in separate state.
- **Lazy load heavy routes.** Use `React.lazy` + `Suspense` for route-level code splitting.
- **Use the project's state library.** Check `package.json` first — follow established patterns, don't introduce new libraries.
- **Optimistic updates for better UX.** Use `useOptimistic` for mutations that should feel instant.
- **Form validation with Zod.** Type-safe schemas that derive both runtime validation and TypeScript types.
- **Nested Suspense boundaries.** Outer for page, inner for independent data-loading sections.

## Common Bugs

- **Stale closure in useEffect.** Referencing state/props inside useEffect without including them in the dependency array captures outdated values.
- **Missing dependency array entries.** Omitting dependencies from useEffect/useMemo/useCallback leads to stale data or skipped updates.
- **Mutating state directly.** Modifying state objects in-place doesn't trigger re-render. Always spread or use immutable helpers.
- **Missing key prop in lists.** No key or unstable key causes DOM thrashing and lost component state.
- **Async state update after unmount.** Fetch completing after unmount calls setState on dead component. Use AbortController.
- **Dependency array with object/array literals.** `[{ id }]` creates new ref every render → infinite loops. Stabilize with useMemo.
- **Forgetting loading and error states.** Async data without explicit loading/error handling leaves UI inconsistent.
- **useFormState instead of useActionState.** React 19 deprecated useFormState. Code using it will show warnings.
- **useFetcher with data type generic.** React Router v7 changed from `useFetcher<DataType>()` to `useFetcher<typeof loader>()`.
- **Stale optimistic state.** Not rolling back `useOptimistic` on server error leaves ghost data in the UI.

## Anti-Patterns

- **Class components.** Cannot use hooks, add unnecessary complexity. Always use function components.
- **Using `any` type.** Disables type checking and hides bugs. Use proper interfaces, generics, or `unknown`.
- **Inline object creation in JSX props.** Creates new reference every render, defeats React.memo.
- **Mixing concerns in components.** API calls + state + business logic + presentation in one component = untestable.
- **useEffect for derived state.** Watch state A → set state B = extra render + sync bugs. Use useMemo.
- **Prop drilling through 3+ layers.** Refactor with composition, context, or state library.
- **Giant monolithic components.** 250+ lines = extract sub-components or custom hooks.
- **Business logic in visual components.** API calls, data transforms, complex validation, state machines belong in custom hooks. Components call hooks and render JSX — nothing else.
- **Overusing useEffect.** React 19 reduces the need for many useEffect patterns. Form submissions → use Actions. Data fetching → use loaders or TanStack Query. Derived state → use useMemo.
- **Wrapping everything in useMemo/useCallback.** Premature optimization adds complexity. Only memoize when profiling shows a re-render problem.
- **Ignoring React Compiler.** React 19 Compiler auto-memoizes. Don't manually memo what the compiler handles.

## Standards

- **PascalCase for component files.** `OrderList.tsx`, `UserProfile.tsx`, `AuthProvider.tsx`. Non-component utilities use camelCase: `formatDate.ts`, `apiClient.ts`.
- **camelCase hooks with `use` prefix.** `useAuth.ts`, `usePagination.ts`, `useDebounce.ts`.
- **Barrel exports via index.ts.** Feature directories export public API through `index.ts`. Internal details not re-exported.
- **Colocate tests with source files.** `OrderList.tsx` and `OrderList.test.tsx` in the same directory.
- **Props interfaces named with `Props` suffix.** `CardProps`, `OrderListProps`, `ModalProps`.
- **One component per file.** Helper sub-components may be defined in the same file but not exported.
- **Absolute imports via path alias.** Use `@/` for all imports from `src/`. Never use relative paths that climb more than one level.
- **Feature-based directory structure.** Group by feature, not by type:
  ```
  src/
    features/
      orders/
        OrderList.tsx
        OrderList.test.tsx
        OrderDetail.tsx
        useOrders.ts
        orderApi.ts
        index.ts
      auth/
        LoginForm.tsx
        useAuth.ts
        authApi.ts
        index.ts
    hooks/          (shared hooks)
    components/     (shared UI components)
    lib/            (utilities, api client, constants)
  ```

## Context7 Instructions

When looking up framework documentation, use these Context7 library identifiers:

- **React:** `/facebook/react` (use version `/facebook/react/v19_1_1` for React 19 specifics)
- **React Router:** `/websites/reactrouter` -- routing, loaders, actions, navigation, framework mode
- **Vite:** `/websites/vite_dev` -- configuration, build, environment variables, plugins
- **Vitest:** `vitest-dev/vitest` -- test runner, assertions, mocking, configuration
- **Testing Library:** `testing-library/react-testing-library` -- render, screen, queries, user events

Always check Context7 for the latest API when working with React 19 features (useActionState, useOptimistic, use(), form actions). Training data may be outdated.
