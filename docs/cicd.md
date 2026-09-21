# CI/CD — ขั้นตอน Deploy ขึ้น VPS

Pipeline: GitHub Actions build image → push ขึ้น GHCR (GitHub Container Registry) → SSH เข้า VPS → `docker compose pull` + `up -d`

Workflow อยู่ที่ `.github/workflows/cd.yml` — trigger อัตโนมัติเมื่อ push เข้า `main`, หรือกดรันเองผ่าน `workflow_dispatch`

---

## 1. สร้าง Deploy Keypair (SSH key เฉพาะสำหรับ CI)

สร้างที่เครื่อง local คนละอันกับ key ส่วนตัว ใช้เฉพาะให้ CI ยิงเข้า VPS:

```bash
ssh-keygen -t ed25519 -C "cmt-dashboard-cd" -f ssh_key -N ""
```

จะได้ 2 ไฟล์:
- `ssh_key` — private key (ห้าม commit ห้าม push เข้า repo)
- `ssh_key.pub` — public key

## 2. เอา Public Key ไปใส่ VPS

SSH เข้า VPS ด้วย access ที่มีอยู่แล้ว แล้วเพิ่ม public key เข้า `authorized_keys` ของ user ที่จะให้ CI ใช้ login:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<เนื้อหาไฟล์ ssh_key.pub>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

ทดสอบว่า login ได้จากเครื่อง local ก่อนไปขั้นต่อไป:

```bash
ssh -i ssh_key <user>@<vps-ip> "echo CONNECTED"
```

## 3. Clone Repo บน VPS

```bash
git clone https://github.com/cmt-iot/cmt-dashboard.git ~/cmt-dashboard
```

(repo เป็น public — clone ตรงได้เลยไม่ต้อง auth)

## 4. ตั้งค่า `.env` บน VPS

`.env` ไม่ได้อยู่ใน git (gitignore ไว้) ต้องสร้างเองบน VPS:

```bash
cd ~/cmt-dashboard
cp .env.example .env
nano .env   # ใส่ค่า MYSQL_ROOT_PASSWORD=<รหัสผ่านจริง>
```

## 5. ตั้งค่า GitHub Secrets และ Variables

ไปที่ GitHub repo → Settings → Secrets and variables → Actions

**Secrets** (ข้อมูลลับ เข้ารหัสไว้):
| ชื่อ | ค่า |
|---|---|
| `SSH_KEY` | เนื้อหาไฟล์ `ssh_key` (private key) ทั้งหมด รวมบรรทัด `-----BEGIN...` / `-----END...` |

**Variables** (ข้อมูลทั่วไป ไม่ลับ):
| ชื่อ | ค่า | หมายเหตุ |
|---|---|---|
| `VPS_HOST` | IP ของ VPS | เช่น `162.141.142.185` |
| `VPS_USER` | username ที่ใช้ SSH | เช่น `dev` |
| `VPS_SSH_PORT` | port SSH | ถ้าไม่ตั้งจะ default เป็น `22` |
| `VPS_DEPLOY_PATH` | path ที่ clone repo ไว้บน VPS | ถ้าไม่ตั้งจะ default เป็น `~/cmt-dashboard` |

## 6. เตรียม Port บน VPS ให้ว่าง

ถ้า VPS มี stack เดิมรันอยู่แล้วที่ใช้ port ซ้ำกัน (`3308`, `1884`, `18084`, `1881`, `8080`, `8081`) ต้องปิดก่อน:

```bash
cd ~/<stack-เดิม>
docker compose down
```

## 7. รัน Deploy

**อัตโนมัติ** — push โค้ดขึ้น `main` แล้ว workflow จะรันเอง

**รันเอง** — ไปที่ GitHub repo → Actions tab → เลือก workflow "CD" → Run workflow

Workflow จะทำตามลำดับ:
1. Build image ของ `backend`, `frontend`, `nodered` แล้ว push ขึ้น `ghcr.io/cmt-iot/cmt-dashboard-*`
2. SSH เข้า VPS ตาม `VPS_HOST`/`VPS_USER`/`SSH_KEY` ที่ตั้งไว้
3. รัน `docker compose pull && docker compose up -d --remove-orphans` ที่ `VPS_DEPLOY_PATH`

## 8. ตรวจสอบผลลัพธ์

บน VPS:

```bash
docker compose ps
```

เข้าเว็บผ่าน:

```
http://<vps-ip>:8081
```

(ยังไม่มี nginx ที่ host หรือ domain — ต้องพิมพ์ port `:8081` ต่อท้ายเสมอ)

---

## สรุป Services และ Port

| Service | Host Port | ใช้ทำอะไร |
|---|---|---|
| frontend | 8081 | เว็บ dashboard (nginx serve React build) |
| backend | 8080 | Go API + WebSocket |
| nodered | 1881 | Node-RED editor |
| emqx | 1884 (MQTT), 18084 (dashboard) | MQTT broker |
| mysql | 3308 | ฐานข้อมูล |

Internal network แบ่งเป็น 2 กลุ่ม:
- `backend-net` — mysql, emqx, nodered, backend (คุยกันได้ภายใน)
- `frontend-net` — backend, frontend (frontend เข้าถึงได้แค่ backend ผ่าน `/api` และ `/ws`, เข้า mysql/emqx/nodered ตรงๆ ไม่ได้)
