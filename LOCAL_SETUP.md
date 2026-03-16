# Local Setup

## Prerequisites

- [Bun](https://bun.sh) runtime installed
- Docker (for OpenLIT observability stack)

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
# Edit .env and set GOOGLE_API_KEY

# 3. Start the server
bun run src/server.ts
```

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GOOGLE_API_KEY` | Yes | — | Gemini API authentication |
| `GOOGLE_CLOUD_PROJECT` | No | `audio-sharp-interop` | GCP project for quota |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | `http://localhost:4318` | OTLP collector (local OpenLIT or Grafana Cloud) |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | — | Grafana Cloud auth header (blank for local) |
| `GH_TOKEN` | No | — | GitHub PAT with `read:packages` (for pulling OpenLIT Docker image from GHCR) |

## Running the Server

```bash
bun run src/server.ts
# Provider Copilot server running on http://localhost:3000
#   POST /api/copilot       — sync query
#   WS   /api/copilot/ws    — streaming
#   GET  /health            — health check
```

### Quick test
```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/copilot \
  -H "Content-Type: application/json" \
  -d '{"query": "Which attribution lists exist?"}'
```

See [docs/COPILOT.md](docs/COPILOT.md) for WebSocket protocol and client examples.

## OpenLIT — Observability Stack

OpenLIT provides a local UI with AI dashboards for inspecting OTel traces, metrics, and LLM stats.

### First-time setup

The OpenLIT Docker image is on GHCR and requires authentication:

```bash
echo $GH_TOKEN | docker login ghcr.io -u <your-github-username> --password-stdin
```

Copy the required OpenLIT config assets from the [OpenLIT repo](https://github.com/openlit/openlit):

```bash
git clone --depth 1 https://github.com/openlit/openlit.git /tmp/openlit
cp /tmp/openlit/assets/{otel-collector-config.yaml,clickhouse-config.xml,clickhouse-init.sh,supervisor-dynamic.yaml} assets/
```

### Start

```bash
docker compose up -d
```

| Service | Port | Purpose |
|---------|------|---------|
| ClickHouse | 8123 | Trace/metric storage |
| OpenLIT | 3001 | AI observability dashboard |
| OpenLIT | 4318 | OTLP HTTP receiver |

### View traces

Run any copilot query, then open **http://localhost:3001** to see:
- Aggregated AI dashboards (token usage, cost, latency)
- Nested trace waterfall (root → router → agent → tools → FHIR HTTP)
- FHIR HTTP spans with status codes and resource types
- LLM token usage and latency per call
- Explainability span attributes (confidence, citations)

### Stop / Remove

```bash
docker compose down
```

### Clean restart (reset data)

```bash
docker compose down -v
docker compose up -d
```

## Grafana Cloud (Deployment)

Same app code — switch from local OpenLIT to Grafana Cloud by changing env vars:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<zone>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(instanceId:apiToken)>
```

Free tier: 50 GB traces/month, 10k metric series, 14-day retention, 3 users.

## Running Tests

API contract tests use `.http` files with [httpYac](https://httpyac.github.io/) assertions. Standard `.http` syntax — also works in VS Code REST Client and JetBrains HTTP Client.

### Copilot API tests (requires `bun run src/server.ts`)

```bash
bunx httpyac docs/http/copilot.http --all     # Server API (5 requests)
bunx httpyac docs/http/router.http --all      # Router classification (6 requests)
```
