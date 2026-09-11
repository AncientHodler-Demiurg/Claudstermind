// NavigationSidebar — HIVE intelligence nav tree.
//
// Consumes the file tree from `useFileTree(snapshot)` and renders each
// section as a collapsible group of entries. Sections are collapsed/expanded
// via local `useState<Set<SectionId>>` state — users can click a section
// header to toggle without touching global state.
//
// Entry types (from useFileTree):
//   - 'file'          → clickable text file. Calls `onOpenFile(relativePath)`
//                       when the user activates it. The callback is
//                       Quick 4 territory — Quick 3 accepts it but App.tsx
//                       may omit it (in which case entries are inert).
//   - 'phase'         → phase row with status badge. Clicking calls
//                       `onOpenPhase(phaseNumber)` — Quick 5 renders a rich
//                       phase detail view.
//   - 'archived-spec' → historical spec directory. Rendered with date + phase
//                       count; currently inert (no onOpen handler).
//
// Icons live in the UI layer (this file) via a `SectionId → LucideIcon` map,
// so the hook stays pure data.
//
// a11y: the outer container is a `<nav aria-label>` landmark. Section
// headers are `<button type="button" aria-expanded>` disclosure buttons.
// Entry buttons carry an explicit `aria-label` with the entry's label when
// the subLabel would otherwise be ignored by screen readers.

import {
  Bug,
  ChevronRight,
  FileText,
  History,
  Layers,
  MessagesSquare,
  Search,
  Sprout,
  StickyNote,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type {
  NavEntry,
  SectionId,
  SectionNode,
} from '@/hooks/useFileTree';

// ── Icon map ──────────────────────────────────────────────────────────────

const SECTION_ICONS: Record<SectionId, LucideIcon> = {
  phases: Layers,
  notes: StickyNote,
  seeds: Sprout,
  quick: Zap,
  discussions: MessagesSquare,
  forensics: Search,
  debug: Bug,
  archives: History,
};

// ── Props ─────────────────────────────────────────────────────────────────

export interface NavigationSidebarProps {
  sections: SectionNode[];
  /** Optional: called when a file entry is clicked. If omitted, files are inert.
   *  Sidebar clicks default to `{ preview: true }` to match panel behavior so
   *  navigation flows reuse the single sentinel preview slot until the user
   *  promotes it. */
  onOpenFile?: (
    relativePath: string,
    label: string,
    options?: { preview?: boolean },
  ) => void;
  /** Optional: called when a phase row is clicked. If omitted, phases are inert. */
  onOpenPhase?: (phaseNumber: number, label: string) => void;
  /** Optional: path of the currently-active file so we can highlight it. */
  activeFilePath?: string | null;
  /** Optional: phase number of the currently-active phase so we can highlight it. */
  activePhaseNumber?: number | null;
}

// ── Status → class for phase badges ───────────────────────────────────────

function phaseStatusClass(status: string): string {
  const s = status.toUpperCase();
  if (s === 'COMMITTED' || s === 'TESTED' || s === 'REVIEWED') {
    return 'bg-hive-success-dim text-hive-success border-hive-success/40';
  }
  if (s === 'EXECUTING' || s === 'REVIEWING' || s === 'TESTING') {
    return 'bg-hive-amber-dim text-hive-amber border-hive-amber/40';
  }
  if (s === 'EXECUTED' || s === 'PLANNED' || s === 'PLAN_REVIEWED') {
    return 'bg-hive-accent/20 text-hive-accent border-hive-accent/40';
  }
  return 'bg-hive-elevated text-hive-muted border-hive-border';
}

// ── Component ─────────────────────────────────────────────────────────────

export function NavigationSidebar({
  sections,
  onOpenFile,
  onOpenPhase,
  activeFilePath = null,
  activePhaseNumber = null,
}: NavigationSidebarProps) {
  // Persist open sections as a plain array in localStorage (Set cannot be
  // JSON-serialized directly). Internally we still toggle by Set semantics
  // but read/write the array form at the boundary.
  const [openSectionsArray, setOpenSectionsArray] = useLocalStorageState<
    string[]
  >('bee-hive:v1:openSections', ['phases', 'quick', 'seeds'], {
    validate: (v): v is string[] =>
      Array.isArray(v) && v.every((x) => typeof x === 'string'),
  });
  const openSections = new Set<SectionId>(openSectionsArray as SectionId[]);

  function toggleSection(id: SectionId) {
    setOpenSectionsArray((prev) => {
      const set = new Set(prev);
      if (set.has(id)) {
        set.delete(id);
      } else {
        set.add(id);
      }
      return Array.from(set);
    });
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Navigation</CardTitle>
      </CardHeader>
      <CardContent className="px-2">
        <nav aria-label="Dashboard navigation">
          <ul className="flex flex-col gap-1">
            {sections.map((section) => {
              const Icon = SECTION_ICONS[section.id];
              const isOpen = openSections.has(section.id);
              const count = section.entries.length;
              const hasEntries = count > 0;
              return (
                <li key={section.id} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={isOpen}
                    aria-controls={`nav-section-${section.id}`}
                    className={`
                      group flex items-center gap-2 border-l-2 border-transparent
                      px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider
                      transition-colors
                      ${hasEntries
                        ? 'text-hive-text-secondary hover:text-hive-accent hover:border-hive-accent/50 cursor-pointer'
                        : 'text-hive-muted cursor-default'}
                    `}
                  >
                    <ChevronRight
                      className={`
                        h-3 w-3 flex-shrink-0 transition-transform
                        ${isOpen ? 'rotate-90' : ''}
                        ${hasEntries ? '' : 'opacity-30'}
                      `}
                      aria-hidden="true"
                    />
                    <Icon
                      className="h-3.5 w-3.5 flex-shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate min-w-0 flex-1 text-left">
                      {section.label}
                    </span>
                    <span className="font-mono text-[9px] text-hive-muted tabular-nums">
                      {count}
                    </span>
                  </button>
                  {isOpen && hasEntries && (
                    <ul
                      id={`nav-section-${section.id}`}
                      className="flex flex-col gap-0.5 pl-5 pt-0.5"
                    >
                      {section.entries.map((entry) => (
                        <NavEntryItem
                          key={entry.id}
                          entry={entry}
                          activeFilePath={activeFilePath}
                          activePhaseNumber={activePhaseNumber}
                          onOpenFile={onOpenFile}
                          onOpenPhase={onOpenPhase}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </CardContent>
    </Card>
  );
}

// ── Per-entry renderer ────────────────────────────────────────────────────

interface NavEntryItemProps {
  entry: NavEntry;
  activeFilePath: string | null;
  activePhaseNumber: number | null;
  onOpenFile?: (
    relativePath: string,
    label: string,
    options?: { preview?: boolean },
  ) => void;
  onOpenPhase?: (phaseNumber: number, label: string) => void;
}

function NavEntryItem({
  entry,
  activeFilePath,
  activePhaseNumber,
  onOpenFile,
  onOpenPhase,
}: NavEntryItemProps) {
  if (entry.kind === 'phase') {
    const isActive = activePhaseNumber === entry.phaseNumber;
    const interactive = !!onOpenPhase;
    return (
      <li>
        <button
          type="button"
          disabled={!interactive}
          onClick={() => onOpenPhase?.(entry.phaseNumber, entry.label)}
          className={`
            flex w-full items-center gap-2 border-l-2 px-2 py-1
            text-[10px] font-mono text-left transition-colors
            ${isActive
              ? 'border-hive-accent bg-hive-accent/10 text-hive-accent'
              : interactive
                ? 'border-transparent text-hive-text-secondary hover:border-hive-border-bright hover:text-hive-text cursor-pointer'
                : 'border-transparent text-hive-muted cursor-default'}
          `}
        >
          <FileText className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          <span className="truncate min-w-0 flex-1">{entry.label}</span>
          <span
            className={`
              px-1 text-[8px] uppercase tracking-wider border rounded-none
              ${phaseStatusClass(entry.status)}
            `}
          >
            {entry.status}
          </span>
        </button>
      </li>
    );
  }

  if (entry.kind === 'archived-spec') {
    // Archived specs resolve to directories, not single files. Render
    // inert until a future quick adds a "show archived spec detail" view.
    return (
      <li>
        <div
          className="flex items-center gap-2 border-l-2 border-transparent px-2 py-1 text-[10px] font-mono text-hive-muted cursor-default"
        >
          <History className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          <span className="truncate min-w-0 flex-1">{entry.label}</span>
          <span className="text-[8px] tabular-nums text-hive-muted/70">
            {entry.phaseCount}P
          </span>
        </div>
      </li>
    );
  }

  // entry.kind === 'file'
  const isActive = activeFilePath === entry.relativePath;
  const interactive = !!onOpenFile;
  return (
    <li>
      <button
        type="button"
        disabled={!interactive}
        onClick={() => onOpenFile?.(entry.relativePath, entry.label, { preview: true })}
        aria-label={entry.subLabel ? `${entry.label} — ${entry.subLabel}` : entry.label}
        className={`
          flex w-full items-start gap-2 border-l-2 px-2 py-1
          text-[10px] font-mono text-left transition-colors
          ${isActive
            ? 'border-hive-accent bg-hive-accent/10 text-hive-accent'
            : interactive
              ? 'border-transparent text-hive-text-secondary hover:border-hive-border-bright hover:text-hive-text cursor-pointer'
              : 'border-transparent text-hive-muted cursor-default'}
        `}
      >
        <FileText className="h-3 w-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <span className="flex flex-col min-w-0 flex-1 gap-0.5">
          <span className="truncate">{entry.label}</span>
          {entry.subLabel && (
            <span className="truncate text-[9px] text-hive-muted normal-case tracking-normal">
              {entry.subLabel}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
