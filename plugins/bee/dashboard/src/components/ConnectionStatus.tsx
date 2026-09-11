// ConnectionStatus — live polling indicator for the Bee Hive dashboard.
//
// Mirrors the three `ConnectionStatusValue` states produced by `useSnapshot`
// (T3.4) into hive-themed Badge variants so panels can surface poll health
// without each widget re-deriving the same logic.
//
// Status mapping:
//   - 'connecting'   → Badge variant="muted"   + "Connecting..." + animate-pulse
//   - 'connected'    → Badge variant="success" + "Connected · Xs ago" (relative)
//   - 'disconnected' → Badge variant="danger"  + "Disconnected"
//
// Relative time: floor((Date.now() - lastUpdated.getTime()) / 1000) seconds.
// If >= 60s, switch to minutes ("Xm ago"). If `lastUpdated` is null, we omit
// the relative suffix entirely so the badge stays valid on first paint before
// the hook has received its first successful response.
import { Badge } from '@/components/ui/badge';
import type { ConnectionStatusValue } from '@/hooks/useSnapshot';

export interface ConnectionStatusProps {
  status: ConnectionStatusValue;
  lastUpdated: Date | null;
}

function formatRelative(lastUpdated: Date | null): string {
  if (lastUpdated === null) {
    return '';
  }
  const diffMs = Date.now() - lastUpdated.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

export function ConnectionStatus({ status, lastUpdated }: ConnectionStatusProps) {
  if (status === 'connecting') {
    return (
      <Badge variant="muted" className="animate-pulse">
        Connecting...
      </Badge>
    );
  }

  if (status === 'disconnected') {
    return <Badge variant="danger">Disconnected</Badge>;
  }

  // status === 'connected'
  const relative = formatRelative(lastUpdated);
  return (
    <Badge variant="success">
      {relative ? `Connected · ${relative}` : 'Connected'}
    </Badge>
  );
}
