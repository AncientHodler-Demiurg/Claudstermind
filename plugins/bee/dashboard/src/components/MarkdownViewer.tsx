// MarkdownViewer — HIVE-themed wrapper around react-markdown.
//
// Renders markdown content with:
//   - GitHub-flavoured extensions (tables, strikethrough, task lists) via
//     remark-gfm.
//   - Hive dark palette: `bg-hive-surface` body, `hive-accent` headings,
//     `hive-border` dividers, `hive-elevated` code blocks.
//   - Tabular alignment for tables, mono font for code.
//   - Safe defaults: external links open in a new tab with noreferrer.
//
// No syntax highlighting — Quick 001-008 keep the viewer dependency-light.
// Syntax highlighting can be added later via rehype-highlight if needed.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <div className="markdown-viewer font-sans text-sm leading-relaxed text-hive-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 mb-3 border-b border-hive-border pb-2 font-display text-2xl font-semibold uppercase tracking-[0.08em] text-hive-accent first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 mb-2 border-b border-hive-border/50 pb-1 font-display text-xl font-semibold uppercase tracking-[0.06em] text-hive-text first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-5 mb-2 font-display text-base font-semibold uppercase tracking-wider text-hive-text-secondary">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-4 mb-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-hive-muted">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="my-3 leading-relaxed text-hive-text">{children}</p>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel={href?.startsWith('http') ? 'noreferrer noopener' : undefined}
              className="text-hive-accent underline decoration-hive-accent/40 underline-offset-2 hover:decoration-hive-accent"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="my-3 list-disc pl-6 space-y-1 marker:text-hive-muted">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal pl-6 space-y-1 marker:text-hive-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-hive-text">{children}</li>
          ),
          code: ({ className, children }) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return (
                <code className={`${className ?? ''} font-mono text-xs text-hive-text`}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded-none border border-hive-border bg-hive-elevated px-1 py-0.5 font-mono text-[0.85em] text-hive-accent">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-4 overflow-x-auto rounded-none border border-hive-border bg-hive-elevated p-4 font-mono text-xs leading-relaxed text-hive-text">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-2 border-hive-accent/60 bg-hive-accent/5 pl-4 py-2 italic text-hive-text-secondary">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-hive-border" />,
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full border-collapse border border-hive-border font-mono text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-hive-elevated">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-hive-border px-3 py-2 text-left font-semibold uppercase tracking-wider text-hive-accent">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-hive-border px-3 py-2 text-hive-text">
              {children}
            </td>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-hive-text">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-hive-text-secondary">{children}</em>
          ),
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt ?? ''}
              className="my-4 max-w-full rounded-none border border-hive-border"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
