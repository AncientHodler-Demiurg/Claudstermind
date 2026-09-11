---
name: backend-standards
description: Universal backend standards -- API design, database, migrations, query optimization
---

# Backend Standards

These standards apply to ALL backend code regardless of framework (Laravel, NestJS, or others). They define stack-agnostic principles -- the "what" and "why" of backend quality. Framework-specific ORM syntax and implementation patterns belong in stack skills.

## API Design

### RESTful Conventions

- **Resource-based URLs** with plural nouns: `/orders`, `/users`, `/products`. Not verbs (`/getOrders`, `/createUser`).
- **HTTP verbs** express the action: `GET` (read), `POST` (create), `PUT` (full replace), `PATCH` (partial update), `DELETE` (remove).
- Nested resources for parent-child relationships: `/orders/{id}/items`. Max 2 levels of nesting.
- Use query parameters for filtering, sorting, and searching: `/orders?status=active&sort=-created_at`.

### Status Codes

Use correct HTTP status codes consistently:

| Code | Meaning           | When to Use                                        |
|------|-------------------|----------------------------------------------------|
| 200  | OK                | Successful GET, PUT, PATCH                         |
| 201  | Created           | Successful POST that creates a resource            |
| 204  | No Content        | Successful DELETE with no response body            |
| 400  | Bad Request       | Malformed request syntax, invalid JSON, missing required headers |
| 401  | Unauthorized      | Missing or invalid authentication credentials      |
| 403  | Forbidden         | Authenticated but insufficient permissions         |
| 404  | Not Found         | Resource does not exist                            |
| 422  | Unprocessable     | Validation failed (well-formed but semantically wrong) |
| 429  | Too Many Requests | Rate limit exceeded (include Retry-After header)   |
| 500  | Server Error      | Unexpected server failure                          |

**400 vs 422 distinction:** Use 400 when the request is structurally malformed (invalid JSON, missing Content-Type, unparseable body). Use 422 when the request is structurally valid but fails business validation (email already taken, amount exceeds limit, date in the past). If the server can parse the body and identify which field is wrong, it's 422. If it can't even parse the body, it's 400.

### Error Response Format

- Consistent error structure across all endpoints:

```json
{
  "error": "Validation failed",
  "message": "Human-readable explanation of what went wrong",
  "details": {
    "email": ["Email is required", "Email must be a valid email address"],
    "name": ["Name must be at least 2 characters"]
  }
}
```

- Never expose stack traces, SQL errors, or internal paths in error responses.
- Include a machine-readable `error` code and a human-readable `message`.

### Pagination

- **Cursor-based pagination** preferred for real-time data (no skipping/duplicates on data changes).
- **Offset/limit pagination** acceptable for static datasets and admin interfaces.
- Always include metadata: `total`, `per_page`, `current_page` (offset) or `next_cursor` (cursor).
- Default page size: 20-50 items. Allow client to override within a maximum (e.g., max 100).

### Rate Limiting

- Protect expensive endpoints (search, file upload, auth) with rate limits.
- Return `429 Too Many Requests` with `Retry-After` header when limit is hit.
- Rate limits by IP for unauthenticated routes, by user/token for authenticated routes.
- Document rate limits in API documentation.

### Versioning

- URL prefix versioning: `/api/v1/`, `/api/v2/`. Simple, explicit, easy to route.
- Only introduce a new version for breaking changes. Non-breaking additions go in the current version.
- Support the previous version for a documented deprecation period.

### Request/Response Contracts

- **Always validate input.** Every endpoint validates its request body, query parameters, and path parameters.
- **Always type output.** Response shapes are defined by DTOs or resource classes, not raw database objects.
- Document all endpoints with request/response schemas (OpenAPI/Swagger or equivalent).

## Database

### Timestamps

- `created_at` and `updated_at` on ALL tables. No exceptions.
- Use database-level defaults for `created_at`. Use triggers or ORM hooks for `updated_at`.
- Store timestamps in UTC. Convert to local timezone only in the presentation layer.

### Foreign Key Constraints

- Always define foreign key constraints at the database level. Never rely solely on application-level enforcement.
- Use `ON DELETE CASCADE` for child records that have no meaning without the parent (e.g., order items).
- Use `ON DELETE RESTRICT` for records that should prevent parent deletion (e.g., orders referencing a user).
- Use `ON DELETE SET NULL` for optional relationships where the child can exist independently.

### Indexes

- Add indexes on columns used in `WHERE`, `JOIN`, `ORDER BY`, and `GROUP BY` clauses.
- Composite indexes for queries that filter on multiple columns. Column order matters -- most selective first.
- Unique indexes for business constraints (email, slug, external ID).
- Do not over-index: each index slows writes. Only index columns that appear in frequent queries.

### Relationships

- Define relationships explicitly in the schema. The database enforces data integrity, not the application.
- Name foreign keys consistently: `{referenced_table_singular}_id` (e.g., `user_id`, `order_id`).
- Junction tables for many-to-many: `{table_a}_{table_b}` in alphabetical order (e.g., `order_product`).

### Soft Deletes vs Hard Deletes

- **Soft deletes** (a `deleted_at` timestamp column) for user-facing records that may need recovery: users, orders, documents.
- **Hard deletes** for truly disposable data: logs, temporary tokens, expired sessions.
- When using soft deletes, add a global scope/filter to exclude deleted records by default.

### Identifiers

- **UUIDs** for user-facing IDs exposed in URLs and APIs. Prevents enumeration attacks and simplifies multi-system data merging.
- **Auto-increment integers** acceptable for internal IDs that never appear in APIs (pivot table IDs, log entries).
- Never expose auto-increment IDs in public-facing URLs.

### Naming Conventions

- **snake_case** for all column names and table names.
- **Plural** for table names: `orders`, `users`, `order_items`.
- **Singular** for model/entity class names: `Order`, `User`, `OrderItem`.
- Boolean columns prefixed with `is_` or `has_`: `is_active`, `has_discount`.

## Migrations

### Reversible

- ALWAYS include rollback logic (down/rollback method). Every migration must be reversible.
- Test rollbacks in development before deploying. A migration that cannot roll back is a liability.

### Small and Focused

- One concern per migration: create a table, add a column, create an index. Not multiple unrelated changes.
- Small migrations are easier to review, easier to debug, and safer to roll back.

### Zero-Downtime

- **Add before use:** Add new columns/tables in one deployment, start using them in the next.
- **Remove after unused:** Stop using columns/tables in one deployment, remove them in the next.
- Never rename a column in a single migration -- add new, migrate data, remove old (three-step).
- Default values for new non-nullable columns to avoid breaking existing rows.

### Naming

- Descriptive migration names that explain the change: `create_orders_table`, `add_status_to_orders`, `remove_legacy_role_column_from_users`.
- Timestamp-prefixed for ordering (most frameworks do this automatically).

### Data Migrations

- Separate data migrations from schema migrations. Schema changes and data transformations have different risk profiles.
- Data migrations should be idempotent -- safe to run multiple times.
- Never modify a deployed migration. Create a new migration for corrections.

## Query Optimization

### No N+1

- Always eager load relationships when accessing related data in loops or collections.
- The pattern: fetching a list of orders then lazily loading items for each order = N+1 queries (1 for orders + N for items).
- The fix: eager load `orders` with `items` in a single query using the ORM's eager loading mechanism.
- Monitor for N+1 in development using query logging or debug tools.

### Caching

- Cache expensive queries: configuration data, rarely-changing reference data, computed aggregates.
- Use appropriate cache TTL: short (1-5 min) for dynamic data, long (1-24 hours) for stable data.
- Invalidate cache when underlying data changes. Stale cache is worse than no cache.
- Cache at the right level: query-level for specific data, response-level for full API responses.

### Query Logging

- Enable query logging in development to spot slow queries and N+1 patterns.
- Set a slow query threshold (e.g., 100ms) and log queries that exceed it.
- Review query counts per request. A single page load should not generate more than 10-20 queries.

### Index Verification

- Use `EXPLAIN` (or equivalent) to verify queries use indexes as expected.
- A full table scan on a large table is a performance bug. Add an index or restructure the query.
- Check index usage after adding new query patterns or filters.

### Batch Operations

- Use bulk insert/update for large data sets. Never loop and save individual records.
- Chunked processing for very large datasets: process in batches of 100-1000 records.
- Avoid loading entire tables into memory. Use cursor/chunked iteration.

### Connection Pooling

- Use connection pools in production. Each request should not open a new database connection.
- Configure pool size based on expected concurrency and database limits.
- Release connections promptly -- long-running transactions hold connections.

### Avoid

- **SELECT * ** -- select only the columns you need. Reduces memory and network overhead.
- **Unbounded queries** -- always paginate. A query without a limit is a time bomb.
- **Raw SQL in application code** -- use the ORM. Raw SQL bypasses type safety, parameter binding, and portability.
- **Queries in loops** -- batch or eager load instead. One query in a loop of 100 items = 100 queries.
