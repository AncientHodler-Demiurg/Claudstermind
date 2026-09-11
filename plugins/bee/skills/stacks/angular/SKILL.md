---
name: angular
description: Angular 19+ standalone conventions with signals, zoneless change detection, inject(), reactive forms, and modern patterns
---

# Angular Standards

These standards apply when the project stack is `angular`. All agents and implementations must follow these conventions.

**Also read `skills/standards/frontend/SKILL.md`** for universal frontend standards (component architecture, accessibility, responsive design, CSS methodology, design quality) that apply alongside these Angular-specific conventions.

## Component Architecture

### Standalone Components (Default)

- **All components are standalone** (`standalone: true` is default in Angular 19+). No NgModules for components.
- **`ChangeDetectionStrategy.OnPush`** on EVERY component. No exceptions. This is critical for performance with signals.
- **Max 250 lines per component.** Extract sub-components and services when components grow.
- **No business logic in components.** Components manage template bindings and delegate to services. Data fetching, transformations, validation belong in services.
- **Inline templates** for small components (< 20 lines of template). External `.html` for larger templates.
- **`selector` follows kebab-case** with app prefix: `app-order-list`, `app-user-profile`.

```typescript
import { ChangeDetectionStrategy, Component, input, output, computed } from '@angular/core';

@Component({
    selector: 'app-order-card',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="card" [class.urgent]="isUrgent()">
            <h3>{{ order().name }}</h3>
            <span class="status">{{ order().status }}</span>
            <button (click)="selected.emit(order())">View</button>
        </div>
    `,
})
export class OrderCardComponent {
    readonly order = input.required<Order>();
    readonly selected = output<Order>();
    protected readonly isUrgent = computed(() => this.order().priority === 'high');
}
```

### Modern Input/Output API

- **`input()`** signal function for component inputs (replaces `@Input()` decorator).
- **`input.required<T>()`** for mandatory inputs.
- **`output()`** for event emitters (replaces `@Output()` + `EventEmitter`).
- **`model()`** for two-way binding inputs.
- **`computed()`** for derived state from signals — replaces getter properties.

```typescript
// Modern API (Angular 19+)
readonly name = input<string>('');           // optional with default
readonly userId = input.required<string>();  // required
readonly closed = output<void>();            // event emitter
readonly value = model<string>('');          // two-way [(value)]
readonly displayName = computed(() => this.name() || 'Anonymous');

// ❌ Legacy — do NOT use
@Input() name: string = '';
@Output() closed = new EventEmitter<void>();
```

## Signals

### Core Signal API

- **`signal(initialValue)`** — writable reactive primitive. Access value with `()`, update with `.set()` or `.update()`.
- **`computed(() => expression)`** — derived signal, auto-tracks dependencies. Read-only.
- **`effect(() => { ... })`** — side effect that runs when tracked signals change. Use sparingly.
- **`linkedSignal(() => source)`** — signal linked to another signal's value, resettable.

```typescript
// State management with signals
readonly count = signal(0);
readonly items = signal<Item[]>([]);
readonly total = computed(() => this.items().reduce((sum, i) => sum + i.price, 0));
readonly isEmpty = computed(() => this.items().length === 0);

// Update patterns
this.count.set(5);
this.count.update(c => c + 1);
this.items.update(items => [...items, newItem]);
```

### Signal Best Practices

- **Use `computed()` for derived state.** Never store derived values in separate signals.
- **Use `effect()` only for external side effects** (logging, analytics, localStorage sync). Never use effect to set other signals — use `computed()` instead.
- **`untracked()`** to read signals without tracking inside `computed`/`effect`.
- **Immutable updates:** Always create new arrays/objects with `.update()`. Never mutate in place.

### Resource API (Async Data)

```typescript
import { resource, signal } from '@angular/core';

readonly userId = signal<string>('123');

readonly userResource = resource({
    request: () => ({ id: this.userId() }),
    loader: async ({ request, abortSignal }) => {
        const response = await fetch(`/api/users/${request.id}`, { signal: abortSignal });
        return response.json() as Promise<User>;
    },
});

// In template:
// @if (userResource.isLoading()) { <spinner /> }
// @if (userResource.value(); as user) { <user-card [user]="user" /> }
// @if (userResource.error()) { <error-message /> }
```

## Dependency Injection

### `inject()` Function (Preferred)

- **Use `inject()` function** instead of constructor injection. Cleaner, works with signals.
- **Services are `@Injectable({ providedIn: 'root' })`** for app-wide singletons.
- **Component-scoped providers:** Use `providers: [MyService]` in `@Component` for component-level DI.

```typescript
@Component({ ... })
export class OrderListComponent {
    private readonly orderService = inject(OrderService);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);

    readonly orders = signal<Order[]>([]);

    constructor() {
        // Load data in constructor or use resource()
        this.loadOrders();
    }

    private async loadOrders() {
        const data = await firstValueFrom(this.orderService.getOrders());
        this.orders.set(data);
    }
}
```

### Service Conventions

- **One service per domain concern:** `OrderService`, `AuthService`, `NotificationService`.
- **Services handle business logic, HTTP calls, state management.** Components delegate to services.
- **Return `Observable<T>` from HTTP methods.** Use `HttpClient` with typed responses.
- **Use `DestroyRef` + `takeUntilDestroyed()`** for subscription cleanup.

```typescript
@Injectable({ providedIn: 'root' })
export class OrderService {
    private readonly http = inject(HttpClient);

    getOrders(): Observable<Order[]> {
        return this.http.get<Order[]>('/api/orders');
    }

    getOrder(id: string): Observable<Order> {
        return this.http.get<Order>(`/api/orders/${id}`);
    }

    createOrder(data: CreateOrderDto): Observable<Order> {
        return this.http.post<Order>('/api/orders', data);
    }
}
```

## HTTP and Interceptors

### HttpClient Configuration

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
    providers: [
        provideRouter(routes),
        provideHttpClient(
            withInterceptors([authInterceptor, errorInterceptor]),
        ),
        provideZonelessChangeDetection(), // if using zoneless
    ],
};
```

### Functional Interceptors (Preferred)

```typescript
export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const authService = inject(AuthService);
    const token = authService.getToken();

    if (token) {
        req = req.clone({
            setHeaders: { Authorization: `Bearer ${token}` },
        });
    }

    return next(req);
};

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
    return next(req).pipe(
        catchError((error: HttpErrorResponse) => {
            if (error.status === 401) {
                inject(Router).navigate(['/login']);
            }
            return throwError(() => error);
        }),
    );
};
```

## Routing

### Route Configuration

```typescript
export const routes: Routes = [
    { path: '', component: HomeComponent },
    {
        path: 'orders',
        children: [
            { path: '', component: OrderListComponent },
            { path: ':id', component: OrderDetailComponent },
            { path: ':id/edit', component: OrderEditComponent },
        ],
    },
    {
        path: 'admin',
        canActivate: [authGuard],
        loadChildren: () => import('./admin/admin.routes').then(m => m.ADMIN_ROUTES),
    },
    { path: '**', component: NotFoundComponent },
];
```

### Guards (Functional)

```typescript
export const authGuard: CanActivateFn = (route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (authService.isAuthenticated()) return true;
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
```

### Route Resolvers

```typescript
export const orderResolver: ResolveFn<Order> = (route) => {
    const orderService = inject(OrderService);
    return orderService.getOrder(route.paramMap.get('id')!);
};

// In routes config:
{ path: ':id', component: OrderDetailComponent, resolve: { order: orderResolver } }

// In component:
readonly order = toSignal(inject(ActivatedRoute).data.pipe(map(d => d['order'] as Order)));
```

## Forms

### Reactive Forms (Preferred)

```typescript
@Component({
    imports: [ReactiveFormsModule],
    template: `
        <form [formGroup]="form" (ngSubmit)="onSubmit()">
            <input formControlName="name" />
            @if (form.controls.name.errors?.['required'] && form.controls.name.touched) {
                <span class="error">Name is required</span>
            }
            <input formControlName="email" type="email" />
            <button type="submit" [disabled]="form.invalid">Save</button>
        </form>
    `,
})
export class OrderFormComponent {
    private readonly fb = inject(FormBuilder);
    private readonly orderService = inject(OrderService);

    readonly form = this.fb.group({
        name: ['', [Validators.required, Validators.minLength(3)]],
        email: ['', [Validators.required, Validators.email]],
        notes: [''],
    });

    onSubmit() {
        if (this.form.valid) {
            this.orderService.createOrder(this.form.getRawValue()).subscribe();
        }
    }
}
```

### Custom Validators

```typescript
function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
    const password = group.get('password')?.value;
    const confirm = group.get('confirmPassword')?.value;
    return password === confirm ? null : { passwordMismatch: true };
}
```

## Modern Template Syntax

### Control Flow (Angular 17+)

```html
<!-- @if / @else -->
@if (isLoading()) {
    <app-spinner />
} @else if (error()) {
    <app-error [message]="error()" />
} @else {
    <app-order-list [orders]="orders()" />
}

<!-- @for with required track -->
@for (order of orders(); track order.id) {
    <app-order-card [order]="order" />
} @empty {
    <p>No orders found</p>
}

<!-- @switch -->
@switch (status()) {
    @case ('active') { <span class="badge-green">Active</span> }
    @case ('pending') { <span class="badge-yellow">Pending</span> }
    @default { <span class="badge-gray">Unknown</span> }
}

<!-- @defer for lazy loading -->
@defer (on viewport) {
    <app-heavy-chart [data]="chartData()" />
} @placeholder {
    <div class="skeleton-chart"></div>
} @loading (minimum 500ms) {
    <app-spinner />
}
```

## State Management

**Detect what the project uses** — check `package.json` for installed state management libraries and follow THAT library's conventions.

- **NgRx Store** — if installed, use feature stores with `createFeature()`, `createActionGroup()`, typed selectors. Never dispatch actions from services directly — use effects.
- **NgRx Signal Store** — modern alternative preferred for new projects:

```typescript
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';

type OrdersState = { orders: Order[]; loading: boolean; error: string | null };

export const OrdersStore = signalStore(
  withState<OrdersState>({ orders: [], loading: false, error: null }),
  withComputed(({ orders }) => ({
    activeOrders: computed(() => orders().filter(o => o.status === 'active')),
    totalCount: computed(() => orders().length),
  })),
  withMethods((store, ordersService = inject(OrdersService)) => ({
    loadOrders: rxMethod<void>(pipe(
      tap(() => patchState(store, { loading: true })),
      switchMap(() => ordersService.getAll().pipe(
        tapResponse({
          next: (orders) => patchState(store, { orders, loading: false }),
          error: (err: Error) => patchState(store, { error: err.message, loading: false }),
        }),
      )),
    )),
  })),
);

// Usage in component: inject(OrdersStore), call store.loadOrders(), read store.activeOrders()
```
- **Signals only** — for simple apps, plain signals in services are sufficient. No external library needed.
- **Akita / Elf** — if installed, follow their store patterns.

**If no external store is installed:** Use Angular signals in `@Injectable` services. Services hold `signal()` state, expose `computed()` selectors and methods for updates.

```typescript
// Simple signal-based store (no external library)
@Injectable({ providedIn: 'root' })
export class CartStore {
    readonly items = signal<CartItem[]>([]);
    readonly total = computed(() => this.items().reduce((sum, i) => sum + i.price * i.qty, 0));
    readonly count = computed(() => this.items().length);

    addItem(item: CartItem) {
        this.items.update(items => [...items, item]);
    }

    removeItem(id: string) {
        this.items.update(items => items.filter(i => i.id !== id));
    }
}
```

## Testing

- **Vitest or Jest** for unit tests + **Angular Testing Library** for component tests.
- **`TestBed.configureTestingModule()`** for DI setup in tests.
- **`TestBed.inject()`** to get service instances.
- **`HttpTestingController`** for mocking HTTP calls.
- **Test behavior, not implementation.** Query by role, label, text — not by CSS class.
- **Signals in tests:** Call signal setters, then verify template renders correct values.

```typescript
describe('OrderListComponent', () => {
    let component: OrderListComponent;
    let fixture: ComponentFixture<OrderListComponent>;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [OrderListComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(OrderListComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
    });

    it('should display orders after loading', () => {
        fixture.detectChanges(); // triggers initial load

        const req = httpTesting.expectOne('/api/orders');
        req.flush([{ id: '1', name: 'Order A' }, { id: '2', name: 'Order B' }]);
        fixture.detectChanges();

        const items = fixture.nativeElement.querySelectorAll('.order-card');
        expect(items.length).toBe(2);
    });
});
```

## Build and Tooling

- **Angular CLI** (`ng`) for scaffolding, building, testing, serving.
- **`ng serve`** for dev server with HMR.
- **`ng build`** for production build (tree-shaking, AOT compilation, minification).
- **`ng generate component/service/guard/pipe`** for scaffolding.
- **Environment files:** `environment.ts` / `environment.prod.ts` for env-specific config.
- **Path aliases:** Configure in `tsconfig.json` `paths` (e.g., `@app/*`, `@shared/*`).
- **Strict mode enabled:** `"strict": true` in `tsconfig.json`. No exceptions.

## Common Pitfalls -- NEVER Rules

- **NEVER** use `ChangeDetectionStrategy.Default` — always `OnPush` with signals.
- **NEVER** use `@Input()` / `@Output()` decorators — use `input()`, `output()`, `model()` signal functions.
- **NEVER** use `ngOnInit` for simple initialization — use constructor or `effect()`.
- **NEVER** use `ngClass` or `ngStyle` — use direct `[class.x]` and `[style.x]` bindings.
- **NEVER** use `*ngIf`, `*ngFor`, `*ngSwitch` — use `@if`, `@for`, `@switch` control flow.
- **NEVER** use `any` type — define proper interfaces and types.
- **NEVER** forget `track` in `@for` — it's mandatory. Use a stable unique identifier.
- **NEVER** subscribe manually without cleanup — use `takeUntilDestroyed()` or `toSignal()`.
- **NEVER** put business logic in components — delegate to services.
- **NEVER** create NgModules for new features — use standalone components with `imports`.
- **NEVER** use constructor injection — use `inject()` function.
- **NEVER** use `EventEmitter` directly — use `output()`.
- **NEVER** mutate signal values in place — always create new references with `.update()`.
- **NEVER** use `effect()` to set other signals — use `computed()` for derived state.

## Must-Haves

- **TypeScript strict mode.** `"strict": true` in `tsconfig.json`. No escape hatches.
- **Standalone components.** Every component, directive, pipe is standalone.
- **OnPush change detection.** Every component uses `ChangeDetectionStrategy.OnPush`.
- **Signal-based state.** Use `signal()`, `computed()`, `input()`, `output()` for all reactive state.
- **`inject()` for DI.** All dependency injection uses the `inject()` function.
- **Reactive Forms.** All forms use `FormBuilder` + `ReactiveFormsModule`. No template-driven forms.
- **TDD.** Tests written before implementation. Vitest/Jest + Angular Testing Library.
- **Modern control flow.** `@if`, `@for`, `@switch`, `@defer` — no structural directives.

## Good Practices

- **`toSignal()` for Observable-to-Signal.** Convert RxJS observables to signals for template use.
- **`@defer` for heavy components.** Lazy-load analytics, charts, editors with viewport trigger.
- **Route-level code splitting.** Use `loadChildren` or `loadComponent` for lazy routes.
- **Functional guards and interceptors.** Prefer functions over classes for guards/interceptors.
- **`DestroyRef` + `takeUntilDestroyed()`** for subscription cleanup in services.
- **Barrel exports via `index.ts`.** Feature directories export public API through barrel files.
- **Use the project's state library.** Check `package.json` — follow NgRx/Akita/Elf patterns, don't introduce new ones.
- **Zoneless change detection.** Use `provideZonelessChangeDetection()` for new projects — eliminates Zone.js overhead.
- **`resource()` for async data.** Use the Resource API for declarative async data loading with signals.

## Common Bugs

- **Missing `track` in `@for`.** Forgetting `track` causes runtime error. Always: `@for (item of items(); track item.id)`.
- **Subscribing without cleanup.** Manual `.subscribe()` without `takeUntilDestroyed()` causes memory leaks on component destroy.
- **Mutating signal arrays in place.** `items().push(newItem)` doesn't trigger updates. Use `items.update(i => [...i, newItem])`.
- **Using `effect()` for derived state.** `effect(() => this.total.set(this.items().length))` — use `computed()` instead.
- **ExpressionChangedAfterItHasBeenCheckedError.** Modifying state during change detection. Move logic to signals/computed or use `afterNextRender()`.
- **Circular DI dependencies.** Service A injects Service B which injects Service A. Restructure with events or a mediator service.
- **Missing imports in standalone components.** Forgetting to add used components/directives to `imports` array — they won't render but no compile error.
- **HTTP calls without error handling.** `this.http.get<T>()` without `catchError` — unhandled errors crash the observable chain.
- **Route params not reactive.** Reading `route.snapshot.paramMap` once — stale when params change. Use `route.paramMap` observable or `toSignal()`.

## Anti-Patterns

- **NgModules for new features.** Only use NgModules for legacy code migration. All new code is standalone.
- **Constructor injection.** `constructor(private service: MyService)` — use `inject()` function instead.
- **`*ngIf` / `*ngFor` structural directives.** Legacy syntax. Use `@if` / `@for` control flow.
- **Business logic in components.** API calls, data transforms, validation in components = untestable. Extract to services.
- **Giant monolithic components.** 250+ lines = extract sub-components or services.
- **`any` type.** Disables TypeScript checking. Define proper interfaces.
- **Manual DOM manipulation.** Never use `document.querySelector()` or `ElementRef.nativeElement` directly. Use Angular APIs.
- **Sharing state via `@Input()` chains.** Prop drilling through 3+ components. Use a signal-based service or state management library.
- **Overusing RxJS.** For simple state, signals are sufficient. Don't wrap everything in `BehaviorSubject` when `signal()` works.

## Standards

- **Feature-based directory structure:**
  ```
  src/app/
    features/
      orders/
        order-list.component.ts
        order-detail.component.ts
        order.service.ts
        order.model.ts
        order.routes.ts
        index.ts
      auth/
        login.component.ts
        auth.service.ts
        auth.guard.ts
        auth.interceptor.ts
        index.ts
    shared/
      components/
      pipes/
      directives/
    core/
      services/
      interceptors/
      guards/
  ```
- **kebab-case for files.** `order-list.component.ts`, `auth.service.ts`, `auth.guard.ts`.
- **PascalCase for classes.** `OrderListComponent`, `AuthService`, `OrderDetailResolver`.
- **Suffix convention.** `.component.ts`, `.service.ts`, `.guard.ts`, `.pipe.ts`, `.directive.ts`, `.interceptor.ts`.
- **One class per file.** No multiple components or services in a single file.
- **`app-` selector prefix.** All component selectors start with `app-` (configurable in `angular.json`).
- **Barrel exports.** Feature directories export via `index.ts`. Import from `@app/features/orders` not deep paths.

## Context7 Instructions

When looking up framework documentation, use these Context7 library identifiers:

- **Angular:** `/websites/v20_angular_dev` — components, signals, DI, routing, forms, testing, best practices
- **Angular (source):** `/angular/angular` — source-level API details
- **RxJS:** `ReactiveX/rxjs` — observables, operators, subjects
- **NgRx:** `ngrx/platform` — store, effects, signals store, entity
- **Vitest:** `vitest-dev/vitest` — test runner, assertions, mocking

Always check Context7 for the latest Angular API — signals, control flow, and zoneless change detection are evolving rapidly between versions.
