// HIVE INTELLIGENCE SYSTEMS — Command Center Layout
//
// Structural responsibilities:
//   - Sticky tactical header with brand mark + session timestamp + toggle
//     controls + a consumer-supplied `headerRight` slot.
//   - Main content area that hosts zero, one, or two side rails depending on
//     which slot props the consumer passes:
//       * `leftSidebar`  — navigation rail on the left (~260px on lg:+)
//       * `feed`         — activity rail on the right (380px on lg:+)
//       * both, or neither. The main content stretches to fill remaining space.
//   - Both sidebars can be collapsed via toggle buttons in the header. Layout
//     state lives in this component (AC 3 of Quick 001) so the toggle buttons
//     and the sidebars share a single source of truth.
//   - Status bar footer (informational, not interactive).
//
// Responsive strategy:
//   - Below the `lg:` breakpoint (1024px) the layout reverts to flex-column:
//     the left nav rail is hidden entirely (`hidden lg:block`) because mobile
//     nav deserves a dedicated drawer pattern that Quick 001 does not build.
//     The right feed rail stacks below the main content (preserving existing
//     behavior from before this change).
//   - At `lg:+` the main element flips to CSS grid and the `grid-cols`
//     template adapts to how many rails are visible. See `gridClass` below.
//
// Backward compatibility:
//   - When `leftSidebar` is omitted entirely, the component renders exactly
//     as it did before this change (AC 1). The 2-column `[main | feed]`
//     behaviour is preserved byte-for-byte via the same template literal.

import {
  Activity,
  Hexagon,
  PanelLeft,
  PanelRight,
} from 'lucide-react';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';

export interface MissionControlLayoutProps {
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  feed?: React.ReactNode;
  leftSidebar?: React.ReactNode;
}

export function MissionControlLayout({
  children,
  headerRight,
  feed,
  leftSidebar,
}: MissionControlLayoutProps) {
  const [leftCollapsed, setLeftCollapsed] = useLocalStorageState<boolean>(
    'bee-hive:v1:leftCollapsed',
    false,
    { validate: (v): v is boolean => typeof v === 'boolean' },
  );
  const [rightCollapsed, setRightCollapsed] = useLocalStorageState<boolean>(
    'bee-hive:v1:rightCollapsed',
    false,
    { validate: (v): v is boolean => typeof v === 'boolean' },
  );

  // Visibility is a pure function of (slot-provided) × (collapsed state).
  // These booleans drive BOTH the grid-template selection and the JSX
  // conditional rendering so the DOM and the grid columns stay in sync.
  const hasLeft = !!leftSidebar && !leftCollapsed;
  const hasRight = !!feed && !rightCollapsed;

  // Grid template selection — only applies at `lg:+`. On mobile the main
  // element stays `flex-1 overflow-y-auto` and children stack vertically.
  // Keeping this as a single derived string avoids template-literal noise in
  // the JSX and makes each visibility state trivially auditable.
  const gridClass = (() => {
    if (hasLeft && hasRight) {
      return 'lg:grid lg:grid-cols-[260px_1fr_380px] lg:overflow-hidden';
    }
    if (hasLeft && !hasRight) {
      return 'lg:grid lg:grid-cols-[260px_1fr] lg:overflow-hidden';
    }
    if (!hasLeft && hasRight) {
      return 'lg:grid lg:grid-cols-[1fr_380px] lg:overflow-hidden';
    }
    return '';
  })();

  // Shared toggle-button class — extracted so both buttons stay visually
  // identical (active = teal accent, inactive = muted elevated).
  function toggleButtonClass(expanded: boolean): string {
    const base =
      'hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-none border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hive-accent';
    const stateful = expanded
      ? 'bg-hive-accent/20 border-hive-accent/50 text-hive-accent'
      : 'bg-hive-elevated border-hive-border text-hive-muted hover:border-hive-border-bright hover:text-hive-text-secondary';
    return `${base} ${stateful}`;
  }

  return (
    <div className="relative z-10 flex min-h-screen flex-col bg-transparent text-hive-text">
      {/* ── Command Bar ── */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-hive-border bg-hive-bg/90 px-6 py-3 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Hexagon className="h-7 w-7 text-hive-accent" aria-hidden="true" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Activity className="h-3 w-3 text-hive-accent" aria-hidden="true" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-display font-semibold text-sm tracking-[0.15em] uppercase text-hive-accent">
                HIVE
              </span>
              <span className="font-mono text-[9px] tracking-[0.2em] text-hive-muted uppercase">
                Intelligence Systems
              </span>
            </div>
          </div>
          <div className="h-8 w-px bg-hive-border" />
          <div className="hidden sm:flex flex-col">
            <span className="font-mono text-[10px] text-hive-muted uppercase tracking-wider">
              Session Active
            </span>
            <span className="font-mono text-xs text-hive-text-secondary">
              {new Date().toISOString().slice(0, 10)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {leftSidebar && (
            <button
              type="button"
              aria-label="Toggle navigation sidebar"
              aria-expanded={!leftCollapsed}
              onClick={() => setLeftCollapsed((v) => !v)}
              className={toggleButtonClass(!leftCollapsed)}
            >
              <PanelLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {feed && (
            <button
              type="button"
              aria-label="Toggle activity feed"
              aria-expanded={!rightCollapsed}
              onClick={() => setRightCollapsed((v) => !v)}
              className={toggleButtonClass(!rightCollapsed)}
            >
              <PanelRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {headerRight}
        </div>
      </header>

      {/* ── Main Content: optional left rail | zones | optional right rail ── */}
      <main className={`flex-1 overflow-y-auto ${gridClass}`}>
        {hasLeft && (
          <aside
            id="hive-left-sidebar"
            className="hidden border-r border-hive-border bg-hive-bg/50 p-5 lg:block lg:overflow-y-auto"
          >
            {leftSidebar}
          </aside>
        )}
        <div className="space-y-5 overflow-y-auto p-5">
          {children}
        </div>
        {hasRight && (
          <aside
            id="hive-right-sidebar"
            className="border-t border-hive-border bg-hive-bg/50 p-5 lg:border-t-0 lg:border-l lg:border-hive-border lg:overflow-y-auto"
          >
            {feed}
          </aside>
        )}
      </main>

      {/* ── Status Bar ── */}
      <footer className="flex items-center justify-between border-t border-hive-border bg-hive-bg/90 px-6 py-1.5 text-[10px] font-mono text-hive-muted uppercase tracking-wider backdrop-blur-md">
        <span>HIVE v4.0 // Bee Intelligence Platform</span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-hive-accent intel-pulse" />
          System Operational
        </span>
      </footer>
    </div>
  );
}

/* ── Section Divider — used between dashboard zones ── */
export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="h-px flex-1 bg-gradient-to-r from-hive-border via-hive-border-bright to-transparent" />
      <span className="font-display text-[10px] font-semibold tracking-[0.2em] uppercase text-hive-muted">
        {label}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-hive-border via-hive-border-bright to-transparent" />
    </div>
  );
}
