/**
 * useKeyboardShortcuts — wires a tiny set of global single-key shortcuts
 * into the dashboard. All shortcuts are gated on "no input is focused" so
 * typing in a future search box (or a textarea in a markdown editor) does
 * not trigger them.
 *
 * Shortcuts (Quick 8):
 *   Escape  — close split pane (priority) OR close active non-overview tab
 *   [       — previous tab
 *   ]       — next tab
 *   \\       — toggle split: pop active tab into split, or close split
 *
 * Modifier-based shortcuts (Cmd/Ctrl+W, Cmd/Ctrl+1..9) are deliberately
 * NOT used because the browser reserves them for its own tab management.
 * Browsers block preventDefault on those combinations in practice.
 *
 * ## Referential stability
 *
 * Callers typically pass a fresh `handlers` object on every render (inline
 * object literal). To avoid re-subscribing the `window` keydown listener on
 * every parent render (which causes listener churn on every 5-second
 * snapshot poll), this hook stores the latest handlers in a ref and
 * subscribes the listener exactly once with an empty dep array. The event
 * handler reads `handlersRef.current` so every keystroke dispatches to the
 * most recent callbacks.
 */

import { useEffect, useRef } from 'react';

export interface KeyboardShortcutHandlers {
  onEscape: () => void;
  onPrevTab: () => void;
  onNextTab: () => void;
  onToggleSplit: () => void;
}

function isTextInputFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (active instanceof HTMLElement && active.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  // Keep a ref of the latest handlers so the window listener (subscribed
  // once) always dispatches to current callbacks even when the parent
  // re-renders with a new inline object literal.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Ignore if any modifier is held — those belong to the browser or OS.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Ignore typing into inputs/textareas.
      if (isTextInputFocused()) return;

      const h = handlersRef.current;
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          h.onEscape();
          return;
        case '[':
          event.preventDefault();
          h.onPrevTab();
          return;
        case ']':
          event.preventDefault();
          h.onNextTab();
          return;
        case '\\':
          event.preventDefault();
          h.onToggleSplit();
          return;
        default:
          return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // Empty deps: subscribe once. Handlers are read via ref at dispatch.

  }, []);
}
