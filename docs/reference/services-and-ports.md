# Services and ports

Production services communicate over private Docker networks. Only loopback ports listed below are published by the Compose files.

| Service        |      Development |                  Production | Role                                     |
| -------------- | ---------------: | --------------------------: | ---------------------------------------- |
| Brain Control  | `127.0.0.1:3000` |                     private | Durable state and control API            |
| Matrix Gateway | `127.0.0.1:3020` |                     private | Matrix sync and delivery                 |
| Continuwuity   | `127.0.0.1:8008` |  configurable loopback port | Matrix homeserver and bootstrap endpoint |
| PostgreSQL     | `127.0.0.1:5432` |                     private | Authoritative database                   |
| Grafana        |                — | `127.0.0.1:3001` by default | Optional dashboards                      |
| Prometheus     |                — | `127.0.0.1:9091` by default | Optional metrics                         |

Do not publish control-plane, worker, runtime, or database ports to the network. Matrix should be exposed to users through the private Tailscale HTTPS path described in the bootstrap guide.
