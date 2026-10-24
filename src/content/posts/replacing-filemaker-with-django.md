---
title: "Replacing FileMaker with Django for an art festival"
description: "Modelling a festival's people and registrations in Django: one-way WooCommerce sync, scannable passes, check-in, public voting and email campaigns."
pubDate: 2026-12-08
tags: [django, data-modelling, woocommerce, migration]
draft: true
social:
  linkedin: |
    The most important arrow in my latest project points one way only.

    I'm replacing a FileMaker CRM for an art festival with Django. Artists register and pay through the festival's WooCommerce shop. That shop isn't going anywhere, and it shouldn't.

    So the sync is one-way. WooCommerce is the source of truth for orders. Django reads them and turns them into people, registrations and passes. Django never writes back.

    The alternative was two-way sync, so staff could fix an order from either side. I said no. Two-way sync between two systems that both think they own an order is how you get a registration that exists in one place and not the other, on the morning of the event.

    What Django adds on top:

    Scannable passes, sent by email.
    Check-in at the desk by scanning the pass.
    Badges.
    Public voting.
    Email campaigns through Brevo, with web push.

    The modelling question that matters most isn't technical. It was: what is a "person" at a festival? An artist who registers in two categories is one person with two registrations, not two contacts. Get that wrong and every count, badge and email is wrong after it.

    Full write-up on the model, the sync and what I'd change:

    https://pearse.dev/writing/replacing-filemaker-with-django/
  short: "Replacing a festival's FileMaker CRM with Django: one-way WooCommerce sync, scannable passes, check-in, voting, campaigns. And what a 'person' is. https://pearse.dev/writing/replacing-filemaker-with-django/"
---

When you replace a legacy system, decide first which system owns each fact, because every bug that follows comes from two systems believing they own the same one.

In October 2026 I started replacing the FileMaker CRM of an art festival [VERIFY: client permission to describe, even anonymised] with a Django application. The festival sells registrations through a WooCommerce shop, runs on-site check-in, prints badges, runs public voting and emails its artists and visitors. FileMaker had grown to cover some of that; spreadsheets and goodwill covered the rest [VERIFY: confirm what FileMaker did and did not cover].

The project is new, so this is a post about modelling and design decisions more than about running it at scale.

## Who owns what

The first page of the design was a table: each fact, and the one system that owns it.

- **Orders and payments:** WooCommerce. It already takes the money; it keeps doing that.
- **People, registrations, passes, check-ins, votes, campaigns:** Django.
- **Email delivery:** Brevo.

Everything else follows from that table.

## The decision: one-way sync from WooCommerce

Django pulls orders from WooCommerce and turns them into people and registrations. It never writes back.

The alternative was two-way sync, so festival staff could correct an order in whichever system they had open. It is a reasonable request and I turned it down. Two-way sync between two systems that each think they own an order needs conflict rules, and conflict rules are where the morning-of-the-event bugs live: a registration that was changed on both sides and now exists in two shapes.

With one-way sync the rule is short. If an order is wrong, fix it in WooCommerce; Django will pick it up on the next sync. Django-only data, such as check-ins and votes, never has to be reconciled with anything. [VERIFY: sync mechanism, webhook or scheduled pull via Celery]

## Modelling a festival's people

The hard modelling question was not technical: what is a person?

A festival sees the same human in several roles. An artist registers in two categories. A visitor buys a pass and later votes. A volunteer is also an exhibiting artist. FileMaker had tended to create a new record per role [VERIFY: confirm this was the legacy behaviour].

The Django model separates the human from what they did:

- **Person:** one row per human, matched on [VERIFY: matching key, e.g. email].
- **Registration:** a person's entry into one category or event, linked to the WooCommerce order that created it.
- **Pass:** what they carry on the day, with a scannable code.
- **Check-in:** an event, recorded when a pass is scanned at the desk.
- **Vote:** cast in the public vote, with duplicate prevention.

Counting "how many artists do we have?" is then a question about distinct people, not rows, and a badge or campaign email goes to a person once.

## Passes, check-in, voting, campaigns

Passes are generated per registration and emailed out. At the desk, scanning a pass records a check-in and can print a badge. Public voting builds on what I learned writing a WordPress voting plugin for the same kind of event earlier in the year: anonymous artists, GDPR-aware, with duplicate-vote prevention. [VERIFY: is public voting moving from that plugin into Django?]

Campaigns go out through Brevo, and pywebpush handles browser push for people who opt in. The admin is django-unfold, background work is Celery, and deploys run GitHub Actions → GHCR → SSH to the host.

## What I would do differently

I started from the FileMaker export's columns and mapped them to models. That carried over some of FileMaker's assumptions, including the record-per-role habit, longer than it should have. Next time I would write the "who owns what" table and the person/registration split first, and only then open the export. [VERIFY: confirm this happened, or replace with the real lesson]

Most legacy migrations are ownership problems wearing a data-format costume. Settle ownership and the code gets small.
