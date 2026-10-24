---
title: MTS Cortex
slug: mts-cortex
oneLiner: An agent-managed second brain — spoken ideas become linked Markdown knowledge, browsable as a 3D graph.
period: Jan – Oct 2026
role: Designer and builder
stack:
  - Python
  - Typer
  - FastAPI
  - Basic Memory (MCP)
  - claude-agent-sdk
  - UMAP + numpy
  - Telegram
  - Self-hosted speech-to-text
  - n8n
featured: true
order: 3
features:
  - A Markdown vault as the source of truth — Products, Capabilities, Offers, Customers, Ideas — with typed relations between them.
  - Claude Code reads and writes the vault over MCP; a schema validator CLI keeps it honest.
  - Telegram voice intake — a voice note becomes a transcript, then concepts, then links into the vault.
  - A read-only 3D graph app laid out with UMAP, with open GitHub issues as satellite nodes around the concepts they touch.
hooks:
  - Five ADRs before the first feature, including "GitHub is the work tracker" and "the graph app is a read-only consumer".
  - The domain language — Vault, Concept, Utterance — was defined before any code was written.
  - The voice-to-knowledge loop runs on self-hosted speech-to-text, so nothing spoken leaves the infrastructure.
visibility: private
category: mts
---

Most company knowledge dies in chat threads. Cortex is an attempt to give a small company a memory that agents and people can both use: a vault of Markdown notes with a strict schema, written to by Claude Code over MCP, fed by voice notes, and browsed as a graph.

The constraint that shaped it was "read-only consumers". The graph app never writes. Telegram never writes directly. Everything goes through the vault and the validator, so there is exactly one place where the truth can change.
