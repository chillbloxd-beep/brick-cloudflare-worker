# Brick Cloudflare Worker Signaling

Free replacement for Replit using Cloudflare Workers + Durable Objects.

## Setup

1. Create a free Cloudflare account.
2. Install Node.js locally or use GitHub Codespaces.
3. In this folder:

```bash
npm install
npx wrangler login
```

4. Edit `wrangler.toml`:

```toml
SIGNALING_KEY = "your_long_random_secret"
```

5. Deploy:

```bash
npm run deploy
```

Your signaling WebSocket URL format:

```txt
wss://brick-classroom-signal.YOUR_SUBDOMAIN.workers.dev/ws/brick-room-001?key=YOUR_SECRET
```

The dashboard and extension build this URL automatically from:
- Worker base URL
- Room ID
- Secret key
