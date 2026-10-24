---
title: Observability stack
slug: infrastructure-observability
oneLiner: Centralised logs, metrics and traces for production Django apps, with an AI agent that triages incidents and posts a diagnosis.
period: Aug – Sep 2026
role: Sole engineer and operator
stack:
  - OpenObserve
  - Grafana Alloy
  - OpenTelemetry
  - GlitchTip
  - Traefik
  - Hetzner
  - systemd
  - Telegram
  - Claude CLI
featured: true
order: 4
features:
  - Logs, metrics and traces in one place; distributed tracing instrumented in both production Django apps.
  - Self-hosted error tracking and synthetic uptime, login and TLS checks.
  - Alerts routed to Telegram; an AI agent reads the alert, pulls the relevant signals and posts a first diagnosis.
  - Encrypted nightly backups with a rehearsed restore; credential-rotation scripts.
hooks:
  - A test asserts that every alert rule is capable of firing — an alert that can never trigger is worse than none.
  - Secrets never pass through argv, and the bot token is isolated in a local relay process.
  - Phases 0 to 6 shipped in about a month, entirely EU-hosted.
visibility: private
category: mts
diagram: Observability
---

Two production Django apps, two self-hosted CI runners, a handful of VMs and one engineer. That is not enough people to watch dashboards, so the dashboards have to watch themselves.

The stack is deliberately boring — OpenTelemetry in the apps, Alloy to collect, OpenObserve to store and query, GlitchTip for exceptions. The novel part is the responder: when an alert fires, an agent with read-only access to the signals writes a short diagnosis into the same Telegram thread, before I have unlocked my phone. It is wrong sometimes. It is fast every time, and it always shows its working.
