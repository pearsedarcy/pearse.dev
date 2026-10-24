---
title: Opthalyze
slug: opthalyze
oneLiner: QR-code event feedback that becomes branded PDF reports for medical congresses, with no login for the people filling it in.
period: May – Oct 2026
role: Sole engineer
stack:
  - Django 6
  - django-unfold
  - ReportLab
  - matplotlib
  - openpyxl
  - HTMX
  - Alpine.js
  - Caddy
  - Docker
featured: false
order: 8
features:
  - Per-session QR surveys; participants scan and answer, nothing to install or sign into.
  - Live analytics dashboard that polls over HTMX during the event.
  - Session benchmark percentiles across the whole event.
  - Session and event-level PDF reports with charts rendered server-side; CSV and XLSX export.
  - Custom branding per event.
hooks:
  - Replaced paper forms and a day of manual data entry after each event.
  - Now in maintenance, with its domain folded into MTS Hub.
visibility: private
category: mts
---

The first of the MTS tools. Feedback used to be a paper form at the door and a spreadsheet a week later. Opthalyze made it a QR code on the station and a PDF in the faculty's inbox the same evening. Its survey and report model lives on inside Hub.
