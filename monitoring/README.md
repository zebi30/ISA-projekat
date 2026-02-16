# Monitoring (Prometheus + Grafana)

Ovaj folder sadrži kompletan monitoring setup za backend aplikaciju.

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
