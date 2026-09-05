# Claudstermind — Exocortex roadmap (2.x → beyond)

The long-arc plan: from "my personal coding cockpit" to "a publishable exocortex whose brain
grows with use." Companion to `ROADMAP-2.0.md`, which covers only the immediate 2.0 release.

**Status:** shaping. Nothing here is started. Chapters 0–1 are the only ones with a firm shape;
everything past Chapter 4 is direction, not commitment.

---

## The core distinction (read this before anything else)

"Brain" gets used for two very different things, with wildly different costs:

1. **Knowledge, skills, graph** — memory, conventions, crystallised skills, code structure.
   Lives in a database. **Buildable now. No GPUs. This is most of the value.**
2. **Model weights** — the neural network itself. Changing this means training.

Almost the whole vision ("my brain becomes a Pact expert, my wife's a Go expert") is **#1**.
Nothing needs to be trained for that to work.

### What is NOT achievable, stated plainly
- **Training a frontier model from scratch** — ~$100M+ and tens of thousands of GPUs. Out.
- **Fine-tuning as a growth mechanism** — a LoRA adapter is affordable (hundreds of dollars),
  but fine-tuning teaches *style and convention*, not intelligence, and causes catastrophic
  forgetting: teach it Pact, it gets worse elsewhere. A scalpel, not a growth path.
- **"Self-improving in perpetuity" from its own output** — this is the documented **model
  collapse** failure mode. The naive flywheel doesn't plateau, it actively rots.

### The reframe that keeps ~90% of the vision
**Put the intelligence in RETRIEVAL, not in weights.** The model stays pluggable; the brain is a
knowledge/skill store it consults. Gains: instant (write a fact, it's live), auditable (you can
see *why* it knew something), reversible (delete bad knowledge — bad training data is permanent),
no collapse, and **merging becomes a database union rather than a training run**.
"The more people use it, the smarter it gets" stays TRUE — the commons grows.

---

## DECISION LOG

### D1 — Claudstermind is MODEL-AGNOSTIC. Pluggable AI from any source. *(decided)*
Not local-first, not Anthropic-only. The brain is separate from the engine, so Claudstermind
inherits better models — hosted or local — the moment they exist, without a rewrite.
Consequence: the routing layer (`lib/routing.mjs`, `lib/omniRoute.mjs`) becomes a first-class
public interface, not an internal detail.

### D2 — Colibri: REJECTED as a dependency. *(decided, evidence-based)*
Investigated properly rather than dismissed. **Every factual noun in the claim checked out** —
Colibri is real (26.8k stars, Apache-2.0, pure C, actively maintained, Italian author), GLM-5
really did ship at 744B/40B-active with ~19,456 routed experts, and it really does run on 25 GB
of RAM with no GPU. The technique (MoE expert streaming from SSD) is legitimate published work.

**It fails on speed, by orders of magnitude, and this is physics not engineering:** a cold token
costs ~11.4 GB of expert reads, so at ~1 GB/s there is an ~11-SECOND floor per token before any
compute. Measured, from Colibri's own docs: **0.05–0.1 tok/s** on the celebrated 25 GB config
(one token every 10–20s), **1.83 tok/s** on a Ryzen AI Max+ 395, and **5.8–6.8 tok/s on SIX RTX
5090s**. Also: 372 GB download, and Python IS required. The repo is honest about all of this;
the viral posts promoting it are not.

**Revisit trigger is NOT a bigger model.** It is (a) prompt caching landing in local runtimes and
(b) prefill throughput moving from ~340 tok/s toward ~1500+. Without prompt caching, a local
agent re-prefills its whole history every turn: at 32K context that is **~94 seconds of dead time
per turn**, so a 20-turn task burns 30–60 minutes just re-reading itself. Prefill, not decode, is
the wall.

### D3 — Local models: scaffold now, adopt later. *(decided)*
Cheap, reversible: make routing accept an OpenAI-compatible base URL (llama.cpp / LM Studio /
Ollama). Costs ~nothing if local never pans out. Use local for **cheap high-volume, short-context
work** (commit messages, changelog drafts, log summarisation, file triage) where ~30 tok/s is
fine. Keep hosted for the agentic loop. Best current fits on 96–110 GB: `gpt-oss-120b Q4_K_M`
(~31 tok/s, best-documented tool-calling reliability that fits) and `Qwen3-Coder-30B-A3B`
(70–100 tok/s).

---

## Chapters

### Ch. 0 — Finish 2.0 *(in progress — see ROADMAP-2.0.md)*

### Ch. 1 — Split code from data ⟵ **THE GATE FOR EVERYTHING BELOW**
Today code and data are entangled; the repo cannot be published without leaking data.
- [ ] 1.1 Storage abstraction — all conversations/state behind one interface, no direct disk paths
- [ ] 1.2 Full secrets audit; prove a clean-clone install starts empty
- [ ] 1.3 Three-zone model: **public shell** · **private user data (never leaves the disk)** ·
      **opt-in commons (explicitly curated + redacted)**
- [ ] 1.4 Migration for existing installs (this one) without data loss
> Owner note: sensitive site databases must NEVER be committed, not even to a private repo.
> This is the constraint that forces the split — and the split is what makes multi-user possible
> anyway, so it is not throwaway work.

### Ch. 2 — The individual brain
- [ ] 2.1 Durable knowledge store (facts/conventions/decisions) with provenance on every entry
- [ ] 2.2 **Skill crystallisation, human-in-the-loop**: notice repeated work → *propose* a skill →
      user approves. Auto-learning without approval produces confident garbage; approval is the
      quality gate, not a UX nicety.
- [ ] 2.3 Retrieval into the agent's context (this is where "it got smarter" actually happens)
- [ ] 2.4 Decay/conflict handling — stale knowledge must be demotable, contradictions surfaced

### Ch. 3 — Code graph / workspace comprehension
- [ ] 3.1 Port the graph engine from **Graphify** + **Hermes**
- [ ] 3.2 Index a repo into a queryable structure (symbols, deps, call/type edges)
- [ ] 3.3 Incremental re-index on change (full re-index per edit will not scale)
- [ ] 3.4 Wire graph queries into planning — *this* is what makes it your workspace's expert

### Ch. 4 — Publish
- [ ] 4.1 Barebone shell: clean clone, empty brain, no personal data
- [ ] 4.2 License + contribution model
- [ ] 4.3 Onboarding (bring your own key / point at any model per D1)
- [ ] 4.4 Threat model — it executes code and holds secrets; publishing widens the blast radius

### Ch. 5 — Multi-user brains
- [ ] 5.1 Per-user brain isolation
- [ ] 5.2 Multiple workspaces per user, one brain
- [ ] 5.3 Export/import a brain (also the backup story)

### Ch. 6 — The commons (brain merge)
The federation step. **The hard problems here are trust and curation, not code.**
- [ ] 6.1 Export format: shareable knowledge/skills, provenance attached
- [ ] 6.2 **Redaction pipeline** — nothing leaves without explicit review. Hardest, most important.
- [ ] 6.3 Merge/conflict resolution across contributors
- [ ] 6.4 Quality gating — one confidently-wrong contributor must not poison the commons
- [ ] 6.5 Attribution + revocation ("delete my contribution" must actually work)
> Storage is NOT the constraint. Measured from this live install: 4.1 MB of conversation text vs
> 55 MB of images. A 100-user commons is **tens of GB** — one ordinary machine. The constraints
> are privacy, curation quality, and conflict resolution: human-judgment problems.

### Ch. 7 — Local model integration *(scaffold per D3; Colibri rejected per D2)*
- [ ] 7.1 OpenAI-compatible base-URL routing *(small, do early — it's cheap insurance)*
- [ ] 7.2 Route cheap high-volume jobs locally, agentic loop stays hosted
- [ ] 7.3 Watch the revisit trigger (prompt caching + prefill throughput)

### Ch. 8 — OPTIONAL, distant: distil the commons into an adapter
The honest version of "the master brain becomes a model": a LoRA so a local model natively speaks
your conventions. Real and affordable — but a **nice-to-have on top of retrieval, never the
mechanism.** Do not let this become the plan.

---

## Open questions
- Ch. 6 incentive model: why does anyone contribute, and what stops poisoning?
- Ch. 2: how much curation can be automated before quality falls off?
- Ch. 3: how much of Graphify/Hermes survives the port vs. gets rewritten?
- Ch. 4: hosted offering, or self-host only?
