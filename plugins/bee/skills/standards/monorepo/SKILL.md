---
name: monorepo
description: "Monorepo patterns -- Turborepo, pnpm workspaces, shared packages, build caching. Use when project has turbo.json, pnpm-workspace.yaml, or lerna.json."
---

# Monorepo Standards

**Detection:** Check for `turbo.json`, `pnpm-workspace.yaml`, `lerna.json`, or `nx.json`. If absent, skip.

## Structure (Turborepo + pnpm)

```
apps/
  web/            # Next.js frontend
  api/            # NestJS/Express backend
  mobile/         # React Native app
packages/
  ui/             # Shared component library
  config/         # Shared ESLint, TypeScript, Tailwind configs
  types/          # Shared TypeScript types/interfaces
  utils/          # Shared utility functions
turbo.json
pnpm-workspace.yaml
package.json      # root — no dependencies, only scripts
```

### Workspace Config

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

```json
// turbo.json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] },
    "type-check": { "dependsOn": ["^build"] }
  }
}
```

## Shared Package Rules

- Internal packages use `"name": "@repo/ui"` convention (scoped to repo)
- Use `workspace:*` for internal dependencies: `"@repo/ui": "workspace:*"`
- Each package has its own `package.json`, `tsconfig.json`
- Shared types go in `@repo/types`, shared utils in `@repo/utils`
- No circular dependencies between packages

## Common Pitfalls

- **Missing `^build` in dependsOn** — packages build before dependents. Without `^`, build order is random.
- **Importing from wrong package** — `import from '@repo/ui'` not `import from '../../packages/ui'`
- **Root-level dependencies** — dev tools go in root (turbo, prettier). App dependencies go in app packages.
- **No `outputs` in turbo.json** — without outputs, Turborepo can't cache builds.
- **Duplicate dependencies** — same library at different versions across packages. Use `pnpm dedupe`.
