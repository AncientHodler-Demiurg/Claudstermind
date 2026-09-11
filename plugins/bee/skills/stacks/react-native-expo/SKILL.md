---
name: react-native-expo
description: React Native + Expo managed workflow conventions and patterns
---

# React Native + Expo Standards

These standards apply when the project stack is `react-native-expo`. All agents and implementations must follow these conventions. This is a MOBILE-FIRST stack.

**Also read `skills/standards/frontend/SKILL.md`** for universal frontend standards (component architecture, accessibility, design quality) that apply alongside these React Native-specific conventions. Note: responsive design and CSS methodology sections are web-focused -- for mobile, follow the patterns in this skill instead.

## Expo Configuration

- Use **Expo managed workflow** as the default. Use prebuild for custom native code, eject only as last resort.
- `app.json` or `app.config.js` for static/dynamic configuration (app name, slug, version, splash, icons).
- Use `app.config.js` when configuration needs environment variables or dynamic values.
- **EAS Build** for production builds: `eas build --platform ios` / `eas build --platform android`.
- **EAS Submit** for app store distribution: `eas submit --platform ios` / `eas submit --platform android`.
- **Prebuild** (`npx expo prebuild`) for custom native code that Expo Go cannot support.
- **Expo Go** for development: fast iteration without native rebuilds. Use `npx expo start`.
- Keep `expo` SDK version consistent across all `expo-*` packages. Upgrade together via `npx expo install --fix`.
- Expo SDK releases 3 times per year, each targeting the latest stable React Native version.

```json
{
  "expo": {
    "name": "MyApp",
    "slug": "my-app",
    "version": "1.0.0",
    "orientation": "portrait",
    "plugins": ["expo-camera", "expo-location"]
  }
}
```

### SDK Upgrade Pattern

When upgrading Expo SDK versions:

1. Read the SDK changelog on expo.dev/changelog
2. Run `npx expo install expo@latest --fix` to update all expo packages together
3. Run `npx expo-doctor` to check for compatibility issues
4. Update `app.json` plugins if any changed configuration
5. Run prebuild if using custom native code: `npx expo prebuild --clean`
6. Test on both iOS and Android before committing

## Component Patterns

- Use **React Native core components**, not HTML elements. There is no DOM.
- `View` replaces `div`. `Text` replaces `span`, `p`, `h1`, etc.
- `ScrollView` for short scrollable content. `FlatList` for long lists (virtualized, performant).
- `Pressable` for all touchable elements. `TouchableOpacity` is deprecated -- do not use it.
- **All text must be inside `<Text>` components.** Raw strings outside `<Text>` cause crashes.
- `SectionList` for grouped data. `FlatList` for flat data. Never use `ScrollView` + `.map()` for lists.

```tsx
// Pattern: list with FlatList
const OrderList = ({ orders }: { orders: Order[] }) => (
  <FlatList
    data={orders}
    keyExtractor={(item) => item.id}
    renderItem={({ item }) => (
      <Pressable onPress={() => handlePress(item.id)}>
        <View style={styles.row}>
          <Text style={styles.title}>{item.name}</Text>
          <Text style={styles.subtitle}>{item.status}</Text>
        </View>
      </Pressable>
    )}
    ListEmptyComponent={<Text>No orders found</Text>}
  />
);
```

## Image Loading (expo-image)

Use `expo-image` instead of React Native's `Image` component. It provides caching, blurhash placeholders, smooth transitions, and better performance:

```tsx
import { Image } from 'expo-image';

// Pattern: image with blurhash placeholder and transition
<Image
  source={{ uri: 'https://example.com/photo.jpg' }}
  placeholder={{ blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' }}
  contentFit="cover"
  transition={300}
  style={styles.image}
/>
```

- `contentFit`: `'cover'` (fill + crop), `'contain'` (fit inside), `'fill'` (stretch), `'none'`
- `placeholder`: Use `{ blurhash }` for low-res preview while loading
- `transition`: Duration in ms for smooth fade-in when image loads
- Always set explicit `width` and `height` for remote images (bundler cannot infer dimensions)
- expo-image handles caching automatically -- no manual cache management needed
- Use `recyclingKey` on `FlatList` items to prevent image flickering during scroll

## Navigation

- **Expo Router** for file-based routing. Routes live in the `app/` directory.
- File names map to routes: `app/index.tsx` is `/`, `app/orders/[id].tsx` is `/orders/:id`.
- `_layout.tsx` files define navigation structure (Stack, Tabs, Drawer).
- **Stack navigator** for hierarchical navigation (push/pop screens).
- **Tab navigator** for top-level sections (`app/(tabs)/` with `_layout.tsx` defining tabs).
- **Deep linking** is automatic with Expo Router -- file paths become link paths.
- Use `<Link href="/orders">` for declarative navigation, `router.push('/orders')` for programmatic.
- **Protected routes** with `redirect` in `_layout.tsx` -- check auth state and redirect to login.

```tsx
// Pattern: tab layout with protected route
export default function TabLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
```

## Forms and Keyboard Handling

Forms in React Native require explicit keyboard management. The keyboard covers input fields by default on iOS.

### Basic forms with KeyboardAvoidingView

```tsx
import { KeyboardAvoidingView, Platform, TextInput } from 'react-native';

<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : undefined}
  style={{ flex: 1 }}
>
  <TextInput placeholder="Email" />
  <TextInput placeholder="Password" secureTextEntry />
</KeyboardAvoidingView>
```

### Complex forms with react-native-keyboard-controller

For multi-input forms, use `KeyboardAwareScrollView` from `react-native-keyboard-controller` -- it auto-scrolls to focused inputs with native-feel performance:

```tsx
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

export default function FormScreen() {
  return (
    <>
      <KeyboardAwareScrollView bottomOffset={62} contentContainerStyle={{ gap: 16, padding: 16 }}>
        <TextInput placeholder="Name" style={styles.input} />
        <TextInput placeholder="Email" style={styles.input} keyboardType="email-address" />
        <TextInput placeholder="Phone" style={styles.input} keyboardType="phone-pad" />
        <TextInput placeholder="Notes" style={styles.input} multiline numberOfLines={4} />
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}
```

### Form validation with React Hook Form + Zod

```tsx
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Min 8 characters'),
});

type FormData = z.infer<typeof schema>;

export default function LoginForm() {
  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = (data: FormData) => { /* login logic */ };

  return (
    <View style={{ gap: 12 }}>
      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, value } }) => (
          <View>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              style={[styles.input, errors.email && styles.inputError]}
            />
            {errors.email && <Text style={styles.error}>{errors.email.message}</Text>}
          </View>
        )}
      />
      <Pressable onPress={handleSubmit(onSubmit)} style={styles.button}>
        <Text style={styles.buttonText}>Login</Text>
      </Pressable>
    </View>
  );
}
```

## Animations (React Native Reanimated)

Use **Reanimated 3** for performant animations that run on the UI thread. Install via `npx expo install react-native-reanimated`.

### Shared values and animated styles

```tsx
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';

export default function AnimatedBox() {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSpring(scale.value === 1 ? 1.5 : 1);
  };

  return (
    <Pressable onPress={handlePress}>
      <Animated.View style={[styles.box, animatedStyle]} />
    </Pressable>
  );
}
```

### Layout animations (entering/exiting)

```tsx
import Animated, { FadeIn, FadeOut, SlideInRight, SlideOutLeft } from 'react-native-reanimated';

// Items animate in/out automatically
{items.map(item => (
  <Animated.View key={item.id} entering={SlideInRight} exiting={SlideOutLeft}>
    <Text>{item.name}</Text>
  </Animated.View>
))}
```

Available animations: `FadeIn`, `FadeOut`, `SlideInRight`, `SlideOutLeft`, `ZoomIn`, `ZoomOut`, `BounceIn`, `BounceOut`, `FlipInXUp`, `StretchInX`, and more. All customizable with `.duration()`, `.delay()`, `.springify()`.

### When to use what

- **`withSpring`** -- natural, bouncy feel (buttons, toggles, interactive elements)
- **`withTiming`** -- precise, linear transitions (progress bars, opacity fades, slides)
- **Layout animations** -- automatic enter/exit for list items, modals, conditional content
- **LayoutAnimation** (built-in) -- simple layout transitions without Reanimated (use sparingly)

## Platform-Specific Code

- `Platform.OS` returns `'ios'` | `'android'` | `'web'` for runtime checks.
- `Platform.select({ ios: value, android: value, default: value })` for inline value selection.
- **File extensions** for platform-specific files: `Component.ios.tsx`, `Component.android.tsx`. The bundler resolves the correct file automatically.
- Use platform checks sparingly -- prefer cross-platform components.
- Common differences: status bar, shadow vs elevation, haptics, date pickers.

```tsx
const styles = StyleSheet.create({
  card: {
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1 },
      android: { elevation: 4 },
    }),
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
  },
});
```

## Styling

- **`StyleSheet.create()`** for ALL styles. Never pass inline style objects -- they cause re-renders.
- Flexbox is the layout model. Default `flexDirection` is `column` (not `row` like web CSS).
- Use `useWindowDimensions()` for responsive sizing.
- **SafeAreaView** and `useSafeAreaInsets()` from `react-native-safe-area-context` for notch/home indicator handling.
- Units are density-independent pixels (dp). No `px`, `em`, `rem`.
- `gap` property works in React Native for spacing between flex children.
- No CSS classes, no Tailwind (unless using NativeWind). All styling is via style objects.

## Native Modules

- Use **Expo SDK modules** for device capabilities. Install via `npx expo install`.
- Common modules: `expo-camera`, `expo-location`, `expo-notifications`, `expo-image-picker`, `expo-file-system`, `expo-secure-store`, `expo-haptics`, `expo-av`, `expo-image`.
- **Always request permissions before use.** Use `requestPermissionsAsync()` from each module.
- Handle **permission denied** gracefully -- show a message explaining why the permission is needed with a link to settings.
- Some modules require **prebuild** (custom dev client) -- Expo Go has limited native module support.

```tsx
// Pattern: camera with permission handling
const [permission, requestPermission] = useCameraPermissions();

if (!permission?.granted) {
  return (
    <View style={styles.container}>
      <Text>Camera access is required to scan barcodes</Text>
      <Pressable onPress={requestPermission}>
        <Text>Grant Permission</Text>
      </Pressable>
    </View>
  );
}

return <CameraView style={styles.camera} facing="back" />;
```

## State Management

- **React hooks** work identically: `useState`, `useReducer`, `useContext`, `useEffect`, `useMemo`, `useCallback`.
- External state libraries (Zustand, Jotai, Redux Toolkit, TanStack Query) work without modification.
- **AsyncStorage** for persistent local data (replaces `localStorage`). Install via `@react-native-async-storage/async-storage`.
- **SecureStore** (`expo-secure-store`) for sensitive data: auth tokens, API keys, credentials.
- Never store sensitive data in AsyncStorage -- it is not encrypted.

```tsx
import * as SecureStore from 'expo-secure-store';

async function saveToken(token: string) {
  await SecureStore.setItemAsync('auth_token', token);
}

async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync('auth_token');
}
```

## Error Recovery

### Error boundaries for screens

Wrap screen-level components in error boundaries to catch rendering errors and show a fallback UI instead of a white screen crash:

```tsx
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorMessage}>{error.message}</Text>
      <Pressable onPress={resetErrorBoundary} style={styles.retryButton}>
        <Text>Try Again</Text>
      </Pressable>
    </View>
  );
}

// In _layout.tsx
<ErrorBoundary FallbackComponent={ErrorFallback}>
  <Stack />
</ErrorBoundary>
```

### Network error handling

```tsx
// Pattern: fetch with retry and error state
function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { data, error, loading, retry: fetchData };
}
```

## Testing

- **React Native Testing Library** (`@testing-library/react-native`) for component tests.
- `render`, `screen`, `fireEvent` are the primary utilities. Use `fireEvent`, NOT `userEvent` (RNTL uses `fireEvent`).
- Mock native modules in `jest.setup.js` -- modules like `expo-camera`, `expo-location` are not available in Jest.
- Test behavior: what renders, what happens on press, what text appears. Not implementation details.
- Use `waitFor()` for async state updates. Use `act()` when triggering state changes outside events.
- Mock navigation with `jest.mock('expo-router')` for testing navigation calls.

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

describe('OrderCard', () => {
  it('displays order name and status', () => {
    render(<OrderCard name="Order #1" status="pending" />);
    expect(screen.getByText('Order #1')).toBeTruthy();
    expect(screen.getByText('pending')).toBeTruthy();
  });

  it('calls onPress with order id when pressed', () => {
    const onPress = jest.fn();
    render(<OrderCard id="123" name="Order #1" status="pending" onPress={onPress} />);
    fireEvent.press(screen.getByText('Order #1'));
    expect(onPress).toHaveBeenCalledWith('123');
  });
});
```

### Mocking Expo modules

```tsx
// jest.setup.js
jest.mock('expo-image', () => ({
  Image: 'Image',
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: 'Link',
  Redirect: 'Redirect',
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
```

## Common Pitfalls -- NEVER Rules

- **NEVER** use HTML elements (`div`, `span`, `p`, `button`) -- use `View`, `Text`, `Pressable`, etc.
- **NEVER** put raw text outside `<Text>` components -- this causes a runtime crash.
- **NEVER** use `TouchableOpacity` -- it is deprecated. Use `Pressable` instead.
- **NEVER** use `ScrollView` with `.map()` for long lists -- use `FlatList` for virtualized rendering.
- **NEVER** use inline style objects (`style={{ padding: 10 }}`) -- use `StyleSheet.create()`.
- **NEVER** assume `flexDirection` is `row` -- React Native defaults to `column`.
- **NEVER** skip permission requests for camera, location, notifications.
- **NEVER** use `localStorage` -- it does not exist in React Native. Use `AsyncStorage` or `SecureStore`.
- **NEVER** ignore Safe Area insets -- content will be hidden behind the notch or home indicator.
- **NEVER** use React Native's `Image` for new code -- use `expo-image` (better caching, blurhash, transitions).
- **NEVER** use `userEvent` from RNTL -- React Native Testing Library uses `fireEvent`.
- **NEVER** use `setTimeout`/`sleep` in animations -- use Reanimated's `withDelay()` instead.

## Must-Haves

- **TypeScript everywhere.** All files use `.ts` / `.tsx`. Define typed props for every component.
- **Function components only.** Class components are forbidden.
- **TDD with Jest and Expo.** Write tests before implementation using `jest-expo` preset and RNTL.
- **`expo-image` for all images.** Replaces React Native `Image`. Use blurhash placeholders and contentFit.
- **Reanimated for animations.** All animations run on the UI thread via shared values.
- **Permission handling before native API access.** Always request and handle the denied case.
- **Error boundaries on screen layouts.** Catch rendering errors instead of white screen crashes.
- **Keyboard handling on all form screens.** Use `KeyboardAwareScrollView` or `KeyboardAvoidingView`.

## Good Practices

- **`StyleSheet.create()` for all styles.** Define outside the component body.
- **`FlatList` for all list rendering.** With `keyExtractor` and `renderItem`.
- **`useMemo` for expensive computations.** Memoize filtered lists, sorted data.
- **Skeleton screens over spinners.** Show content-shaped placeholders while loading.
- **Expo SDK APIs over third-party alternatives.** They upgrade cleanly with the SDK.
- **`useCallback` for stable callbacks.** Wrap handlers passed to `FlatList` renderItem.
- **`react-hook-form` + Zod for form validation.** Controller pattern with TextInput.
- **expo-haptics for tactile feedback.** Add haptics to important interactions (submit, delete, toggle).

## Common Bugs

- **Missing `KeyboardAvoidingView` on forms.** Keyboard covers inputs on iOS. Use `behavior="padding"` on iOS.
- **AsyncStorage not awaited.** `getItem()`/`setItem()` return promises. Forgetting `await` causes undefined reads.
- **Android back button not handled.** Use `BackHandler.addEventListener` with cleanup.
- **Missing `GestureHandlerRootView` at app root.** Gesture components silently fail without it.
- **Shadow not working cross-platform.** iOS uses shadow*, Android uses `elevation`. Always provide both.
- **Stale closures in useEffect/handlers.** Include dependencies or use `useRef` for mutable values.
- **HTTP images not loading on Android.** Android blocks cleartext HTTP. Use HTTPS or configure network security.
- **expo-image recycling in FlatList.** Use `recyclingKey` prop to prevent image flickering during scroll.

## Anti-Patterns

- **Class components.** All components must be function components with hooks.
- **Using `any` type.** Define explicit interfaces, union types, or generics.
- **Sensitive data in AsyncStorage.** Use `expo-secure-store` for tokens, keys, credentials.
- **Blocking the JS thread.** Never run heavy computation synchronously. Use `InteractionManager.runAfterInteractions()`.
- **Ignoring platform differences.** Test on both iOS and Android.
- **Inline style objects.** Use `StyleSheet.create()` to avoid re-renders.
- **Using `index` as key in dynamic lists.** Use stable unique identifiers from the data.
- **Manual animation timing.** Use Reanimated spring/timing instead of setTimeout chains.

## Standards

- **PascalCase for components.** `OrderCard.tsx`, `ProfileScreen.tsx`. Hooks: `useAuth.ts`.
- **`app/` directory for Expo Router.** File names map to URL paths. `_layout.tsx` for navigation.
- **`components/` for shared UI.** Organized by feature or domain.
- **`hooks/` for custom hooks.** Each exports a single `use*` function.
- **`constants/` for app-wide constants.** Colors, spacing, API endpoints.
- **One component per file.** Styles co-located at bottom with `StyleSheet.create()`.
- **snake_case API → camelCase in app.** Transform at the API boundary.

## Context7 Instructions

When looking up framework documentation, use these Context7 library identifiers:

- **Expo:** `/expo/expo` or `/websites/expo_dev_versions_v55_0_0` (SDK 55) -- SDK modules, configuration, EAS, Router
- **React Native:** `facebook/react-native` -- core components, APIs, styling
- **React Native Reanimated:** `/websites/swmansion_react-native-reanimated` -- animations, shared values, layout animations
- **React Native Testing Library:** `callstack/react-native-testing-library` -- render, screen, fireEvent
- **React Native Keyboard Controller:** search for `react-native-keyboard-controller` -- KeyboardAwareScrollView, KeyboardToolbar

Always query Context7 for latest APIs -- Expo SDK releases 3 times per year and patterns change.
