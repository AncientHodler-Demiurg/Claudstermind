---
name: testing-standards
description: Testing standards -- TDD mandatory, test naming, mocking strategy, gap analysis
---

# Testing Standards

These standards govern ALL testing in Bee-managed projects. TDD is not optional -- it is the foundation of the development workflow.

## TDD is Mandatory

Every implementation task follows the Red-Green-Refactor cycle. No exceptions.

### Red: Write the Failing Test First

- Before writing ANY implementation code, write a test that defines the desired behavior.
- The test MUST fail when first run. If it passes, the test is wrong or the behavior already exists.
- The test describes WHAT the code should do, not HOW it should do it.
- This step drives the design: you think about the interface before the implementation.

### Green: Write Minimal Code to Pass

- Write the simplest code that makes the failing test pass.
- Do NOT add extra features, optimizations, or "nice to have" logic.
- Do NOT write code for test cases you have not written yet.
- If the test passes, stop. Move to refactor or the next test.

### Refactor: Clean Up While Green

- With passing tests as a safety net, improve code quality.
- Extract methods, rename variables, simplify conditionals, remove duplication.
- Run tests after EVERY refactoring change. If tests fail, undo the change.
- Refactoring changes behavior of the code structure, never the external behavior.

### The TDD Rhythm

1. Write one failing test
2. Make it pass with minimal code
3. Refactor if needed
4. Repeat for the next behavior

Tests come first in EVERY task. Implementation never precedes tests. Agents that skip TDD are violating the core workflow rule.

## Test Writing Standards

### Quantity

- **2-8 tests per implementation group** (a group = one logical feature or behavior set).
- Start with the happy path (core user flow), then add critical error cases.
- Do NOT write exhaustive tests for every edge case during initial TDD. Gap analysis handles edge cases later.

### Focus

- **Test behavior, not implementation.** Test what the code does, not how it does it internally.
- Each test should have a **single reason to fail.** If a test can fail for multiple reasons, split it.
- Tests should be **independent.** No test should depend on another test's execution or state.
- Tests should be **deterministic.** Same input always produces the same result. No randomness, no time-dependence, no network calls.

### Structure

- Follow **Arrange-Act-Assert** (AAA) pattern:
  - **Arrange:** Set up test data and preconditions.
  - **Act:** Execute the behavior under test.
  - **Assert:** Verify the expected outcome.
- Keep tests short. If a test is longer than 15-20 lines, it is probably testing too much.
- One assert per test (or closely related asserts about the same outcome).

### What NOT to Test

Infrastructure code with no business logic decisions does NOT get dedicated tests. Test it implicitly through feature tests that exercise the full stack:

- **Migrations** — they run or they don't. Verify the schema works through feature tests that hit the endpoints using those tables.
- **Seeders** — test the resulting data through feature tests, not the seeder itself.
- **Factory definitions** — factories are test helpers, not production code.
- **Route definitions** — test routes by hitting the endpoints in feature tests.
- **Config files** — no logic to test.
- **Middleware registration** — test middleware behavior through feature tests that trigger it.
- **Simple Eloquent models with no methods** — if the model is just `$fillable` + relationships, feature tests cover it.

**The rule:** if a file has no `if`/`else`/`switch`/`loop`/`try-catch` — no branching logic — it probably doesn't need a dedicated test. Test it through the feature that uses it.

**What DOES need tests:** Controllers, Services, Actions, Policies, Form Requests, complex Components, Composables, hooks, API endpoints, validation logic, authorization logic, data transformations, calculations — anything where the code makes decisions.

### Tied to Acceptance Criteria

- Every test must trace back to an acceptance criterion from the spec or task.
- If you cannot explain which requirement a test validates, the test should not exist.
- Acceptance criteria drive test count: one criterion may need 1-3 tests (happy path + key error paths).

## Test Naming

### PHP (Pest)

```php
it('creates a user with valid data');
it('rejects duplicate email addresses');
it('returns paginated results for large datasets');
it('denies access to unauthorized users');
```

- Use natural language that describes the behavior and expected outcome.
- Start with a verb: `creates`, `rejects`, `returns`, `denies`, `displays`, `sends`.
- Avoid implementation details in names: NOT `it('calls the repository save method')`.

### JavaScript/TypeScript (Vitest)

```js
describe('OrderForm', () => {
    it('renders empty state when no items');
    it('validates required fields before submission');
    it('displays server validation errors');
    it('disables submit button while processing');
});
```

- `describe()` groups by component or feature name.
- `it()` describes specific behavior with expected outcome.
- Same rules: natural language, behavior-focused, no implementation details.

### Anti-Patterns in Naming

- BAD: `it('test1')`, `it('should work')`, `it('handles edge case')`
- BAD: `it('calls OrderService.create with correct params')` -- tests implementation
- GOOD: `it('creates an order with valid line items')` -- tests behavior

## Mocking Strategy

### What to Mock

- **External services:** APIs, payment gateways, email providers, file storage.
- **Database** (in unit tests only): Use in-memory or mock repositories.
- **Time:** Use clock mocking for time-dependent logic.
- **Randomness:** Seed or mock random generators for deterministic tests.

### What NOT to Mock

- **Internal logic:** Do not mock the class under test or its core collaborators.
- **Value objects:** Test them directly -- they are simple and fast.
- **Eloquent models in feature tests:** Use factories and a real test database.
- **If you mock everything, you test nothing.** Mocks verify interaction, not correctness.

### Prefer Fakes Over Mocks

- **Fakes** are working implementations with simplified behavior (in-memory repository, fake mailer, fake file system).
- Fakes test real behavior paths. Mocks only verify method calls.
- Laravel provides excellent fakes: `Mail::fake()`, `Event::fake()`, `Storage::fake()`, `Queue::fake()`.
- Use these before reaching for custom mocks.

### Test Data

- **Laravel:** Use model factories for all test data. Define factory states for common scenarios.
- **JavaScript:** Create factory functions that return typed test objects.
- Never hardcode test data inline if it is used across multiple tests -- extract to factories.
- Use meaningful test data: `User::factory()->create(['name' => 'Jane Doe'])` not `User::factory()->create()` when the name matters.

## Async Testing Patterns

Most production code involves asynchronous operations. Tests must handle them correctly to avoid flakiness and false passes.

### Promises and async/await

Always `await` async operations and assert on the resolved value, not the promise:

```js
// Correct — awaits result
it('fetches user data', async () => {
    const user = await userService.findById(1);
    expect(user.name).toBe('Alice');
});

// Wrong — asserts on promise object
it('fetches user data', () => {
    const user = userService.findById(1);
    expect(user).toBeDefined(); // passes — user is a Promise, which is defined
});
```

### Timers and debounce

Use fake timers for time-dependent code. Never use real `setTimeout` in tests:

```js
// Correct — fake timers
it('debounces search input', async () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    render(<SearchInput onSearch={onSearch} />);
    await userEvent.type(screen.getByRole('textbox'), 'hello');
    vi.advanceTimersByTime(300);
    expect(onSearch).toHaveBeenCalledWith('hello');
    vi.useRealTimers();
});
```

### Waiting for UI updates

Use `waitFor` for assertions that depend on async state changes. Never use `sleep()` or fixed timeouts:

```js
// Correct — condition-based waiting
await waitFor(() => {
    expect(screen.getByText('Loaded')).toBeInTheDocument();
});

// Wrong — arbitrary timeout
await new Promise(r => setTimeout(r, 500));
expect(screen.getByText('Loaded')).toBeInTheDocument();
```

### Testing error rejection

Always test async error paths — they are the most common source of unhandled exceptions:

```js
it('throws on invalid ID', async () => {
    await expect(userService.findById(-1)).rejects.toThrow('Invalid ID');
});
```

### PHP async (queues, jobs)

```php
it('dispatches order confirmation email', function () {
    Mail::fake();
    $order = Order::factory()->create();
    (new ProcessOrder)->handle($order);
    Mail::assertSent(OrderConfirmation::class, fn ($mail) => $mail->order->is($order));
});
```

Use Laravel fakes (`Queue::fake()`, `Mail::fake()`, `Event::fake()`) to test dispatch without execution. Assert on what was dispatched, not on side effects.

### Flaky test prevention

Tests that sometimes pass and sometimes fail are worse than no tests — they erode trust:

- Never depend on execution order between tests
- Never depend on real time (`Date.now()`, `time()`) — mock the clock
- Never depend on network state — mock all HTTP calls
- Never depend on file system order — sort results before asserting
- If a test is flaky, fix it immediately or delete it. A flaky test is not a test.

## Gap Analysis

After the TDD cycle completes for a feature, run a gap analysis to identify missing coverage.

### Process

1. Review all acceptance criteria from the spec/task.
2. Map each criterion to existing tests.
3. Identify gaps: criteria without tests, error paths not covered, integration points not tested.
4. Write **at most 10 additional tests** to close critical gaps.
5. Run the full test suite to confirm no regressions.

### Gap Categories

- **Untested acceptance criteria:** Every criterion must have at least one test.
- **Error paths:** What happens on invalid input, missing data, network failure, timeout?
- **Edge cases:** Empty lists, single items, maximum values, boundary conditions.
- **Integration points:** Do components work together correctly? (e.g., form submission through to database)
- **Authorization:** Can unauthorized users access protected resources?

### Limits

- Gap analysis adds at most **10 tests per feature.** Do not over-test.
- Focus on **high-risk gaps**: security, data integrity, core user flows.
- Low-risk cosmetic edge cases (display formatting, optional tooltips) can be skipped.
- If the test suite takes significantly longer after gap analysis, review for redundant tests.

## Test Organization

### PHP Test Structure

```
tests/
  Feature/
    Orders/
      CreateOrderTest.php
      ListOrdersTest.php
    Auth/
      LoginTest.php
  Unit/
    Services/
      OrderServiceTest.php
    ValueObjects/
      MoneyTest.php
```

- Feature tests mirror the route/page structure.
- Unit tests mirror the source code structure.
- One test file per feature or class under test.

### JavaScript Test Structure

```
resources/js/
  Components/
    OrderForm.vue
    OrderForm.test.ts
  Composables/
    useFilters.ts
    useFilters.test.ts
  Pages/
    Orders/
      Index.vue
      Index.test.ts
```

- Test files live next to the source files they test.
- Use `.test.ts` extension for all test files.
- Import the component/composable directly from the relative path.
