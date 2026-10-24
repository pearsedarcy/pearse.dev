# Speaker and guest bios

Third person, for conference, meetup and podcast forms. Same facts and rules as `linkedin.md`: everything comes from the case studies, the timeline and the About section; MTS is named by its public name and described as a wetlab-education company; no customers, congresses, events or prices. Word counts are for the text inside each block (`wc -w`).

## 50 words

50 words.

```
Pearse D'Arcy is a software engineer at MTS – The Wetlab Company in Innsbruck. He builds the systems a wetlab-education company runs on: Ophthix, a surgical-training video platform, and MTS Hub, its operations system of record. Most of his code is written by AI agents and reviewed before it merges.
```

## 100 words

100 words.

```
Pearse D'Arcy is a software engineer at MTS – The Wetlab Company in Innsbruck, where he is the sole engineer on the platforms a wetlab-education company runs on. Ophthix records surgeons at wetlab stations and chapters each procedure with a small supervised model. MTS Hub is the operations system of record, with more than 6000 automated tests. He also runs the observability behind both, including an AI agent that triages alerts. Most of his code is written by agents and reviewed before it merges. He took a full-stack diploma in 2024 after teaching himself to code. He is from Dublin.
```

## 300 words

300 words.

```
Pearse D'Arcy is a software engineer at MTS – The Wetlab Company, a wetlab-education company based in Innsbruck. He is the sole engineer on the platforms it runs on, and he builds them with a team of AI agents whose work he reviews before it merges.

The longest-running of those platforms is Ophthix, a surgical-training video platform. A camera on each wetlab station records the surgeon; a small supervised phase model, trained on the company's own footage and judged against a locked test set, splits each procedure into chapters; and every surgeon gets a personal video library. It runs at live congresses and deploys on every merge. Pearse chose the trained model over a general vision-language model because it could say where a phase ended, keeping the general model as an opt-in.

MTS Hub is the operations system of record: congresses, courses, contacts, bookings, packing, staffing, certificates and communications on one model. It replaced spreadsheets, a FileMaker database and three earlier tools he had built, and it carries more than 6000 automated tests, 22 architecture decision records and a human-approval gate before any email leaves the system.

Behind both sits an observability stack on OpenTelemetry, OpenObserve and GlitchTip, with an AI agent that reads each alert and posts a first diagnosis. He also built the agentic engineering workflow that makes the rest possible: one planning session, cheaper delegate agents routed by issue size, git worktree isolation enforced by hooks, and adversarial review in which one model argues against every pull request.

His work sits across three themes: platform building for small teams, self-hosted AI in production and agentic engineering. Before MTS, he taught himself to code, took a full-stack diploma in 2024 and worked freelance on Django, Wagtail, WordPress and TYPO3 sites. He is from Dublin and writes at pearse.dev.
```
