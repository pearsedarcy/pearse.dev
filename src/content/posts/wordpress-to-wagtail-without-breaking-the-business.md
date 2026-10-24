---
title: "WordPress to Wagtail without breaking the business"
description: "Audit the live WordPress, build Django and Wagtail alongside it, then move the origin behind Cloudflare with WordPress kept warm as the rollback."
pubDate: 2026-12-01
tags: [django, wagtail, wordpress, migration]
draft: true
social:
  linkedin: |
    The safest WordPress migration I've done kept WordPress running the whole time.

    The client is a small Irish blinds installer. Their website was WordPress. Their actual business needed more than a website: quotes, invoices, suppliers, jobs, customers.

    So the job was never "rebuild the website". It was: give them a Django system for the business, with a Wagtail site in front, and switch over without a day where the phone stops ringing.

    How it went:

    1. Audit the live WordPress first. Every page, form, redirect and plugin that does something someone relies on.

    2. Build Django 5.2 LTS + Wagtail alongside it, on a separate host. Quoting with PDF quotes, invoicing, procurement, jobs, a small CRM.

    3. Both sites sit behind Cloudflare. Cutover is moving the origin, not a DNS change you wait on.

    4. WordPress stays up, untouched, as the rollback. Going back is one change, not a restore.

    The rejected option was a big-bang switch with WordPress archived. Less to run in parallel. Much more to lose if a form or a redirect you forgot about turns out to be where the leads came from.

    The write-up covers the audit checklist, the cutover and what I'd do differently:

    https://pearse.dev/writing/wordpress-to-wagtail-without-breaking-the-business/
  short: "Moving a small business from WordPress to Django + Wagtail with WordPress kept warm as the rollback: audit first, build alongside, switch the origin behind Cloudflare. https://pearse.dev/writing/wordpress-to-wagtail-without-breaking-the-business/"
---

A migration off WordPress is safe when going back is a single, boring change that you never have to make.

This autumn I rebuilt the website of a small Irish blinds installer [VERIFY: client permission to describe the project, even anonymised] in Django 5.2 LTS and Wagtail 8. Over about 96 commits between August and October 2026, it grew into more than a website: quoting with PDF quotes, invoicing, procurement, job tracking and a small CRM, with the public site as the front door.

The interesting part was not the build. It was switching a business that takes enquiries every day from one system to another without a gap.

## Audit before you build

Before writing a model, I audited the live WordPress site. The same checklist I now use for any WordPress job:

- **Every URL that gets traffic.** Old blog posts, product pages, landing pages from past campaigns. Each gets a redirect or a deliberate decision to let it go. [VERIFY: rough number of URLs/redirects mapped]
- **Every form, and where its submissions actually go.** This is where leads are lost in migrations.
- **Every plugin that does something a person relies on.** Not the plugin list, the behaviour: "sends the quote request to the owner's phone", not "Contact Form X".
- **Performance, SEO and security baselines,** so the new site can be shown to be better, not just different.

Most of that list is invisible in the WordPress admin. You find it by reading the site from the outside and asking the owner what they would miss.

## Build alongside, not instead

The new stack runs on its own host, a Hetzner server behind Cloudflare. Django handles the business apps; Wagtail handles the pages the owner edits. Quote PDFs are rendered with WeasyPrint, background work runs on Celery, the UI is Tailwind 4 with DaisyUI, and the owner gets Web Push notifications for new enquiries [VERIFY: confirm Web Push is used for enquiries].

Building alongside meant the business apps could be used for real before the public site moved. [VERIFY: did the owner start quoting in the new system before cutover?]

## The decision: move the origin, keep WordPress warm

Both the old and new sites sit behind Cloudflare. Cutover is pointing Cloudflare at the new origin. Rollback is pointing it back.

The alternative I rejected was the usual big-bang: change DNS, archive WordPress, deal with anything that comes up. It is less to run in parallel and it feels cleaner. It also turns every forgotten form or redirect into a live incident, with the old system no longer there to fall back on.

Keeping WordPress running, unchanged and untouched, costs a few weeks of hosting [VERIFY: how long WordPress is kept as rollback]. In exchange, the worst case on cutover day is a minute of embarrassment instead of a lost week of enquiries.

The cutover itself was a short, written runbook: freeze content changes, final content sync, switch origin, verify from the public internet (pages, forms, redirects, TLS), watch for a day. Firewall and backup runbooks were written before cutover, not after.

## What went wrong

[VERIFY: the real thing that went wrong. Candidates to confirm or replace: a form or redirect missed in the audit; email deliverability after the switch; content edited on WordPress after the freeze.]

What I would do differently regardless: write the URL inventory as a test, not a spreadsheet. A test that requests every old URL against the new site and asserts a 200 or a redirect would have been cheaper than checking by hand. [VERIFY: confirm this was not already done]

## Patterns for any WordPress to Django move

- Audit behaviour, not plugins.
- Build alongside on a separate origin.
- Put a proxy you control in front of both, so cutover and rollback are the same size of change.
- Keep the old system untouched until the new one has survived real traffic.
- Verify from outside, the way a customer would arrive.

The owner shouldn't notice the day you switch. The only sign should be that the quotes go out faster afterwards.
