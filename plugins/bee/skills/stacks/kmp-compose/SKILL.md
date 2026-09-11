---
name: kmp-compose
description: Kotlin Multiplatform + Compose Multiplatform conventions with Voyager, Koin, Ktor, Kotlinx Serialization
---

# KMP + Compose Multiplatform Standards

These standards apply when the project stack is `kmp-compose`. All agents and implementations must follow these conventions. This is a CROSS-PLATFORM stack targeting Android and iOS.

## Architecture

### MVVM + Clean Architecture

- **Shared module (`shared/`):** Business logic, data layer, networking, DI configuration — shared across all platforms.
- **Platform modules (`androidApp/`, `iosApp/`):** Platform-specific UI, ViewModels, navigation, storage implementations.
- **Layering:** `data/` (repositories, API, storage) → `domain/` (business logic, if needed) → `presentation/` (ViewModels, screens).

### expect/actual Pattern

Use `expect`/`actual` for platform-specific implementations. Keep the shared API surface minimal:

```kotlin
// commonMain — declare the contract
expect class TokenStorage {
    suspend fun getToken(): String?
    suspend fun saveToken(token: String)
    suspend fun clearToken()
}

// androidMain — Android implementation
actual class TokenStorage(private val context: Context) {
    private val prefs = EncryptedSharedPreferences.create(...)
    actual suspend fun getToken(): String? = prefs.getString("token", null)
    actual suspend fun saveToken(token: String) { prefs.edit().putString("token", token).apply() }
    actual suspend fun clearToken() { prefs.edit().remove("token").apply() }
}

// iosMain — iOS implementation
actual class TokenStorage {
    actual suspend fun getToken(): String? = NSUserDefaults.standardUserDefaults.stringForKey("token")
    // ...
}
```

**Rule:** Only use `expect`/`actual` when platform APIs genuinely differ. If the implementation is the same on all platforms, keep it in `commonMain`.

## Compose Multiplatform UI

### Composable Conventions

- **Function components only.** All UI is `@Composable` functions with typed parameters.
- **Max 250 lines per screen composable.** Extract sub-composables and ViewModels when screens grow.
- **No business logic in composables.** Composables observe state and call ViewModel functions. No data fetching, transformations, or validation in composables.
- **`collectAsState()`** to observe StateFlows from ViewModels.
- **`LaunchedEffect`** for one-time side effects (load data on first composition).
- **`remember` and `rememberSaveable`** for local UI state that survives recomposition/rotation.

```kotlin
@Composable
fun HomeScreen(viewModel: HomeViewModel = koinViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()

    LaunchedEffect(Unit) { viewModel.loadDashboard() }

    when (val state = uiState) {
        is HomeUiState.Loading -> LoadingSkeleton()
        is HomeUiState.Success -> DashboardContent(
            dashboard = state.dashboard,
            isRefreshing = isRefreshing,
            onRefresh = { viewModel.refresh() },
        )
        is HomeUiState.Error -> ErrorMessage(
            message = state.message,
            onRetry = { viewModel.loadDashboard() },
        )
    }
}
```

### Material 3

- Use Material 3 components (`MaterialTheme`, `Surface`, `Card`, `Button`, etc.) from `androidx.compose.material3`.
- Define theme in `ui/theme/` with `Theme.kt`, `Color.kt`, `Type.kt`.
- Use semantic colors (`MaterialTheme.colorScheme.primary`, `.error`, `.surface`) — never hardcode hex colors.
- Support dark mode via `isSystemInDarkTheme()`.

### Modifiers

- Chain modifiers in a readable order: layout → sizing → padding → background → border → click.
- Extract commonly reused modifier chains into extension functions.
- Pass `modifier: Modifier = Modifier` as the first optional parameter to all reusable composables.

## State Management

### StateFlow Pattern

- **Private `MutableStateFlow`**, public `StateFlow` — standard ViewModel pattern.
- Use `update {}` block for atomic state modifications.
- Sealed classes/interfaces for UI state: `Loading`, `Success(data)`, `Error(message)`, `Empty`.

```kotlin
class InvoicesViewModel(
    private val invoiceRepository: InvoiceRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<InvoicesUiState>(InvoicesUiState.Loading)
    val uiState: StateFlow<InvoicesUiState> = _uiState.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    fun loadInvoices(clientId: String) {
        viewModelScope.launch {
            _uiState.value = InvoicesUiState.Loading
            invoiceRepository.getInvoices(clientId)
                .onSuccess { _uiState.value = InvoicesUiState.Success(it) }
                .onError { _uiState.value = InvoicesUiState.Error(it.message) }
        }
    }
}

sealed interface InvoicesUiState {
    data object Loading : InvoicesUiState
    data class Success(val invoices: List<Invoice>) : InvoicesUiState
    data class Error(val message: String) : InvoicesUiState
}
```

### Result Type

Use a custom sealed `Result<T>` for all repository return types:

```kotlin
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    data class Error(val exception: Throwable, val message: String? = null) : Result<Nothing>()
}

// Extension functions for clean consumption
inline fun <T> Result<T>.onSuccess(action: (T) -> Unit): Result<T> { if (this is Result.Success) action(data); return this }
inline fun <T> Result<T>.onError(action: (Result.Error) -> Unit): Result<T> { if (this is Result.Error) action(this); return this }
```

## Dependency Injection — Koin

### Module Organization

```kotlin
// commonMain — shared dependencies
val commonModule = module {
    single { Json { ignoreUnknownKeys = true; isLenient = true } }
    single { SessionManager() }
    single { createHttpClient(get(), get()) }
    single { ApiClient(get()) }

    // Repositories
    single<AuthRepository> { AuthRepositoryImpl(get()) }
    single<DashboardRepository> { DashboardRepositoryImpl(get()) }
    single<InvoiceRepository> { InvoiceRepositoryImpl(get()) }
}

// androidMain — platform-specific + ViewModels
val appModule = module {
    single { TokenStorage(androidContext()) }
    single { PreferencesStorage(androidContext()) }

    // ViewModels — use factory for parameterized construction
    viewModel { HomeViewModel(get(), get(), get()) }
    viewModel { params -> LoginPasswordViewModel(params.get(), get()) }
}
```

### Koin Best Practices

- **`single {}`** for stateless services (repositories, API client, SessionManager).
- **`viewModel {}`** for ViewModels — lifecycle-aware, scoped to the composable.
- **`factory {}`** for objects that should be created fresh each time.
- **`koinViewModel()`** in composables to inject ViewModels.
- **Never** use `get()` in composables — always inject via `koinViewModel()` or `koinInject()`.
- **Platform modules** provide platform-specific implementations (storage, networking engine).

## Networking — Ktor Client

### ApiClient Pattern

Wrap Ktor with a typed API client:

```kotlin
class ApiClient(private val httpClient: HttpClient) {
    suspend inline fun <reified T> get(endpoint: String, params: Map<String, String> = emptyMap()): Result<T> =
        safeApiCall { httpClient.get("$baseUrl$endpoint") { params.forEach { (k, v) -> parameter(k, v) } } }

    suspend inline fun <reified T, reified R> post(endpoint: String, body: R): Result<T> =
        safeApiCall { httpClient.post("$baseUrl$endpoint") { setBody(body) } }

    suspend inline fun <reified T> safeApiCall(block: () -> HttpResponse): Result<T> = try {
        val response = block()
        Result.Success(response.body<T>())
    } catch (e: Exception) {
        Result.Error(e, e.message)
    }
}
```

### Interceptors and Retry

```kotlin
fun createHttpClient(json: Json, sessionManager: SessionManager): HttpClient {
    return HttpClient {
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) { requestTimeoutMillis = 30_000; connectTimeoutMillis = 15_000 }
        install(Auth) {
            bearer { loadTokens { sessionManager.token?.let { BearerTokens(it, "") } } }
        }
        // Logging interceptor
        install(Logging) { level = LogLevel.HEADERS; logger = Logger.DEFAULT }
        // Retry on transient failures
        install(HttpRequestRetry) {
            retryOnServerErrors(maxRetries = 3)
            exponentialDelay()
        }
        // 401 handling — clear session and redirect
        HttpResponseValidator {
            handleResponseExceptionWithRequest { exception, _ ->
                if (exception is ClientRequestException && exception.response.status.value == 401) {
                    sessionManager.clearSession()
                }
            }
        }
    }
}
```

### Kotlinx Serialization

- All DTOs use `@Serializable` annotation.
- **`@SerialName`** for snake_case mapping: `@SerialName("client_id") val clientId: String`.
- Configure Json: `ignoreUnknownKeys = true`, `isLenient = true`.
- Keep DTOs in `data/api/models/` — separate from domain models if they diverge.

## Navigation — Voyager

### Tab Navigation

```kotlin
@Composable
fun AppNavigator() {
    TabNavigator(HomeTab) { tabNavigator ->
        Scaffold(
            bottomBar = {
                NavigationBar {
                    listOf(HomeTab, InvoicesTab, GatesTab, ProfileTab).forEach { tab ->
                        NavigationBarItem(
                            selected = tabNavigator.current == tab,
                            onClick = { tabNavigator.current = tab },
                            icon = { Icon(tab.options.icon!!, contentDescription = tab.options.title) },
                            label = { Text(tab.options.title) },
                        )
                    }
                }
            }
        ) { innerPadding ->
            CurrentTab(Modifier.padding(innerPadding))
        }
    }
}
```

### Screen Navigation

- Define tabs as `object : Tab` with `TabOptions`.
- Use `Navigator` for stack-based push/pop navigation within tabs.
- `navigator.push(DetailScreen(id))` for forward navigation.
- `navigator.pop()` to go back.
- Koin integration: `getScreenModel<MyScreenModel>()` in Voyager screens.

## Local Persistence — SQLDelight

Use SQLDelight for type-safe local database access across platforms. It generates Kotlin APIs from SQL statements.

### Setup

```kotlin
// build.gradle.kts (shared module)
plugins {
    alias(libs.plugins.sqldelight)
}

sqldelight {
    databases {
        create("AppDatabase") {
            packageName.set("com.app.cache")
        }
    }
}

// Dependencies per source set
commonMain.dependencies {
    implementation("app.cash.sqldelight:runtime:2.1.0")
    implementation("app.cash.sqldelight:coroutines-extensions:2.1.0")
}
androidMain.dependencies {
    implementation("app.cash.sqldelight:android-driver:2.1.0")
}
iosMain.dependencies {
    implementation("app.cash.sqldelight:native-driver:2.1.0")
}
```

### Driver Factory (expect/actual)

```kotlin
// commonMain
interface DatabaseDriverFactory {
    fun createDriver(): SqlDriver
}

// androidMain
class AndroidDatabaseDriverFactory(private val context: Context) : DatabaseDriverFactory {
    override fun createDriver(): SqlDriver = AndroidSqliteDriver(AppDatabase.Schema, context, "app.db")
}

// iosMain
class IosDatabaseDriverFactory : DatabaseDriverFactory {
    override fun createDriver(): SqlDriver = NativeSqliteDriver(AppDatabase.Schema, "app.db")
}
```

### SQL files and queries

Place `.sq` files in `shared/src/commonMain/sqldelight/`:

```sql
-- Invoice.sq
CREATE TABLE Invoice (
    id TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT NOT NULL
);

selectByClient:
SELECT * FROM Invoice WHERE clientId = ? ORDER BY createdAt DESC;

insert:
INSERT OR REPLACE INTO Invoice(id, clientId, amount, status, createdAt) VALUES (?, ?, ?, ?, ?);
```

SQLDelight generates type-safe Kotlin functions from these queries. Use `asFlow().mapToList()` from coroutines-extensions for reactive queries.

## Image Loading — Coil 3

Use Coil 3 for async image loading in Compose Multiplatform (supports KMP):

```kotlin
// build.gradle.kts
commonMain.dependencies {
    implementation("io.coil-kt.coil3:coil-compose:3.2.0")
    implementation("io.coil-kt.coil3:coil-network-ktor3:3.2.0")
}
```

```kotlin
import coil3.compose.AsyncImage

@Composable
fun UserAvatar(imageUrl: String?, modifier: Modifier = Modifier) {
    AsyncImage(
        model = imageUrl,
        contentDescription = "User avatar",
        contentScale = ContentScale.Crop,
        modifier = modifier.size(48.dp).clip(CircleShape),
    )
}
```

- Use `AsyncImage` for all remote images — it handles caching, placeholders, and error states
- Configure `ImageLoader` with Ktor engine for KMP: `ImageLoader.Builder(context).components { add(KtorNetworkFetcherFactory()) }`
- Set `placeholder` and `error` composables for loading/error states
- Use `ContentScale.Crop` for avatars, `ContentScale.Fit` for detail views

## Repository Pattern

### Interface + Implementation

```kotlin
// Contract in commonMain
interface InvoiceRepository {
    suspend fun getInvoices(clientId: String): Result<List<Invoice>>
    suspend fun getInvoice(id: String): Result<Invoice>
    suspend fun payInvoice(id: String): Result<PaymentResult>
}

// Implementation in commonMain (uses shared ApiClient)
class InvoiceRepositoryImpl(private val apiClient: ApiClient) : InvoiceRepository {
    override suspend fun getInvoices(clientId: String): Result<List<Invoice>> =
        apiClient.get("/clients/$clientId/invoices")

    override suspend fun getInvoice(id: String): Result<Invoice> =
        apiClient.get("/invoices/$id")

    override suspend fun payInvoice(id: String): Result<PaymentResult> =
        apiClient.post("/invoices/$id/pay", EmptyBody)
}
```

## Testing

- **JUnit 4** + **Coroutines Test** for ViewModel and repository tests.
- **Fake implementations** over mocks — create `FakeInvoiceRepository` implementing the interface.
- **`runTest {}`** with `StandardTestDispatcher` for coroutine testing.
- **`Dispatchers.setMain(testDispatcher)`** in `@Before`, reset in `@After`.
- Test state transitions: Loading → Success, Loading → Error, refresh flows.
- Shared tests in `commonTest/`, platform tests in `androidTest/`/`iosTest/`.

```kotlin
class HomeViewModelTest {
    private val testDispatcher = StandardTestDispatcher()
    private val fakeDashboardRepo = FakeDashboardRepository()

    @Before
    fun setup() { Dispatchers.setMain(testDispatcher) }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun `loadDashboard sets Success state on success`() = runTest {
        fakeDashboardRepo.setResult(Result.Success(testDashboard))
        val viewModel = HomeViewModel(fakeDashboardRepo)

        viewModel.loadDashboard()
        advanceUntilIdle()

        assertEquals(HomeUiState.Success(testDashboard), viewModel.uiState.value)
    }
}
```

## Secure Storage

- **Android:** `EncryptedSharedPreferences` with `MasterKey.AES256_GCM` for tokens and sensitive data.
- **iOS:** Keychain via platform bridge.
- **Regular preferences** for non-sensitive data (selected client, UI settings).
- **Never** store tokens or API keys in plain SharedPreferences/UserDefaults.
- Handle keystore corruption gracefully — fallback + retry mechanism.

## Common Pitfalls -- NEVER Rules

- **NEVER** put business logic in `@Composable` functions — ViewModels handle all logic.
- **NEVER** use hardcoded colors — use `MaterialTheme.colorScheme` tokens.
- **NEVER** use `GlobalScope.launch` — use `viewModelScope` for ViewModels, structured concurrency elsewhere.
- **NEVER** store sensitive data in plain SharedPreferences — use EncryptedSharedPreferences or Keychain.
- **NEVER** catch `CancellationException` — it breaks structured concurrency. Always rethrow it.
- **NEVER** use `runBlocking` in production code — it blocks the thread. Use `suspend` functions.
- **NEVER** create `MutableStateFlow` as public — always expose `StateFlow` (read-only).
- **NEVER** use `Thread.sleep()` or blocking I/O on the main thread — use `delay()` and `withContext(Dispatchers.IO)`.
- **NEVER** ignore `expect`/`actual` for platform APIs — don't ifdef with `Platform.OS`-style checks.
- **NEVER** use inline style values in Compose — define in `MaterialTheme` or `StyleSheet`-equivalent patterns.
- **NEVER** forget to handle both `Loading` and `Error` states in UI — sealed state must be exhaustive.
- **NEVER** mix Voyager `ScreenModel` and AndroidX `ViewModel` in the same project without clear convention — pick one pattern.

## Must-Haves

- **Kotlin everywhere.** No Java files in the project. All code is Kotlin with explicit types on public APIs.
- **Shared business logic in `commonMain`.** Networking, repositories, serialization, DI config — all shared.
- **Sealed state classes for UI state.** Every screen has a sealed interface: `Loading`, `Success(data)`, `Error(message)`.
- **Result type for repository returns.** All repository methods return `Result<T>`, never throw exceptions to callers.
- **Koin DI for all dependencies.** No manual construction. All services, repositories, and ViewModels injected via Koin.
- **EncryptedSharedPreferences for tokens.** Auth tokens and secrets use encrypted storage with keystore corruption handling.
- **Material 3 theming.** All UI uses Material 3 components and semantic color tokens.
- **TDD with fakes.** Tests use fake repository implementations, not mocks. Test state transitions through ViewModels.

## Good Practices

- **`collectAsState()` in composables.** Observe ViewModel flows in composables, not manually collecting in effects.
- **`LaunchedEffect(key)` for load triggers.** Load data when a screen composes or when a key changes.
- **`viewModelScope` for all coroutines.** ViewModel coroutines are lifecycle-aware and cancel on clear.
- **`update {}` for StateFlow mutations.** Atomic state updates prevent race conditions.
- **Platform module separation.** Keep `androidMain`/`iosMain` minimal — only `expect`/`actual` implementations.
- **Typed navigation parameters.** Pass IDs as constructor params to Voyager screens, not untyped bundles.
- **Version catalog (`libs.versions.toml`).** Centralize all dependency versions. Never hardcode versions in build files.
- **Error mapping to user strings.** Map API errors to string resources via `ErrorMapper`, not raw exception messages.
- **Staleness-based refresh.** Track last fetch timestamps and refresh only when data is stale (e.g., 5 min threshold).

## Common Bugs

- **Stale closures in `LaunchedEffect`.** Using state values inside `LaunchedEffect` without proper keys causes callbacks to capture outdated values.
- **Forgetting `@Serializable` on DTOs.** Kotlinx Serialization fails at runtime if annotation is missing. No compile-time error.
- **401 not clearing session.** API returns 401 but token is not cleared — user stays in broken authenticated state.
- **EncryptedSharedPreferences corruption.** Keystore reset or OS upgrade corrupts encrypted prefs. Must have fallback/retry mechanism.
- **`CancellationException` swallowed.** Catching generic `Exception` in coroutines also catches `CancellationException`, breaking structured concurrency. Always rethrow.
- **Recomposition loops.** Modifying state inside a composable body (not in a callback or effect) causes infinite recomposition.
- **Missing `ignoreUnknownKeys` in Json config.** Backend adds a new field → app crashes on deserialization.
- **Platform-specific code in `commonMain`.** Using Android-specific APIs in shared code causes iOS build failures.

## Anti-Patterns

- **God ViewModel.** ViewModel handling 5+ unrelated concerns. Split into focused ViewModels per screen/feature.
- **Direct API calls in composables.** Never call `apiClient.get()` from a composable — go through ViewModel → Repository → ApiClient.
- **Mutable state exposed publicly.** Exposing `MutableStateFlow` instead of `StateFlow` lets consumers mutate state directly.
- **Using `var` for state.** Use `MutableStateFlow` and `update {}`, not mutable properties.
- **Catching all exceptions.** `catch (e: Exception)` swallows `CancellationException`. Catch specific types or rethrow cancellation.
- **Platform checks instead of expect/actual.** Using `if (Platform.OS == "android")` instead of proper `expect`/`actual` declarations.
- **Hardcoded strings in UI.** Use string resources for all user-visible text. Enables localization.
- **Inline lambdas in Compose for stable callbacks.** Creating lambdas inline in Compose causes unnecessary recompositions. Use `remember { }` or ViewModel functions.

## Standards

- **PascalCase for classes and composables.** `HomeScreen`, `InvoiceRepository`, `HomeViewModel`, `HomeUiState`.
- **camelCase for functions and properties.** `loadDashboard()`, `uiState`, `isRefreshing`.
- **Package by feature.** `ro.app.data.repository`, `ro.app.ui.screens.home`, `ro.app.di`.
- **`{Feature}ViewModel` naming.** `HomeViewModel`, `InvoicesViewModel`, `LoginPasswordViewModel`.
- **`{Feature}Screen` naming.** `HomeScreen`, `ProfileScreen`, `InvoiceDetailScreen`.
- **`{Entity}Repository` + `{Entity}RepositoryImpl`.** Interface + implementation in same package.
- **Private backing state with underscore.** `_uiState` (private mutable), `uiState` (public read-only).
- **Version catalog for dependencies.** All versions in `gradle/libs.versions.toml`, referenced in build files.
- **Sealed interfaces over sealed classes.** Prefer `sealed interface` for state hierarchies (more flexible, no constructor overhead).

## Context7 Instructions

When looking up framework documentation, use these Context7 library identifiers:

- **Kotlin Multiplatform:** `/jetbrains/kotlin-multiplatform-dev-docs` or `/websites/kotlinlang_multiplatform` — expect/actual, shared code, platform configuration
- **SQLDelight:** search for `sqldelight` — database, queries, migrations, drivers
- **Compose Multiplatform:** `/jetbrains/compose-multiplatform` — UI components, state, navigation
- **Ktor:** `ktor-io/ktor` — HTTP client, serialization, authentication, WebSocket
- **Koin:** `InsertKoinIO/koin` — DI modules, ViewModel injection, multiplatform setup
- **Kotlinx Serialization:** `Kotlin/kotlinx.serialization` — JSON, @Serializable, @SerialName
- **Voyager:** `adrielcafe/voyager` — navigation, tabs, screen models, Koin integration

Always check Context7 for the latest API — KMP and Compose Multiplatform evolve rapidly between versions.
