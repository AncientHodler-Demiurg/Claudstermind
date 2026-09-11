/**
 * useFileTree — derives a browsable file tree from the snapshot's scanner
 * outputs. Keeps NavigationSidebar data-driven instead of static.
 *
 * Design:
 *   1. Purely derivative — no new snapshot fields. Everything comes from the
 *      existing T1.4 scanner arrays (notes / seeds / discussions / forensics /
 *      debugSessions / quickTasks) plus state.phases and archivedSpecs.
 *   2. Absolute filesystem paths in snapshot entries are converted to paths
 *      relative to the `.bee/` directory so they can be passed straight to
 *      the Quick 002 /api/file endpoint without further transformation.
 *   3. The hook returns a stable shape even when snapshot is null so
 *      NavigationSidebar can render section headers before the first poll
 *      completes.
 *   4. Icons stay in the UI layer — this hook only emits semantic `SectionId`
 *      strings. NavigationSidebar maps ids to lucide-react icons.
 *
 * The tree is intentionally FLAT within each section (one level of entries
 * inside each section header). Nested trees belong to a later quick if/when
 * the snapshot grows nested data.
 */

import { useMemo } from 'react';
import type { Snapshot } from '@/types/snapshot';

// Section identifiers — stable string keys the UI layer uses to pick icons.
export type SectionId =
  | 'phases'
  | 'notes'
  | 'seeds'
  | 'quick'
  | 'discussions'
  | 'forensics'
  | 'debug'
  | 'archives';

// ── Entry shapes ──────────────────────────────────────────────────────────

/** A file the user can open in the main viewer (Quick 4 makes these clickable). */
export interface FileEntry {
  kind: 'file';
  id: string;
  label: string;
  /** Path relative to .bee/, suitable for GET /api/file?path=<this>. */
  relativePath: string;
  /** Optional secondary text (date, severity, status). */
  subLabel?: string;
}

/** A phase row — not a direct file; Quick 5 will render a rich phase detail view. */
export interface PhaseEntry {
  kind: 'phase';
  id: string;
  label: string;
  phaseNumber: number;
  status: string;
}

/** An archived spec — resolves to a directory, not a single file. */
export interface ArchivedSpecEntry {
  kind: 'archived-spec';
  id: string;
  label: string;
  date: string | null;
  phaseCount: number;
}

export type NavEntry = FileEntry | PhaseEntry | ArchivedSpecEntry;

// ── Section ───────────────────────────────────────────────────────────────

export interface SectionNode {
  id: SectionId;
  label: string;
  entries: NavEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Convert an absolute filesystem path (as produced by the snapshot scanners)
 * to a path relative to the `.bee/` directory. Returns null if the path does
 * not sit inside a `.bee/` directory. Normalises Windows backslashes.
 */
export function toRelativeBeePath(absPath: string | null | undefined): string | null {
  if (!absPath) return null;
  const normalized = absPath.replace(/\\/g, '/');
  const idx = normalized.indexOf('/.bee/');
  if (idx === -1) return null;
  // 6 = length of '/.bee/'
  return normalized.slice(idx + 6);
}

function lastPathSegment(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts[parts.length - 1] || relativePath;
}

// ── Default sections (used before first snapshot arrives) ─────────────────

const EMPTY_SECTIONS: SectionNode[] = [
  { id: 'phases', label: 'Phases', entries: [] },
  { id: 'notes', label: 'Notes', entries: [] },
  { id: 'seeds', label: 'Seeds', entries: [] },
  { id: 'quick', label: 'Quick Tasks', entries: [] },
  { id: 'discussions', label: 'Discussions', entries: [] },
  { id: 'forensics', label: 'Forensics', entries: [] },
  { id: 'debug', label: 'Debug Sessions', entries: [] },
  { id: 'archives', label: 'Spec History', entries: [] },
];

// ── The hook ──────────────────────────────────────────────────────────────

export function useFileTree(snapshot: Snapshot | null): SectionNode[] {
  return useMemo(() => {
    if (!snapshot) return EMPTY_SECTIONS;

    const phases: PhaseEntry[] = (snapshot.state?.phases ?? []).map((p) => ({
      kind: 'phase',
      id: `phase-${p.number}`,
      label: `Phase ${p.number}: ${p.name}`,
      phaseNumber: p.number,
      status: p.status,
    }));

    const notes: FileEntry[] = (snapshot.notes ?? [])
      .map((n): FileEntry | null => {
        const rel = toRelativeBeePath(n.filePath);
        if (!rel) return null;
        return {
          kind: 'file',
          id: `note:${rel}`,
          label: n.title || lastPathSegment(rel),
          relativePath: rel,
          subLabel: n.date || undefined,
        };
      })
      .filter((x): x is FileEntry => x !== null);

    const seeds: FileEntry[] = (snapshot.seeds ?? [])
      .map((s): FileEntry | null => {
        const rel = toRelativeBeePath(s.filePath);
        if (!rel) return null;
        return {
          kind: 'file',
          id: `seed:${rel}`,
          label: s.title || s.id || lastPathSegment(rel),
          relativePath: rel,
          subLabel: s.status || s.planted || undefined,
        };
      })
      .filter((x): x is FileEntry => x !== null);

    const quickTasks: FileEntry[] = (snapshot.quickTasks ?? [])
      .map((q): FileEntry | null => {
        const rel = toRelativeBeePath(q.filePath);
        if (!rel) return null;
        return {
          kind: 'file',
          id: `quick:${rel}`,
          label: q.title || lastPathSegment(rel),
          relativePath: rel,
          subLabel: q.date || q.status || undefined,
        };
      })
      .filter((x): x is FileEntry => x !== null);

    const discussions: FileEntry[] = (snapshot.discussions ?? [])
      .map((d): FileEntry | null => {
        const rel = toRelativeBeePath(d.filePath);
        if (!rel) return null;
        return {
          kind: 'file',
          id: `discussion:${rel}`,
          label: d.title || lastPathSegment(rel),
          relativePath: rel,
          subLabel: d.date || undefined,
        };
      })
      .filter((x): x is FileEntry => x !== null);

    const forensics: FileEntry[] = (snapshot.forensics ?? [])
      .map((f): FileEntry | null => {
        const rel = toRelativeBeePath(f.filePath);
        if (!rel) return null;
        const severityLabel = f.severity ? String(f.severity) : '';
        const dateLabel = f.date || '';
        const subLabel = [severityLabel, dateLabel].filter(Boolean).join(' · ');
        return {
          kind: 'file',
          id: `forensic:${rel}`,
          label: f.title || lastPathSegment(rel),
          relativePath: rel,
          subLabel: subLabel || undefined,
        };
      })
      .filter((x): x is FileEntry => x !== null);

    const debug: FileEntry[] = (snapshot.debugSessions ?? [])
      .map((d): FileEntry | null => {
        const rel = toRelativeBeePath(d.filePath);
        if (!rel) return null;
        const statusLabel = d.status ? String(d.status) : '';
        const focusLabel = d.current_focus ? String(d.current_focus) : '';
        const subLabel = [statusLabel, focusLabel].filter(Boolean).join(' · ');
        return {
          kind: 'file',
          id: `debug:${rel}`,
          label: d.slug || lastPathSegment(rel),
          relativePath: rel,
          subLabel: subLabel || undefined,
        };
      })
      .filter((x): x is FileEntry => x !== null);

    const archives: ArchivedSpecEntry[] = (snapshot.archivedSpecs ?? []).map((a) => ({
      kind: 'archived-spec',
      id: `archived:${a.dirName}`,
      label: a.name,
      date: a.date,
      phaseCount: a.phaseCount,
    }));

    return [
      { id: 'phases', label: 'Phases', entries: phases },
      { id: 'notes', label: 'Notes', entries: notes },
      { id: 'seeds', label: 'Seeds', entries: seeds },
      { id: 'quick', label: 'Quick Tasks', entries: quickTasks },
      { id: 'discussions', label: 'Discussions', entries: discussions },
      { id: 'forensics', label: 'Forensics', entries: forensics },
      { id: 'debug', label: 'Debug Sessions', entries: debug },
      { id: 'archives', label: 'Spec History', entries: archives },
    ];
  }, [snapshot]);
}
