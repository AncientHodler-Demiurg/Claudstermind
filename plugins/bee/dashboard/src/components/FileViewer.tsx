// FileViewer — fetches a file from /api/file and renders it via the
// MarkdownViewer. Handles loading, error, and success states locally.
//
// Data flow:
//   relativePath → GET /api/file?path=<encoded> → { content, mtime, size }
//   → MarkdownViewer(content) for .md/.markdown, plain <pre> for .txt/.json/
//     .yml/.yaml (so JSON stays legible without markdown parsing).
//
// Each `relativePath` change triggers a fresh fetch with AbortController
// cleanup so rapidly switching tabs does not race.

import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MarkdownViewer } from '@/components/MarkdownViewer';

interface FileResponse {
  path: string;
  content: string;
  mtime: string;
  size: number;
}

interface FileErrorResponse {
  error: string;
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; httpStatus?: number }
  | { status: 'success'; data: FileResponse };

export interface FileViewerProps {
  relativePath: string;
  label: string;
}

function isMarkdown(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function FileViewer({ relativePath, label }: FileViewerProps) {
  const [state, setState] = useState<FetchState>({ status: 'idle' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    const url = `/api/file?path=${encodeURIComponent(relativePath)}`;
    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as FileErrorResponse;
            if (body.error) message = body.error;
          } catch (_) {
            // non-JSON error body — keep generic message
          }
          throw Object.assign(new Error(message), { httpStatus: res.status });
        }
        return (await res.json()) as FileResponse;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ status: 'success', data });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: err?.message ?? 'Unknown error',
          httpStatus: err?.httpStatus,
        });
      });

    return () => {
      controller.abort();
    };
  }, [relativePath]);

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 flex-shrink-0 text-hive-accent" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </CardTitle>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant="muted">
              <span className="font-mono text-[10px]">{relativePath}</span>
            </Badge>
            {state.status === 'success' && (
              <Badge variant="default">
                <span className="font-mono text-[10px] tabular-nums">
                  {formatSize(state.data.size)}
                </span>
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {state.status === 'loading' && (
          <div className="flex items-center gap-2 py-6 text-sm text-hive-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading {relativePath}…</span>
          </div>
        )}
        {state.status === 'error' && (
          <div className="flex items-start gap-2 rounded-none border border-hive-danger/40 bg-hive-danger-dim p-4">
            <AlertTriangle
              className="h-4 w-4 flex-shrink-0 text-hive-danger mt-0.5"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-1 min-w-0">
              <span className="font-mono text-xs text-hive-danger">
                {state.httpStatus ? `HTTP ${state.httpStatus}` : 'Fetch failed'}
              </span>
              <span className="text-sm text-hive-text">{state.message}</span>
              <span className="font-mono text-[10px] text-hive-muted">
                {relativePath}
              </span>
            </div>
          </div>
        )}
        {state.status === 'success' && (
          <>
            {isMarkdown(relativePath) ? (
              <MarkdownViewer content={state.data.content} />
            ) : (
              <pre className="overflow-x-auto rounded-none border border-hive-border bg-hive-elevated p-4 font-mono text-xs leading-relaxed text-hive-text whitespace-pre-wrap">
                {state.data.content}
              </pre>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
