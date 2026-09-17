# cmt-dashboard

**Cement EV Truck Monitor.** ESP32s on each truck publish CAN data such as Vehicle speed/Motor RPM/energy-meter/Odometry telemetry over MQTT; Node-RED validates and writes MySQL; a Go service polls and pushes the fleet to a React dashboard over WebSocket.

![status](https://img.shields.io/badge/status-WIP-orange)

## Features

- Live fleet map + telemetry — speed, odometer, motor temp, battery pack
- MQTT ingest via EMQX, validated and persisted by Node-RED
- Go API polls MySQL @ 1s, fans out over WebSocket + REST
- One `docker compose up`, ports shifted to avoid clashing local services
- `SIMULATE=true` / Node-RED simulator for data with no hardware attached

## Quick start

```bash
cd cmt-dashboard
cp .env.example .env          # set MYSQL_ROOT_PASSWORD
docker compose up -d
cd car-monitor && npm install && npm run dev
```

Ports for local dev

- Dashboard: http://localhost:5173
- API: http://localhost:8080
- Node-RED: `1881`
- EMQX dashboard: `18084` (admin / public)
- MySQL: `3308`

## The why

[The problem project solve]. See [docs/architecture.md](docs/architecture.md).

## Repo

| Path                        | What                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| [backend/](backend/)         | Go API REST endpoint, polling data with Websocket, manage MySQL |
| [car-monitor/](car-monitor/) | React + Vite dashboard (map, telemetry, alerts)                   |
| [node-red/](node-red/)       | MQTT ingest flow, validation, MySQL writes                        |
| [db/](db/)                   | Schema, auto-loaded by MySQL on first start                       |
| [docs/](docs/)               | Architecture, MQTT topics list , diagram                          |

## Contributing

Branch off `main`, work your own feature keep `docker compose up` green, test the container in your machine and then, open a PR.
