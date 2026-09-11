---
name: realtime
description: "Realtime communication patterns -- WebSocket, SSE, Pusher, Socket.io, polling. Use when project implements live updates, chat, notifications, or collaborative features."
---

# Realtime Standards

These patterns apply when building features requiring live data: chat, notifications, collaborative editing, live dashboards, real-time feeds.

## Choosing the Right Protocol

| Protocol | Use When | Latency | Complexity |
|----------|----------|---------|------------|
| **WebSocket** | Bidirectional communication (chat, gaming, collaboration) | Lowest | High |
| **Server-Sent Events (SSE)** | Server-to-client only (notifications, live feeds, dashboards) | Low | Low |
| **Long Polling** | SSE not supported, simple fallback | Medium | Low |
| **Pusher/Ably** | Managed WebSocket, need scaling without infrastructure | Low | Lowest |

## WebSocket (Native)

```typescript
// Server (Node.js with ws)
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws, req) => {
  const userId = authenticateFromHeaders(req); // verify auth before accepting
  if (!userId) { ws.close(1008, 'Unauthorized'); return; }

  ws.on('message', (data) => {
    let message;
    try { message = JSON.parse(data.toString()); } catch { ws.send(JSON.stringify({ error: 'invalid JSON' })); return; }
    handleMessage(userId, message);
  });

  ws.on('close', () => { handleDisconnect(userId); });
});

// Client
const ws = new WebSocket(`wss://api.example.com/ws?token=${token}`);
ws.onmessage = (event) => {
  let data; try { data = JSON.parse(event.data); } catch { return; }
  handleServerMessage(data);
};
ws.onclose = () => { scheduleReconnect(); }; // always reconnect
```

### Reconnection Pattern

```typescript
function createReconnectingWebSocket(url: string) {
  let ws: WebSocket;
  let reconnectAttempt = 0;
  const maxDelay = 30_000;

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => { reconnectAttempt = 0; };
    ws.onclose = () => {
      const delay = Math.min(1000 * 2 ** reconnectAttempt, maxDelay);
      setTimeout(connect, delay);
      reconnectAttempt++;
    };
    ws.onmessage = (event) => { /* handle */ };
  }

  connect();
  return { send: (data: unknown) => ws.send(JSON.stringify(data)), close: () => ws.close() };
}
```

## Server-Sent Events (SSE)

Simpler than WebSocket for server-to-client streaming:

```typescript
// Server (any framework)
export function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      // Send events
      const interval = setInterval(() => send({ type: 'heartbeat' }), 30_000);
      const unsubscribe = eventBus.on('notification', (n) => send(n));

      req.signal.addEventListener('abort', () => { clearInterval(interval); unsubscribe(); });
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
}

// Client
const eventSource = new EventSource('/api/events');
eventSource.onmessage = (event) => { let data; try { data = JSON.parse(event.data); } catch { return; } /* handle data */ };
eventSource.onerror = () => { /* auto-reconnects by default */ };
```

## Rules

- Always authenticate WebSocket connections before accepting messages. Note: browser WebSocket API does not support custom headers — use short-lived tokens in query string or a ticket-based auth pattern (POST to get ticket, pass ticket in WS URL)
- Implement exponential backoff reconnection on the client
- Send heartbeat pings every 30s to detect stale connections
- Use JSON for message format with a `type` field for routing: `{ type: 'message', payload: {...} }`
- Clean up listeners and connections on component unmount
- SSE auto-reconnects by default — WebSocket requires manual reconnection logic

## Common Pitfalls

- **No auth on WebSocket** — accepting connections without token verification
- **No reconnection** — network drops kill the connection permanently
- **Memory leaks** — not cleaning up event listeners on unmount
- **No heartbeat** — stale connections stay open, consuming resources
- **JSON.parse without try/catch** — malformed messages crash the handler
- **Broadcasting to all** — send only to relevant users/rooms, not entire connection pool
