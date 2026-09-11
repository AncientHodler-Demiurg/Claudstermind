// SplitPaneHeader — the mini toolbar on top of the secondary (right) pane.
//
// Shows the tab's title + a close button that unsplits the view. No tab
// system in the secondary pane (single tab at a time), by design — the
// minimal split-pane pattern is "pop out for side-by-side viewing" rather
// than a full second workspace.

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

export interface SplitPaneHeaderProps {
  tab: Tab;
  onClose: () => void;
}

export function SplitPaneHeader({ tab, onClose }: SplitPaneHeaderProps) {
  const Icon = KIND_ICONS[tab.kind];
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hive-border bg-hive-bg/50 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Columns2
          className="h-3.5 w-3.5 flex-shrink-0 text-hive-accent"
          aria-hidden="true"
          aria-label="split view"
        />
        <Icon
          className="h-3.5 w-3.5 flex-shrink-0 text-hive-muted"
          aria-hidden="true"
        />
        <span className="truncate font-mono text-[11px] uppercase tracking-wider text-hive-accent">
          {tab.label}
        </span>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close split view"
        className="flex h-6 w-6 items-center justify-center rounded-none border border-hive-border bg-hive-elevated text-hive-muted transition-colors hover:border-hive-danger hover:text-hive-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hive-accent"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
