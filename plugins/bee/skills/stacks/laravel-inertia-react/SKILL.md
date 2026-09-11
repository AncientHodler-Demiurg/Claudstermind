---
name: laravel-inertia-react
description: Laravel 12 + Inertia 2 + React 19 + TailwindCSS conventions and patterns
---

# Laravel + Inertia + React Standards

These standards apply when the project stack is `laravel-inertia-react`. All agents and implementations must follow these conventions.

**Also read `skills/standards/frontend/SKILL.md`** for universal frontend standards (component architecture, accessibility, responsive design, CSS methodology, design quality) that apply alongside these Laravel+React-specific conventions.

## Laravel 12 Conventions

### Controllers

- **Single responsibility:** Each controller handles one resource or one logical concern.
- **Resource controllers** for CRUD operations: `index`, `create`, `store`, `show`, `edit`, `update`, `destroy`.
- **Form requests** for ALL validation. Never validate inline in controllers.
- Controllers are thin -- they accept a request, delegate to a service, and return a response.
- NEVER put business logic in controllers. Controllers orchestrate; services implement.
- Return Inertia responses via `Inertia::render('Page/Name', $props)`.
- **Authorization:** ALWAYS use `Gate::authorize()` -- NEVER `$request->user()->can()` + `abort(403)` or `auth()->user()->can()`.
- **Dual-response:** When an action is called by both `router.put()` (Inertia, from Edit pages) AND `axios.put()` (sub-resource modals), use `$request->wantsJson()` to return `JsonResponse` for axios and `RedirectResponse` for Inertia. Return type: `JsonResponse|RedirectResponse`.

```php
// Pattern: thin controller with Gate::authorize and dual-response
public function update(UpdateOrderRequest $request, Order $order): JsonResponse|RedirectResponse
{
    Gate::authorize('update', $order);
    $order = app(OrderService::class)->update($order, $request->validated());

    if ($request->wantsJson()) {
        return response()->json(['message' => __('models.order.updated')]);
    }
    return redirect()->route('orders.edit', $order);
}

public function store(StoreOrderRequest $request, OrderService $service): RedirectResponse
{
    Gate::authorize('create', Order::class);
    $order = $service->create($request->validated());
    return redirect()->route('orders.show', $order);
}
```

### Models

- Define **relationships** explicitly: `hasMany`, `belongsTo`, `belongsToMany`, `morphMany`, etc.
- Use **scopes** for reusable query constraints: `scopeActive`, `scopeByUser`.
- Use **accessors and mutators** via Attribute class for computed or transformed fields.
- Use `$casts` for type casting (dates, enums, JSON, booleans).
- Keep models lean -- no business logic. Models define data shape and relationships.
- Always define `$fillable` or `$guarded` for mass assignment protection.
- **Search scope:** ALWAYS include `scopeWithSearch()` on models that appear in index/list views.
- **Sortable trait:** Use `WithSortableScope` from `App\Models\Traits\` -- NEVER `App\Traits\`.

```php
use App\Models\Traits\WithSortableScope;

class Order extends Model
{
    use HasFactory, WithSortableScope;

    protected $fillable = ['client_id', 'status', 'total', 'notes'];

    protected $casts = [
        'status' => OrderStatus::class,
        'metadata' => 'array',
        'shipped_at' => 'datetime',
        'total' => 'decimal:2',
    ];

    // Search scope -- required for index controllers
    public function scopeWithSearch(Builder $q, ?string $s, array $cols = ['name']): Builder
    {
        if (! $s) return $q;
        return $q->where(fn (Builder $q) =>
            collect($cols)->each(fn ($c) => $q->orWhere($c, 'like', "%{$s}%"))
        );
    }

    // Sorting -- provided by WithSortableScope trait
    // scopeWithSorting(?string $sortDef, ?string $defaultSort)

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }
}
```

### Routes

- **RESTful naming:** Use resource routes (`Route::resource`) when possible.
- **Route model binding:** Type-hint models in controller methods for automatic resolution.
- **Middleware groups:** Apply auth, verified, and role-based middleware at the route group level.
- **Route naming:** All routes must have names (`->name('orders.index')`).
- Group related routes with prefixes and middleware.
- API routes go in `routes/api.php`; web routes in `routes/web.php`.
- **Ordering:** Search endpoints BEFORE resource routes. Model-binding routes BEFORE static routes.

```php
// Search endpoint BEFORE resource route
Route::get('clients/search', [ClientController::class, 'search'])->name('clients.search');
Route::resource('clients', ClientController::class);

// Resource patterns
Route::resource('orders', OrderController::class)->only(['index', 'store', 'update', 'destroy']);
Route::resource('orders', OrderController::class)->except(['create']);
Route::apiResource('orders.items', OrderItemController::class)->except(['show']);

// Model-binding route BEFORE static route (action controllers)
Route::post('orders/{order}/actions/void', [OrderActionController::class, 'voidSingle']);
Route::post('orders/actions/void', [OrderActionController::class, 'void']);
```

#### Wayfinder (Optional -- Route Generation)

If the project uses Wayfinder for type-safe route URLs:

- **Generate:** `php artisan wayfinder:generate` (run after ANY route changes)
- **Import pattern:** `import { index, edit, show } from '@/actions/App/Http/Controllers/OrderController'`
- **Usage:** `edit.url({ order: id })` produces `"/orders/1/edit"`
- **With query:** `index.url({}, { query: { page: 2 } })` produces `"/orders?page=2"`
- **Current URL:** `usePage().url` -- NEVER `route().current()`

### Services

- Extract **business logic** into dedicated service classes (e.g., `OrderService`, `PaymentService`).
- Services are injected into controllers via **dependency injection** (constructor or method injection).
- Services handle orchestration: validation logic, database operations, event dispatching, external API calls.
- Keep services focused -- one service per domain concern.
- Services should be testable in isolation (no HTTP dependencies).

#### Dependency Injection Rules

```
IF service used in 2+ methods   --> constructor injection (protected property)
IF service used in 1 method     --> method parameter injection
IF method must match parent signature --> constructor injection (even if 1 method)
Listeners / Observers           --> ALWAYS constructor injection (handle/observer signatures are fixed)
Traits                          --> app() inline is acceptable (traits cannot have constructors)
```

```php
// 2+ methods --> constructor injection
class OrderController
{
    public function __construct(protected OrderService $service) {}

    public function store(StoreOrderRequest $request): RedirectResponse
    {
        $order = $this->service->create($request->validated());
        return redirect()->route('orders.show', $order);
    }
}

// 1 method --> method parameter injection
public function autoAllocate(Request $request, AllocationService $svc): JsonResponse
{
    $svc->autoAllocate($request->validated());
    return response()->json(['message' => __('models.allocation.created')]);
}

// Listener (handle signature is fixed by Laravel)
class OrderCreatedListener
{
    public function __construct(private readonly NotificationService $svc) {}
    public function handle(OrderCreated $event): void { /* ... */ }
}
```

### Events and Listeners

- Use **events** for side effects that should not block the main flow (emails, notifications, audit trails).
- Events are dispatched from services, not controllers. Name as past-tense: `OrderCreated`, `PaymentProcessed`.
- Listeners handle the side effect and can be queued for async processing.
- **Laravel 12 auto-discovery:** Listeners in `app/Listeners/` are auto-discovered via `handle(Event $event)` type-hint. NEVER use `Event::listen()` in AppServiceProvider (causes duplicates).
- **Verify registration:** `php artisan event:list --event=App\\Events\\YourEvent` -- should show exactly ONE listener.

### Migrations

- Migrations are **immutable** once deployed -- never edit a deployed migration.
- Always include `down()` method. Define foreign key constraints with `constrained()`.
- Add indexes for columns used in WHERE clauses, JOINs, and ORDER BY.

### Enums

- Use **PHP 8.1+ backed enums** for fixed sets of values (statuses, types, roles).
- Enums are string-backed for readability. Define in `app/Enums/` directory.

## Inertia 2 Deep Dive

### Pages

- Inertia pages are **React components** that receive props from Laravel controllers.
- Controllers render pages via `Inertia::render('Orders/Index', ['orders' => $orders])`.
- Page components live in `resources/js/Pages/` with PascalCase directory structure matching the render path.
- Props are typed via TypeScript interfaces on the component function parameters.

```tsx
// Pattern: Inertia page component with typed props
interface Props {
    orders: Order[];
    filters: { search: string; status: string };
}

export default function Index({ orders, filters }: Props) {
    return (
        <div>
            <h1>Orders</h1>
            {orders.map((order) => (
                <OrderCard key={order.id} order={order} />
            ))}
        </div>
    );
}
```

### Shared Data and usePage()

- Use `HandleInertiaRequests` middleware for data shared across all pages.
- Shared data includes: authenticated user, flash messages, app name, permissions.
- Access shared data via `usePage().props` in any component.
- Keep shared data minimal -- only what most pages need.

```tsx
import { usePage } from '@inertiajs/react';

// Access auth user, flash messages, and app config from anywhere
export default function Layout({ children }: { children: React.ReactNode }) {
    const { auth, flash } = usePage().props;

    return (
        <main>
            <header>Logged in as: {auth.user.name}</header>
            {flash.success && <div className="alert-success">{flash.success}</div>}
            <article>{children}</article>
        </main>
    );
}
```

### useForm() Hook -- Primary Form Tool

Use `useForm()` from `@inertiajs/react` for ALL form submissions. It provides reactive data binding, processing state, error handling, dirty tracking, and automatic CSRF.

```tsx
import { useForm } from '@inertiajs/react';

export default function CreateOrder() {
    const { data, setData, post, processing, errors, reset, transform } = useForm<{
        client_id: number | '';
        notes: string;
        items: Array<{ product_id: number; quantity: number }>;
    }>({
        client_id: '',
        notes: '',
        items: [],
    });

    function submit(e: React.FormEvent) {
        e.preventDefault();
        post(route('orders.store'), {
            preserveScroll: true,
            onSuccess: () => reset(),
        });
    }

    return (
        <form onSubmit={submit}>
            <select
                value={data.client_id}
                onChange={(e) => setData('client_id', Number(e.target.value))}
            >
                <option value="">Select client</option>
                {/* options */}
            </select>
            {errors.client_id && <span className="text-red-500 text-sm">{errors.client_id}</span>}

            <textarea
                value={data.notes}
                onChange={(e) => setData('notes', e.target.value)}
            />
            {errors.notes && <span className="text-red-500 text-sm">{errors.notes}</span>}

            <button type="submit" disabled={processing}>
                {processing ? 'Saving...' : 'Create Order'}
            </button>
        </form>
    );
}
```

**useForm key features:**

- `data` / `setData(key, value)` -- reactive form state
- `post(url)`, `put(url)`, `patch(url)`, `delete(url)` -- HTTP methods
- `processing` -- boolean, true while request is in-flight
- `errors` -- object with server validation errors keyed by field name
- `reset()` / `reset('field')` -- reset all or specific fields to initial values
- `transform(callback)` -- modify data before submission (e.g., extract `.id` from objects)
- `isDirty` -- boolean, true if any field has changed from initial values
- `clearErrors()` / `clearErrors('field')` -- clear validation errors

**File uploads with useForm:**

```tsx
const { data, setData, post, progress } = useForm<{ avatar: File | null }>({
    avatar: null,
});

<input type="file" onChange={(e) => setData('avatar', e.target.files?.[0] ?? null)} />
{progress && <progress value={progress.percentage} max="100">{progress.percentage}%</progress>}
```

### Programmatic Navigation with router

Use the `router` object for navigation outside of JSX links.

```tsx
import { router } from '@inertiajs/react';

// Navigate to a new page
router.visit('/orders');
router.visit(route('orders.edit', order.id));

// Shorthand methods (include data as second arg)
router.get('/orders', { search: 'pending' });
router.post('/orders', { client_id: 1, notes: 'Rush order' });
router.put(route('orders.update', order.id), { status: 'shipped' });
router.delete(route('orders.destroy', order.id));

// With options
router.post(route('orders.store'), formData, {
    preserveScroll: true,
    preserveState: true,
    onSuccess: () => { /* handle success */ },
    onError: (errors) => { /* handle validation errors */ },
});
```

### Partial Reloads

Reload specific props without fetching all page data. Reduces bandwidth and improves performance for paginated data, search results, and filtered lists.

```tsx
import { router } from '@inertiajs/react';

// Reload only the 'orders' prop
router.reload({ only: ['orders'] });

// Reload everything except a heavy prop
router.reload({ except: ['analytics'] });

// Partial reload with Link component
<Link href="/orders?status=active" only={['orders']}>Show active</Link>

// Combine with search -- reload only filtered data
function handleSearch(query: string) {
    router.get(route('orders.index'), { search: query }, {
        preserveState: true,
        preserveScroll: true,
        only: ['orders'],
    });
}
```

### Persistent Layouts

Keep layout state (scroll position, sidebar state, audio players) alive across page navigations. Define the layout as a static property on the page component.

```tsx
import AppLayout from '@/Layouts/AppLayout';

export default function Index({ orders }: Props) {
    return (
        <div>
            <h1>Orders</h1>
            {/* page content */}
        </div>
    );
}

// Persistent layout -- NOT re-mounted on navigation between pages that share this layout
Index.layout = (page: React.ReactNode) => <AppLayout>{page}</AppLayout>;
```

For nested persistent layouts:

```tsx
Index.layout = (page: React.ReactNode) => (
    <AppLayout>
        <DashboardLayout>{page}</DashboardLayout>
    </AppLayout>
);
```

### Deferred Props

Load heavy data lazily after the initial page render. The server sends the page immediately, then fetches deferred props in a follow-up request.

```php
// Controller -- defer heavy props
use Inertia\Inertia;

public function show(Order $order): \Inertia\Response
{
    return Inertia::render('Orders/Show', [
        'order' => $order->load('client'),
        'analytics' => Inertia::defer(fn () => $this->analyticsService->forOrder($order)),
        'auditLog' => Inertia::defer(fn () => $order->auditLogs()->latest()->paginate(20)),
    ]);
}
```

```tsx
// React -- use WhenVisible or check for undefined
import { WhenVisible } from '@inertiajs/react';

export default function Show({ order, analytics, auditLog }: Props) {
    return (
        <div>
            <OrderDetails order={order} />

            {/* Render analytics once loaded */}
            {analytics ? <AnalyticsPanel data={analytics} /> : <Skeleton />}

            {/* Or use WhenVisible for viewport-triggered loading */}
            <WhenVisible fallback={<Skeleton />} data="auditLog">
                <AuditLogTable entries={auditLog} />
            </WhenVisible>
        </div>
    );
}
```

### Shared Data from HandleInertiaRequests Middleware

```php
// app/Http/Middleware/HandleInertiaRequests.php
public function share(Request $request): array
{
    return [
        ...parent::share($request),
        'auth' => [
            'user' => $request->user() ? [
                'id' => $request->user()->id,
                'name' => $request->user()->name,
                'email' => $request->user()->email,
                'abilities' => $request->user()->abilities ?? [],
            ] : null,
        ],
        'flash' => [
            'success' => $request->session()->get('success'),
            'error' => $request->session()->get('error'),
        ],
    ];
}
```

## React 19 Patterns

### Core Hooks

- `useState` for local reactive state. Always use the setter function, never mutate directly.
- `useEffect` for side effects (subscriptions, timers, DOM manipulation). Always return a cleanup function when needed.
- `useMemo` for expensive derived values. Use instead of storing derived state in useState.
- `useCallback` for stable function references passed to child components.
- `useRef` for mutable values that do not trigger re-renders (DOM refs, timers, previous values).

```tsx
// Pattern: hooks usage in an Inertia page
const [search, setSearch] = useState(filters.search ?? '');
const filteredOrders = useMemo(
    () => orders.filter((o) => o.name.toLowerCase().includes(search.toLowerCase())),
    [orders, search]
);

useEffect(() => {
    const timer = setTimeout(() => {
        router.get(route('orders.index'), { search }, {
            preserveState: true,
            preserveScroll: true,
            only: ['orders'],
        });
    }, 300);
    return () => clearTimeout(timer);
}, [search]);
```

### React 19 Hooks

- **`use()`** -- read promises and context directly in render. Replaces `useContext` for context reading. Can be called conditionally (unique among hooks).
- **`useActionState(fn, initialState)`** -- manage form action state with automatic pending tracking. Returns `[state, formAction, isPending]`. Note: Inertia's `useForm()` is usually preferred for server-submitted forms because it integrates with Inertia's error handling and navigation. Use `useActionState` for client-side-only actions or non-Inertia endpoints.
- **`useOptimistic(state, updateFn)`** -- optimistic UI updates during async actions. Show the expected result immediately, roll back on failure.
- **`useFormStatus()`** (from `react-dom`) -- read parent form submission status. Use in submit buttons to show loading state.

```tsx
// Pattern: useOptimistic with Inertia for inline toggle
import { useOptimistic } from 'react';
import { router } from '@inertiajs/react';

function OrderRow({ order }: { order: Order }) {
    const [optimisticOrder, setOptimistic] = useOptimistic(order, (current, newStatus: string) => ({
        ...current,
        status: newStatus,
    }));

    function toggleStatus() {
        const newStatus = optimisticOrder.status === 'active' ? 'paused' : 'active';
        setOptimistic(newStatus);
        router.put(route('orders.update', order.id), { status: newStatus }, {
            preserveScroll: true,
        });
    }

    return (
        <tr>
            <td>{optimisticOrder.status}</td>
            <td><button onClick={toggleStatus}>Toggle</button></td>
        </tr>
    );
}
```

### Props, Custom Hooks, and use() Prefix

- Destructure props in the function signature. Use `children` for composition. Callback props for child-to-parent communication.
- Extract reusable logic into custom hooks (`useFilters()`, `useDebounce()`, `usePagination()`). Hooks follow `use*` naming and live in `resources/js/Hooks/`.
- A custom hook returns state and functions -- it is a self-contained unit of logic.

```tsx
// Pattern: custom hook for debounced Inertia search
function useInertiaSearch(routeName: string, propKey: string, delay = 300) {
    const { url } = usePage();
    const params = new URLSearchParams(url.split('?')[1] || '');
    const [search, setSearch] = useState(params.get('search') ?? '');

    useEffect(() => {
        const timer = setTimeout(() => {
            router.get(route(routeName), { search }, {
                preserveState: true,
                preserveScroll: true,
                only: [propKey],
            });
        }, delay);
        return () => clearTimeout(timer);
    }, [search]);

    return { search, setSearch };
}
```

## State Management

### Inertia Page Props as Primary State Source

In an Inertia application, the **server is the source of truth**. Page props delivered via `Inertia::render()` are the primary state. Local React state should only be used for UI concerns (open/close, search input, selected items).

**Do NOT duplicate server state into React state.** If you need to modify displayed data, use `useMemo` to derive it from props. If you need to submit changes, use `useForm()`.

### When to Use External Stores

**Detect what the project uses** -- check `package.json` for installed state management libraries and follow THAT library's conventions. Do NOT introduce a different state library than what the project already uses.

- **Zustand** -- lightweight stores. Use for client-only state that persists across Inertia page navigations (shopping cart, UI preferences, notification queue). Create typed stores, use selectors: `useStore(selector)` over `useStore()`.
- **TanStack Query** -- for data that lives outside Inertia's page model (real-time feeds, polling endpoints, non-Inertia API calls). Do NOT use TanStack Query for data already provided by Inertia page props.
- **Redux / RTK** -- if installed, use RTK slices, `createAsyncThunk` for async, RTK Query for server state. Never mutate outside Immer.
- **Context API + useReducer** -- for lightweight shared state (theme, locale) when no external library is installed. Split read/write contexts for performance.

**If no external store is installed:** Inertia page props + local useState + Context API cover most needs. Only add an external library when you have a clear use case the existing tools cannot handle.

**Key rule:** Match the project. If the project uses Zustand, write Zustand. If it uses Redux, write Redux. Never mix state libraries without explicit user direction.

## Forms and Validation

### Inertia useForm() -- Primary Choice

Use `useForm()` from `@inertiajs/react` for ALL forms that submit to Laravel. It automatically handles CSRF, validation error mapping, processing state, and Inertia navigation.

### React Hook Form + Zod -- Alternative for Complex Client-Side Validation

For forms requiring complex client-side validation (cross-field rules, real-time feedback, multi-step wizards), use React Hook Form with Zod. Submit via `router.post()` or `axios` after client-side validation passes.

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { router } from '@inertiajs/react';

const schema = z.object({
    email: z.string().email('Invalid email'),
    phone: z.string().optional(),
}).refine((d) => d.email || d.phone, {
    message: 'Email or phone is required',
    path: ['email'],
});

type FormValues = z.infer<typeof schema>;

function ContactForm() {
    const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
        resolver: zodResolver(schema),
    });

    const onSubmit = (values: FormValues) => {
        router.post(route('contacts.store'), values);
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)}>
            <input {...register('email')} />
            {errors.email && <span className="text-red-500">{errors.email.message}</span>}
            <button type="submit">Save</button>
        </form>
    );
}
```

### Server-Side Validation Error Display Pattern

Inertia automatically maps Laravel validation errors to `form.errors`. Display them inline next to each field.

```tsx
// Reusable error component
function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return <p className="mt-1 text-sm text-red-600">{message}</p>;
}

// Usage with useForm
<input
    value={data.name}
    onChange={(e) => setData('name', e.target.value)}
    className={errors.name ? 'border-red-500' : 'border-gray-300'}
/>
<FieldError message={errors.name} />
```

### File Uploads

```tsx
const { data, setData, post, progress } = useForm<{ document: File | null }>({
    document: null,
});

function submit(e: React.FormEvent) {
    e.preventDefault();
    post(route('documents.store'), {
        forceFormData: true, // ensure multipart encoding
    });
}

<input type="file" onChange={(e) => setData('document', e.target.files?.[0] ?? null)} />
{progress && <div className="w-full bg-gray-200 rounded">
    <div className="bg-blue-600 h-2 rounded" style={{ width: `${progress.percentage}%` }} />
</div>}
```

## Component Conventions

### Architecture Rules

- **Max 250 lines per visual component.** If larger, extract sub-components or custom hooks.
- **No business logic in visual components.** Components render UI only. Extract data fetching, transformations, validation, and state machines into custom hooks. Components orchestrate hooks and render JSX -- nothing else.
- **Function components only.** All components are plain functions with TypeScript interfaces for props.
- **Composition over inheritance:** Use children, render props, and compound components.

### Directory Structure

```
resources/js/
    Pages/              -- Inertia page components (match controller render paths)
        Orders/
            Index.tsx
            Show.tsx
            Edit.tsx
    Components/         -- Shared reusable UI components
        OrderCard.tsx
        DataTable.tsx
        FieldError.tsx
    Layouts/            -- Persistent layouts
        AppLayout.tsx
        DashboardLayout.tsx
    Hooks/              -- Custom hooks (use* naming)
        useDebounce.ts
        useFilters.ts
        useInertiaSearch.ts
    types/              -- TypeScript interfaces and types
        models.ts
        index.d.ts
```

### Pages vs Components vs Layouts

- **Pages** receive props from Laravel controllers. They define the page structure and wire up hooks. They set `Page.layout` for persistent layouts.
- **Components** are reusable UI building blocks. They receive data via props, never via `usePage()` (exception: layout components that need auth data).
- **Layouts** wrap pages and provide persistent chrome (navigation, sidebar, footer). They use the persistent layout pattern to avoid re-mounting on navigation.

## DataTable with TanStack Table

Use `@tanstack/react-table` for all tabular data. Define columns in a separate `columns.tsx` file for reusability.

### Column definitions

```tsx
// columns.tsx
import { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/utils/dates';

export const columns: ColumnDef<Order>[] = [
  {
    accessorKey: 'reference',
    header: 'Reference',
    cell: ({ row }) => (
      <Link href={`/orders/${row.original.id}`} className="font-medium hover:underline">
        {row.getValue('reference')}
      </Link>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={row.getValue('status') === 'active' ? 'default' : 'secondary'}>
        {row.getValue('status')}
      </Badge>
    ),
  },
  {
    accessorKey: 'total',
    header: () => <div className="text-right">Total</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium">
        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(row.getValue('total'))}
      </div>
    ),
  },
  {
    accessorKey: 'created_at',
    header: 'Date',
    cell: ({ row }) => formatDate(row.getValue('created_at')),
  },
];
```

### Table actions (row actions, bulk actions)

```tsx
// Row actions with dropdown
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';

{
  id: 'actions',
  cell: ({ row }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.visit(`/orders/${row.original.id}/edit`)}>Edit</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleVoid(row.original.id)} className="text-destructive">Void</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
```

### Server-side pagination with Inertia

```tsx
// Controller passes paginated data
// React component controls page state via Inertia router
const handlePageChange = (page: number) => {
  router.get(window.location.pathname, { page, ...filters }, { preserveState: true, preserveScroll: true });
};
```

### Table action patterns (Golden Rule)

| Action Scope | Pattern | Backend Route |
|-------------|---------|---------------|
| Single row | Dropdown menu item → `router.post()` | `POST /orders/{order}/actions/void` |
| Bulk selection | Toolbar button → `router.post()` with IDs | `POST /orders/actions/void` (body: `{ ids: [...] }`) |
| Navigate | Link or `router.visit()` | `GET /orders/{order}/edit` |
| Inline edit | Cell with editable state | `PATCH /orders/{order}` |

## TailwindCSS Conventions

- Use Tailwind utility classes directly in JSX. This is the primary styling approach.
- Avoid `@apply` in most cases -- extract to React components instead when utility strings repeat.
- Define project design tokens in `tailwind.config.js` under `theme.extend` with semantic naming.
- Mobile-first approach: base styles for mobile, breakpoints (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) for larger screens.

## Testing Patterns

### PHP Testing (Pest)

- **Feature tests** for HTTP layer: controller actions, middleware, redirects, Inertia responses.
- **Unit tests** for business logic: services, value objects, model scopes.
- Use `assertInertia()` for testing Inertia page responses, props, and component rendering.
- Use model factories for test data setup.
- Database transactions for test isolation (`RefreshDatabase` trait).

```php
it('displays the orders list', function () {
    $orders = Order::factory()->count(3)->create();

    $this->actingAs(User::factory()->create())
        ->get(route('orders.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->component('Orders/Index')
            ->has('orders', 3)
        );
});

it('validates required fields on store', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('orders.store'), [])
        ->assertSessionHasErrors(['client_id', 'status']);
});

it('authorizes before updating', function () {
    $order = Order::factory()->create();
    $user = User::factory()->create(); // user without permission

    $this->actingAs($user)
        ->put(route('orders.update', $order), ['status' => 'shipped'])
        ->assertForbidden();
});
```

### React Testing (Vitest + React Testing Library)

- Test component rendering, user interactions, and callback invocations.
- Use `render()`, `screen`, and `userEvent` from `@testing-library/react`.
- **Mock Inertia's `usePage()` and `useForm()`** in tests.
- Test custom hooks independently using `renderHook()`.
- Test user behavior, not implementation details. Query by role, label, text -- not by class name or test ID.

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

// Mock Inertia hooks
vi.mock('@inertiajs/react', () => ({
    usePage: () => ({
        props: {
            auth: { user: { id: 1, name: 'Test User' } },
            flash: {},
        },
        url: '/orders',
    }),
    useForm: () => ({
        data: { name: '', email: '' },
        setData: vi.fn(),
        post: vi.fn(),
        processing: false,
        errors: {},
        reset: vi.fn(),
    }),
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
    router: { visit: vi.fn(), reload: vi.fn(), get: vi.fn() },
}));

test('submits the form with order data', async () => {
    const user = userEvent.setup();
    render(<CreateOrder clients={mockClients} />);

    await user.type(screen.getByLabelText('Notes'), 'Rush delivery');
    await user.click(screen.getByRole('button', { name: /create order/i }));

    expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('orders'));
});
```

### Testing Inertia Pages with Mocked Props

```tsx
test('renders order list from Inertia props', () => {
    const orders = [
        { id: 1, name: 'Order A', status: 'active' },
        { id: 2, name: 'Order B', status: 'pending' },
    ];

    render(<Index orders={orders} filters={{ search: '', status: '' }} />);

    expect(screen.getByText('Order A')).toBeInTheDocument();
    expect(screen.getByText('Order B')).toBeInTheDocument();
});
```

## Common Pitfalls -- NEVER Rules

### Laravel

1. **NEVER** put business logic in controllers -- use service classes.
2. **NEVER** skip form request validation -- every `store()` and `update()` needs a FormRequest.
3. **NEVER** use `auth()->user()->can()` or `$request->user()->can()` + `abort(403)` -- ALWAYS use `Gate::authorize()`.
4. **NEVER** use raw SQL without parameterized queries -- use Eloquent or the query builder.
5. **NEVER** skip eager loading -- use `with()` to prevent N+1 query problems.
6. **NEVER** hardcode configuration values -- use `.env` and `config()`.
7. **NEVER** return sensitive data in Inertia props -- filter to only what the page needs.
8. **NEVER** forget `scopeWithSearch()` on models used in index views.
9. **NEVER** use wrong trait path -- it is `App\Models\Traits\WithSortableScope`, NOT `App\Traits\`.
10. **NEVER** use `Event::listen()` in AppServiceProvider -- Laravel 12 auto-discovers listeners.

### React

11. **NEVER** use class components -- always use function components with hooks.
12. **NEVER** mutate state directly -- always use the setter function from useState.
13. **NEVER** use useEffect for derived state -- use useMemo instead.
14. **NEVER** forget cleanup in useEffect -- return a cleanup function for subscriptions, timers, and abort controllers.
15. **NEVER** use index as key in lists that reorder -- use a stable unique identifier.
16. **NEVER** use `any` type in TypeScript -- define proper interfaces and types.
17. **NEVER** use `useFormState` -- it is deprecated in React 19. Use `useActionState` instead.
18. **NEVER** create inline objects or arrays in JSX props -- they create new references every render, breaking React.memo.

### Inertia

19. **NEVER** use raw `fetch` or `axios` for form submissions that should navigate -- use `useForm()` or `router.post()`. Raw HTTP calls bypass Inertia's page management, CSRF handling, and error routing.
20. **NEVER** forget to use partial reloads for filtered lists and paginated data -- full page data transfer on every filter change is wasteful.
21. **NEVER** use `router.visit()` with method argument when shorthand exists -- use `router.get()`, `router.post()`, `router.put()`, `router.delete()` for clarity.
22. **NEVER** access shared data by passing it through props chains -- use `usePage().props` in any component that needs auth or flash data.
23. **NEVER** mutate Inertia page props directly -- props are read-only snapshots. Copy to `useState` if you need local modifications.

## Must-Haves

These are non-negotiable requirements for every feature implementation.

- **FormRequest for all validation.** Every `store()` and `update()` controller method must use a dedicated FormRequest class. Never validate inline.
- **Gate::authorize for authorization.** Always use `Gate::authorize()`. Never use `$request->user()->can()` + `abort(403)`.
- **TypeScript interfaces for all props.** Every Inertia page component must define a TypeScript interface for its props. No untyped prop objects.
- **useForm() for all form submissions.** Use `useForm()` from `@inertiajs/react` for every form that submits to Laravel. It provides processing state, error handling, dirty tracking, and CSRF out of the box.
- **TDD for all features.** Write failing tests before implementation. Follow Red-Green-Refactor. Feature tests for HTTP layer (Pest), component tests for UI (Vitest + RTL).
- **Eager loading for all relationship access.** Use `with()` to prevent N+1 query problems.
- **$fillable on every model.** Mass assignment protection is mandatory.
- **Route names on every route.** All routes must have explicit names via `->name()` or resource route conventions.
- **scopeWithSearch() on every listed model.** Any model appearing in an index/list view must define this scope.
- **Persistent layouts for all pages.** Every page component must set `Page.layout` to avoid re-mounting layouts on navigation.

## Good Practices

Recommended patterns that improve code quality and maintainability.

- **Thin controllers, fat services.** Controllers accept requests, delegate to service classes, and return responses. Business logic, orchestration, and database operations belong in services.
- **Dependency injection rules for controllers.** If a service is used in 2+ methods, inject via constructor. If used in only 1 method, inject as a method parameter.
- **Partial reloads for performance.** Use `router.reload({ only: ['orders'] })` to refresh specific props without full page data reload.
- **Custom hooks for reusable logic.** Extract shared component logic into custom hooks (e.g., `useFilters()`, `useDebounce()`, `usePagination()`). Hooks live in `resources/js/Hooks/`.
- **React.memo for expensive child components.** Wrap child components that receive stable props but re-render due to parent updates.
- **useMemo for derived state.** Compute filtered/sorted/aggregated data with `useMemo` instead of storing derived values in `useState`.
- **Model scopes for reusable queries.** Define query scopes (`scopeActive`, `scopeByUser`, `scopeWithSearch`) on models.
- **Events for side effects.** Dispatch events from services for non-blocking side effects (emails, notifications, audit logs).
- **Preserve scroll on navigation.** Use `preserveScroll` prop on Inertia `<Link>` components and `router` calls.
- **Deferred props for heavy data.** Use `Inertia::defer()` for analytics, audit logs, and other expensive queries that are not needed for initial render.
- **Optimistic updates for better UX.** Use `useOptimistic` for mutations that should feel instant (toggles, likes, status changes).
- **Form transform for data cleanup.** Use `form.transform()` to modify data before submission (extract `.id` from objects, add computed fields).

## Common Bugs

Frequent issues encountered in Laravel + Inertia + React projects.

- **N+1 queries.** Accessing relationships in Inertia props without eager loading. Always use `with()`. Use Laravel Debugbar or `DB::enableQueryLog()` to detect.
- **Direct prop mutation.** Modifying Inertia page props directly instead of copying to local state. Props are read-only snapshots from the server -- copy to `useState` before mutating.
- **Missing null checks on optional relationships.** Accessing `$model->relationship->field` without checking if loaded. Use optional chaining (`?->`) in PHP and (`?.`) in TypeScript.
- **Stale closures in useEffect and useCallback.** Referencing state variables inside closures without including them in the dependency array. Leads to callbacks with outdated values.
- **CSRF token missing on non-Inertia requests.** Inertia handles CSRF automatically, but raw `axios` or `fetch` calls must include `X-XSRF-TOKEN` header. Results in 419 status code.
- **useEffect for derived state.** Using `useEffect` + `setState` to compute values from props. Use `useMemo` instead -- synchronous and avoids extra render cycle.
- **Missing cleanup in useEffect.** Forgetting cleanup for subscriptions, timers, and abort controllers. Causes memory leaks.
- **Index as key in dynamic lists.** Using array index as `key` in lists that reorder or filter. Causes incorrect component reuse and state bugs.
- **Wrong router method for navigation.** Using `router.visit(url, { method: 'post' })` instead of `router.post(url)`. Both work but the shorthand is clearer and less error-prone.
- **Forgetting preserveState on search filters.** Without `preserveState: true`, component state resets on every Inertia visit. Search inputs lose focus and local state is lost.
- **Stale optimistic state.** Not rolling back `useOptimistic` on server error leaves ghost data in the UI.
- **Sort empty string vs missing param.** `$request->validated('sort')` returns `null` for BOTH missing AND empty. Use `$request->has('sort')` to distinguish.

## Anti-Patterns

Patterns that must be avoided in all circumstances.

- **Business logic in controllers.** Controllers must not contain domain logic, database queries, or orchestration. Extract to services.
- **Class components.** Never use React class components. Function components with hooks only.
- **Inline styles in JSX.** Never use `style={{}}` objects. Use Tailwind utility classes. Extract repeated classes into React components.
- **Synchronous long-running operations in request cycle.** Never perform email sending, PDF generation, or external API calls synchronously in controllers. Dispatch to queued jobs.
- **Using `any` type in TypeScript.** Never use `any`. Define proper interfaces. Use `unknown` with type narrowing when genuinely uncertain.
- **Raw SQL without parameterized queries.** Never concatenate user input into SQL strings. Use Eloquent or the query builder.
- **Hardcoded configuration values.** Never hardcode URLs, API keys, or feature flags. Use `.env` + `config()`.
- **Returning sensitive data in Inertia props.** Never pass passwords, tokens, or full user records to the frontend. Filter to what the page needs.
- **Using raw fetch/axios for Inertia form submissions.** Bypasses Inertia's navigation, error routing, and CSRF handling. Use `useForm()` or `router`.
- **Overusing useEffect.** React 19 and Inertia reduce the need for many useEffect patterns. Form submissions -> `useForm()`. Derived state -> `useMemo`. Navigation -> `router`.
- **Storing server data in useState.** Inertia page props ARE your server state. Do not duplicate them into local state. Derive with `useMemo` if needed.
- **Giant monolithic components.** 250+ lines = extract sub-components or custom hooks. Components call hooks and render JSX -- nothing else.

## Standards

Naming, structure, and convention standards for consistency across the codebase.

- **PascalCase for React components.** Component files and function names use PascalCase (`OrderCard.tsx`, `UserProfile.tsx`). Pages follow directory structure matching Inertia render paths (`Pages/Orders/Index.tsx`).
- **snake_case for database columns.** All migration column names use snake_case (`created_at`, `user_id`). Laravel serializes props as `snake_case`: use `props.item.client_id` not `props.item.clientId`.
- **`use` prefix for all custom hooks.** Custom hooks must start with `use` (`useFilters`, `useDebounce`). Enforced by React's rules of hooks linter.
- **Resource routes for CRUD.** Use `Route::resource()` for standard CRUD operations. Only override with explicit routes when non-standard behavior is needed.
- **camelCase for TypeScript variables and functions.** All variables, function names, and object keys in TypeScript/React use camelCase. Interface names use PascalCase.
- **PascalCase for PHP classes, camelCase for methods.** PHP classes (`OrderService`, `StoreOrderRequest`) use PascalCase. Methods (`getActiveOrders`, `calculateTotal`) use camelCase. Follow PSR-12.
- **Kebab-case for route URIs.** Multi-word route URIs use kebab-case (`/storage-units`, `/payment-links`). Route names use dot notation (`storage-units.index`).
- **Feature tests in `tests/Feature/`, unit tests in `tests/Unit/`.** Feature tests cover HTTP request/response cycles. Unit tests cover isolated business logic.
- **Props interfaces named with `Props` suffix.** `OrderListProps`, `CreateFormProps`. Page-level props can simply use `Props` when unambiguous.

## Context7 Instructions

When looking up framework documentation, use these Context7 library identifiers:

- **Laravel:** `laravel/framework` -- controllers, routing, Eloquent, validation, events, middleware
- **Inertia:** `/websites/inertiajs_v2` -- pages, forms, shared data, navigation, partial reloads, deferred props
- **React:** `/facebook/react` (use version `/facebook/react/v19_1_1` for React 19 specifics)
- **Pest:** `pestphp/pest` -- test syntax, assertions, datasets, hooks
- **TailwindCSS:** `tailwindlabs/tailwindcss` -- utility classes, configuration, responsive design
- **Vitest:** `vitest-dev/vitest` -- test runner, assertions, mocking, configuration
- **Testing Library:** `testing-library/react-testing-library` -- render, screen, queries, user events

Always check Context7 for the latest API when working with version-specific features. Training data may be outdated for Laravel 12, Inertia 2, and React 19 specifics.
