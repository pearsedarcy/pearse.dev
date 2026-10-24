---
title: MTS Atlas
slug: mts-atlas
oneLiner: Self-hosted AI content platform — LangGraph agents draft newsletters and posts, a human approves, then it ships via Mailchimp.
period: May 2026
role: Product and engineering
stack:
  - Django 5.1
  - DRF
  - django-unfold
  - Celery
  - PostgreSQL + pgvector
  - LangGraph
  - Self-hosted vLLM
  - Mailchimp
featured: false
order: 7
features:
  - Contact sync with GDPR erasure.
  - Content ingestion from WordPress and PDFs into embeddings.
  - Multi-agent drafting with approval-by-email tokens before anything is sent.
  - Repurposing one approved piece into newsletter, LinkedIn and blog formats.
hooks:
  - A self-hosted LLM behind an OpenAI-compatible API, chosen for data sovereignty.
  - Two slide decks — executive and engineering — generated from the PRD itself.
visibility: private
category: mts
---

Atlas is the smallest project here and the one with the clearest rule: no AI output reaches a human audience without a human approving it first. The agents draft; the approval is a signed token in an email; Mailchimp only hears from the system after that token is used. It stopped at Sprint 2 when Hub took priority, and its approval pattern moved into Hub's comms module.
