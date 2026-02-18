# Monitoring (Prometheus + Grafana)

Ovaj folder sadrži kompletan monitoring setup za backend aplikaciju.

## Docker režimi (dev vs cluster)

Kada pokrećeš monitoring kroz `docker-compose`, Prometheus može da radi u dva režima:

- `cluster` (podrazumevano): čita metrike sa `api1:5000` i `api2:5000`
- `dev`: čita metrike samo sa `host.docker.internal:5000`

Režim biraš promenljivom `PROMETHEUS_CONFIG_FILE` pre pokretanja servisa:

```powershell
$env:PROMETHEUS_CONFIG_FILE="prometheus.dev.yml"
docker compose up -d prometheus grafana
```

```bash
PROMETHEUS_CONFIG_FILE=prometheus.dev.yml docker compose up -d prometheus grafana
```

Za klaster režim:

```powershell
$env:PROMETHEUS_CONFIG_FILE="prometheus.cluster.yml"
docker compose up -d prometheus grafana
```

```bash
PROMETHEUS_CONFIG_FILE=prometheus.cluster.yml docker compose up -d prometheus grafana
```

Ako promenljiva nije postavljena, koristi se `prometheus.cluster.yml`.

Ako želiš da promeniš već pokrenut Prometheus na drugi `.yml`, samo pokreni isti `docker compose up -d prometheus grafana` sa novom vrednošću promenljive.

## Šta se prati

- DB konekcije iz `pg` pool-a:
  - `app_db_pool_total_connections`
  - `app_db_pool_idle_connections`
  - `app_db_pool_waiting_requests`
- Prosečno zauzeće CPU:
  - `app_cpu_usage_percent` (sampling na 5s)
  - u dashboard-u: `avg_over_time(app_cpu_usage_percent[5m])`
- Aktivni korisnici u 24h:
  - `app_active_users_24h`

## Pokretanje

1. Pokreni backend na portu `5000`.
2. Instaliraj Prometheus za Windows i raspakuj ga, npr. u:

  `C:\tools\prometheus`

3. U Prometheus folderu zameni `prometheus.yml` fajlom iz:

  `monitoring/prometheus/prometheus.yml`

4. Pokreni Prometheus:

```powershell
cd C:\tools\prometheus
./prometheus.exe --config.file=prometheus.yml
```

5. Instaliraj Grafana za Windows i podesi port na `3001`:

  - Prekopiraj [monitoring/grafana/custom.ini](monitoring/grafana/custom.ini) u Grafana config folder (npr. `C:\Program Files\GrafanaLabs\grafana\conf\custom.ini`).
  - Restartuj Grafana servis.
  - Otvori: `http://localhost:3001`.

6. U Grafani dodaj Prometheus data source:
  - URL: `http://localhost:9090`

7. Import dashboard iz fajla:

  `monitoring/grafana/dashboards/app-monitoring.json`

8. Otvori dashboard `ISA Application Monitoring`.

## Napomena

Metrike su dostupne na backend ruti:

`http://localhost:5000/metrics`
