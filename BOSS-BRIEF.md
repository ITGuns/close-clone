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

Nothing further can be built without these. Each one unlocks a specific capability.

| Need                                      | Unlocks                           | Notes                                                                                                                |
| ----------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Twilio account** + one phone number     | Real calling and texting          | Usage-based: a few dollars a month for the number, then per minute and per message. Confirm current rates at signup. |
| **Google Cloud project** (Gmail API)      | Real two-way email sync           | Free; uses our existing Google Workspace.                                                                            |
| **Anthropic API key**                     | Call summaries, draft assistance  | Usage-based and small at our volume.                                                                                 |
| **Deepgram API key** _(optional)_         | Call transcription                | Can be deferred without blocking anything else.                                                                      |
| **Single sign-on app** (Google Workspace) | Staff log in with work accounts   | Free; until then, a temporary login stands in.                                                                       |
| **A server to run it on**                 | Everyone using the same live copy | Internal VM or a small cloud host.                                                                                   |
| **Sign-off on the call-recording policy** | Turning recording on at all       | Legal/HR decision, not a technical one.                                                                              |

Cost figures above are order-of-magnitude, not quotes — worth confirming on each vendor's
pricing page before committing.

**The single highest-value decision is Twilio.** Calling and texting are the features that
distinguish this from a spreadsheet, and they are the ones currently simulated.

---

## What happens once we have them

The connections are already written and tested against fakes; switching them to real is a
configuration change, not new development. The realistic sequence is: plug in the accounts,
run a pilot with one or two reps on real data, fix what that surfaces, then roll out.

The work that remains after that is deployment and operations — a server, backups,
monitoring — not building the product.

---

_Screenshots regenerate with `node screenshots.mjs` from `e2e/` while the app is running._
