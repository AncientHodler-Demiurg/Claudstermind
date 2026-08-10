# StoicSyntax Pact

Prefix-aware syntax coloring for **Kadena Pact** written in the **StoicSyntax** discipline — where the
function *prefix* is the contract. Instead of coloring every function the same, StoicSyntax Pact colors
an identifier by its **prefix band**, so at a glance you see whether a call is unprotected (safe reads /
compute) or protected (admin / orchestration / persistence writes).

Two artifacts in one package:

1. **A TextMate grammar** — drop-in syntax coloring for **VS Code / Cursor** (and anything that eats
   `.tmLanguage.json`: Sublime, GitHub Linguist, Shiki, etc.).
2. **A framework-agnostic tokenizer** (`src/tokenizer.mjs`) — for programmatic use (the Claudstermind
   web IDE, CodeMirror, a terminal renderer, tests).

## The band taxonomy (the prefix IS the contract)

| Band | Prefixes | Meaning | Color |
|------|----------|---------|-------|
| compute | `UC_` `UCK_` | pure compute / key ctors | teal `#4ec9b0` |
| read | `UR_` `URD_` `URC_` `URDC_` | reads / derives | cyan `#4fb6e0` |
| ctor | `UDC_` | object constructors | yellow `#dcdcaa` |
| enforce | `UEV_` | enforce / validate | amber `#e5c07b` |
| cap | `CAP_` | capability | gold `#e6c200` |
| **client** | `C_` | client recipe | green `#98c379` |
| **orch** | `XI_` `XE_` `XB_` | orchestration writes | orange `#e5a663` |
| **admin** | `A_` | admin | salmon `#e06c75` |
| **write** | `W_` `WI_` `WU_` `WW_` | persistence writes | **red** `#ef5350` |

Cool colors = unprotected; warm/red = protected. Prefixes are recognized at a **segment boundary**
(string start, or after `| . : >`), so they resolve inside qualified names — `IC|UDC_…`,
`URC|KDA-PID_CLAD` — and cap-name shapes — `SWP|A_…`, `SWP|C>…`.

## Use in Cursor / VS Code

This package is a grammar-only extension (no activation code). To use it before it's on a marketplace:

```bash
# from this directory
npm i -g @vscode/vsce
vsce package                # -> stoicsyntax-pact-0.1.0.vsix
# then in Cursor/VS Code: Extensions → “…” → Install from VSIX → pick the .vsix
```

Or, for a quick local try, symlink/copy this folder into your extensions dir
(`~/.cursor/extensions/` or `~/.vscode/extensions/`) and reload. Open any `.pact`/`.repl` file — the band
colors apply automatically (shipped via `contributes.configurationDefaults`).

## Use programmatically (Node / bundlers)

```js
import { tokenize, classifyWord, toHtml } from "stoicsyntax-pact";

classifyWord("URC|KDA-PID_CLAD");     // "read"
classifyWord("SWP|A_UpdateBoost");    // "admin"
tokenize("(defun UC_add (a b) ...)"); // [{type:"paren",value:"("},{type:"def",value:"defun"},{type:"compute",value:"UC_add"}, …]
toHtml("(W_Save x)");                 // '<span class="pk-paren">(</span><span class="pk-write">W_Save</span> …'
```

`tokenize()` is lossless (`tokens.map(t => t.value).join("") === input`) so it drops cleanly into a
CodeMirror `StreamLanguage`, a terminal colorizer, or an HTML viewer via `toHtml()`.

## Relationship to Claudstermind

Claudstermind's web Pact IDE ships a classic-script build of this same tokenizer
(`dashboard/public/pact-highlight.js`). This package is the canonical, reusable home of the rule — keep
the two in sync, or have the dashboard consume this package's `toHtml()` once it has a build step.

## Status / provisional naming

`name` (`stoicsyntax-pact`) and `publisher` (`ancientpantheon`) are **placeholders** — finalize them
before publishing (npm and/or the VS Code Marketplace / OpenVSX). Nothing here is published yet.

MIT.
