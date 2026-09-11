---
name: i18n
description: "Internationalization patterns -- translation files, pluralization, date/number formatting, RTL. Use when project has i18n library (react-intl, vue-i18n, next-intl, i18next)."
---

# Internationalization Standards

**Detection:** Check `package.json` for `react-intl`, `vue-i18n`, `next-intl`, `i18next`, or `@formatjs/*`. Check for `locales/` or `messages/` directory. If absent, skip.

## Translation File Structure

```
locales/
  en/
    common.json    # shared: buttons, labels, errors
    orders.json    # feature-specific
    auth.json
  ro/
    common.json
    orders.json
    auth.json
```

```json
// locales/en/orders.json
{
  "title": "Orders",
  "create": "Create Order",
  "status": {
    "active": "Active",
    "completed": "Completed",
    "cancelled": "Cancelled"
  },
  "count": "{count, plural, =0 {No orders} one {# order} other {# orders}}",
  "total": "Total: {amount, number, ::currency/USD}"
}
```

## Rules

- **All user-visible strings must be translated** — no hardcoded text in components
- **Use ICU message format** for pluralization and formatting (not ternary operators)
- **Namespace by feature** — split files by domain, not one giant file
- **Keys are semantic** — `orders.create` not `btn_create_order_1`
- **Variables use named placeholders** — `{name}` not positional `{0}`
- **Dates and numbers** — use `Intl.DateTimeFormat` / `Intl.NumberFormat` or library formatters. Never `toLocaleDateString()`.
- **RTL support** — use logical CSS properties (`margin-inline-start` not `margin-left`). Use `dir="rtl"` attribute.

## Common Pitfalls

- **String concatenation for messages** — `t('hello') + ' ' + name` breaks in languages with different word order. Use `t('greeting', { name })`.
- **Hardcoded date formats** — `MM/DD/YYYY` is US-only. Use locale-aware formatters.
- **Missing pluralization** — "1 items" is wrong. Use ICU plural format.
- **No fallback locale** — missing translation shows blank. Configure fallback to default language.
- **Translating developer-facing strings** — error codes, log messages, API keys should NOT be translated.
