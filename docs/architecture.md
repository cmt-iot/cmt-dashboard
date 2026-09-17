# Datalogger — architecture

Two repos under one workspace, joined by one MQTT broker.

- `IOTcar/` — the Cement Truck Monitor: EMQX + Node-RED + MySQL + Go API + React dashboard.
- `Datalogger-Firmware-ESP32/` — the ESP32 firmware that produces the data.

Companion diagram: `docs/datalogger-architecture.excalidraw`.

---

## The one-line story

An ESP32 on each truck publishes JSON over MQTT. Node-RED validates every
message and writes MySQL. A Go service polls MySQL once a second and pushes the
whole fleet to browsers over a WebSocket. React draws it.

```
ESP32 ──MQTT──> EMQX ──sub──> Node-RED ──SQL──> MySQL <──poll(1s)── Go API ──WS/REST──> React
```

The important property: **no component talks to the next one directly.** Node-RED
never calls the Go API. The Go API never subscribes to MQTT. MySQL is the only
handoff point between the ingest half and the serving half — either half can be
restarted, rewritten, or replaced without touching the other.

---

## Layer by layer

### 1. Edge — ESP32 (`Datalogger-Firmware-ESP32/`)

Arduino-framework firmware. Reads CAN, an ADS1115 ADC, an MPU-6500 IMU and an
energy meter, batches signals, and publishes them on an interval
(`cfg.publishIntervalMs`).

Topics the firmware actually builds (`mqtt_manager.cpp:48-50`):

| Topic | Direction |
|---|---|
| `{baseTopic}/{deviceId}/data` | ESP32 → broker |
| `{baseTopic}/{deviceId}/status` | ESP32 → broker (also the LWT) |
| `{baseTopic}/{deviceId}/cmd` | broker → ESP32 (subscribed, QoS 1) |

Two firmware behaviours worth knowing because they shape the data downstream:

- **Last Will**: the broker publishes the status topic automatically if the truck
  drops off (`mqtt_manager.cpp:181-189`). Offline is detected even when the ESP32
  cannot send anything itself.
- **Report-by-exception**: unchanged signals are skipped unless a heartbeat is due
  (`cfg.publishUnchanged`, `mqtt_manager.cpp:240`). A parked truck is quiet on the
  wire — that is intended, not a fault.

> ⚠️ **Topic contract mismatch.** The firmware publishes one combined `/data`
> topic. Node-RED subscribes to `cmt/+/telemetry` and `cmt/+/battery` — two
> separate topics that nothing currently publishes. Today the pipeline is fed by
> the Node-RED simulator nodes, not by real firmware. Closing this gap means
> either splitting `/data` in the firmware or adding a splitter node in Node-RED.

### 2. Broker — EMQX

`emqx/emqx:6.3`, container `cmt-emqx`. Host ports `1884` (MQTT) and `18084`
(dashboard, `admin`/`public`). Inside the compose network it is plain
`emqx:1883`, which is why the Node-RED flow needs no host-specific config.

Ports are deliberately shifted off the defaults to coexist with another project
on the same machine (see the header comment in `docker-compose.yml`).

### 3. Ingest — Node-RED (`IOTcar/node-red/flow.json`)

39 nodes. Four subscriptions, each on the same three-stage shape:

```
mqtt in  →  validate <x>  →  build <x> upsert  →  mysql
                  │
                  └─(reject)→ build reject insert → mysql (rejects)
```

| Subscription | QoS | Writes |
|---|---|---|
| `cmt/+/status` | 1 | UPSERT `truck_status` (online, last_seen) |
| `cmt/+/telemetry` | 0 | UPSERT `truck_status` (position, speed, odometer, motor) |
| `cmt/+/battery` | 0 | UPSERT `truck_status` (pack, cells, derived) + may INSERT `alerts` |
| `cmt/+/alert` | 1 | INSERT `alerts` |

Plus three timers:

- **every 60 s** — cache `trucks` into `global.knownTrucks`, so validators can
  reject an unknown `truck_id` without a query per message.
- **every 5 s** — read live `truck_status` rows, filter through *report by
  exception*, INSERT survivors into `telemetry`.
- **simulator (2 s)** — publishes realistic telemetry+battery for 3 trucks, and a
  one-shot "mark online" inject. This is what actually drives the system today.

**The validators are the real product of this layer.** Every message is checked
before it touches the database: payload must be a JSON object, `truck_id` must be
in the known set, cell count must match the registry, and each cell must sit
inside physical bounds (voltage 2.5–4.3 V, temp −20…80 °C). A reading outside
those bounds is a *sensor fault*, not a flat battery, so the whole message is
rejected rather than allowed to poison the pack averages. Rejects land in the
`rejects` table with the raw payload and a reason string — that table is the first
place to look when data goes missing.

Derived, not transmitted: `delta_mv` (max−min cell, mV) and `max_temp_c` are
computed in the `build battery upsert + alert` node. The ESP32 never sends them.

Alerts fire only on *state change* (`flow.get('lastAlert_' + id)`), so an ongoing
fault produces one row, not one row every two seconds.

| Condition | type | severity |
|---|---|---|
| `max_temp_c > 50` | `over_temp` | critical |
| `delta_mv > 150` | `cell_delta_high` | warning |
| `total_pct < 15` | `low_soc` | warning |
| LWT fires | `offline` | info |

**Report by exception** (history only): a row is written to `telemetry` when the
odometer moved > 5 m, SOC changed ≥ 1 %, or 60 s passed since the last row. A
parked truck yields one row a minute instead of twelve. `truck_status` is still
updated by every message, so `last_seen` keeps moving and a parked truck never
looks offline.

### 4. Storage — MySQL (`IOTcar/db/schema.sql`)

`mysql:8.0`, container `cmt-mysql`, host port `3308`, database `cmt`. Schema
applies once, on first start with an empty volume.

| Table | Shape | Role |
|---|---|---|
| `trucks` | one row per truck | registry: name, VIN, `cell_count` |
| `truck_status` | one row per truck | live snapshot — what the dashboard reads |
| `telemetry` | append-only | downsampled history for charts |
| `alerts` | append-only | discrete events, with `resolved_at` |
| `rejects` | append-only | messages the guard refused, with raw payload |

Two deliberate design calls: cells are stored as a JSON array per row rather than
a per-cell table (a per-cell table would balloon disk for little benefit), and
`rejects` has **no** foreign key on `truck_id` — an unknown truck id is itself a
rejection reason, so the row must remain storable.

### 5. Serving — Go API (`IOTcar/backend/`)

Port `8080`. Two routes, no more:

| Route | Kind | Returns |
|---|---|---|
| `GET /api/trucks` | REST | full fleet as a JSON array, one shot |
| `GET /ws` | WebSocket | full fleet snapshot on connect, then on every update |

Not a REST API in any deeper sense — there is no per-truck route, no filtering, no
writes. The unit of transfer is always the entire fleet.

Internals: `runReader` (`store.go:44`) polls `loadFleet` every second, swaps it
into a mutex-guarded `Store`, and hands it to `Hub.broadcast`, which writes it to
every connected browser. `loadFleet` joins `trucks` + `truck_status`, then runs a
second query per truck for the last 30 `telemetry` rows to build the map trail and
the battery sparkline.

> ⚠️ **`SIMULATE` defaults to `true`** (`main.go:42`). On that path the Go service
> writes its own fake fleet into MySQL through `upsertStatus`, competing with
> whatever Node-RED writes for the same rows. If the dashboard shows trucks that
> do not exist, this is why. Set `SIMULATE=false` once real data flows.

CORS is wide open (`Access-Control-Allow-Origin: *`, `main.go:25`) and the
WebSocket accepts any origin (`ws.go:14`). Fine on a laptop, both need tightening
before this is exposed.

### 6. UI — React (`IOTcar/car-monitor/`)

Vite + React 19 + Tailwind 4 + shadcn-style components, Leaflet for the map.
`App.jsx` does one `fetch` to `/api/trucks` so the page is never blank, then opens
the WebSocket and replaces state wholesale on each message.

Panels: `MapPanel` (position + trail), `BatteryPanel` (per-cell grid),
`OdometerPanel`, `TruckSelector`, `Sparkline`. `src/data/mockTruck.js` is the
pre-backend mock and is no longer the live source.

Backend URLs are currently hardcoded to `localhost:8080` in `App.jsx`.

---

## Edges — who may talk to whom

| From | To | Via |
|---|---|---|
| ESP32 | EMQX | MQTT 1883 (host 1884) |
| Node-RED | EMQX | MQTT subscribe, wildcards |
| Node-RED | MySQL | SQL writes only |
| Go API | MySQL | SQL reads (plus writes while `SIMULATE=true`) |
| React | Go API | REST once, then WebSocket |
| nginx | Go API, Node-RED | reverse proxy, see `nginx.conf` |

Node-RED and the Go API have **no** direct edge. That is the design.

---

## Running it

```bash
cd IOTcar
cp .env.example .env          # set MYSQL_ROOT_PASSWORD + NODE_RED_CREDENTIAL_SECRET
docker compose up -d --build  # mysql 3308, emqx 1884/18084, node-red 1881

cd backend && go run .        # :8080  — needs DB_DSN
cd ../car-monitor && npm run dev
```

`docker compose down -v` deletes the MySQL volume and re-applies the schema.

Neither the Go backend nor the frontend is containerised yet; `nginx.conf` at the
repo root is scaffolding that assumes they will be.

---

## Known gaps

1. Firmware `/data` topic does not match the `cmt/+/telemetry` + `cmt/+/battery`
   subscriptions. Real hardware is not yet wired into the pipeline.
2. `SIMULATE=true` by default — two writers for the same rows.
3. `backend` and `car-monitor` are missing from `docker-compose.yml`, so
   `nginx.conf` cannot resolve its upstreams yet.
4. CORS and WebSocket origin checks are open to everything.
5. `cmt/{id}/cmd/{action}` downlink is documented and subscribed by the firmware,
   but nothing publishes it.
6. `consumptionKwhPer100km` is hardcoded to 112 in `db.go:165` — not stored.
