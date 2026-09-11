// TabBar — row of tabs at the top of the main content area.
//
// The bar renders every open tab from useTabs() and highlights the active
// one. Each tab has a close button (×) except the pinned Overview tab.
// Clicking the tab label activates it; clicking × closes it.
//
// Layout strategy: horizontal flex with overflow-x-auto. No drag-to-reorder
// in this quick — that's Quick 7 (split pane) territory if it comes at all.
//
// a11y: uses `role="tablist"`, each tab `role="tab"` with `aria-selected`
// and `aria-controls` pointing at the content panel id. The content panel
// (rendered by App.tsx) carries `role="tabpanel"` with matching id.

import {
  BookOpen,
  Columns2,
  FileText,
  Layers,
  Map as MapIcon,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Tab } from '@/hooks/useTabs';

const KIND_ICONS: Record<Tab['kind'], LucideIcon> = {
  overview: BookOpen,
  file: FileText,
  phase: Layers,
  roadmap: MapIcon,
};

export interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Optional: called when the user requests a split view of the tab.
   *  Split-eligible tabs get a small "columns" button next to close. Overview
   *  and already-split tabs never get the button. */
  onSplit?: (id: string) => void;
  /** Id of the tab currently shown in the split (secondary) pane. Used to
   *  hide the split button on the tab that's already in the secondary pane
   *  so we never show the same tab twice. */
  splitTabId?: string | null;
  /** Optional: called when the user clicks the already-active *preview*
   *  tab header. The consumer should promote the preview tab to a stable
   *  pinned-style tab (clearing the `preview` flag and re-keying its id).
   *  Non-preview tabs and non-active preview tabs fall back to `onActivate`. */
  onPromote?: (id: string) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onSplit,
  splitTabId = null,
  onPromote,
}: TabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Main content tabs"
      className="flex items-stretch gap-0.5 border-b border-hive-border bg-hive-bg/50 px-2 overflow-x-auto"
    >
      {tabs.map((tab) => {
        const Icon = KIND_ICONS[tab.kind];
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`
              group relative flex items-stretch min-w-0
              border-t-2 border-r border-transparent
              ${isActive
                ? 'border-t-hive-accent bg-hive-surface'
                : 'border-t-transparent bg-transparent hover:bg-hive-surface/50'}
              ${isActive ? 'border-r-hive-border' : 'border-r-hive-border/30'}
            `}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => {
                // Click on the already-active preview tab header promotes
                // it to a permanent pinned-style tab. All other clicks
                // just activate the tab (existing behavior).
                if (
                  isActive &&
                  tab.kind === 'file' &&
                  tab.preview === true &&
                  onPromote
                ) {
                  onPromote(tab.id);
                  return;
                }
                onActivate(tab.id);
              }}
              className={`
                flex items-center gap-2 px-3 py-2 min-w-0 max-w-[220px]
                font-mono text-[11px] uppercase tracking-wider
                transition-colors
                ${tab.kind === 'file' && tab.preview === true ? 'italic' : ''}
                ${isActive
                  ? 'text-hive-accent'
                  : 'text-hive-muted hover:text-hive-text-secondary'}
              `}
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="truncate min-w-0">{tab.label}</span>
              {tab.pinned && (
                <span
                  className="flex-shrink-0 text-[8px] text-hive-muted"
                  aria-label="pinned"
                  title="Pinned tab"
                >
                  ●
                </span>
              )}
            </button>
            {onSplit && tab.kind !== 'overview' && tab.id !== splitTabId && (
              <button
                type="button"
                aria-label={`Open ${tab.label} in split view`}
                title="Split right"
                onClick={() => onSplit(tab.id)}
                className={`
                  flex items-center justify-center px-1.5
                  transition-colors
                  ${isActive
                    ? 'text-hive-muted hover:text-hive-accent'
                    : 'text-hive-muted/50 hover:text-hive-accent opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}
                `}
              >
                <Columns2 className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
            {!tab.pinned && (
              <button
                type="button"
                aria-label={`Close ${tab.label}`}
                onClick={() => onClose(tab.id)}
                className={`
                  flex items-center justify-center px-1.5 -ml-1
                  transition-colors
                  ${isActive
                    ? 'text-hive-muted hover:text-hive-danger'
                    : 'text-hive-muted/50 hover:text-hive-danger opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}
                `}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
