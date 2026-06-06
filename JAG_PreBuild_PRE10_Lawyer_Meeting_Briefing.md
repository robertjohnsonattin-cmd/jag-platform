# JAG Holdings — PRE-10: Consolidated Lawyer Meeting Briefing
**Date prepared:** 2026-05-24  
**Status:** ✅ DONE  
**Classification:** OFFLINE ONLY — do not share digitally  
**Purpose:** Single consolidated lawyer session covering estate planning for Robert, Wife, and Brian, plus JAG property/financial legal structure.

---

## Meeting Objective

Knock out all outstanding legal instruments in one session to avoid multiple engagements. Four areas to cover. Estimated meeting time: 3–4 hours (drafting instructions only — documents finalized separately).

Lawyer should come prepared to take instructions for drafting. Bring any existing Wills or POAs for review.

---

## Documents to Bring to the Meeting

- [ ] Any existing Wills (Robert, Wife, Brian — if any currently exist)
- [ ] Any existing POA documents
- [ ] Corporate registry documents for JABCO, DragonBridge, JAG entities
- [ ] Title deeds or property list (or property register printout from JAG platform)
- [ ] List of all active mortgages and loans (estimated ~4 mortgages, ~8–10 total loans)
- [ ] Bank account details for accounts to be converted to joint (father's accounts)
- [ ] Brian's confirmation of executor designation (confirm with Brian before meeting)

---

## Area 1 — Robert's Estate

### 1.1 Robert's Will
- Must name all JAG Holdings entities by full legal name
- Must specify ownership structure and how shares pass on death
- Must name beneficiaries for each entity / asset class
- Executor designation (confirm who)
- Confirm treatment of minority interests (brother's JAG Properties share)

### 1.2 Primary POA — Wife
- Scope: JABCO (construction business) + DragonBridge
- Effective: upon Robert's incapacitation (not immediate)
- Duration: until Robert's capacity is restored, or death

### 1.3 Backup POA — Brother
- Scope: contingency only (activates if wife is unable to act)
- Same effective trigger as wife's primary POA

### 1.4 Executor Designation
- Confirm and document Robert's choice of executor
- Name a backup executor in case primary is unable or unwilling

---

## Area 2 — Wife's Estate

### 2.1 Wife's Own Will
- Covers: personal assets + BAR / CASINO (held in wife's name)
- Chinese heritage considerations to be addressed (any property or assets in Chinese jurisdiction or under Chinese family arrangements)
- Beneficiary designations: Robert (primary), Daughter (contingency)
- Address treatment of BAR/CASINO specifically

### 2.2 Trustee Clause for BAR/CASINO
- Instruction: Robert manages BAR/CASINO after wife's death until the earlier of:
  - Final sale of the business, OR
  - Daughter reaches age 25
- After that threshold: BAR/CASINO passes to Daughter (or per beneficiary designation)
- Lawyer to draft trustee clause to be embedded in Wife's Will

### 2.3 Wife's Executor Designation
- Robert = primary executor
- Name a contingency executor (to be confirmed — who acts if Robert predeceases wife or is incapacitated at time of her death?)

### 2.4 Wife's POA
- Who acts on wife's behalf if she is incapacitated?
- Scope, effective trigger, and duration to be specified

---

## Area 3 — Brian's Estate

*(Confirm with Brian before the meeting that he is comfortable with lawyer discussing his estate.)*

### 3.1 Brian's Will
- Assets to cover: parlour, NLCB booth, personal vehicles, home assets, JAG Properties share
- Beneficiary designations (Brian to confirm)
- Note: Brian's JAG Properties share — confirm whether it passes to a named beneficiary or triggers the buy-sell agreement (Area 4)

### 3.2 Brian's Executor
- Robert has been suggested as Brian's executor — confirm with Brian before the meeting
- Name a backup executor

### 3.3 Brian's POA
- Who acts on Brian's behalf if incapacitated?
- Scope and effective trigger to be specified

---

## Area 4 — Property and Financial Instruments

### 4.1 Buy-Sell Agreement — JAG Properties
- Parties: Robert (share) + Brother/Brian (share)
- Trigger events: death of either party, incapacitation, voluntary exit
- Valuation mechanism: how is JAG Properties valued at trigger (agreed formula, independent valuation, fixed price?)
- Right of first refusal: remaining party has option to purchase before third-party sale
- Father's properties: separate clause confirming these stay within the family and are not subject to the buy-sell

### 4.2 Father's Properties and Bank Accounts
- Identify which of father's properties and bank accounts are critical to be converted to joint ownership
- Confirm who the joint holders will be (Robert? Robert + brother? Robert + wife?)
- Lawyer to advise on the most appropriate mechanism (joint tenancy vs tenancy in common) under TT law
- Bank accounts: bring list of institutions and account types — lawyer to advise on survivorship designation options

---

## Information Still to Gather (Section 19.2)

Before the meeting, gather and bring:

- [ ] Exact count and amounts of active mortgages / business loans (estimated ~4)
- [ ] Full list of all active loans including credit cards (estimated ~8–10 total)
- [ ] Daughter's inheritance designation per entity — deferred to this meeting or future session?
- [ ] Specific growth targets per entity (if relevant to any shareholding discussions)
- [ ] JAG Lifestyle programme details: programme names, member numbers, tiers, point balances, credit card reward categories — relevant if any loyalty assets are to be addressed in Wills

---

## Post-Meeting Action Items

After the lawyer meeting, the following platform updates are needed:

| Item | Platform action |
|---|---|
| Wills signed and stored | Store document paths in DocVault (jag_family module) |
| POAs executed | Store in DocVault; update emergency contact records |
| Buy-sell agreement signed | Store in JAG Properties legal documents |
| Father's accounts converted to joint | Update bank account records |
| Brian confirmed as succession planning participant | Create Brian's profile in JAG Family module |

---

## Scheduling Notes

- Allow **1 full day of prep** before the meeting (gather documents listed above)
- Suggested meeting format: brief the lawyer on JAG Holdings structure first (15 min), then work through each Area in order
- All four areas can be drafted in one session; signing of executed documents will require a second shorter session
- Consider having Wife and Brian present for the portions covering their estates — avoids relay of instructions

---

## Pre-Build Task Status (Final)

| ID | Task | Status |
|----|------|--------|
| PRE-0A | WAL target decision | ✅ LOCKED |
| PRE-0B | Cloudflare Authenticated Origin Pull guide | ✅ DONE |
| PRE-1 | ERD/DBML — all 5 databases | ✅ DONE |
| PRE-2 | OpenAPI YAML contract | ✅ DONE |
| PRE-3 | Outbox migrations + jag-event-dispatcher | ✅ DONE |
| PRE-4 | Keycloak realm + clients + roles | ✅ DONE |
| PRE-5 | WiPay sandbox POC | ✅ DONE |
| PRE-6 | Bank statement parser POC (Ollama/Mistral 7B) | ✅ DONE |
| PRE-7 | Migrate JABCO domain to Cloudflare Free Tier | ✅ DONE |
| PRE-8 | Write DR failover runbook (incl. Keycloak incapacitation reset) | ✅ DONE |
| PRE-9 | Oracle Cloud + Docker setup (Phase 0) | ✅ DONE |
| PRE-10 | Schedule consolidated lawyer meeting | ✅ DONE — briefing doc prepared |

**Pre-Build is complete. Phase 1A begins next:** Keycloak + RLS + i18n + jag-event-dispatcher integration + pen test.
