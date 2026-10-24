---
title: East Coast Blinds
slug: east-coast-blinds
oneLiner: WordPress to Django + Wagtail rebuild for an Irish blinds installer, with quoting, invoicing, procurement, jobs and a CRM behind the public site.
period: Aug – Oct 2026
role: Sole engineer
stack:
  - Django 5.2 LTS
  - Wagtail 8
  - Celery
  - WeasyPrint
  - Web Push
  - Tailwind v4 + DaisyUI
  - Cloudflare
  - Hetzner
featured: true
order: 5
features:
  - Public site rebuilt in Wagtail with the existing content migrated and the WordPress site kept live as a rollback.
  - Quoting and invoicing with PDF output via WeasyPrint.
  - Procurement, jobs and CRM apps so that the website and the back office share one database.
  - Push notifications for job updates; Celery for the slow work.
hooks:
  - Cutover was a Cloudflare origin switch with WordPress still running behind it — rollback was one DNS change away.
  - Firewall and backup runbooks were written before the site went live, not after the first incident.
visibility: private
category: client
clientPermission: pending
---

A small business with a WordPress site and a paper-heavy back office. The brief was a faster website; the actual need was one system that knows about a quote, the job it became and the invoice it ends in.

I kept WordPress alive through the whole build. Wagtail went up on a new origin behind Cloudflare, got verified from the public internet, and only then took over. If anything had gone wrong on the night, the fix was a single origin change.
