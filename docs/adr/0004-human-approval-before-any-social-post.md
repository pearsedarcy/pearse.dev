---
status: accepted
date: 2026-10-24
---

# A human approves every social post before it is sent

The scheduler reads the social feed and standalone posts, but it never posts anything Pearse has not approved individually. Approval happens out of band (a chat message with approve / skip), and the scheduler keeps a posting record so approved copy is posted once. We rejected fully automatic posting, even for copy already reviewed in a pull request, because a post under a real name about a real employer is not reversible and the cost of one wrong post outweighs the cost of tapping approve a few times a week.

The scheduler runs on self-hosted n8n and posts to LinkedIn through the member posting API with a personal token; third-party scheduling services are a fallback, not the default, so no credential for a personal account lives with a vendor.
