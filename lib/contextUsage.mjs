// contextUsage.mjs — pure, no imports.
// Shapes the Claude Agent SDK's SDKControlGetContextUsageResponse into a
// normalized, null-safe model the web client renders as a Claude-GUI-style
// context popover (colored bar + per-category legend + free space).
//
// SDK source shape (node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts,
// type SDKControlGetContextUsageResponse):
//   { categories[{name,tokens,color,isDeferred?}], totalTokens, maxTokens,
//     rawMaxTokens, percentage, gridRows[][{color,isFilled,categoryName,
//     tokens,percentage,squareFullness}], model, memoryFiles[{path,type,tokens}],
//     mcpTools[{name,serverName,tokens,isLoaded?}], deferredBuiltinTools?[],
//     systemTools?[{name,tokens}], systemPromptSections?[{name,tokens}], ... }

/**
 * Format a token count as a compact k/M string.
 * Examples: 0 -> "0", 940 -> "940", 316000 -> "316k", 1000000 -> "1M".
 * @param {number} n
 * @returns {string}
 */
export function k(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    const m = v / 1_000_000;
    // Trim trailing ".0"
    const s = m.toFixed(m % 1 === 0 ? 0 : 1);
    return `${s}M`;
  }
  if (abs >= 1000) {
    return `${Math.round(v / 1000)}k`;
  }
  return `${Math.round(v)}`;
}

function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function pctOf(tokens, maxTokens) {
  return maxTokens > 0 ? round1((num(tokens) / maxTokens) * 100) : 0;
}

const EMPTY = Object.freeze({
  ok: false,
  totalTokens: 0,
  maxTokens: 0,
  percentage: 0,
  model: '',
  categories: [],
  grid: [],
  free: { tokens: 0, pct: 0 },
  memoryFiles: [],
  mcpTools: [],
  systemTools: [],
  systemPromptSections: [],
});

/**
 * Normalize an SDKControlGetContextUsageResponse into a client-friendly,
 * null-safe shape. Never throws.
 *
 * @param {any} resp
 * @returns {{
 *   ok: boolean,
 *   totalTokens: number,
 *   maxTokens: number,
 *   percentage: number,
 *   model: string,
 *   categories: {name:string,tokens:number,color:string,pct:number,isDeferred:boolean}[],
 *   grid: {color:string,isFilled:boolean,tokens:number,pct:number}[][],
 *   free: {tokens:number,pct:number},
 *   memoryFiles: {path:string,type:string,tokens:number}[],
 *   mcpTools: {name:string,serverName:string,tokens:number,isLoaded:boolean}[],
 *   systemTools: {name:string,tokens:number}[],
 *   systemPromptSections: {name:string,tokens:number}[],
 * }}
 */
export function shapeContextUsage(resp) {
  // Treat as malformed unless it's a plain object carrying the core numeric
  // fields the SDK always returns. Rejects null, arrays, primitives, {}, and
  // partial payloads missing totalTokens/maxTokens.
  if (
    !resp ||
    typeof resp !== 'object' ||
    Array.isArray(resp) ||
    !Number.isFinite(Number(resp.totalTokens)) ||
    !Number.isFinite(Number(resp.maxTokens))
  ) {
    return { ...EMPTY, free: { ...EMPTY.free } };
  }

  const maxTokens = num(resp.maxTokens);
  const totalTokens = num(resp.totalTokens);
  const percentage = Number.isFinite(Number(resp.percentage))
    ? round1(Number(resp.percentage))
    : (maxTokens > 0 ? round1((totalTokens / maxTokens) * 100) : 0);
  const model = typeof resp.model === 'string' ? resp.model : '';

  const categories = Array.isArray(resp.categories)
    ? resp.categories.filter((c) => c && typeof c === 'object').map((c) => ({
        name: typeof c.name === 'string' ? c.name : '',
        tokens: num(c.tokens),
        color: typeof c.color === 'string' ? c.color : '',
        pct: pctOf(c.tokens, maxTokens),
        isDeferred: c.isDeferred === true,
      }))
    : [];

  const grid = Array.isArray(resp.gridRows)
    ? resp.gridRows
        .filter((row) => Array.isArray(row))
        .map((row) =>
          row.filter((sq) => sq && typeof sq === 'object').map((sq) => ({
            color: typeof sq.color === 'string' ? sq.color : '',
            isFilled: sq.isFilled === true,
            tokens: num(sq.tokens),
            pct: Number.isFinite(Number(sq.percentage))
              ? round1(Number(sq.percentage))
              : pctOf(sq.tokens, maxTokens),
          }))
        )
    : [];

  const freeTokens = Math.max(0, maxTokens - totalTokens);
  const free = { tokens: freeTokens, pct: pctOf(freeTokens, maxTokens) };

  const memoryFiles = Array.isArray(resp.memoryFiles)
    ? resp.memoryFiles.filter((f) => f && typeof f === 'object').map((f) => ({
        path: typeof f.path === 'string' ? f.path : '',
        type: typeof f.type === 'string' ? f.type : '',
        tokens: num(f.tokens),
      }))
    : [];

  const mcpTools = Array.isArray(resp.mcpTools)
    ? resp.mcpTools.filter((t) => t && typeof t === 'object').map((t) => ({
        name: typeof t.name === 'string' ? t.name : '',
        serverName: typeof t.serverName === 'string' ? t.serverName : '',
        tokens: num(t.tokens),
        isLoaded: t.isLoaded === true,
      }))
    : [];

  const systemTools = Array.isArray(resp.systemTools)
    ? resp.systemTools.filter((t) => t && typeof t === 'object').map((t) => ({
        name: typeof t.name === 'string' ? t.name : '',
        tokens: num(t.tokens),
      }))
    : [];

  const systemPromptSections = Array.isArray(resp.systemPromptSections)
    ? resp.systemPromptSections
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({
          name: typeof s.name === 'string' ? s.name : '',
          tokens: num(s.tokens),
        }))
    : [];

  return {
    ok: true,
    totalTokens,
    maxTokens,
    percentage,
    model,
    categories,
    grid,
    free,
    memoryFiles,
    mcpTools,
    systemTools,
    systemPromptSections,
  };
}

/**
 * Compact one-line summary of the shaped context usage.
 * Examples: "316k / 1M (32%)", or "316k (32%)" when maxTokens is absent.
 * @param {ReturnType<typeof shapeContextUsage>} shaped
 * @returns {string}
 */
export function contextSummaryLabel(shaped) {
  if (!shaped || typeof shaped !== 'object') return '0 (0%)';
  const total = num(shaped.totalTokens);
  const max = num(shaped.maxTokens);
  const pct = num(shaped.percentage);
  if (max > 0) {
    return `${k(total)} / ${k(max)} (${Math.round(pct)}%)`;
  }
  return `${k(total)} (${Math.round(pct)}%)`;
}
