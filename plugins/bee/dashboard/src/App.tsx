// HIVE INTELLIGENCE SYSTEMS — Command Center App
// Layout zones (Overview tab):
//   Zone 1: System Status — Config + Phases + Requirements (overview strip)
//   Zone 2: Analytics — Health Trend + Velocity + Code Quality (charts)
//   Zone 3: Intelligence Data — Notes, Seeds, Discussions, Forensics, Debug, Quick Tasks
//
// Tab system (Quick 4):
//   - Overview is always pinned as tab 0.
//   - Clicking a file in the NavigationSidebar opens a file tab rendered by
//     FileViewer → /api/file → MarkdownViewer.
//   - Clicking a phase row opens a phase tab rendered by PhaseDetailView
//     (Quick 5).
//   - A Roadmap shortcut in the header opens the Roadmap tab (Quick 6).
import { MissionControlLayout, SectionDivider } from '@/components/MissionControlLayout';
import { NavigationSidebar } from '@/components/NavigationSidebar';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { ActivityFeed } from '@/components/ActivityFeed';
import { LiveActivityPanel } from '@/components/LiveActivityPanel';
import { Skeleton } from '@/components/ui/skeleton';
import { TabBar } from '@/components/TabBar';
import { TabContentRenderer } from '@/components/TabContentRenderer';
import { SplitPaneHeader } from '@/components/SplitPaneHeader';
import { Map as MapIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSnapshot } from '@/hooks/useSnapshot';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { useFileTree } from '@/hooks/useFileTree';
import { useTabs, type Tab } from '@/hooks/useTabs';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

import { PhasesPanel } from '@/components/panels/PhasesPanel';
import { HealthTrendChart } from '@/components/panels/HealthTrendChart';
import { VelocityChart } from '@/components/panels/VelocityChart';
import { CodeQualityChart } from '@/components/panels/CodeQualityChart';
import { RequirementsCoveragePanel } from '@/components/panels/RequirementsCoveragePanel';
import { NotesPanel } from '@/components/panels/NotesPanel';
import { SeedsPanel } from '@/components/panels/SeedsPanel';
import { DiscussionsPanel } from '@/components/panels/DiscussionsPanel';
import { ForensicsPanel } from '@/components/panels/ForensicsPanel';
import { DebugSessionsPanel } from '@/components/panels/DebugSessionsPanel';
import { QuickTasksPanel } from '@/components/panels/QuickTasksPanel';
import { ConfigSummaryPanel } from '@/components/panels/ConfigSummaryPanel';
import { ArchivedSpecsPanel } from '@/components/panels/ArchivedSpecsPanel';
import { ActiveSpecsPanel } from '@/components/panels/ActiveSpecsPanel';

function SkeletonGrid() {
  return (
    <div className="space-y-5">
      {/* Zone 1 skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
      {/* Zone 2 skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
      {/* Zone 3 skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    </div>
  );
}

function OverviewTabContent({
  snapshot,
  flatMetrics,
  onOpenFile,
}: {
  snapshot: ReturnType<typeof useSnapshot>['snapshot'];
  flatMetrics: Array<Record<string, unknown>>;
  onOpenFile: (
    relativePath: string,
    label: string,
    options?: { preview?: boolean },
  ) => void;
}) {
  if (snapshot === null) {
    return <SkeletonGrid />;
  }
  return (
    <>
      {/* ════════════════════════════════════════════════════════════
          ZONE 1: SYSTEM STATUS — overview at a glance
          Config (left) | Phases (center) | Requirements (right)
          ════════════════════════════════════════════════════════════ */}
      <SectionDivider label="System Status" />
      {/* Zone 1: bump to xl:grid-cols-4 so the 4-up layout only fires at
          1280px+. At lg: (1024px) with both sidebars open the main area
          is ~384px wide — too narrow for 4 panels. xl: keeps the 2-up
          stack for that band and promotes to 4-up only when there is room. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <ConfigSummaryPanel config={snapshot.config} />
        <PhasesPanel phases={snapshot.state?.phases ?? null} />
        <RequirementsCoveragePanel requirements={snapshot.requirements} />
        <ActiveSpecsPanel
          activeSpecs={snapshot.activeSpecs}
          currentSpecName={snapshot.state?.currentSpec?.name}
        />
        <ArchivedSpecsPanel
          archivedSpecs={snapshot.archivedSpecs}
          currentSpecName={snapshot.state?.currentSpec?.name}
        />
      </div>

      {/* ════════════════════════════════════════════════════════════
          ZONE 2: ANALYTICS — charts and trends
          Health Trend | Velocity | Code Quality
          ════════════════════════════════════════════════════════════ */}
      <SectionDivider label="Analytics" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <HealthTrendChart healthHistory={snapshot.healthHistory} />
        <VelocityChart
          phaseMetrics={flatMetrics}
          phases={snapshot.state?.phases ?? null}
        />
        <CodeQualityChart phaseMetrics={flatMetrics} />
      </div>

      {/* ════════════════════════════════════════════════════════════
          ZONE 3: INTELLIGENCE DATA — detailed feeds
          6 panels in a responsive 2x3 or 3x2 grid
          ════════════════════════════════════════════════════════════ */}
      <SectionDivider label="Intelligence Data" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ForensicsPanel forensics={snapshot.forensics} />
        <DebugSessionsPanel debugSessions={snapshot.debugSessions} />
        <NotesPanel notes={snapshot.notes} onOpenFile={onOpenFile} />
        <SeedsPanel seeds={snapshot.seeds} onOpenFile={onOpenFile} />
        <DiscussionsPanel discussions={snapshot.discussions} onOpenFile={onOpenFile} />
        <QuickTasksPanel quickTasks={snapshot.quickTasks} onOpenFile={onOpenFile} />
      </div>
    </>
  );
}

export default function App() {
  const { snapshot, connectionStatus, lastUpdated } = useSnapshot();
  const events = useActivityFeed(snapshot, connectionStatus);
  // Live hook-event stream (Quick 11 consumer). Aliased because `events` and
  // `connectionStatus` already exist at this scope from the snapshot/activity-
  // feed hooks above; without the aliases the destructure would shadow and
  // the JSX below would silently use the wrong buffer.
  const { events: liveEvents, connectionStatus: liveConnectionStatus } =
    useLiveEvents();
  const sections = useFileTree(snapshot);
  const {
    tabs,
    activeTab,
    activeTabId,
    openFileTab,
    openPhaseTab,
    openRoadmapTab,
    closeTab,
    activateTab,
    promoteTab,
  } = useTabs();

  // Split pane: a single secondary tab that pops out to the right of the
  // main pane for side-by-side viewing. Not a full second tab system — just
  // "show this one alongside". Setting to null hides the secondary pane.
  const [splitTab, setSplitTab] = useState<Tab | null>(null);
  const openSplit = (tabId: string) => {
    const target = tabs.find((t) => t.id === tabId);
    if (!target || target.kind === 'overview') return;
    setSplitTab(target);
  };
  const closeSplit = () => setSplitTab(null);

  // Keyboard shortcuts: Escape / [ / ] / \
  useKeyboardShortcuts({
    onEscape: () => {
      if (splitTab) {
        setSplitTab(null);
        return;
      }
      if (activeTab.kind !== 'overview') {
        closeTab(activeTab.id);
      }
    },
    onPrevTab: () => {
      const idx = tabs.findIndex((t) => t.id === activeTab.id);
      if (idx > 0) activateTab(tabs[idx - 1].id);
    },
    onNextTab: () => {
      const idx = tabs.findIndex((t) => t.id === activeTab.id);
      if (idx >= 0 && idx < tabs.length - 1) {
        activateTab(tabs[idx + 1].id);
      }
    },
    onToggleSplit: () => {
      if (splitTab) {
        setSplitTab(null);
      } else if (activeTab.kind !== 'overview') {
        setSplitTab(activeTab);
      }
    },
  });

  // If the main pane closes a tab that's also in the split pane, auto-close
  // the split too (stale tab cleanup). Runs as an effect (not during render)
  // so React can schedule the update cleanly — this avoids the "Cannot
  // update during render" warning and render-storm risk of a render-phase
  // setState pattern.
  useEffect(() => {
    if (splitTab && !tabs.some((t) => t.id === splitTab.id)) {
      setSplitTab(null);
    }
  }, [tabs, splitTab]);

  const flatMetrics =
    snapshot?.phaseMetrics?.flatMap((p) => p.phases ?? []) ?? [];

  // Track the active file/phase so NavigationSidebar can highlight them.
  const activeFilePath =
    activeTab.kind === 'file' ? activeTab.relativePath : null;
  const activePhaseNumber =
    activeTab.kind === 'phase' ? activeTab.phaseNumber : null;

  // Shared overview content instance — rendered inside whichever pane has
  // the overview tab active (always main for now since overview can't be
  // split-popped).
  const overviewContent = (
    <OverviewTabContent
      snapshot={snapshot}
      flatMetrics={flatMetrics}
      onOpenFile={openFileTab}
    />
  );

  return (
    <MissionControlLayout
      headerRight={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openRoadmapTab}
            aria-label="Open roadmap view"
            className="hidden md:inline-flex items-center gap-1.5 rounded-none border border-hive-border bg-hive-elevated px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-hive-muted transition-colors hover:border-hive-border-bright hover:text-hive-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hive-accent"
          >
            <MapIcon className="h-3 w-3" aria-hidden="true" />
            Roadmap
          </button>
          <ConnectionStatus status={connectionStatus} lastUpdated={lastUpdated} />
        </div>
      }
      feed={
        <div className="flex flex-col gap-4">
          <LiveActivityPanel
            events={liveEvents}
            connectionStatus={liveConnectionStatus}
          />
          <ActivityFeed events={events} />
        </div>
      }
      leftSidebar={
        <NavigationSidebar
          sections={sections}
          onOpenFile={openFileTab}
          onOpenPhase={openPhaseTab}
          activeFilePath={activeFilePath}
          activePhaseNumber={activePhaseNumber}
        />
      }
    >
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={activateTab}
        onClose={closeTab}
        onSplit={openSplit}
        splitTabId={splitTab?.id ?? null}
        onPromote={promoteTab}
      />
      <div
        className={
          splitTab
            ? 'grid grid-cols-1 lg:grid-cols-2 gap-4'
            : 'space-y-5'
        }
      >
        <div
          role="tabpanel"
          id={`tabpanel-${activeTab.id}`}
          aria-labelledby={`tab-${activeTab.id}`}
          className="space-y-5 min-w-0"
        >
          <TabContentRenderer
            tab={activeTab}
            snapshot={snapshot}
            overviewContent={overviewContent}
            onOpenPhase={openPhaseTab}
          />
        </div>
        {splitTab && (
          <div
            role="tabpanel"
            id={`tabpanel-split-${splitTab.id}`}
            aria-label={`Split view: ${splitTab.label}`}
            className="flex flex-col min-w-0 border border-hive-border rounded-none bg-hive-bg/30"
          >
            <SplitPaneHeader tab={splitTab} onClose={closeSplit} />
            <div className="flex-1 space-y-5 p-3 min-w-0 overflow-y-auto">
              <TabContentRenderer
                tab={splitTab}
                snapshot={snapshot}
                overviewContent={overviewContent}
                onOpenPhase={openPhaseTab}
              />
            </div>
          </div>
        )}
      </div>
    </MissionControlLayout>
  );
}
