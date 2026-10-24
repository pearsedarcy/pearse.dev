---
title: Dublin Plein Air CRM
slug: dublinpleinair-crm
oneLiner: Django replacement for a FileMaker CRM at an art festival — one-way WooCommerce sync, scannable passes, check-in, badges, public voting and email campaigns.
period: Oct 2026
role: Sole engineer
stack:
  - Django 5
  - django-unfold
  - Celery
  - Brevo
  - pywebpush
  - WooCommerce API
  - GitHub Actions → GHCR → SSH
featured: true
order: 6
features:
  - One-way sync from WooCommerce orders into festival registrations — the shop stays the source of payment truth.
  - Scannable passes and on-site check-in from a phone.
  - Badge generation and public voting for the competition.
  - Email campaigns to artists and visitors with GDPR-aware consent.
hooks:
  - Replaces a FileMaker database that only one person could operate.
  - Builds on the earlier WordPress voting plugin — same festival, same anonymous-artist rules, now with a real data model behind them.
visibility: private
category: client
clientPermission: pending
---

A plein air festival has artists, visitors, volunteers, daily contests and one weekend to get it all right. The previous CRM was a FileMaker file. This is its replacement: a Django app that pulls registrations from the shop, issues scannable passes, runs check-in and voting, and sends the campaigns.

The modelling question was who a person is to the festival — an artist can also buy a ticket, a volunteer can also vote — and the answer was a single Person with roles per edition, which is the same shape I had already arrived at in MTS Hub.
