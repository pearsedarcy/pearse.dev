---
# CV facts that exist nowhere else on the site. Wording comes from docs/profile/linkedin.md
# and docs/profile/bio.md; anything still carrying a verify marker there stays out of here until confirmed.
# Case studies, contact links, location and skills are pulled from the site itself.
headline: 'Software engineer at MTS – The Wetlab Company. I build Django platforms, run self-hosted AI in production, and ship with an agent team under review.'
experience:
  - title: Software Engineer
    organisation: MTS – The Wetlab Company
    period: Aug 2025 – Present
    location: Innsbruck, Austria
    summary: 'Sole engineer on the platforms a wetlab-education company runs on: Ophthix, MTS Hub, and a family of internal platforms on shared conventions.'
    bullets:
      - 'Built MTS Hub, the operations system of record, by unifying WetPack, Opthalyze and a legacy CRM into one model, so that congresses, courses, contacts, bookings, packing, staffing, certificates and comms stop living in spreadsheets and a FileMaker database.'
      - 'Wrote 22 ADRs and 6000+ automated tests, and reconstructed a real congress end to end, so that the decisions that are expensive to reverse are on record and the model was proven before anyone relied on it.'
      - 'Built GDPR tooling (PII inventory, erasure, anonymisation, a human-approval gate on outgoing email) so that an erasure request reaches even publicly verifiable certificates: the name is scrubbed, the credential stays valid.'
      - 'Built Ophthix, a surgical-training video platform, so that each surgeon recorded at a wetlab station leaves with their own procedure, chaptered by phase, in a library they control.'
      - 'Trained a supervised phase model (ResNet50 + MS-TCN++) on our own footage, judged against a locked test set, so that chapter boundaries do not depend on a general vision-language model. Qwen3-VL stays as an opt-in.'
      - 'Set up accessibility checks in CI and two self-hosted runners so that every merge to main can deploy to production.'
      - 'Built an observability stack on OpenTelemetry, Grafana Alloy, OpenObserve and GlitchTip, with an AI agent that reads each alert, so that a first diagnosis is in the Telegram thread before I have unlocked my phone.'
      - 'Built an agentic engineering workflow (worktree isolation enforced by hooks, model routing by issue size, adversarial PR review, shift handovers) so that one engineer can ship with agents every day, under review.'
      - 'Built WetPack and Opthalyze so that packing lists became recipes per course type and event feedback went from a paper form to a PDF report the same evening.'
      - 'Built MTS Cortex, a schema-validated Markdown vault that Claude Code writes to over MCP and Telegram voice notes feed, so that company knowledge has one place to change instead of chat threads.'
  - title: Freelance Web Developer
    organisation: Self-employed
    period: May 2024 – 2025
    bullets:
      - 'Built my first Django apps, a blog, a store and an events calendar, with Tailwind and DaisyUI.'
      - 'Built sites in Wagtail and TYPO3, and did WordPress store work.'
      - 'Built Chatterbox, a streaming chat UI over HTMX against a local model on Ollama, to find out whether a local model was usable enough to build on. It was. That thread leads to Qwen3-VL in Ophthix and vLLM in Atlas.'
education:
  - title: Full-stack diploma
    organisation: Code Institute
    period: Nov 2023 – Apr 2024
    summary: 'Self-taught first, then the diploma.'
    bullets:
      - 'Built static sites, JavaScript apps, a first Python CLI and a first Flask app.'
      - 'Built Tournament Brackets, a Python CLI that runs knockout brackets on a Google Sheet: the first project where tests caught a bug before a user did.'
---

I build the systems a wetlab-education company runs on, and the agent workflow that lets one engineer ship all of it under review. Django, PostgreSQL and Celery underneath. Self-hosted AI where it earns its place.

What I care about: writing decisions down before they get expensive, small trained models over general ones when the answer has to be right, and boring infrastructure that tells you when it breaks.
