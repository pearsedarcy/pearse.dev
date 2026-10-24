---
title: MTS Hub
slug: mts-hub
oneLiner: Operations platform and system of record for a wetlab-education company — congresses, courses, contacts, bookings, packing, inventory, staffing, tickets, certificates, comms.
period: Jul – Oct 2026
role: Platform lead, sole engineer (agent-assisted)
stack:
  - Python 3.12
  - Django 5.2
  - DRF
  - django-unfold
  - Celery + Redis
  - Channels / Daphne
  - PostgreSQL
  - Tailwind v4 + DaisyUI
  - HTMX + Alpine
  - ReportLab
  - pytest
featured: true
order: 1
features:
  - Single source of truth for contacts, faculty, courses, congresses and bookings; replaces spreadsheets and a FileMaker system.
  - Course planning from rooms to stations to equipment, with template-driven packing lists per session.
  - Live multi-user packing screen over WebSockets; warehouse inventory and vehicle capacity planning.
  - Staff scheduling with a daily roster, plus time and expense tracking on an append-only ledger with dated statutory rate tables.
  - Certificate platform with public verification pages; event ticketing with Apple Wallet passes.
  - Sponsor vouchers and a pricing pipeline with scenario forecasting.
  - GDPR tooling — PII inventory, erasure and anonymisation, and a human-approval gate before any email leaves the system.
  - Magic-link login for external participants, German and English localisation, QR and RFID asset identification (experimental).
hooks:
  - 6000+ automated tests and 22 written architecture decision records, including "no email sends without human approval" and "time bookings are an append-only ledger".
  - Three older tools — WetPack, Opthalyze and a legacy CRM — unified into one model, then validated by reconstructing a real congress end to end.
  - Privacy by design — an erasure request reaches even publicly verifiable certificates. The name is scrubbed; the credential stays valid.
visibility: private
category: mts
---

MTS runs hands-on surgical training at medical congresses across Europe. Before Hub, that business lived in spreadsheets, a FileMaker database and three small Django tools I had built over the previous year. Each one knew part of the story: who was coming, what to pack, how the feedback looked. None of them knew the whole thing.

Hub is the whole thing. It took the domain language from WetPack, Opthalyze and the old CRM, settled it in a glossary and a set of ADRs, then rebuilt the model once. Everything downstream — rosters, packing lists, certificates, tickets, invoices — hangs off the same Congress, Course, Session and Contact records.

The scale that mattered was not users but consequences. A certificate is a professional credential. A packing list is what gets loaded onto a truck at 5am. A GDPR erasure has to actually erase. So the test suite is large, the sensitive paths have approval gates, and the decisions that would be expensive to reverse are written down.
