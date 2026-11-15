---
title: East Coast Blinds
slug: east-coast-blinds
oneLiner: WordPress to Django + Wagtail rebuild for an Irish blinds installer, with quoting, invoicing, procurement, jobs and a CRM behind the public site.
period: Aug 2026 – Present
role: Sole engineer
stack:
  - Django 5.2 LTS
  - Wagtail 8
  - Celery + Redis
  - WeasyPrint
  - Web Push
  - Tailwind v4 + DaisyUI
  - Cloudflare
  - Hetzner
featured: true
order: 5
diagram: EastCoastBlinds
features:
  - Public site rebuilt in Wagtail with the existing content migrated and WordPress kept on disk, untouched, as the rollback.
  - Quoting and invoicing with PDF output via WeasyPrint.
  - Procurement, jobs and CRM apps so that the website and the back office share one database.
  - Push notifications for job updates; Celery for the slow work.
hooks:
  - Cutover is a vhost swap on the same server, behind Cloudflare, with WordPress still on disk — rollback will be one config change.
  - Firewall and backup runbooks were written before cutover, not after the first incident.
visibility: private
category: client
clientPermission: granted
social:
  date: 2027-02-17
  linkedin: |
    A blinds installer asked me for a faster website. What they were missing was one place where an enquiry becomes a quote, the quote becomes a job and the job ends in an invoice.

    East Coast Blinds is an Irish blinds installer. I rebuilt the public site in Wagtail and put the back office behind it in Django: quoting with PDF output, invoicing, procurement, jobs and a small CRM. It is all one database, so the website and the business apps look at the same customer instead of two lists someone has to reconcile.

    The habit I would keep on any small-business build is writing the runbooks first. The firewall and backup runbooks existed before any traffic was due to move, so the first incident would not be the first time anyone wrote down what to do.

    The public cutover is still ahead, and WordPress stays untouched until then.

    https://pearse.dev/work/east-coast-blinds/
  short: "East Coast Blinds, an Irish blinds installer: one Django database behind a rebuilt Wagtail site, so an enquiry turns into a quote, a job and an invoice without retyping. Runbooks written before go-live. https://pearse.dev/work/east-coast-blinds/"
---
A small business with a WordPress site and a back office that ran largely on paper. They asked for a faster website. What the business needed was one system that follows an enquiry into a quote, the quote into a job, and the job into an invoice.

## The website

The site takes enquiries every day, so it could not go dark while its replacement was being built. Before writing a model I audited the live WordPress from the outside, the way a customer arrives. Every URL that gets traffic has a redirect in Wagtail or a deliberate decision to let it go. Every form was traced to wherever its submissions actually land, because that is where migrations lose leads. Plugins were listed by what they do for a person rather than by name, and performance, SEO and security were measured first, so the new site can be shown to be better and not just different.

The new public site is Wagtail, with the existing content migrated across. It runs in Docker on the same server as WordPress, behind Cloudflare, and WordPress itself has not been touched. Cutover is planned as one edit to Apache: the live vhost stops serving WordPress and becomes a reverse proxy in front of Django. Going back is that edit in reverse, with the old vhost restored and Apache reloaded, while WordPress stays warm on disk. When both directions cost the same, rolling back is cheap enough that nobody hesitates to do it. The swap itself is still ahead; everything up to it is in place.

The firewall and backup runbooks were written first, ahead of any traffic moving. The cutover runbook ends outside the server: every page, the contact form, the sitemap and TLS checked from the public internet, then the Cloudflare cache purged.

## The back office

The website is the front door, and most of the work sits behind it. Quoting produces PDF quotes through WeasyPrint. An accepted quote becomes a job, and a finished job ends in an invoice. Procurement handles what has to be ordered from suppliers, and a small CRM keeps each customer's history next to their quotes and jobs.

The public pages and the business apps share one database, so an enquiry from the site and the quote that answers it are never copied between tools. Slow work runs on Celery, and staff get push notifications when a job changes.
