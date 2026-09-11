---
name: laravel-inertia-vue
description: Laravel 12 + Inertia 2 + Vue 3.5 + TailwindCSS conventions and patterns
---

# Laravel + Inertia + Vue Standards

These standards apply when the project stack is `laravel-inertia-vue`. All agents and implementations must follow these conventions.

**Also read `skills/standards/frontend/SKILL.md`** for universal frontend standards (component architecture, accessibility, responsive design, CSS methodology, design quality) that apply alongside these Laravel+Vue-specific conventions.

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
// Pattern: base controller with overridable methods
class ResourceController extends Controller
{
    protected function getModelClass(): string { return Resource::class; }
    protected function getResourceName(): string { return 'Resources'; }
    protected function getRoutePrefix(): string { return 'resources'; } // override for multi-word
    protected function getSearchableColumns(): array { return ['name']; }
    protected function getDefaultSort(): string { return '-id'; } // '-id' = desc, 'name' = asc

    public function store(Request $request): JsonResponse
    {
        Gate::authorize('create', $this->getModelClass());
        $model = $this->getModelClass()::create($this->validateStore($request));
        return response()->json(['message' => __('models.resource.created')], 201);
    }

    public function update(Request $request, string|int $id): JsonResponse|RedirectResponse
    {
        $model = $this->findModel($id);
        Gate::authorize('update', $model);
        $model->update($this->validateUpdate($request, $model));

        if ($request->wantsJson()) {
            return response()->json(['message' => __('models.resource.updated')]);
        }
        return redirect()->route($this->getRoutePrefix() . '.edit', $model);
    }
}
```

- **Multi-word resources:** Override `getRoutePrefix()` (e.g., `return 'storage-units';`).
- **Validation methods:** Use `validateStore()` / `validateUpdate()` for inline validation in base controllers. Use FormRequest classes for complex validation.

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

class Resource extends Model
{
    use HasFactory, WithSortableScope;

    protected $fillable = ['name', 'status'];

    protected $casts = [
        'status' => ResourceStatus::class,
        'metadata' => 'array',
        'active' => 'boolean',
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
Route::resource('r', RC::class)->only(['index', 'store', 'update', 'destroy']); // simple modal CRUD
Route::resource('r', RC::class)->except(['create']);  // hybrid: modal create + tabbed edit
Route::apiResource('p.c', CC::class)->except(['show']); // sub-resource

// Model-binding route BEFORE static route (action controllers)
Route::post('entries/{entry}/actions/void', [AC::class, 'voidSingle']);
Route::post('entries/actions/void', [AC::class, 'void']);
```

#### Wayfinder (Route Generation)

- **Generate:** `php artisan wayfinder:generate` (run after ANY route changes)
- **Import pattern:** `import { index, edit, show } from '@/actions/App/Http/Controllers/ClientController'`
- **Usage:** `edit.url({ client: id })` produces `"/clients/1/edit"`
- **With query:** `index.url({}, { query: { page: 2 } })` produces `"/clients?page=2"`
- **Alias imports:** `import { edit as editClient } from '@/actions/.../ClientController'`
- **Current URL:** `usePage().url` -- NEVER `route().current()`
- **URL params:** `new URLSearchParams(usePage().url.split('?')[1] || '')`

```ts
// Helper functions for composables that need URL manipulation
function getUrlParams(): URLSearchParams {
    const page = usePage();
    const [, search] = page.url.split('?');
    return new URLSearchParams(search || '');
}

function getPathname(): string {
    const page = usePage();
    const [pathname] = page.url.split('?');
    return pathname;
}
```

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
class ResourceActionController
{
    public function __construct(protected ResourceService $service) {}
}

// 1 method --> method parameter
public function autoAllocate(Request $request, AllocationService $svc): JsonResponse
{
    $svc->autoAllocate($rental);
}

// 1 method but parent signature constraint --> constructor injection
class ChildController extends ResourceController
{
    public function __construct(protected ChildService $cs) {}
    public function store(Request $r): JsonResponse { $this->cs->create(); }
}

// Listener (handle signature is fixed by Laravel)
class MyListener
{
    public function __construct(private readonly SomeService $svc) {}
}

// Observer (method signatures are fixed by Laravel)
class MyObserver
{
    public function __construct(private readonly SomeService $svc) {}
}
```

### Events and Listeners

- Use **events** for side effects that should not block the main flow.
- Examples: sending emails, dispatching notifications, logging audit trails, syncing external services.
- Events are dispatched from services, not controllers.
- Listeners handle the side effect and can be queued for async processing.
- Name events as past-tense actions: `OrderCreated`, `UserRegistered`, `PaymentProcessed`.
- **Laravel 12 auto-discovery:** Listeners in `app/Listeners/` are auto-discovered via `handle(Event $event)` type-hint. NEVER use `Event::listen()` in AppServiceProvider (causes duplicates).
- **Verify registration:** `php artisan event:list --event=App\\Events\\YourEvent` -- should show exactly ONE listener.

#### Real-time Notifications (WebSocket)

Pattern: `$user->notify()` + broadcast event for in-app + real-time delivery.

```php
class SendNotificationListener implements ShouldQueue
{
    public function handle(SomeEvent $event): void
    {
        $user->notify(new SomeNotification($model)); // DB + email
        $this->broadcastNotification($user, $model);  // WebSocket
    }

    private function broadcastNotification(User $user, Model $model): void
    {
        $locale = $user->preferredLocale();
        UserNotificationCreated::dispatch($user->id, [
            'id' => Str::uuid()->toString(), // Generate UUID directly
            'title' => __('notifications.some.title', ['param' => $model->name], $locale),
            'message' => __('notifications.some.message', [...], $locale),
            'action_url' => route('resource.edit', $model),
        ]);
    }
}
```

- NEVER query `$user->notifications()->latest()->first()` after `$user->notify()` -- race condition under concurrent load.
- ALWAYS build broadcast data directly with `Str::uuid()->toString()` for the notification ID.

### Migrations

- Migrations are **immutable** once deployed -- never edit a deployed migration.
- Use descriptive migration names: `create_orders_table`, `add_status_to_orders_table`.
- Always include `down()` method for rollback support.
- Define foreign key constraints explicitly with `constrained()`.
- Add indexes for columns used in WHERE clauses, JOINs, and ORDER BY.

### Enums

- Use **PHP 8.1+ backed enums** for fixed sets of values (statuses, types, roles).
- Enums are backed by strings for readability in the database.
- Define enums in `app/Enums/` directory.

### Scheduling

- ALL scheduled jobs/commands MUST go in `bootstrap/app.php` via `withSchedule()` callback.
- NEVER use `routes/console.php` for scheduling (causes duplicates).

```php
// bootstrap/app.php
->withSchedule(function (Schedule $schedule): void {
    $schedule->job(MyJob::class)
        ->everyMinute()
        ->name('My job')
        ->withoutOverlapping()
        ->onOneServer();

    $schedule->command('my:command')
        ->daily()
        ->at('02:00')
        ->withoutOverlapping()
        ->onOneServer();
})
```

### Mail Preview Controller

- `MailPreviewController` MUST NEVER create database records.
- Use `::first()` to fetch existing records.
- Use `::factory()->make()` (NOT `create()`) for unsaved instances.
- Use `replicate()` to clone without saving.
- NEVER call `->save()`, `->create()`, `->update()`, or `::create()`.

```php
// Correct pattern
$invoice = Invoice::with(['client'])->first();
if ($invoice) {
    $id = $invoice->id;
    $invoice = $invoice->replicate();
    $invoice->id = $id;
} else {
    $invoice = Invoice::factory()->make(['id' => 1]);
}

// NEVER
$invoice = Invoice::factory()->create(); // Creates DB record!
$invoice->save(); // Persists to DB!
```

## Inertia 2 Patterns

### Pages

- Inertia pages are **Vue components** that receive props from Laravel controllers.
- Controllers render pages via `Inertia::render('Orders/Index', ['orders' => $orders])`.
- Page components live in `resources/js/Pages/` with PascalCase directory structure matching the render path.
- Props are typed using `defineProps<{ orders: Order[] }>()`.

### Shared Data

- Use `HandleInertiaRequests` middleware for data shared across all pages.
- Shared data includes: authenticated user, flash messages, app name, permissions.
- Access shared data via `usePage().props`.
- Keep shared data minimal -- only what most pages need.

### Forms

- Use `useForm()` helper for basic Inertia form submissions.
- `useForm()` provides: reactive data binding, processing state, error handling, dirty tracking.
- Server-side validation errors automatically populate `form.errors`.
- Use `form.post()`, `form.put()`, `form.delete()` for submissions.
- Display validation errors next to form fields.

#### vee-validate + zod Form System

For complex forms, use the vee-validate + zod system with `FormDialog` / `ResourceForm`.

**Field types:** `input` | `textarea` | `select` | `combobox` | `switch` | `date` | `file` | `spacer` | `phone`

##### Combobox Fields

**Static** (< 100 items): locations, countries, statuses, enums, types.
```ts
loc_id: {
    type: 'combobox',
    comboboxOptions: locations.map(l => ({ label: l.name, value: l })),
    displayValue: l => l?.name || '',
}
```

**Backend** (100+ items): use `searchUrl` with `HasSearchEndpoint` trait.
```ts
import { search as searchClients } from '@/actions/App/Http/Controllers/ClientController';

client_id: {
    type: 'combobox',
    searchUrl: searchClients.url(),
    displayValue: i => i?.name || '',
    searchFilters: { loc_id: '@loc_id' }, // cross-reference another field
}
```

- Backend setup: `HasSearchEndpoint` trait + override `getSearchableColumns()`, `getSearchOrderColumn()`, `getSearchOrderDirection()`, `transformSearchResult()`.
- Route: `Route::get('clients/search', [CC::class, 'search'])->name('clients.search');` BEFORE resource route.
- The `@field_name` syntax in `searchFilters` references the current value of another form field.

##### Submission

- Laravel serializes **snake_case** NOT camelCase: `props.item.main_container` not `mainContainer`.
- Extract `.id` from combobox objects that return full objects.

```ts
import { update } from '@/actions/App/Http/Controllers/ResourceController';

onSubmit: async (v) => {
    const payload = {
        ...v,
        loc_id: v.loc_id?.id || v.loc_id,
        client_id: v.client_id?.id || v.client_id,
    };
    router.put(update.url({ resource: props.item.id }), payload);
}
```

##### Cascading Dependencies

Config: `cascadingDependencies: FieldDependency[]` -- bidirectional: downward clear + upward auto-populate.

```ts
interface FieldDependency { child: string; parents: ParentFieldRef[]; }
interface ParentFieldRef { field: string; key: string; }

cascadingDependencies: [
    { child: 'main_container_id', parents: [{ field: 'location_id', key: 'location' }] },
    { child: 'storage_unit_id', parents: [
        { field: 'location_id', key: 'location' },
        { field: 'main_container_id', key: 'main_container' },
    ]},
]
```

- Backend `transformSearchResult()` MUST return nested parent data for upward auto-population.
- Use for: hierarchical data (e.g., location -> container -> unit).
- Do NOT use for: static comboboxes, disabled parents, sub-resource forms with pre-filled parents.

##### Cross-Field Validation

```ts
crossFieldValidation: (s) => s.refine(
    (d: any) => d.email || d.phone,
    { message: t('...'), path: ['email'] }
)
```

Backend: `'email' => ['required_without:phone', 'nullable', 'email']` or custom `ValidationException::withMessages()`.

##### Error Handling

```ts
const handleSubmit = async (v: any) => {
    try {
        /* axios call */
        toast.success();
        isDialogOpen.value = false;
        router.reload({ only: ['resources'] });
    } catch (e: any) {
        if (!e.response?.data?.errors) {
            toast.error(e.response?.data?.message || t('failed'));
        }
        throw e; // MUST throw for ResourceForm to display field errors
    }
};
```

- NEVER toast validation errors (ResourceForm displays them under fields automatically).
- NEVER use `@submit` on FormDialog -- use `onSubmit` in formDefinition (Vue emit does not await async).
- The `catch` block MUST `throw e` so ResourceForm can process validation errors.

### Navigation

- Use `<Link>` component for SPA-style navigation (no full page reload).
- Use `router.visit()` for programmatic navigation.
- Use `router.reload()` for refreshing current page data.
- Preserve scroll position with `preserve-scroll` prop on Link.

### Partial Reloads

- Use `only` option to reload specific props without full page data refresh.
- Use `except` option to exclude heavy props on subsequent visits.
- Partial reloads reduce bandwidth and improve perceived performance.
- Especially useful for paginated data, search results, and filtered lists.

```js
router.reload({ only: ['orders'] });
```

## Vue 3.5 Composition API

### Script Setup

- `<script setup>` is the ONLY accepted syntax. NEVER use Options API.
- All components use `<script setup lang="ts">` with TypeScript.
- Imports, props, emits, and reactive state are declared at the top level.

### Reactive State

- `ref()` for primitive reactive values.
- `reactive()` for objects (use sparingly -- prefer `ref()` for clarity).
- `computed()` for derived values that depend on reactive state.
- `watch()` and `watchEffect()` for side effects on state changes.

### Props and Emits

- `defineProps<{ title: string; items: Item[] }>()` with TypeScript interface.
- `defineEmits<{ (e: 'update', id: number): void }>()` with typed events.
- `defineModel()` for two-way binding (v-model support).
- NEVER mutate props directly -- emit events to parent instead.

### Composables

- Extract reusable logic into composables: `useFilters()`, `useDebounce()`, `usePagination()`.
- Composables follow `use*` naming convention.
- Composables live in `resources/js/Composables/` directory.
- A composable returns reactive state and functions -- it is a self-contained unit of logic.

### Component Organization

- Components live in `resources/js/Components/` with PascalCase naming.
- Layouts live in `resources/js/Layouts/`.
- Pages live in `resources/js/Pages/` mirroring route structure.
- Keep components focused: one concern per component.
- Extract repeated UI patterns into shared components.

## TailwindCSS Conventions

### Utility-First

- Use Tailwind utility classes directly in templates. This is the primary styling approach.
- Avoid `@apply` in most cases -- it defeats the purpose of utility-first CSS.
- `@apply` is acceptable ONLY in base styles for elements that cannot have classes (e.g., prose content).

### Design Tokens

- Define project design tokens in `tailwind.config.js` under `theme.extend`.
- Use semantic naming for colors: `primary`, `secondary`, `success`, `danger`, `warning`.
- Define spacing, font sizes, and breakpoints consistent with the design system.

### Component Extraction

- When a utility string exceeds ~5 classes and repeats across components, extract to a Vue component (not a CSS class).
- Prefer component extraction over CSS extraction -- keeps styles colocated with behavior.

### Responsive Design

- Mobile-first approach: base styles apply to mobile, use breakpoints for larger screens.
- Breakpoint order: `sm:` (640px), `md:` (768px), `lg:` (1024px), `xl:` (1280px), `2xl:` (1536px).
- Test all pages at each breakpoint.

## CRUD Patterns (Architecture)

**Simple** (< 8 fields): Index.vue + columns.ts, modal create/edit, routes `only(['index', 'store', 'update', 'destroy'])`.

**Complex** (tabs): Index.vue (modal create) + Edit.vue (tabbed), routes `except(['create'])`.

**Sub-resource**: components in `components/parents/Children.vue` + pages in `pages/Parents/Children/Index.vue`, `apiResource`, axios + `router.reload`.

- NEVER create Show.vue -- Edit.vue serves as read-only view when user lacks update permission.

### Modal CRUD Pattern

```ts
import { destroy } from '@/actions/App/Http/Controllers/ResourceController';

const isDialogOpen = ref(false);
const isEditing = ref(false);
const currentItem = ref<Resource | null>(null);

const formDef = computed(() => ({
    fields: { /* ... */ },
    initialValues: currentItem.value ? { /* edit values */ } : { /* create defaults */ },
    submitText: isEditing.value ? t('update') : t('create'),
    onSubmit: handleSubmit,
}));

const openEdit = (item: Resource) => {
    isEditing.value = true;
    currentItem.value = item;
    isDialogOpen.value = true;
};

// Window events for column-triggered actions
onMounted(() => {
    window.addEventListener('edit-resource', handleEdit as EventListener);
    window.addEventListener('delete-resource', handleDelete as EventListener);
});
onUnmounted(() => {
    window.removeEventListener('edit-resource', handleEdit as EventListener);
    window.removeEventListener('delete-resource', handleDelete as EventListener);
});
```

**Delete patterns:**
- Main resources (`router.delete`): NO toast -- backend flash message handles it.
- Sub-resources / simple CRUD (`axios.delete`): YES toast -- no flash system available.

```ts
// Main resource -- no toast
router.delete(destroy.url({ resource: item.id }), {
    preserveScroll: true,
    onSuccess: () => { showDeleteDialog.value = false; },
    onError: () => { toast.error(); },
});

// Sub-resource -- yes toast
await axios.delete(destroy.url({ resource: item.id }));
toast.success(t('deleted'));
router.reload({ only: ['resources'] });
```

## TanStack Table Columns

```ts
import { h } from 'vue';
import { can, canAny } from '@/utils/abilities';
import { router, usePage } from '@inertiajs/vue3';
import { edit } from '@/actions/App/Http/Controllers/ResourceController';

export const getColumns = (
    t: Composer['t'],
    locale: string = 'en',
    dateFormat: string | null = null, // or dateTimeFormat for timestamp columns
): ColumnDef<Resource>[] => [
    {
        accessorKey: 'name',
        header: () => t('...'),
        cell: ({ row }) => h('span', {
            class: 'font-medium cursor-pointer hover:underline',
            onClick: () => router.visit(edit.url({ resource: row.original.id })),
        }, row.original.name),
    },
    {
        accessorKey: 'status',
        cell: ({ row }) => h(Badge, {
            variant: row.getValue('status') === 'active' ? 'default' : 'secondary',
        }, () => t(`statuses.${row.getValue('status')}`)),
    },
    {
        accessorKey: 'active',
        cell: ({ row }) => {
            const v = row.getValue<boolean>('active');
            return h('div', { class: 'flex items-center' },
                h(v ? Check : X, {
                    class: v ? 'h-4 w-4 text-green-600' : 'h-4 w-4 text-muted-foreground',
                }),
            );
        },
    },
    {
        id: 'actions',
        cell: ({ row }) => {
            const abilities = usePage<AppPageProps>().props.auth.user.abilities;
            const canEdit = canAny(abilities, 'resource', ['canUpdateAny', 'canDeleteAny']);
            // Pencil (edit), Trash2 (delete), Eye (view-only)
        },
    },
];
```

**Cell patterns:**
- Primary link: `font-medium cursor-pointer hover:underline`
- Status: `Badge` component with variant
- Booleans: `Check` / `X` icons
- Dates: `formatDate(d, locale, dateFormat)` -- for date columns
- Timestamps: `formatDateTime(d, locale, dateTimeFormat)` -- for created_at, updated_at
- Currency: `formatCurrency()` -- produces "150.00 RON"
- Codes: `font-mono`

## Pagination

Use FLAT pagination format. NEVER use nested links/meta format.

```ts
// FLAT format (correct)
interface PaginatedResponse<T> {
    data: T[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number;
    to: number;
}

// NEVER use nested format
// { data: [...], links: {...}, meta: {...} }
```

## Sorting

**Backend:** `WithSortableScope` trait + `scopeWithSorting()`.

```php
// $request->validated('sort') returns null for BOTH missing AND empty -- use has() to distinguish
$query->withSorting(
    $request->has('sort') ? $request->validated('sort') ?? '' : null,
    $this->getDefaultSort()
);

// sortDef = null   --> use defaultSort
// sortDef = ''     --> no sorting (cleared by user)
// sortDef = 'col'  --> asc
// sortDef = '-col' --> desc
```

**Frontend:** `useSorting()` composable + DataTable `:sort` prop.

```ts
const page = usePage();
const currentSort = computed(() =>
    new URLSearchParams(page.url.split('?')[1] || '').get('sort') || undefined
);

<DataTable :sort="currentSort ?? 'deadline'" ... />
```

**Sort cycle:** asc -> desc -> clear (custom implementation -- TanStack only does asc <-> desc).

**URL params:**
- `?sort=col` -- ascending
- `?sort=-col` -- descending
- `?sort=` -- explicitly cleared (empty string, no sorting)
- No param -- use backend default

Empty string `sort=` is NOT the same as missing param: empty = explicitly cleared (no sorting), missing = use backend default.

## Filters (MultiSelectFilter)

```vue
<script setup>
import { search as searchClients } from '@/actions/App/Http/Controllers/ClientController';
</script>

<!-- Static filter -->
<MultiSelectFilter :options="opts" v-model="qp.status_filters" />

<!-- Backend filter -->
<MultiSelectFilter :search-url="searchClients.url()" v-model="qp.client_ids" />

<!-- Cascading filter (depends on another filter value) -->
<MultiSelectFilter
    :search-url="searchContainers.url()"
    :filters="{ loc_id: qp.loc_filters[0] }"
    v-model="qp.mc_filters"
/>
```

## Auth / Abilities

**Policy methods:** `viewAny`, `create`, `updateAny`, `deleteAny` -> keys: `canViewAny`, `canCreate`, `canUpdateAny`, `canDeleteAny`.

**Custom action policies:** Policy `{actionName}Action(User $user): bool` -> Abilities.php `'{actionName}Action'` -> FE `permissions: ['resource.can{ActionName}Action']`.

**Frontend usage split:**
- **Columns (.ts files):** `import { can, canAny } from '@/utils/abilities'` -- utils functions because columns run outside Vue component context.
- **Vue components (layouts, pages):** `import { useAbilities } from '@/composables/useAbilities'` -- composable for reactive access in Vue components.

## Layouts

- Use `#page-actions` slot -- NEVER `#actions`.

```vue
<!-- Simple layout -->
<AppLayout>
    <ResourceLayout :title="...">
        <template #page-actions>
            <Button @click="openCreate">
                <Plus /> {{ t('create') }}
            </Button>
        </template>
    </ResourceLayout>
</AppLayout>

<!-- Tabbed layout (for complex resources) -->
<AppLayout>
    <ResourceTabbedLayout :resource="item">
        <ResourceForm />
    </ResourceTabbedLayout>
</AppLayout>
```

- **Views:** `?view=articles` for same resource tabs | `/resources/1/sub-resources` for sub-resource pages.
- Use `usePage().url` for current URL detection in tab highlighting.

## i18n

- **Vue:** `const { t } = useI18n()`
- **PHP:** `__('models.r.created')`
- **Files:** `lang/en/models.php`, `lang/ro/*`
- **Toast:** `import { toast } from '@/lib/toast'`

**CRITICAL -- Placeholder syntax:**
- Backend `__('key', ['var' => $v])` uses `:var` syntax in lang files.
- Frontend `t('key', { var: v })` uses `{var}` syntax in lang files.
- If a translation is used on the frontend with `t()`, it MUST use `{variable}` syntax.
- If a translation is used only on the backend with `__()`, use `:variable` syntax.
- Single-row actions use `success_single` keys (no `:count`). Bulk actions use `success` with count param.

**Escape sequences in PHP lang files:** `{'@'}`, `{'{'}`, `{'}'}`, `{'$'}`, `{'|'}`.

## Date/Time Formatting

```ts
import { formatDate, formatDateTime } from '@/lib/utils';

// Date columns: due_date, start_date, end_date, issue_date, payment_date
formatDate(d, locale, page.props.dateFormat)

// Timestamp columns: created_at, updated_at, processed_at, failed_at
formatDateTime(d, locale, page.props.dateTimeFormat)
```

- NEVER use `new Date().toLocaleDateString()` or manual date formatting.
- Column definitions accept `dateFormat` (for dates) or `dateTimeFormat` (for timestamps) as the third parameter.

## Table Actions

**Files:** `table-actions/{resource}.ts` + `table-actions/shared/` (visibility.ts, form-fields.ts, index.ts).

**Interface:** `ActionDefinition` in `@/types/actions.ts`.

### The Golden Rule

| Frontend Config | Backend Pattern | Response |
|-----------------|-----------------|----------|
| `singleRowAction: true` + `endpoint: (item) => url` | Route: `{model}/actions/x`, `Gate::authorize()` | FLAT |
| `singleRowAction: false` + `requiresSelection: true` | Route: `actions/x`, `executeBulkAction()` + `ids[]` | NESTED |
| `singleRowAction: false` + `requiresSelection: false` | Route: `actions/x`, `executePageAction()` | NESTED |
| `actionType: 'custom'` | No backend call | N/A |

- `singleRowAction: true` MUST have `endpoint` as a function: `endpoint: (item) => actionFn.url({ model: item.id })`.

### Response Patterns

```php
// FLAT (Pattern A -- single-row): no 'success' boolean
return response()->json(['message' => __('actions.xxx.success'), 'result_id' => $result->id]);

// NESTED (Pattern B/C -- bulk/page): with 'success' boolean + counts
return response()->json([
    'success' => true,
    'message' => $msg,
    'processedCount' => $n,
    'totalCount' => $t,
]);
```

### Structure

```ts
import { doAction } from '@/actions/App/Http/Controllers/Actions/ResourceActionController';

export const getResourceActions = (t: Composer['t']): ActionDefinition[] => [
    // Single-row action -- endpoint MUST be a function
    {
        key: 'do-action',
        label: t('actions.do.name'),
        singleRowAction: true,
        endpoint: (item) => doAction.url({ resource: item.id }),
        method: 'post',
        permissions: ['resources.canDoAction'],
    },
    // Bulk action -- endpoint as string
    {
        key: 'bulk-action',
        label: t('actions.bulk.name'),
        singleRowAction: false,
        requiresSelection: true,
        endpoint: () => bulkAction.url(),
        method: 'post',
    },
];
```

### DRY Patterns

```ts
// table-actions/shared/visibility.ts
export const canDoAction = (item: any): boolean => item.status === 'active' && item.amount > 0;

// table-actions/shared/form-fields.ts
export const createReasonField = (t: Composer['t']): Record<string, FormFieldDefinition> => ({ ... });

// table-actions/shared/index.ts -- barrel exports

// table-actions/resource.ts
import { canDoAction, createReasonField } from './shared';
{ visibilityCondition: canDoAction, formFields: createReasonField(t) }
```

- NEVER define visibility functions locally in action files -- move to `shared/visibility.ts`.
- NEVER define formFields inline -- use factories from `shared/form-fields.ts`.

### Combined Solo + Bulk Actions

When the same action needs BOTH single-row (inline button) AND bulk (dropdown with selection):
- Define TWO entries in `table-actions/*.ts` with the **same `label`** (used for deduplication).
- `ActionDropdown` auto-deduplicates by label: 1 selected -> shows single-row, multiple -> shows bulk.
- Backend needs TWO methods: Pattern A (`voidSingle`) + Pattern B (`void`).
- Single-row route MUST come BEFORE bulk route (route model binding vs static path).

### Backend Patterns

**Controller:** `Actions/{Resource}ActionController.php`
**Policy:** `{actionName}Action(User $user): bool` in `{Resource}Policy.php`
**Abilities:** `Abilities.php` -> add `'{actionName}Action'` to resource array
**FE Permissions:** `permissions: ['resources.can{ActionName}Action']`

## Testing Patterns

### PHP Testing (Pest)

- **Feature tests** for HTTP layer: controller actions, middleware, redirects, Inertia responses.
- **Unit tests** for business logic: services, value objects, model scopes.
- Use `assertInertia()` for testing Inertia page responses, props, and component rendering.
- Use model factories for test data setup.
- Database transactions for test isolation (`RefreshDatabase` trait).
- ALWAYS run tests with `php artisan test --parallel` -- NEVER `composer test` (too slow).

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
```

### Pre-Commit Gate

NEVER commit if ANY of these report errors (even pre-existing ones):
1. `vendor/bin/pint` -- code style
2. `vendor/bin/phpstan analyse --memory-limit=1G` -- static analysis
3. `php artisan test --parallel` -- tests

Fix ALL errors first, then commit.

### Vue Testing (Vitest)

- Test component rendering, user interactions, and emitted events.
- Use `@vue/test-utils` with `mount()` or `shallowMount()`.
- Mock Inertia's `usePage()` and `useForm()` in tests.
- Test composables independently by calling them in a test setup.

## Common Pitfalls -- NEVER Rules

1. **NEVER** put business logic in controllers -- use service classes.
2. **NEVER** use Options API -- always Composition API with `<script setup>`.
3. **NEVER** mutate props directly in Vue components -- emit events instead.
4. **NEVER** skip form request validation in controllers -- every store/update needs a FormRequest.
5. **NEVER** use raw SQL without parameterized queries -- use Eloquent or the query builder.
6. **NEVER** skip eager loading -- use `with()` to prevent N+1 query problems.
7. **NEVER** use `@apply` for component styling -- extract to Vue components instead.
8. **NEVER** hardcode configuration values -- use `.env` and `config()`.
9. **NEVER** return sensitive data in Inertia props -- filter props to only what the page needs.
10. **NEVER** use `any` type in TypeScript -- define proper interfaces and types.
11. **NEVER** forget `scopeWithSearch()` on models used in index views.
12. **NEVER** use wrong trait path -- it is `App\Models\Traits\WithSortableScope`, NOT `App\Traits\`.
13. **NEVER** forget to override `getRoutePrefix()` for multi-word resource names.
14. **NEVER** use `#actions` slot -- it is `#page-actions`.
15. **NEVER** forget `displayValue` on combobox fields or skip extracting `.id` on submit.
16. **NEVER** use utils (`can`, `canAny`) in Vue components -- use `useAbilities` composable. Conversely, NEVER use composable in `.ts` column files -- use utils.
17. **NEVER** forget `onMounted`/`onUnmounted` for window event listeners (memory leaks).
18. **NEVER** use `toLocaleDateString()` -- use `formatDate()` / `formatDateTime()` from utils.
19. **NEVER** toast validation errors -- ResourceForm displays them under fields. NEVER `@submit` on FormDialog.
20. **NEVER** omit `throw e` in catch blocks -- ResourceForm needs the re-thrown error to display field errors.
21. **NEVER** use `JSON.parse(JSON.stringify())` for deep cloning -- use `deepClone(obj)` from `@/lib/deepClone` (recursively strips Vue proxies + functions, then `structuredClone` preserves File/Date/Blob).
22. **NEVER** use `Event::listen()` in AppServiceProvider -- Laravel 12 auto-discovers listeners via type-hint.
23. **NEVER** query notifications after `$user->notify()` -- race condition. Build broadcast data directly with `Str::uuid()`.

## File Structure

```
app/Http/Controllers/{Resource}Controller.php
app/Http/Controllers/Actions/{Resource}ActionController.php
app/Models/{Resource}.php
app/Policies/{Resource}Policy.php
resources/js/components/{resource}/columns.ts
resources/js/components/{resource}/table-actions/{resource}.ts
resources/js/components/{resource}/table-actions/shared/
resources/js/pages/{Resources}/Index.vue
resources/js/pages/{Resources}/Edit.vue
resources/js/types/models.ts
routes/web.php
lang/{en,ro}/models.php
```

## Must-Haves

These are non-negotiable requirements. Every implementation MUST satisfy all of them.

1. **`Gate::authorize()` for authorization** -- NEVER use `$request->user()->can()` + `abort(403)` or `auth()->user()->can()`. Always `Gate::authorize('ability', $model)`.
2. **FormRequest for validation** -- Every `store()` and `update()` action MUST use a FormRequest class (or the base controller's `validateStore()`/`validateUpdate()` methods). Never validate inline in controllers.
3. **`scopeWithSearch()` on every listed model** -- Any model that appears in an index/list view MUST define `scopeWithSearch()`. Missing this scope breaks the search bar silently.
4. **`WithSortableScope` trait from the correct namespace** -- Always `use App\Models\Traits\WithSortableScope`. The trait provides `scopeWithSorting()` for backend sort support.
5. **Scheduling in `bootstrap/app.php`** -- ALL scheduled jobs and commands MUST be registered via the `withSchedule()` callback in `bootstrap/app.php`. NEVER use `routes/console.php` for scheduling (causes duplicate execution).
6. **`<script setup lang="ts">` on every Vue component** -- All components use Composition API with `<script setup>` and TypeScript. No exceptions.
7. **TDD** -- Write tests BEFORE implementation. Follow the Red-Green-Refactor cycle. Run `php artisan test --parallel` (never `composer test`). Pre-commit gate: Pint + PHPStan + tests must all pass.

## Good Practices

These are strongly recommended patterns that lead to maintainable, performant code.

1. **Thin controllers** -- Controllers accept a request, delegate to a service, and return a response. All business logic lives in dedicated service classes (e.g., `OrderService`, `PaymentService`).
2. **DI rules for controllers** -- If a service is used in 2+ methods, inject via constructor (`protected` property). If used in 1 method, inject as a method parameter. If the method must match a parent signature, use constructor injection even for 1 method. Listeners and Observers always use constructor injection (their method signatures are fixed by Laravel). Traits may use `app()` inline (no constructor available).
3. **Events and listeners with auto-discovery** -- Dispatch events from services (not controllers) for side effects (emails, notifications, audit logs). Laravel 12 auto-discovers listeners in `app/Listeners/` via `handle(Event $event)` type-hint. Verify with `php artisan event:list`.
4. **Partial reloads** -- Use `router.reload({ only: ['prop'] })` to refresh specific props without full page data transfer. Reduces bandwidth and improves perceived performance for paginated data, search results, and filtered lists.
5. **Wayfinder for route URLs** -- Generate type-safe route URLs with `php artisan wayfinder:generate` after any route change. Import actions: `import { edit } from '@/actions/App/Http/Controllers/ResourceController'`. Use `edit.url({ resource: id })` instead of hardcoded strings.
6. **Eager loading** -- Always use `with()` to prevent N+1 query problems. Never lazy-load relationships in loops.
7. **Composables for reusable logic** -- Extract shared reactive logic into `use*` composables in `resources/js/Composables/`. A composable returns reactive state and functions as a self-contained unit.

## Common Bugs

Known pitfalls that have caused production issues or wasted significant debugging time.

1. **Notify race condition** -- NEVER query `$user->notifications()->latest()->first()` after `$user->notify()`. Under concurrent load, another notification may be inserted between the two calls. Build broadcast data directly with `Str::uuid()->toString()` for the notification ID.
2. **`Event::listen()` duplicates** -- NEVER register listeners via `Event::listen()` in `AppServiceProvider`. Laravel 12 auto-discovers listeners, so manual registration causes duplicate execution. Verify with `php artisan event:list --event=App\\Events\\YourEvent` (should show exactly ONE listener).
3. **Wrong trait namespace** -- The sortable trait lives at `App\Models\Traits\WithSortableScope`, NOT `App\Traits\WithSortableScope`. Using the wrong namespace causes a class-not-found error that is easy to overlook in large diffs.
4. **Missing `getRoutePrefix()` override** -- Multi-word resource controllers (e.g., `StorageUnitController`) MUST override `getRoutePrefix()` to return the kebab-case route prefix (e.g., `'storage-units'`). Without this, route generation and redirects break silently.
5. **`colSpan:2` ignored in grid layout** -- The form grid does not honor `colSpan:2`. To control row alignment, use a `spacer` field type with the same condition as the related fields.
6. **`singleRowAction` endpoint must be a function** -- When `singleRowAction: true`, the `endpoint` property MUST be a function: `endpoint: (item) => actionFn.url({ model: item.id })`. A string endpoint causes the action to fire against the wrong URL or fail entirely.
7. **Sort empty string vs missing param** -- `$request->validated('sort')` returns `null` for BOTH missing AND empty string values. Use `$request->has('sort')` to distinguish: empty string (`?sort=`) means user explicitly cleared sorting (no sort applied), while missing param means use the backend default sort.

## Anti-Patterns

Code patterns that are explicitly banned in this stack. Reject any PR that introduces them.

1. **Options API** -- NEVER use `export default { data(), methods: {} }`. All components must use `<script setup>` with Composition API.
2. **Business logic in controllers** -- Controllers orchestrate; services implement. If a controller contains conditional logic, calculations, or multi-step workflows, extract to a service class.
3. **Direct prop mutation** -- NEVER mutate props in Vue components. Emit events to the parent or use `defineModel()` for two-way binding. Direct mutation causes silent failures and hard-to-trace bugs.
4. **`@apply` for component styling** -- NEVER use `@apply` in CSS/SCSS. It defeats TailwindCSS utility-first design. Extract repeated utility strings into Vue components instead. The only acceptable use is base styles for elements that cannot have classes (e.g., prose content).
5. **Nested pagination format** -- NEVER use `{ data: [...], links: {...}, meta: {...} }`. Always use the FLAT pagination format: `{ data: [...], current_page, last_page, per_page, total, from, to }`.
6. **`any` type in TypeScript** -- NEVER use `any` as a type annotation. Define proper interfaces and types for all data structures. The only exception is catch block parameters (`catch (e: any)`).
7. **`Show.vue` pages** -- NEVER create `Show.vue` pages. The `Edit.vue` page serves as a read-only view when the user lacks update permission. Use `computed(() => can('resource', 'canUpdateAny'))` to toggle edit controls.

## Standards

Naming conventions, file organization, and structural rules for consistency.

1. **PascalCase components** -- All Vue component files use PascalCase: `OrderList.vue`, `PaymentForm.vue`. Page directories mirror route structure: `resources/js/Pages/Orders/Index.vue`.
2. **`snake_case` database columns** -- All database columns and model attributes use `snake_case`. Laravel serializes props as `snake_case`: use `props.item.main_container` not `props.item.mainContainer`.
3. **Resource routes** -- Use `Route::resource()` for CRUD operations. Simple CRUD: `->only(['index', 'store', 'update', 'destroy'])`. Complex (tabbed): `->except(['create'])`. Sub-resources: `Route::apiResource('parents.children', ChildController::class)->except(['show'])`.
4. **Lang file structure** -- Translations live in `lang/{en,ro}/models.php`. Backend uses `:variable` placeholders with `__('key', ['var' => $v])`. Frontend uses `{variable}` placeholders with `t('key', { var: v })`. Single-row actions use `success_single` keys; bulk actions use `success` with a count param.
5. **Abilities split by context** -- In `.ts` column files (outside Vue component context), use utility functions: `import { can, canAny } from '@/utils/abilities'`. In Vue components (layouts, pages), use the composable: `import { useAbilities } from '@/composables/useAbilities'`. Never mix the two contexts.

## Context7 Instructions

When looking up framework documentation, use these Context7 library identifiers:

- **Laravel:** `laravel/framework` -- controllers, routing, Eloquent, validation, events, middleware
- **Inertia:** `inertiajs/inertia` -- pages, forms, shared data, navigation, partial reloads
- **Vue:** `vuejs/core` -- Composition API, reactivity, components, lifecycle hooks
- **Pest:** `pestphp/pest` -- test syntax, assertions, datasets, hooks
- **TailwindCSS:** `tailwindlabs/tailwindcss` -- utility classes, configuration, responsive design

Always check Context7 for the latest API when working with version-specific features. Training data may be outdated for Laravel 12, Inertia 2, and Vue 3.5 specifics.
