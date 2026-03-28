# ns-fischer-chat

Minimal NationStates RMB and Dispatch monitor with Discord notifications. Connects to NationStates Server-Sent Events (SSE) for real-time RMB posts and dispatch notifications.

## Quick Start (Docker CLI & Unraid)

### 1. Prepare and Configure

```bash
mkdir -p ns-fischer-chat
cd ns-fischer-chat

# Download the config template
curl -L https://raw.githubusercontent.com/rotenaple/ns-fischer-chat/main/config.json.example -o config.json

# Edit the config file
nano config.json

# Create data directory
mkdir -p data
```

### 2. Run the Container

**Docker CLI**
```bash
docker run -d --name ns-fischer-chat \
  --restart unless-stopped \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/data:/app/data \
  ghcr.io/rotenaple/ns-fischer-chat:latest
```

**Unraid**
1. Go to the **Docker** tab and click **Add Container**
2. **Repository:** `ghcr.io/rotenaple/ns-fischer-chat:latest`
3. **Volume Mappings:**
   - Host: `/mnt/user/appdata/ns-fischer-chat/config.json` → Container: `/app/config.json`
   - Host: `/mnt/user/appdata/ns-fischer-chat/data` → Container: `/app/data`
4. Click **Apply**

## Configuration

```json
{
  "userAgent": "YourMainNation",
  "webhookUrl": "https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN",
  "rmbNations": ["Nation1", "Nation2"],
  "rmbRegions": ["Region1", "Region2"],
  "dispatchNations": ["Nation1", "Nation2"]
}
```

### Fields

- `userAgent` (required): Your nation name for API User-Agent
- `webhookUrl` (required): Discord webhook URL
- `rmbNations` (optional): Nations to monitor for RMB posts
- `rmbRegions` (optional): Regions to monitor for all RMB posts
- `dispatchNations` (optional): Nations to monitor for dispatches

### Getting Discord Webhook URL

1. Discord → Server Settings → Integrations → Webhooks → New Webhook
2. Copy the URL

## Docker Management

```bash
docker compose up -d          # Start
docker compose logs -f        # View logs
docker compose down           # Stop
docker compose pull           # Update image
```

## Troubleshooting

- **No messages?** Check logs, verify webhook URL and nation names (use underscores)
- **Duplicates?** Delete `data/state.json` and restart
- **Container exits?** Ensure config.json exists with valid fields
