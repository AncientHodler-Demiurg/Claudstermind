---
name: zustand
description: "Zustand state management conventions -- stores, selectors, middleware, persist, devtools. Use when project has zustand in package.json."
---

# Zustand Standards

**Detection:** Check `package.json` for `zustand`. If absent, skip.

## Store Definition

```typescript
import { create } from 'zustand';

interface AuthStore {
  user: User | null;
  token: string | null;
  login: (credentials: LoginDto) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  login: async (credentials) => {
    const { user, token } = await api.login(credentials);
    set({ user, token });
  },
  logout: () => set({ user: null, token: null }),
  setUser: (user) => set({ user }),
}));
```

## Selectors (performance-critical)

Select only what you need — components re-render only when their selected value changes:

```typescript
// Good — component re-renders only when user changes
const user = useAuthStore((state) => state.user);
const login = useAuthStore((state) => state.login);

// Bad — component re-renders on ANY store change
const store = useAuthStore();
```

For multiple selectors, use `useShallow` to prevent unnecessary re-renders:

```typescript
import { useShallow } from 'zustand/react/shallow';

const { user, token } = useAuthStore(useShallow((state) => ({
  user: state.user,
  token: state.token,
})));
```

## Middleware

### Persist (localStorage/AsyncStorage)

```typescript
import { persist, createJSONStorage } from 'zustand/middleware';

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: 'system' as 'light' | 'dark' | 'system',
      locale: 'en',
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ theme: state.theme, locale: state.locale }), // persist only these fields
    },
  ),
);
```

### Devtools

```typescript
import { devtools } from 'zustand/middleware';

export const useCartStore = create<CartStore>()(
  devtools(
    (set) => ({ /* store definition */ }),
    { name: 'CartStore' }, // label in Redux DevTools
  ),
);
```

### Combine middleware

```typescript
// persist + devtools
export const useStore = create<Store>()(
  devtools(
    persist(
      (set) => ({ /* ... */ }),
      { name: 'store' },
    ),
    { name: 'Store' },
  ),
);
```

## Async Actions

```typescript
interface OrderStore {
  orders: Order[];
  loading: boolean;
  error: string | null;
  fetchOrders: () => Promise<void>;
}

export const useOrderStore = create<OrderStore>((set) => ({
  orders: [],
  loading: false,
  error: null,
  fetchOrders: async () => {
    set({ loading: true, error: null });
    try {
      const orders = await api.getOrders();
      set({ orders, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Unknown error', loading: false });
    }
  },
}));
```

## Common Pitfalls

- **Selecting entire store** — `useStore()` without selector re-renders on every change. Always use selectors.
- **Mutating state directly** — Zustand uses immutable updates. `set({ items: [...state.items, newItem] })` not `state.items.push(newItem)`.
- **Missing `useShallow`** — selecting object/array without shallow comparison causes unnecessary re-renders.
- **Persist with sensitive data** — localStorage is not encrypted. Never persist tokens. Use `partialize` to exclude sensitive fields.
- **Store as God object** — one massive store for everything. Split into domain stores: `useAuthStore`, `useCartStore`, `useUIStore`.
- **Forgetting TypeScript generics** — `create<StoreType>()` with extra `()` is needed when using middleware.

## Context7

- **Zustand:** search for `zustand` — stores, middleware, selectors, persist, devtools
