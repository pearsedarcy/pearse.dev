---
status: accepted
date: 2026-11-01
---

# Post tags are a closed vocabulary, each tag in one pillar

Before #166 (PR #216) the 11 posts carried 25 distinct tags, 17 of them on one post only. The Topics list on /writing/ and the tags on each post showed whatever the published posts happened to carry, which did not match the four content pillars the README names (Platform building (Django), Self-hosted AI in production, Agentic engineering, Career), and nothing stopped a new post from adding another one-off tag.

Decision: **post tags come from a closed list of seven, and each tag belongs to exactly one pillar.** `TAG_PILLAR` in `src/lib/tags.ts` is the list and the mapping (`django`, `architecture`, `migration` and `privacy` to Platform building; `self-hosted-ai`; `agentic-engineering`; `career`). The posts schema in `src/content.config.ts` types `tags` as a non-empty array of that enum, so an unknown tag fails the build. Every post was retagged in the same change. We rejected keeping free-form tags, because a list that only grows turns Topics into a word cloud of one-post tags.

## Consequences

- Adding a tag is a code change: a line in `TAG_PILLAR` with its pillar. `PILLARS` lives in the same module and the standalone-post schema imports it, so pillars are written once.
- `tests/post-tags.test.mjs` fails when the vocabulary grows past eight tags, a tag has no README pillar, a post has fewer than one or more than three tags or writes them in block style, a tag is carried by fewer than two posts (drafts included), or a built page shows a tag outside the vocabulary.
- Renaming a tag means retagging every post that carries it in the same pull request; the schema rejects the old name.
