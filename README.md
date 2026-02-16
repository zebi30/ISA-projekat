# ISA-projekat

## Monitoring (Prometheus + Grafana)

Implementiran je monitoring sa izlaganjem Prometheus metrika na backend ruti:

- `GET /metrics`

Metrike koje su dostupne:

- broj aktivnih/idle/waiting konekcija ka bazi (`pg` pool)
- prosečno zauzeće CPU (sampling + agregacija u Grafani)
- broj aktivnih korisnika u poslednja 24h

Monitoring konfiguracija i dashboard su u folderu [monitoring/README.md](monitoring/README.md) (lokalna Windows instalacija Prometheus + Grafana).

Napomena: Grafana je podešena da radi na `http://localhost:3001` kako ne bi bila u konfliktu sa React dev serverom na portu `3000`.

