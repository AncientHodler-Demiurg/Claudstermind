---
name: playwright
description: "Use when writing or reviewing Playwright end-to-end tests. Covers Page Object Model, fixtures, selectors, assertions, authentication, network mocking, visual testing, and test organization. Invoke explicitly -- not loaded by default."
---

# Playwright E2E Testing Standards

These standards apply when writing or reviewing Playwright end-to-end tests. This skill is **invoked on demand** — it is NOT loaded automatically by stack skills. Use it when the task involves writing, reviewing, or debugging Playwright tests.

## Core Principles

- **Test user-visible behavior, not implementation.** Tests assert what the user sees and does — not internal state, component structure, or CSS classes.
- **Auto-waiting built-in.** Playwright auto-waits for elements to be actionable before interacting. Do NOT add manual waits or sleeps.
- **Test isolation.** Each test gets a fresh browser context. No shared state between tests. No test ordering dependencies.
- **Parallel by default.** Tests run in parallel across workers. Design tests to be independent.

## Selectors and Locators

### Preferred Locator Strategy (in order)

1. **`getByRole()`** — accessible role + name. Best for buttons, links, headings, inputs.
2. **`getByLabel()`** — form inputs by their associated label text.
3. **`getByText()`** — visible text content. Use for paragraphs, messages, status text.
4. **`getByPlaceholder()`** — inputs by placeholder when no label exists.
5. **`getByTestId()`** — `data-testid` attribute. Last resort when semantic selectors don't work.

```typescript
// ✅ Preferred — semantic, resilient to UI changes
await page.getByRole('button', { name: 'Submit Order' }).click();
await page.getByLabel('Email address').fill('user@example.com');
await page.getByRole('heading', { name: 'Order Confirmation' }).isVisible();

// ✅ Acceptable — when semantic doesn't work
await page.getByTestId('order-total').textContent();

// ❌ Avoid — fragile, breaks on refactors
await page.locator('.btn-primary').click();
await page.locator('#email-input').fill('user@example.com');
await page.locator('div > span.price').textContent();
```

### Locator Rules

- **NEVER** use CSS class selectors (`.btn`, `.card-header`) — they change on refactors.
- **NEVER** use XPath — unreadable and fragile.
- **NEVER** use DOM structure selectors (`div > div > span`) — break on layout changes.
- **Prefer** `getByRole` with `{ name: }` for interactive elements.
- **Use** `locator().filter()` for narrowing within a section.

```typescript
// Filter within a specific section
const orderSection = page.locator('[data-testid="order-123"]');
await orderSection.getByRole('button', { name: 'Cancel' }).click();

// Chaining with nth for lists
await page.getByRole('listitem').nth(2).getByRole('button', { name: 'Edit' }).click();
```

## Page Object Model (POM)

### Structure

Every major page or reusable section gets a Page Object class:

```typescript
// pages/orders.page.ts
import { type Page, type Locator, expect } from '@playwright/test';

export class OrdersPage {
    readonly page: Page;
    readonly searchInput: Locator;
    readonly createButton: Locator;
    readonly orderRows: Locator;

    constructor(page: Page) {
        this.page = page;
        this.searchInput = page.getByRole('searchbox');
        this.createButton = page.getByRole('button', { name: 'Create Order' });
        this.orderRows = page.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });
    }

    async goto() {
        await this.page.goto('/orders');
    }

    async search(query: string) {
        await this.searchInput.fill(query);
        // Auto-waits for network, no manual wait needed
    }

    async createOrder(data: { client: string; notes: string }) {
        await this.createButton.click();
        await this.page.getByLabel('Client').selectOption(data.client);
        await this.page.getByLabel('Notes').fill(data.notes);
        await this.page.getByRole('button', { name: 'Save' }).click();
    }

    async expectOrderCount(count: number) {
        await expect(this.orderRows).toHaveCount(count);
    }

    async expectOrderVisible(name: string) {
        await expect(this.page.getByRole('cell', { name })).toBeVisible();
    }
}
```

### POM Rules

- **Locators in constructor, actions as methods, assertions as `expect*` methods.**
- **One POM per page or major section.** Don't create POMs for small components.
- **POMs don't assert by default** — they expose `expect*` helper methods. Tests decide what to assert.
- **POMs live in `tests/pages/` or `e2e/pages/`** — separate from test files.
- **Reuse POMs via fixtures** (see below), not via imports + manual construction.

## Fixtures

### Custom Test Fixtures

Extend the base `test` to provide POMs and shared setup:

```typescript
// fixtures.ts
import { test as base } from '@playwright/test';
import { OrdersPage } from './pages/orders.page';
import { LoginPage } from './pages/login.page';

type Fixtures = {
    ordersPage: OrdersPage;
    loginPage: LoginPage;
};

export const test = base.extend<Fixtures>({
    ordersPage: async ({ page }, use) => {
        const ordersPage = new OrdersPage(page);
        await use(ordersPage);
    },
    loginPage: async ({ page }, use) => {
        const loginPage = new LoginPage(page);
        await use(loginPage);
    },
});

export { expect } from '@playwright/test';
```

```typescript
// orders.spec.ts
import { test, expect } from './fixtures';

test('can search orders', async ({ ordersPage }) => {
    await ordersPage.goto();
    await ordersPage.search('shipped');
    await ordersPage.expectOrderVisible('Order #123');
});
```

### Role-Based Fixtures

For multi-role testing (admin vs user):

```typescript
export const test = base.extend<{ adminPage: AdminPage; userPage: UserPage }>({
    adminPage: async ({ browser }, use) => {
        const ctx = await browser.newContext({ storageState: 'playwright/.auth/admin.json' });
        const page = await ctx.newPage();
        await use(new AdminPage(page));
        await ctx.close();
    },
    userPage: async ({ browser }, use) => {
        const ctx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
        const page = await ctx.newPage();
        await use(new UserPage(page));
        await ctx.close();
    },
});
```

## Authentication

### Global Auth Setup (Recommended)

Use a setup project to authenticate once, save state, reuse across tests:

```typescript
// playwright.config.ts
export default defineConfig({
    projects: [
        { name: 'setup', testMatch: /.*\.setup\.ts/ },
        {
            name: 'chromium',
            use: { storageState: 'playwright/.auth/user.json' },
            dependencies: ['setup'],
        },
    ],
});
```

```typescript
// auth.setup.ts
import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL('/dashboard');
    await page.context().storageState({ path: authFile });
});
```

### API Auth (Faster)

```typescript
setup('authenticate via API', async ({ request }) => {
    await request.post('/api/login', {
        data: { email: 'test@example.com', password: 'password' },
    });
    await request.storageState({ path: 'playwright/.auth/user.json' });
});
```

## Network Mocking

### Mock API Responses

```typescript
test('shows orders from mocked API', async ({ page }) => {
    await page.route('**/api/orders', async (route) => {
        await route.fulfill({
            json: [
                { id: 1, name: 'Order A', status: 'active' },
                { id: 2, name: 'Order B', status: 'pending' },
            ],
        });
    });

    await page.goto('/orders');
    await expect(page.getByText('Order A')).toBeVisible();
    await expect(page.getByText('Order B')).toBeVisible();
});
```

### Modify Real Responses

```typescript
test('adds extra item to real API response', async ({ page }) => {
    await page.route('**/api/orders', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.push({ id: 999, name: 'Injected Order', status: 'test' });
        await route.fulfill({ json });
    });

    await page.goto('/orders');
    await expect(page.getByText('Injected Order')).toBeVisible();
});
```

### Wait for API Calls

```typescript
test('submits form and waits for API response', async ({ page }) => {
    await page.goto('/orders/create');

    const responsePromise = page.waitForResponse('**/api/orders');
    await page.getByRole('button', { name: 'Submit' }).click();
    const response = await responsePromise;

    expect(response.status()).toBe(201);
});
```

## Assertions

### Web-First Assertions (Auto-Retry)

Always use `expect()` from Playwright — it auto-retries until timeout:

```typescript
// ✅ Auto-retrying — waits up to timeout for condition
await expect(page.getByText('Order created')).toBeVisible();
await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
await expect(page).toHaveURL('/orders/1');
await expect(page).toHaveTitle(/Orders/);
await expect(page.getByRole('table')).toContainText('Order A');

// ❌ Non-retrying — snapshot check, can be flaky
expect(await page.textContent('.status')).toBe('active');  // DON'T
```

### Common Assertions

```typescript
await expect(locator).toBeVisible();
await expect(locator).toBeHidden();
await expect(locator).toBeEnabled();
await expect(locator).toBeDisabled();
await expect(locator).toHaveText('exact text');
await expect(locator).toContainText('partial');
await expect(locator).toHaveCount(5);
await expect(locator).toHaveAttribute('href', '/orders');
await expect(locator).toHaveClass(/active/);
await expect(locator).toHaveValue('search term');
await expect(page).toHaveURL(/orders/);
```

## Visual Testing

```typescript
// Full page screenshot comparison
await expect(page).toHaveScreenshot('orders-page.png');

// Component screenshot comparison
await expect(page.getByTestId('order-card')).toHaveScreenshot('order-card.png');

// With threshold for minor differences
await expect(page).toHaveScreenshot('dashboard.png', { maxDiffPixels: 100 });
```

## Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['html', { open: 'never' }]],
    use: {
        baseURL: 'http://localhost:3000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'setup', testMatch: /.*\.setup\.ts/ },
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
            dependencies: ['setup'],
        },
        {
            name: 'mobile',
            use: { ...devices['iPhone 14'], storageState: 'playwright/.auth/user.json' },
            dependencies: ['setup'],
        },
    ],
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
    },
});
```

## Test Organization

```
tests/
  e2e/
    pages/                  ← Page Object Models
      orders.page.ts
      login.page.ts
      dashboard.page.ts
    fixtures.ts             ← Custom test fixtures
    auth.setup.ts           ← Authentication setup
    orders.spec.ts          ← Test files by feature
    dashboard.spec.ts
    auth.spec.ts
playwright.config.ts
playwright/
  .auth/                    ← Saved auth state (gitignored)
```

## Common Pitfalls -- NEVER Rules

- **NEVER** use `page.waitForTimeout()` / `sleep` — Playwright auto-waits. If you need a wait, you're missing a proper assertion or locator.
- **NEVER** use CSS class selectors — they break on refactors. Use `getByRole`, `getByLabel`, `getByText`.
- **NEVER** use XPath — unreadable and fragile.
- **NEVER** share state between tests — each test must be independent. No `test.describe.serial()` unless absolutely necessary.
- **NEVER** assert on non-retrying values for dynamic content — use `expect(locator).toHaveText()` not `expect(await locator.textContent()).toBe()`.
- **NEVER** hardcode URLs — use `baseURL` from config and relative paths.
- **NEVER** skip authentication setup — use the setup project pattern, not login-per-test.
- **NEVER** put assertions in Page Objects by default — POMs expose `expect*` helpers, tests decide what to assert.
- **NEVER** test implementation details — don't assert on component state, Redux stores, or internal function calls.
- **NEVER** ignore the trace viewer — when tests fail, `trace: 'on-first-retry'` captures everything. Use `npx playwright show-trace` to debug.

## Accessibility Testing

Playwright includes built-in accessibility assertions. Use them on every critical page:

```typescript
test('homepage has no accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page).toMatchAriaSnapshot(`
    - banner:
      - navigation "Main"
    - main:
      - heading "Welcome" [level=1]
    - contentinfo
  `);
});
```

For comprehensive a11y audits, use `@axe-core/playwright`:

```typescript
import AxeBuilder from '@axe-core/playwright';

test('should not have any a11y violations', async ({ page }) => {
  await page.goto('/dashboard');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

Add a11y checks to your CI pipeline -- run on every page test, not as a separate suite.

## API Testing

Playwright's `request` fixture enables API testing without a browser:

```typescript
test.describe('Orders API', () => {
  test('creates an order', async ({ request }) => {
    const response = await request.post('/api/orders', {
      data: { product: 'Widget', quantity: 3 },
    });
    expect(response.ok()).toBeTruthy();
    const order = await response.json();
    expect(order.product).toBe('Widget');
  });

  test('returns 401 without auth', async ({ request }) => {
    const response = await request.get('/api/orders');
    expect(response.status()).toBe(401);
  });
});
```

Use API tests for: test data setup (create users/orders before E2E), backend contract verification, and auth flow validation.

## Debugging

- **`page.pause()`** — stops execution and opens Playwright Inspector for interactive debugging
- **Trace viewer:** `npx playwright show-trace trace.zip` — step through actions, network, screenshots
- **`--debug` flag:** `npx playwright test --debug` — runs in headed mode with inspector
- **Console logs:** `page.on('console', msg => console.log(msg.text()))` — capture browser console

## Good Practices

- **Page Object Model for every page.** Encapsulate locators and actions. Reuse via fixtures.
- **Global auth setup.** Authenticate once in a setup project, reuse `storageState` across all tests.
- **API mocking for deterministic tests.** Mock external APIs with `page.route()` to avoid flaky network dependencies.
- **Visual regression for critical pages.** Use `toHaveScreenshot()` on key pages and components.
- **Parallel execution.** Design tests for `fullyParallel: true`. No shared state, no ordering.
- **Trace on failure.** Configure `trace: 'on-first-retry'` to capture full execution trace for debugging.
- **Test on mobile viewport.** Add a mobile project (`devices['iPhone 14']`) for responsive testing.
- **Use `waitForResponse` for form submissions.** Verify the server received and processed the request.

## Context7 Instructions

When looking up Playwright documentation, use these Context7 library identifiers:

- **Playwright:** `/websites/playwright_dev` — API reference, best practices, configuration, assertions
- **Playwright (source):** `/microsoft/playwright` — source-level API, latest features

Always check Context7 for the latest Playwright API — features like component testing and API testing evolve between versions.
