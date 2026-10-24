---
status: accepted
date: 2026-10-24
---

# Confidential material is gated in CI with a denylist kept outside the repository

Content about MTS work must not name customers, congresses, infrastructure addresses, credentials or business figures. The repository is public, so the list of forbidden strings cannot live in it: the list would itself be the leak. The check runs in CI against the built site, reading its patterns from a repository secret, and fails the build on any hit. We rejected a committed denylist for that reason, and rejected "just be careful" because ghost-written content from multiple agents has already needed this filter once.
