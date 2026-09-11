import { useState, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { BeeConfig } from '@/types/snapshot';

// ConfigSummaryPanel — editable config panel with toggle switches.
// Reads config from snapshot, sends POST /api/config to persist changes.

interface ConfigSummaryPanelProps {
  config: BeeConfig | null | undefined;
}

// ── Toggle Switch (CSS-only) ──
function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`
        relative inline-flex h-5 w-9 items-center rounded-none border transition-colors
        ${value
          ? 'bg-hive-accent/20 border-hive-accent/50'
          : 'bg-hive-elevated border-hive-border'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-hive-border-bright'}
      `}
    >
      <span
        className={`
          inline-block h-3 w-3 transform transition-transform
          ${value ? 'translate-x-4 bg-hive-accent' : 'translate-x-1 bg-hive-muted'}
        `}
      />
    </button>
  );
}

// ── Mode Selector ──
function ModeSelector({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const modes = ['economy', 'quality', 'premium'];
  return (
    <div className="flex gap-0.5">
      {modes.map((mode) => (
        <button
          key={mode}
          type="button"
          disabled={disabled}
          onClick={() => onChange(mode)}
          className={`
            px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider border transition-all
            ${value === mode
              ? 'bg-hive-accent/20 border-hive-accent/50 text-hive-accent'
              : 'bg-hive-elevated border-hive-border text-hive-muted hover:text-hive-text-secondary hover:border-hive-border-bright'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

// ── Row layout ──
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-xs border-b border-hive-border/20 last:border-b-0">
      <dt className="text-hive-muted font-mono text-[11px] uppercase tracking-wider">{label}</dt>
      <dd className="flex items-center gap-1">{children}</dd>
    </div>
  );
}

export function ConfigSummaryPanel({ config }: ConfigSummaryPanelProps) {
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const saveConfig = useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true);
    setLastSaved(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setLastSaved(new Date().toLocaleTimeString());
      }
    } catch (_) {
      // Silent fail — next snapshot poll will show current state
    } finally {
      setSaving(false);
    }
  }, []);

  if (!config) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Config</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-hive-muted font-mono">No config loaded</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Config</CardTitle>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="font-mono text-[10px] text-hive-amber intel-pulse">SAVING...</span>
            )}
            {lastSaved && !saving && (
              <span className="font-mono text-[10px] text-hive-accent">SAVED {lastSaved}</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl>
          <Row label="Stacks">
            <span className="flex flex-wrap gap-1">
              {config.stacks && config.stacks.length > 0
                ? config.stacks.map((s) => (
                    <Badge key={s.name} variant="default">{s.name}</Badge>
                  ))
                : <span className="text-hive-muted">-</span>}
            </span>
          </Row>

          <Row label="Mode">
            <ModeSelector
              value={config.implementation_mode || 'premium'}
              disabled={saving}
              onChange={(mode) => saveConfig({ implementation_mode: mode })}
            />
          </Row>

          <Row label="Context7">
            <Toggle
              value={!!config.context7}
              disabled={saving}
              onChange={(v) => saveConfig({ context7: v })}
            />
          </Row>

          <Row label="Review: spec">
            <Toggle
              value={!!config.review?.against_spec}
              disabled={saving}
              onChange={(v) => saveConfig({ review: { against_spec: v } })}
            />
          </Row>

          <Row label="Review: standards">
            <Toggle
              value={!!config.review?.against_standards}
              disabled={saving}
              onChange={(v) => saveConfig({ review: { against_standards: v } })}
            />
          </Row>

          <Row label="Review: dead code">
            <Toggle
              value={!!config.review?.dead_code}
              disabled={saving}
              onChange={(v) => saveConfig({ review: { dead_code: v } })}
            />
          </Row>

          <Row label="Ship: final review">
            <Toggle
              value={!!config.ship?.final_review}
              disabled={saving}
              onChange={(v) => saveConfig({ ship: { final_review: v } })}
            />
          </Row>

          <Row label="Ship: max iters">
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={saving}
                  onClick={() => saveConfig({ ship: { max_review_iterations: n } })}
                  className={`
                    w-6 h-6 font-mono text-[10px] border transition-all
                    ${config.ship?.max_review_iterations === n
                      ? 'bg-hive-accent/20 border-hive-accent/50 text-hive-accent'
                      : 'bg-hive-elevated border-hive-border text-hive-muted hover:border-hive-border-bright'}
                    ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  {n}
                </button>
              ))}
            </div>
          </Row>
        </dl>
      </CardContent>
    </Card>
  );
}
