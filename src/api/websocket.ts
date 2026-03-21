import { WebSocketServer, WebSocket } from 'ws';
import { timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';

function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

interface WSClient {
  ws: WebSocket;
  authenticated: boolean;
  subscriptions: Set<string>;
}

const clients: Map<WebSocket, WSClient> = new Map();
const eventBuffers: Map<string, any[]> = new Map();
const MAX_BUFFER = 50;

export function setupWebSocket(server: Server, gatewaySecret: string): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Ping every 30s
  const pingInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(pingInterval));

  wss.on('connection', (ws) => {
    const client: WSClient = { ws, authenticated: false, subscriptions: new Set() };
    clients.set(ws, client);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'auth') {
          if (safeCompare(String(msg.key ?? ''), gatewaySecret)) {
            client.authenticated = true;
            ws.send(JSON.stringify({ type: 'auth_ok' }));
          } else {
            ws.send(JSON.stringify({ type: 'auth_failed' }));
            ws.close();
          }
          return;
        }

        if (!client.authenticated) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
          return;
        }

        if (msg.type === 'subscribe' && msg.taskId) {
          client.subscriptions.add(msg.taskId);
          ws.send(JSON.stringify({ type: 'subscribed', taskId: msg.taskId }));
        }

        if (msg.type === 'sync' && Array.isArray(msg.taskIds)) {
          // Re-subscribe and send current state
          for (const taskId of msg.taskIds) {
            client.subscriptions.add(taskId);
          }
          ws.send(JSON.stringify({ type: 'sync_ok', taskIds: msg.taskIds }));
        }

        if (msg.type === 'replay' && msg.taskId && msg.afterTimestamp) {
          const buffer = eventBuffers.get(msg.taskId) || [];
          const missed = buffer.filter((e: any) => e.timestamp > msg.afterTimestamp);
          for (const event of missed) {
            ws.send(JSON.stringify(event));
          }
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });
}

export function clearEventBuffer(taskId: string): void {
  eventBuffers.delete(taskId);
}

export function broadcast(taskId: string, event: any): void {
  const timestamped = { ...event, timestamp: new Date().toISOString() };

  // Buffer event
  if (!eventBuffers.has(taskId)) eventBuffers.set(taskId, []);
  const buffer = eventBuffers.get(taskId)!;
  buffer.push(timestamped);
  if (buffer.length > MAX_BUFFER) buffer.shift();

  // Send to subscribed clients
  const message = JSON.stringify(timestamped);
  clients.forEach((client) => {
    if (client.authenticated && client.subscriptions.has(taskId) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}
