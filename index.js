export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "Brick Classroom Cloudflare Signaling",
        endpoints: {
          websocket: "/ws/:roomId"
        },
        time: new Date().toISOString()
      });
    }

    if (url.pathname.startsWith("/ws/")) {
      const roomId = decodeURIComponent(url.pathname.replace("/ws/", "")).trim();
      if (!roomId) return json({ ok: false, error: "roomId required" }, 400);

      const id = env.ROOMS.idFromName(roomId);
      const room = env.ROOMS.get(id);
      return room.fetch(request);
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
};

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();

    // Restore sockets after hibernation.
    if (this.state.getWebSockets) {
      for (const ws of this.state.getWebSockets()) {
        const meta = ws.deserializeAttachment?.() || {};
        this.sessions.set(ws, meta);
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const apiKey = url.searchParams.get("key") || "";
    const role = url.searchParams.get("role") || "unknown";
    const deviceId = url.searchParams.get("deviceId") || "";

    if (apiKey !== this.env.SIGNALING_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ ok: false, error: "Expected WebSocket upgrade" }, 426);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const meta = {
      role,
      deviceId,
      connectedAt: Date.now(),
      id: crypto.randomUUID()
    };

    if (this.state.acceptWebSocket) {
      this.state.acceptWebSocket(server);
      server.serializeAttachment?.(meta);
    } else {
      server.accept();
      server.addEventListener("message", event => this.handleMessage(server, event.data));
      server.addEventListener("close", () => this.handleClose(server));
      server.addEventListener("error", () => this.handleClose(server));
    }

    this.sessions.set(server, meta);

    this.send(server, {
      type: "joined",
      role,
      deviceId,
      peerCount: this.sessions.size,
      time: new Date().toISOString()
    });

    this.broadcast(server, {
      type: "peer-joined",
      role,
      deviceId,
      peerCount: this.sessions.size,
      time: new Date().toISOString()
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.handleMessage(ws, message);
  }

  async webSocketClose(ws) {
    this.handleClose(ws);
  }

  async webSocketError(ws) {
    this.handleClose(ws);
  }

  async handleMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      this.send(ws, { type: "error", error: "Invalid JSON" });
      return;
    }

    const meta = this.sessions.get(ws) || ws.deserializeAttachment?.() || {};

    if (msg.type === "hello") {
      this.send(ws, {
        type: "hello",
        ok: true,
        role: meta.role,
        deviceId: meta.deviceId,
        time: new Date().toISOString()
      });
      return;
    }

    if (msg.type === "signal") {
      this.broadcast(ws, {
        type: "signal",
        from: {
          role: meta.role || "unknown",
          deviceId: meta.deviceId || ""
        },
        payload: msg.payload || {},
        time: new Date().toISOString()
      });
      return;
    }

    if (msg.type === "presence") {
      this.send(ws, {
        type: "presence",
        peers: [...this.sessions.values()].map(s => ({
          role: s.role,
          deviceId: s.deviceId,
          connectedAt: s.connectedAt
        }))
      });
      return;
    }

    this.send(ws, { type: "error", error: "Unknown message type" });
  }

  handleClose(ws) {
    const meta = this.sessions.get(ws) || {};
    this.sessions.delete(ws);
    this.broadcast(ws, {
      type: "peer-left",
      role: meta.role,
      deviceId: meta.deviceId,
      peerCount: this.sessions.size,
      time: new Date().toISOString()
    });
  }

  send(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (_) {}
  }

  broadcast(sender, obj) {
    for (const ws of this.sessions.keys()) {
      if (ws !== sender) this.send(ws, obj);
    }
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}
