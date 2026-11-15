---
title: Dublin Plein Air
slug: dublin-plein-air
oneLiner: An art festival's WordPress site audited, hardened and upgraded, then a Django CRM to replace its FileMaker database — WooCommerce sync, scannable passes, check-in, badges, public voting and campaigns.
description: "An art festival's WordPress site audited, hardened and upgraded, then a Django CRM to replace its FileMaker database, with WooCommerce sync and check-in."
period: Aug 2026 – Present
role: Sole engineer
stack:
  - WordPress
  - WooCommerce
  - Apache
  - Cloudflare
  - Django 5
  - PostgreSQL 16
  - Celery + Redis
  - django-unfold
  - HTMX + Alpine.js
  - Brevo
  - pywebpush
  - GitHub Actions → GHCR
featured: true
order: 6
diagram: DublinPleinAir
features:
  - A read-only external audit of the live site across seven areas — security, privacy, WordPress and WooCommerce, performance, accessibility, SEO and content — with every finding re-checked by a second pass before it was filed.
  - The server's hardening config and the security headers brought into the repository, byte for byte what runs on the box, so a change is a diff rather than a memory.
  - A staging clone with no public DNS, payment credentials scrubbed and a guard plugin that stops it emailing or charging anyone.
  - The upgrade planned as twenty gated steps, each with its own preflight and rollback, after a fresh backup verified off the server.
  - A Django CRM that syncs registrations one way from the WooCommerce shop, so the shop stays the source of payment truth.
  - Scannable passes, on-site check-in from a phone, badge generation, public voting and email campaigns with GDPR-aware consent.
hooks:
  - An adversarial review of the upgrade plan found seven defects in its own rollback paths before a single step ran.
  - "`cmd && echo OK` cannot fail a script under `set -e`. Running step zero found that; every preflight block was fixed before step one."
  - The CRM replaces a FileMaker database that only one person could operate.
process:
  - step: audit
    proof: "A read-only audit from the outside covered seven areas, and every finding was re-checked by a second pass before it was filed."
  - step: staging
    proof: "Updates are rehearsed on a staging clone with no public DNS and a guard plugin that stops it emailing or charging anyone, before they touch live."
  - step: gated
    proof: "The upgrade is twenty gated steps, each with its own preflight and rollback, starting from a fresh backup verified off the server."
  - step: written-down
    proof: "The server's hardening config now lives in the repository, byte for byte what runs on the box, so a change is a diff rather than a memory."
visibility: private
category: client
clientPermission: granted
live: https://dublinpleinair.ie
social:
  date: 2027-01-27
  linkedin: |
    A WordPress shop that takes real money is the last thing you want to break while fixing it.

    Dublin Plein Air is an art festival, and that site is where its registrations and payments happen. So the website came first, and the first rule was to leave it working.

    I started outside: a read-only audit using only requests anyone could make, with each finding re-checked in a second pass. The hardening config that had partly lived only on the server went into git. Updates are rehearsed on a staging clone with no public DNS, so it cannot email or charge anyone. The upgrade is a series of gated steps from a backup verified off the server, each with its own preflight and rollback.

    Outside-in, in git, rehearsed, gated. That order is what I would reuse on any WordPress site that is earning money.

    The festival's FileMaker file got a Django CRM after that, but the website half is the part worth copying.

    https://pearse.dev/work/dublin-plein-air/
  short: "Dublin Plein Air's WordPress shop, audited from outside, its hardening config moved into git, upgraded in gated steps after a staging rehearsal. The Django CRM that replaced FileMaker came after. https://pearse.dev/work/dublin-plein-air/"
---

A plein air festival has artists, visitors, volunteers, daily contests and one festival week to get it all right. Its public face is a WordPress site with a shop that takes registrations and payments. Behind it, the people and their registrations lived in a FileMaker file that one person knew how to drive.

## The website

The site worked, and it was taking money, so the first rule was not to break it. I started from the outside with a read-only audit: no server access, only requests anyone could make, each one labelled so the whole session could be filtered out of the logs. Every finding went through a second, adversarial pass, and the ones that turned out fine on measurement were written down as fine rather than dropped.

The fixes followed the same habit. The server's hardening config had partly lived only on the box; it is now in the repository, and the repository copy is the one that matches the server. Updates are rehearsed on a staging clone with no public DNS, scrubbed payment credentials and a guard plugin, before they touch live. The upgrade itself is a sequence of gated steps, each with a preflight check and a rollback, starting from a fresh backup verified off the server.

The step I would point to is the review of that plan. Three adversarial passes over it found seven defects in its rollback paths: the parts nobody reads until the night they are needed. They were fixed inside the steps, not in a footnote.

## The CRM

The second chapter replaces the FileMaker file. It is a Django app that pulls registrations one way from the shop, issues scannable passes, runs check-in from a phone, generates badges, runs the public vote and sends the campaigns. The shop stays the source of payment truth; the CRM never writes an order back.

The modelling question was who a person is to the festival. An artist can also buy a ticket, a volunteer can also vote. The answer was a single Person with roles per edition, which is the same shape I had already arrived at in MTS Hub. It builds on an earlier WordPress voting plugin for the same festival, with the same anonymous-artist rules, now with a real data model behind them.
