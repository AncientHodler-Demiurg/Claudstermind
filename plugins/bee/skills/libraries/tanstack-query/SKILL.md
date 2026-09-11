---
name: tanstack-query
description: "TanStack Query (React Query) conventions -- query keys, caching, mutations, invalidation, optimistic updates. Use when project has @tanstack/react-query or @tanstack/vue-query in package.json."
---

# TanStack Query Standards

**Detection:** Check `package.json` for `@tanstack/react-query` or `@tanstack/vue-query`. If absent, skip this skill.

## Setup

```tsx
// React
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000,   // 10 minutes (was cacheTime in v4)
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

<QueryClientProvider client={queryClient}>
  <App />
</QueryClientProvider>
```

## Query Keys

Query keys uniquely identify cached data. Structure them as tuples for granular invalidation:

```typescript
// Pattern: [entity, scope, filters]
const queryKeys = {
  orders: {
    all: ['orders'] as const,
    lists: () => [...queryKeys.orders.all, 'list'] as const,
    list: (filters: OrderFilters) => [...queryKeys.orders.lists(), filters] as const,
    details: () => [...queryKeys.orders.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.orders.details(), id] as const,
  },
};

// Usage
useQuery({ queryKey: queryKeys.orders.detail(orderId), queryFn: () => fetchOrder(orderId) });

// Invalidation — all order lists (any filter combination)
queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists() });

// Invalidation — everything orders
queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
```

Key rule: query keys are arrays. Matching uses prefix — `['orders']` invalidates `['orders', 'list']` and `['orders', 'detail', '123']`.

## Queries

```typescript
function useOrders(filters: OrderFilters) {
  return useQuery({
    queryKey: queryKeys.orders.list(filters),
    queryFn: () => api.getOrders(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData, // keep old data while new filters load
  });
}

function useOrder(id: string) {
  return useQuery({
    queryKey: queryKeys.orders.detail(id),
    queryFn: () => api.getOrder(id),
    enabled: !!id, // don't fetch until id exists
  });
}
```

## Mutations

```typescript
function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateOrderDto) => api.createOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists() });
    },
  });
}
```

### Optimistic Updates

```typescript
function useUpdateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateOrderDto }) => api.updateOrder(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.orders.detail(id) });
      const previous = queryClient.getQueryData(queryKeys.orders.detail(id));
      queryClient.setQueryData(queryKeys.orders.detail(id), (old: Order) => ({ ...old, ...data }));
      return { previous };
    },
    onError: (_err, { id }, context) => {
      queryClient.setQueryData(queryKeys.orders.detail(id), context?.previous);
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
    },
  });
}
```

## Pagination

```typescript
function useOrdersPaginated(page: number) {
  return useQuery({
    queryKey: queryKeys.orders.list({ page }),
    queryFn: () => api.getOrders({ page }),
    placeholderData: keepPreviousData, // smooth page transitions
  });
}

// Infinite scroll
function useOrdersInfinite() {
  return useInfiniteQuery({
    queryKey: queryKeys.orders.lists(),
    queryFn: ({ pageParam }) => api.getOrders({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}
```

## Common Pitfalls

- **Unstable query keys** — creating new object references in keys causes refetching. Use factory pattern above.
- **Missing invalidation after mutation** — data stays stale after create/update/delete. Always invalidate.
- **Over-invalidating** — invalidating `['orders']` refetches ALL order queries. Be specific when possible.
- **Not using `enabled`** — query fires immediately. Use `enabled: !!id` to wait for dependencies.
- **`gcTime` vs `staleTime`** — staleTime = when to refetch. gcTime = when to garbage collect from cache.
- **Forgetting `placeholderData`** — without it, filters/pagination show loading state on every change.
- **Using TanStack Query for Inertia data** — if using Inertia.js, page props are the data source. Use TanStack Query only for non-Inertia endpoints (WebSocket, polling, external APIs).

## Context7

- **TanStack Query:** search for `tanstack/query` — hooks, queryClient, devtools, pagination
