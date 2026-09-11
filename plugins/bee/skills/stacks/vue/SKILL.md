---
name: vue
description: Vue 3.5 standalone conventions with Vite, Vue Router 4, Pinia, TypeScript
---

# Vue Standards

These standards apply when the project stack is `vue`. All agents and implementations must follow these conventions.

**Also read `skills/standards/frontend/SKILL.md`** for universal frontend standards (component architecture, accessibility, responsive design, CSS methodology, design quality) that apply alongside these Vue-specific conventions.

## Component Architecture

- **Single-File Components (SFCs) only.** Every component is a `.vue` file with `<script setup lang="ts">`, `<template>`, and optionally `<style scoped>`.
- **`<script setup>` is the ONLY accepted syntax.** NEVER use Options API. NEVER use a plain `<script>` block with `export default defineComponent()` unless you need `inheritAttrs: false` (use a separate `<script>` block for that single option only).
- **Single responsibility:** Each component does one thing. If a component handles form state AND layout AND API calls, split it.
- **Composition over inheritance:** Use slots, composables, and provide/inject -- never extend components.
- **Props design:** Use `defineProps` with TypeScript generics. Provide defaults via `withDefaults`. Keep prop interfaces narrow.
- **Slots for content distribution:** Use named slots for wrapper components (layouts, modals, cards). Use scoped slots when children need parent data.
- **Compound components:** Group related components under a directory with a barrel export (`Tabs/TabList.vue`, `Tabs/TabPanel.vue`, `Tabs/index.ts`).
- **Max 250 lines per visual component.** If larger, extract sub-components or composables.
- **No business logic in visual components.** Components render UI only. Extract data fetching, transformations, validation, and state machines into composables. Components orchestrate composables and render templates -- nothing else.
- **SFC section order:** `<script setup>` first, then `<template>`, then `<style scoped>`. Always follow this order.

```vue
<!-- Pattern: component with props, emits, slots, and composable -->
<script setup lang="ts">
import { computed } from 'vue'
import { useOrders } from '@/composables/useOrders'

interface Props {
    customerId: string
    limit?: number
}

const props = withDefaults(defineProps<Props>(), {
    limit: 10,
})

const emit = defineEmits<{
    select: [orderId: string]
}>()

const { orders, loading, error } = useOrders(props.customerId, props.limit)

const totalValue = computed(() =>
    orders.value.reduce((sum, o) => sum + o.total, 0)
)
</script>

<template>
    <div>
        <slot name="header" :total="totalValue" />
        <ul v-if="!loading">
            <li v-for="order in orders" :key="order.id" @click="emit('select', order.id)">
                {{ order.name }} -- {{ order.total }}
            </li>
        </ul>
        <p v-else>Loading...</p>
        <slot name="footer" />
    </div>
</template>
```

## Composition API

### Reactive State

- **`ref()`** for all reactive values -- primitives and objects. Prefer `ref` over `reactive` for consistency and clarity.
- **`reactive()`** for deeply nested objects only when you need automatic unwrapping. Use sparingly -- `ref()` is the default choice.
- **`computed()`** for derived values that depend on reactive state. NEVER store derived values in a separate `ref` and sync them with `watch`.
- **`toRefs()` / `toRef()`** to destructure reactive objects without losing reactivity. Use when spreading props or reactive objects.
- **`shallowRef()` / `shallowReactive()`** for large objects where deep reactivity is unnecessary (e.g., large lists, third-party object instances).

### Watchers

- **`watch()`** for explicit side effects on specific sources. Always provide a source (ref, getter, or array of sources).
- **`watchEffect()`** for side effects that auto-track their dependencies. Runs immediately on creation.
- **`watchPostEffect()`** when you need to access updated DOM after a reactive change.
- **Cleanup:** Use the `onCleanup` parameter in `watch` / `watchEffect` callbacks for abort controllers, timers, and subscriptions.
- **`once: true`** option (Vue 3.4+) for watchers that should fire only once.

```ts
// Pattern: watch with cleanup and abort
watch(searchQuery, async (query, _oldQuery, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())

    loading.value = true
    try {
        results.value = await fetchResults(query, { signal: controller.signal })
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        error.value = e as Error
    } finally {
        loading.value = false
    }
})
```

### Lifecycle Hooks

- **`onMounted()`** for DOM access, third-party library initialization, initial data fetching.
- **`onUnmounted()`** for cleanup: remove event listeners, clear timers, abort requests, disconnect observers.
- **`onBeforeUnmount()`** for cleanup that must happen before DOM removal.
- **`onUpdated()`** -- use sparingly. Prefer `watch` or `watchEffect` for reactive side effects.
- **`onActivated()` / `onDeactivated()`** for components inside `<KeepAlive>`.
- Always pair setup with teardown: if `onMounted` adds a listener, `onUnmounted` removes it.

## TypeScript Integration

### Props

- **`defineProps<T>()`** with a TypeScript interface for type-safe props.
- **`withDefaults()`** for default values when using the type-only syntax.

```vue
<script setup lang="ts">
interface Props {
    title: string
    items: Item[]
    variant?: 'primary' | 'secondary'
    onAction?: (id: string) => void
}

const props = withDefaults(defineProps<Props>(), {
    variant: 'primary',
})
</script>
```

### Emits

- **`defineEmits<T>()`** with typed event signatures. Use the tuple syntax for payload types.

```ts
const emit = defineEmits<{
    update: [id: number, value: string]
    delete: [id: number]
    close: []
}>()
```

### defineModel

- **`defineModel()`** for two-way binding (v-model support). Replaces the `modelValue` prop + `update:modelValue` emit pattern.

```ts
// Parent: <ToggleSwitch v-model="isEnabled" v-model:label="labelText" />
const isEnabled = defineModel<boolean>({ required: true })
const label = defineModel<string>('label', { default: 'Toggle' })
```

### defineExpose

- **`defineExpose()`** to explicitly expose properties to parent template refs. By default, `<script setup>` components expose nothing.

```ts
defineExpose({
    reset: () => { formData.value = initialState },
    validate: () => schema.safeParse(formData.value),
})
```

### defineSlots

- **`defineSlots<T>()`** for typed slot props. Enables type checking on scoped slot content.

```ts
defineSlots<{
    default: (props: { item: Item; index: number }) => any
    header: (props: { total: number }) => any
    empty: () => any
}>()
```

### Generic Components

- Use the `generic` attribute on `<script setup>` for reusable generic components.

```vue
<script setup lang="ts" generic="T extends { id: string | number }">
defineProps<{
    items: T[]
    selected?: T
}>()

defineEmits<{
    select: [item: T]
}>()
</script>
```

## Composables

- **Composables are the Vue equivalent of React custom hooks.** They encapsulate reusable stateful logic.
- **Naming convention:** Always prefix with `use`: `useAuth()`, `useFilters()`, `usePagination()`, `useDebounce()`.
- **Directory:** Shared composables live in `src/composables/`. Feature-specific composables colocate with the feature.
- **Return signature:** A composable returns an object of refs, computed values, and functions. It is a self-contained unit of logic.
- **Accept refs as arguments:** Use `MaybeRef<T>` or `MaybeRefOrGetter<T>` for composable parameters so callers can pass either raw values or refs.
- **Cleanup:** If a composable sets up listeners or timers, it must clean them up via `onUnmounted` or watcher cleanup.

```ts
// Pattern: composable with ref input, cleanup, and abort
import { ref, watch, onUnmounted, type MaybeRefOrGetter, toValue } from 'vue'

export function useFetch<T>(url: MaybeRefOrGetter<string>) {
    const data = ref<T | null>(null)
    const loading = ref(true)
    const error = ref<Error | null>(null)
    let controller: AbortController | null = null

    const fetchData = async () => {
        controller?.abort()
        controller = new AbortController()
        loading.value = true
        error.value = null

        try {
            const res = await fetch(toValue(url), { signal: controller.signal })
            data.value = await res.json()
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') return
            error.value = e as Error
        } finally {
            loading.value = false
        }
    }

    watch(() => toValue(url), fetchData, { immediate: true })
    onUnmounted(() => controller?.abort())

    return { data, loading, error, refetch: fetchData }
}
```

## State Management

### Local State

- `ref()` for component-level state. Keep state as close to where it is used as possible.
- Lift state up only when two siblings need the same data. Avoid premature lifting.

### Shared State

**Detect what the project uses** -- check `package.json` for installed state management libraries and follow THAT library's conventions. Do NOT introduce a different state library than what the project already uses.

### Pinia (Recommended)

- **Setup stores (Composition API syntax) are preferred** over option stores for consistency with `<script setup>`.
- Store files live in `src/stores/` with `use*Store` naming: `useAuthStore.ts`, `useCartStore.ts`.
- **State:** `ref()` values. **Getters:** `computed()` values. **Actions:** plain functions. All must be returned.
- Use `storeToRefs()` when destructuring store state to maintain reactivity: `const { count, name } = storeToRefs(store)`.
- Actions can be async. Handle loading and error states inside the action.
- NEVER mutate store state directly from components -- always use actions.
- Use `$reset()` for resetting state (define it manually in setup stores).
- Use `$subscribe()` for reacting to state changes outside components.

```ts
// Pattern: Pinia setup store with TypeScript
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
    const user = ref<User | null>(null)
    const token = ref<string | null>(null)
    const loading = ref(false)

    const isAuthenticated = computed(() => !!token.value)
    const displayName = computed(() => user.value?.name ?? 'Guest')

    async function login(credentials: LoginCredentials) {
        loading.value = true
        try {
            const res = await api.post<AuthResponse>('/auth/login', credentials)
            user.value = res.data.user
            token.value = res.data.token
        } finally {
            loading.value = false
        }
    }

    function logout() {
        user.value = null
        token.value = null
    }

    function $reset() {
        user.value = null
        token.value = null
        loading.value = false
    }

    return { user, token, loading, isAuthenticated, displayName, login, logout, $reset }
})
```

### Vuex (Legacy)

- If the project uses Vuex, follow its existing module structure. Use typed accessors.
- NEVER introduce Pinia into a Vuex project without explicit user direction.

### Plain Composables

- For small apps without Pinia, shared composables with `ref()` at module scope act as simple global stores.
- This is acceptable for prototypes or very small apps. Recommend Pinia for anything beyond trivial shared state.

**Key rule:** Match the project. If the project uses Pinia, write Pinia. If it uses Vuex, write Vuex. Never mix state libraries without explicit user direction.

## Routing -- Vue Router 4

### Router Setup

- Use `createRouter` with `createWebHistory` for HTML5 history mode (recommended) or `createWebHashHistory` for hash mode.
- Define routes in a dedicated `src/router/index.ts` file.
- Use typed route meta via module augmentation for `RouteMeta`.

```ts
// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
    interface RouteMeta {
        requiresAuth?: boolean
        title?: string
    }
}

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        {
            path: '/',
            component: () => import('@/layouts/DefaultLayout.vue'),
            children: [
                { path: '', name: 'home', component: () => import('@/pages/HomePage.vue') },
                {
                    path: 'orders',
                    name: 'orders',
                    component: () => import('@/pages/OrdersPage.vue'),
                    meta: { requiresAuth: true },
                },
                {
                    path: 'orders/:id',
                    name: 'order-detail',
                    component: () => import('@/pages/OrderDetailPage.vue'),
                    meta: { requiresAuth: true },
                },
            ],
        },
        { path: '/login', name: 'login', component: () => import('@/pages/LoginPage.vue') },
        { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/pages/NotFoundPage.vue') },
    ],
})
```

### Navigation Guards

- **Global `beforeEach`** for authentication checks, page titles, and analytics.
- **Per-route `beforeEnter`** for route-specific authorization.
- **In-component guards** via `onBeforeRouteLeave` and `onBeforeRouteUpdate` composables from `vue-router`.
- Protected routes: check auth in `beforeEach`, redirect to login with return URL.

```ts
router.beforeEach(async (to, from) => {
    const authStore = useAuthStore()

    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
        return { name: 'login', query: { redirect: to.fullPath } }
    }
})

router.afterEach((to) => {
    document.title = to.meta.title || 'My App'
})
```

### Navigation Patterns

- **`useRouter()`** for programmatic navigation: `router.push()`, `router.replace()`, `router.back()`.
- **`useRoute()`** for reading current route params, query, and meta. Access is reactive.
- **`<RouterLink>`** for declarative navigation in templates. Use `active-class` for styling.
- **Lazy loading:** Always use dynamic imports (`() => import(...)`) for route components. Vite handles code splitting automatically.
- **Nested routes:** Use `<RouterView>` in parent layout components for child route rendering.

```vue
<!-- Pattern: in-component guard for unsaved changes -->
<script setup lang="ts">
import { ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

const hasUnsavedChanges = ref(false)

onBeforeRouteLeave(() => {
    if (hasUnsavedChanges.value) {
        const confirm = window.confirm('You have unsaved changes. Leave anyway?')
        if (!confirm) return false
    }
})
</script>
```

## Forms and Validation

### v-model Patterns

- **`v-model`** for two-way binding on native inputs and custom components.
- **`v-model` with modifiers:** `.trim`, `.number`, `.lazy` for built-in transformations.
- **Multiple v-model bindings:** `v-model:title="title" v-model:content="content"` on custom components using `defineModel()`.
- **Controlled inputs:** Bind `:value` + `@input` when you need to intercept or transform input.

### VeeValidate + Zod (If Installed)

- **VeeValidate** for form management with `useForm()`, `useField()`, and `<Form>` / `<Field>` components.
- **Zod** for type-safe schema validation. Derive TypeScript types from schemas with `z.infer<typeof schema>`.
- Use `@vee-validate/zod` adapter with `toTypedSchema()` for integration.

```vue
<script setup lang="ts">
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'

const schema = z.object({
    email: z.string().email('Invalid email'),
    password: z.string().min(8, 'Min 8 characters'),
})

type FormData = z.infer<typeof schema>

const { handleSubmit, errors, defineField } = useForm<FormData>({
    validationSchema: toTypedSchema(schema),
})

const [email, emailAttrs] = defineField('email')
const [password, passwordAttrs] = defineField('password')

const onSubmit = handleSubmit(async (values) => {
    await api.post('/auth/login', values)
})
</script>

<template>
    <form @submit.prevent="onSubmit">
        <input v-model="email" v-bind="emailAttrs" type="email" />
        <span v-if="errors.email">{{ errors.email }}</span>
        <input v-model="password" v-bind="passwordAttrs" type="password" />
        <span v-if="errors.password">{{ errors.password }}</span>
        <button type="submit">Log in</button>
    </form>
</template>
```

### Custom Form Composables

- For simple forms without VeeValidate, extract form logic into a composable: `useLoginForm()`, `useOrderForm()`.
- The composable returns reactive form data, validation errors, submit handler, and loading state.

## Build and Tooling -- Vite

- **Vite** as the build tool and dev server. Use `@vitejs/plugin-vue` plugin.
- **Environment variables:** Use `VITE_` prefix. Access via `import.meta.env.VITE_API_URL`. Never expose secrets without prefix.
- **Path aliases:** Configure in `vite.config.ts` under `resolve.alias` (e.g., `@/` maps to `src/`). Mirror in `tsconfig.json` `paths`.
- **Dev server proxy:** Configure `server.proxy` in Vite config for API calls to avoid CORS during development.
- **Code splitting:** Vite handles this automatically via dynamic imports. Use `defineAsyncComponent()` or route-level lazy loading for splitting.
- **Build optimization:** Use `build.rollupOptions.output.manualChunks` for vendor splitting when needed.
- **Environment modes:** `.env`, `.env.local`, `.env.production`, `.env.staging` -- loaded based on `--mode` flag.

```ts
// vite.config.ts -- typical Vue project configuration
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
    plugins: [vue()],
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
})
```

## Testing

- **Vitest** + **Vue Test Utils** (or **Vue Testing Library**) for all component and composable tests.
- Use `mount()` / `shallowMount()` from Vue Test Utils, or `render()` / `screen` from Vue Testing Library.
- **Test user behavior, not implementation details.** Query by role, label, text -- not by class name or test ID.
- **Mock API calls with MSW** (Mock Service Worker) for network-level mocking. Prefer over `vi.mock()` for fetch/axios.
- Test composables by calling them inside a test component or using a `withSetup()` helper.
- **Test loading and error states** -- verify conditional rendering works for all async states.
- **Snapshot tests:** Use sparingly and only for stable UI. Prefer explicit assertions.

```ts
// Pattern: component test with Vue Test Utils
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import OrderList from '@/components/OrderList.vue'

test('renders orders and handles selection', async () => {
    const wrapper = mount(OrderList, {
        props: { customerId: '123' },
        global: {
            plugins: [createTestingPinia({
                initialState: { orders: { items: mockOrders } },
            })],
        },
    })

    expect(wrapper.findAll('li')).toHaveLength(mockOrders.length)
    await wrapper.find('li').trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['order-1'])
})

// Pattern: composable test
import { useFetch } from '@/composables/useFetch'
import { flushPromises } from '@vue/test-utils'

test('fetches data and exposes reactive state', async () => {
    const { data, loading, error } = withSetup(() => useFetch<User[]>('/api/users'))

    expect(loading.value).toBe(true)
    await flushPromises()
    expect(loading.value).toBe(false)
    expect(data.value).toHaveLength(3)
    expect(error.value).toBeNull()
})
```

## Provide / Inject

- **Dependency injection** for passing data deeply without prop drilling. Use for themes, configuration, and service instances.
- **Always type with `InjectionKey<T>`** for type safety.
- **Provide at the app or layout level**, inject in any descendant.
- Use a composable to wrap inject with a descriptive error for missing providers.

```ts
// keys.ts
import type { InjectionKey } from 'vue'

export const ThemeKey: InjectionKey<Ref<'light' | 'dark'>> = Symbol('Theme')
export const ApiClientKey: InjectionKey<ApiClient> = Symbol('ApiClient')

// Provider component
import { provide, ref } from 'vue'
const theme = ref<'light' | 'dark'>('light')
provide(ThemeKey, theme)

// Consumer composable (recommended pattern)
export function useTheme() {
    const theme = inject(ThemeKey)
    if (!theme) throw new Error('useTheme must be used within a ThemeProvider')
    return theme
}
```

## Teleport, Suspense, KeepAlive

### Teleport

- Use `<Teleport to="body">` for modals, toasts, and tooltips that need to render outside the component tree.
- Always specify a valid CSS selector target. Ensure the target exists in the DOM before the Teleport mounts.
- Use `disabled` prop to conditionally disable teleporting (e.g., render inline on mobile).

### Suspense (Experimental)

- Use `<Suspense>` to handle async components with `#default` and `#fallback` slots.
- Wrap async components (those with top-level `await` in `<script setup>`) in Suspense.
- Nest Suspense boundaries: outer for the page, inner for independent async sections.
- Pair with `onErrorCaptured` or an `<ErrorBoundary>` component for error handling.

```vue
<template>
    <Suspense>
        <template #default>
            <AsyncDashboard />
        </template>
        <template #fallback>
            <LoadingSkeleton />
        </template>
    </Suspense>
</template>
```

### KeepAlive

- Use `<KeepAlive>` to cache component instances when toggling between them (tabs, wizard steps).
- Use `include` / `exclude` props to control which components are cached by name.
- Set `max` to limit cached instances and prevent memory leaks.
- Use `onActivated()` / `onDeactivated()` lifecycle hooks for setup/teardown in kept-alive components.

```vue
<KeepAlive :include="['OrderList', 'UserProfile']" :max="5">
    <component :is="currentTab" />
</KeepAlive>
```

## Common Pitfalls -- NEVER Rules

- **NEVER** use Options API -- always use `<script setup>` with Composition API.
- **NEVER** mutate props directly -- emit events to parent or use `defineModel()` for two-way binding.
- **NEVER** use `reactive()` for primitive values -- use `ref()`. Reassigning a reactive variable loses reactivity.
- **NEVER** destructure props without `toRefs()` or `toRef()` -- destructured values lose reactivity.
- **NEVER** forget `.value` when accessing refs in `<script setup>` -- templates auto-unwrap, but script does not.
- **NEVER** use `v-if` and `v-for` on the same element -- `v-if` has higher priority in Vue 3 and cannot access the `v-for` scope variable. Wrap with `<template v-for>` and put `v-if` on the child.
- **NEVER** use index as key in `v-for` lists that reorder or mutate -- use a stable unique identifier.
- **NEVER** store derived state in a separate `ref` and sync it with `watch` -- use `computed()` instead.
- **NEVER** use `any` type in TypeScript -- define proper interfaces, generics, or `unknown`.
- **NEVER** expose secrets in `import.meta.env` without `VITE_` prefix -- unprefixed vars are not available client-side, but setting `envPrefix` to empty string is a security risk.
- **NEVER** forget cleanup in `onMounted` -- if you add event listeners, timers, or observers, remove them in `onUnmounted`.
- **NEVER** use `this` in `<script setup>` -- there is no component instance. All state is accessed directly via refs and composables.
- **NEVER** call composables inside callbacks, loops, or conditions -- call them at the top level of `<script setup>` or inside other composables, just like React hooks.
- **NEVER** access `$refs`, `$emit`, `$slots` via the Options API style -- use `useTemplateRef()`, `defineEmits()`, and `useSlots()` instead.

## Must-Haves

- **TypeScript everywhere.** All components, composables, utilities, and tests are written in TypeScript with strict mode. No `.js` files in the source tree.
- **`<script setup>` only.** Every Vue component uses `<script setup lang="ts">`. No Options API, no `defineComponent()` blocks.
- **Composables for stateful logic.** Extract reusable stateful logic into composables (`use*` prefix). Components orchestrate composables, not contain raw logic.
- **TDD with Vitest.** All features developed test-first using Vitest and Vue Test Utils or Vue Testing Library.
- **Stable key props on `v-for` lists.** Every list element has a stable, unique `:key` derived from domain data -- never from array index in dynamic lists.
- **Explicit return types on public APIs.** Exported composables, utility functions, and store definitions have explicit types.
- **Cleanup in lifecycle hooks.** Every `onMounted` with listeners, timers, or async must have a corresponding `onUnmounted` cleanup.
- **Typed props with `defineProps<T>()`.** All component props are typed via TypeScript generics, never runtime-only prop validation.
- **Error handling for async operations.** All async composables and actions expose loading, error, and data states.

## Good Practices

- **Composition over prop drilling.** Use provide/inject, composables, or slots instead of threading data through layers.
- **`shallowRef` for large collections.** Use `shallowRef` for lists of hundreds+ items where deep reactivity is unnecessary.
- **Split components at responsibility boundaries.** Layout + data fetching = two components. Container + presentation = two components.
- **Colocate state with consumers.** Keep state in the lowest common ancestor. Lift only when truly needed.
- **Prefer `computed` for derived data.** NEVER store derived values in separate refs and sync with watchers.
- **Lazy load heavy routes.** Use dynamic imports for route components. Vite handles code splitting automatically.
- **Use the project's state library.** Check `package.json` first -- follow established patterns, don't introduce new libraries.
- **`v-memo` for expensive list rendering.** Use `v-memo` on `v-for` items to skip re-rendering unchanged items in large lists.
- **Typed provide/inject.** Always use `InjectionKey<T>` for type-safe dependency injection.
- **Scoped styles by default.** Use `<style scoped>` to prevent CSS leakage. Use `:deep()` only when targeting child component internals.
- **Async components with `defineAsyncComponent`.** Use for heavy components not needed at initial render (charts, editors, maps).
- **`watchEffect` for auto-tracking.** Use `watchEffect` when the callback reads multiple reactive sources -- no need to list dependencies manually.

## Common Bugs

- **Lost reactivity from destructuring.** Destructuring `reactive()` or `props` loses reactivity. Use `toRefs(props)` or access as `props.name`.
- **Forgetting `.value` in script.** Accessing a `ref` without `.value` in `<script setup>` returns the ref object, not the value. Templates auto-unwrap -- script does not.
- **`v-if` + `v-for` on same element.** In Vue 3, `v-if` is evaluated first and cannot access `v-for` scope. Move `v-for` to a `<template>` wrapper.
- **Mutating props.** Directly modifying props triggers a warning and causes unpredictable behavior. Emit events or use `defineModel()`.
- **Missing key in `v-for`.** No key or unstable key causes DOM thrashing and lost component state.
- **Reactive object reassignment.** Reassigning a `reactive()` variable (`state = newObj`) replaces the reference and breaks reactivity. Use `ref()` or `Object.assign()`.
- **Stale closure in watchers.** Capturing refs by value in closures (e.g., `const val = ref.value` before async) reads stale data. Always read `.value` at the point of use.
- **Forgetting async error handling.** Async composables without try/catch leave UI in loading state forever when requests fail.
- **Teleport target missing.** Using `<Teleport to="#modal-root">` when the target element doesn't exist causes a runtime warning and the content doesn't render.
- **Watch on reactive object without `deep`.** Watching a `reactive()` object detects only reassignment by default. Use `{ deep: true }` or watch specific properties via getter.

## Anti-Patterns

- **Options API in new code.** Cannot leverage `<script setup>`, composables, or modern TypeScript integration. Always use Composition API.
- **Using `any` type.** Disables type checking and hides bugs. Use proper interfaces, generics, or `unknown`.
- **God components.** 500+ line components with API calls, state, business logic, and presentation -- untestable and unmaintainable. Extract composables and sub-components.
- **Business logic in components.** API calls, data transforms, complex validation, state machines belong in composables. Components call composables and render templates -- nothing else.
- **Prop drilling through 3+ layers.** Refactor with provide/inject, composables, or slots.
- **Watchers for derived state.** Watch state A, set state B = extra render + sync bugs. Use `computed()`.
- **Global event bus.** Replaced by provide/inject, Pinia stores, or composables. Event buses are untraceable and untestable.
- **Mixins.** Replaced by composables. Mixins have implicit dependencies, name collisions, and are difficult to type.
- **`$forceUpdate()` / direct DOM manipulation.** Let Vue's reactivity system handle updates. If you need `$forceUpdate`, your data flow is broken.
- **Overusing `watch` and `watchEffect`.** Most "reactive side effects" can be expressed as `computed` values or template bindings. Only use watchers for true side effects (API calls, analytics, logging).

## Standards

- **PascalCase for component files.** `OrderList.vue`, `UserProfile.vue`, `DefaultLayout.vue`.
- **camelCase composables with `use` prefix.** `useAuth.ts`, `usePagination.ts`, `useDebounce.ts`.
- **camelCase for utility files.** `formatDate.ts`, `apiClient.ts`, `validators.ts`.
- **Barrel exports via index.ts.** Feature directories export public API through `index.ts`. Internal details not re-exported.
- **Colocate tests with source files.** `OrderList.vue` and `OrderList.test.ts` in the same directory.
- **One component per file.** No multiple component definitions in a single `.vue` file.
- **Absolute imports via path alias.** Use `@/` for all imports from `src/`. Never use relative paths that climb more than one level.
- **Store files named with `use*Store`.** `useAuthStore.ts`, `useCartStore.ts`, `useOrderStore.ts`.
- **Feature-based directory structure.** Group by feature, not by type:
  ```
  src/
    features/
      orders/
        OrderList.vue
        OrderList.test.ts
        OrderDetail.vue
        useOrders.ts
        orderApi.ts
        index.ts
      auth/
        LoginForm.vue
        useAuth.ts
        authApi.ts
        index.ts
    composables/     (shared composables)
    components/      (shared UI components)
    stores/          (Pinia stores)
    router/          (router config and guards)
    lib/             (utilities, api client, constants)
    layouts/         (layout components)
    pages/           (route-level page components)
  ```

## Context7 Instructions

When looking up framework documentation, use these Context7 library identifiers:

- **Vue 3:** `/vuejs/docs` -- Composition API, reactivity, components, script setup, TypeScript, built-in components
- **Vue Router:** `/vuejs/router` -- routing, guards, navigation, nested routes, lazy loading, Composition API
- **Pinia:** `/vuejs/pinia` -- stores, state, getters, actions, plugins, TypeScript, setup stores
- **Vite:** `/websites/vite_dev` -- configuration, build, environment variables, plugins, dev server
- **Vitest:** `vitest-dev/vitest` -- test runner, assertions, mocking, configuration
- **VeeValidate:** Look up `vee-validate` -- form validation, useForm, useField, Zod integration

Always check Context7 for the latest API when working with Vue 3.5 features (defineModel, defineSlots, generic components, Suspense). Training data may be outdated.
