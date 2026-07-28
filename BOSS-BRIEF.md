# Switchboard — where it stands, and what it needs

A one-page brief. Screenshots referenced below are in `screenshots/`.

---

## What it is

**Switchboard is a communication-first CRM for our own sales team.** The unit of work is
the _conversation on a lead's timeline_, not the database record. Calls, emails, texts and
notes all land in one append-only stream per lead, so a rep opens a company and sees
everything that has ever happened with them in one place, in order.

It is not marketing automation and not a help desk. It is the tool a rep lives in all day.

---

## What you are looking at

| #                    | Screen               | Why it matters                                                                                                                   |
| -------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `01-welcome`         | Landing page         | The front door.                                                                                                                  |
| `02-inbox`           | **The daily driver** | One queue of everything waiting on you — overdue tasks, replies, steps needing approval. This is where a rep starts the morning. |
| `12-lead-timeline`   | **The core idea**    | One company, one thread: emails, texts, calls, tasks, all in order, with Call / SMS / Email / Task / Enroll one click away.      |
| `03-leads`           | Lead list            | Sortable, filterable, bulk-actionable.                                                                                           |
| `04-pipeline`        | Deal board           | Drag-and-drop stages.                                                                                                            |
| `05-sequences`       | Follow-up automation | Multi-step email/SMS cadences that stop the moment someone replies.                                                              |
| `06-reports`         | Reporting            | Activity, funnel, and sequence performance.                                                                                      |
| `07-dialer`          | Call queue           | Work a call list without leaving the app.                                                                                        |
| `08-import`          | **CSV import**       | Bring an existing CRM in — mapped, de-duplicated, and previewed before anything is written.                                      |
| `09/10-views`        | Smart Views          | Saved, shareable queries ("everyone I haven't touched in 10 days").                                                              |
| `11-settings`        | Admin                | Users, quiet hours, recording policy, suppression list.                                                                          |
| `13-command-palette` | Ctrl-K               | Built for keyboard-first operators; a fast rep never touches the mouse.                                                          |

---

## What is real, and what is simulated

Being precise about this, because the screenshots do not distinguish it.

**Real and working today.** The whole application: the database, the timeline engine, lead
and deal management, CSV import, Smart Views, sequences, reporting, user accounts and
permissions, the audit log, and the compliance rules described below. It runs as a real
system against a real database. Roughly **2,600 automated tests** pass on every change.

**Simulated today.** The connections to the _outside world_ — sending a real email,
placing a real phone call, sending a real text, transcribing a call. Those are built and
tested against realistic fakes, because making them real requires accounts we do not have
yet. Everything you see in the screenshots is running on synthetic sample data.

The honest summary: **the product is built; it is not yet plugged in.**

---

## Compliance is built in, not bolted on

Worth knowing because it is the part that creates legal exposure if it is wrong. The rules
are enforced in the core of the system, where no shortcut can skip them:

- Anyone who replies **STOP** is suppressed immediately and permanently, everywhere.
- Do-not-contact flags block every send and every call — with no override button.
- No text goes out outside 8am–9pm in the **recipient's** local time.
- Call recording ships **switched off** and cannot be turned on until a policy sign-off is
  recorded. When on, a consent announcement plays on every call and cannot be skipped.

These are tested adversarially — the test suite actively tries to find a way around each
rule and fails to.

---

## What we need from you

Smaller than it looks. Most of it is free, and only one item costs meaningful money.

### Free — just needs someone to click through it once

| Need                                 | Unlocks                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **A Google Cloud project** (~20 min) | Staff sign in with their work Google account, email sends from their own mailbox, and inbound email syncs automatically. |

This single item covers login **and** email, both directions. There is no licence and no
per-user fee — it uses the Google Workspace we already pay for. It is only a registration,
but Google requires it before any app may offer a "Sign in with Google" button.

### Costs money — but very little

| Need                                                 | Unlocks                             |
| ---------------------------------------------------- | ----------------------------------- |
| **A phone provider** (Twilio, or Telnyx / Bandwidth) | Real calling and texting            |
| **Anthropic API key**                                | Call summaries and draft assistance |

Both are usage-based and small at our volume: a phone number costs a couple of dollars a
month, then fractions of a cent per message. These are order-of-magnitude figures, not
quotes — confirm on the vendor's pricing page before committing.

We cannot build calling and texting ourselves. Making a phone ring means connecting to the
public telephone network, which requires being a licensed carrier or buying wholesale from
one. Twilio and its competitors _are_ the cheap way to buy it.

### ⚠️ The one thing that is urgent

**Business texting in the US requires carrier registration (A2P 10DLC), and it takes days
to weeks.** Our company and our messaging use-case must be registered and approved by the
mobile carriers before a single text may be sent. Nothing on the engineering side can
shorten this, and everything else can proceed in parallel.

**If we want texting working by any particular date, this registration is the thing to
start first — before the server, before anything else.**

### Decisions, not purchases

| Need                                      | Notes                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| **A server to run it on**                 | An internal VM or a small cloud host. Modest — this is not a heavy application. |
| **Sign-off on the call-recording policy** | Legal/HR, not technical. Recording stays off until this is recorded.            |
| **Call transcription** _(optional)_       | Can be deferred indefinitely, or self-hosted later at no vendor cost.           |

---

## What happens once we have them

The connections are already written and tested against realistic fakes; switching them to
real is largely configuration rather than new development. The realistic sequence is: plug
in the accounts, run a pilot with one or two reps on real data, fix what that surfaces,
then roll out to the team.

The work remaining after that is deployment and operations — a server, backups,
monitoring — not building the product.

Engineering work that needs none of the above is continuing in the meantime.

---

_Screenshots regenerate with `node screenshots.mjs` from `e2e/` while the app is running._
