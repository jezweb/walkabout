/**
 * The app guide the ask-the-app assistant answers from.
 *
 * This is the assistant's ONLY source of truth — keep it factual and keep it
 * current when features ship (update it in the same commit as any feature
 * change). Facts come from the code, never from imagination: no invented
 * pricing, stats, or contact details.
 *
 * This is a trimmed EXAMPLE shape — see FieldProof's full ~150-line version
 * for the quality bar. Sections that work: what the app is, the surfaces,
 * every page, the core flows, data & limits, who to contact.
 */
export const APP_GUIDE = `
ExampleApp is a [one-paragraph description of what the app does and who
uses it].

THE SURFACES
- Dashboard (app.example.com): sign in with [method]. Pages: Home, Items,
  Reports, Settings.

PAGES
- Home (/home): [what the user sees and what the page answers].
- Items (/items): [the main record list — what lands here, the filters,
  what clicking a row shows, what actions exist and what they do].
- Reports (/reports): [what can be exported, in what shape].
- Settings (/settings): [what can be configured].

CORE FLOWS
1. [The main loop, numbered, as a user experiences it.]
2. [What happens automatically vs what needs a human.]

DATA & LIMITS
- [Retention, rate limits, permanence of records — the questions users ask.]

WHO TO CONTACT
For anything the app can't answer — contact [Name] at [email] or [phone].
`.trim();
