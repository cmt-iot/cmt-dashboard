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

Vite dev server runs on http://localhost:5173 and proxies to the API.

## The why

[The problem project solve]. See [docs/architecture.md](docs/architecture.md).

---

## Ports


| Port  | Service                                                           | Exposure  |
| ------- | ------------------------------------------------------------------- | ----------- |
| 8081  | Dashboard (nginx serving the React build)                         | public    |
| 1884  | EMQX MQTT — the ESP32 publishes here                             | public    |
| 8080  | Go API Server<br />nginx proxies`/api` and `/ws` to it internally | localhost |
| 1881  | Node-RED editor                                                   | localhost |
| 18084 | EMQX dashboard (admin / public)                                   | localhost |
| 3308  | MySQL                                                             | localhost |

### Reaching the non-public port

such as nodered editor use SSH Tunnel

```bash
ssh -N -L 1881:127.0.0.1:1881 -L 18084:127.0.0.1:18084 <user>@<vps-ip>
```

Leave it running, then open http://localhost:1881 (Node-RED) or
http://localhost:18084 (EMQX).

If port is already taken, Change the left-hand number:
`-L 9999:127.0.0.1:1881` so it serves it at http://localhost:9999.

### Logs

```bash
# Example nodered admind container log
docker logs cmt-nodered                          # or cmt-backend, cmt-emqx, cmt-mysql
docker logs --since 1h --timestamps cmt-nodered  # narrow a window
docker logs -f cmt-nodered                       # follow live
docker compose logs --tail 50                    # every service at once
sudo journalctl -u ssh --since today             # SSH logins
sudo tail /var/log/nginx/access.log              # host nginx, port 80
```

Capped at 10MB × 5 files per service and gone once a container is removed — EMQX
keeps no log file of its own, so its history dies with the container. 

## Deploying to the VPS

```bash
docker compose pull && docker compose up -d --remove-orphans
```

Images are built and pushed by CI — see
[.github/workflows/](.github/workflows/) and [docs/cicd.md](docs/cicd.md).

## Contributing

Branch off `main`, work your own feature keep `docker compose up` green, test the container in your machine and then, open a PR.
