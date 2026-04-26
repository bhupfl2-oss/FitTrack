# FitTrack — Project Handoff & Next Steps

**Date:** 26 Apr 2026  
**Build partner:** Claude  
**Status:** V1 core complete, ready for testing + V1.1 features

---

## Project Overview

FitTrack is a personal fitness and health tracking web app (PWA) for tracking workouts, body composition, and blood lab results. Built for personal use + small friend group. Not a public product — open Google sign-in, no allowlist.

**Live locally at:** `localhost:5175`  
**Repo:** github.com/bhupfl2-oss (same org as HomeServe)  
**Firebase project:** `forge-6a3e3` (Blaze plan)

---

## Tech Stack

- **Frontend:** React + Vite + TypeScript
- **Styling:** Tailwind CSS + shadcn/ui components
- **Charts:** Recharts
- **Backend:** Firebase — Auth (Google), Firestore, Storage, Hosting
- **IDE:** Windsurf (Cascade with Cmd+L)
- **Color theme:** Emerald green (#10b981) on dark background (#0f1218)

---

## Folder Structure

```
/Users/bhupeshsharma/Desktop/Ai Apps/FitTrack   ← main project (was "Forge")
  src/
    pages/         ← Home.tsx, Workouts.tsx, Body.tsx, Labs.tsx
    components/
      layout/      ← AppShell, ProtectedRoute, UserMenu
      ui/          ← shadcn components
    contexts/      ← AuthContext.tsx
    hooks/
    lib/
  .env.local       ← Firebase config (DO NOT commit to GitHub)
```

---

## Firebase Firestore Data Model

All data scoped under `/users/{uid}/`

| Collection | Shape | Notes |
|---|---|---|
| `users/{uid}/sessions` | `{date, templateId, exercises:[{name, sets:[{reps, weightKg}]}], notes}` | ~3/week |
| `users/{uid}/bodyComp` | `{date, weightKg, pbf, smm, legLeanMass, ecwRatio, waist?, neck?, chest?, thigh?, notes?}` | Monthly |
| `users/{uid}/labs` | `{date, results:[{testName, value, unit}]}` | Quarterly |
| `users/{uid}/customTests` | `{name, unit}` | User-added lab tests |
| `users/{uid}/goals` | `{metric, targetValue, targetDate}` | User-set goals |
| `users/{uid}/templates` | `{name, exercises:[{name, sets, reps, weightKg}]}` | Workout templates |

**Critical rule:** Always wrap Firestore writes in `cleanData()` helper to convert `undefined` → `null`. Firebase throws errors on undefined values.

---

## What's Built (V1)

### ✅ Auth
- Google Sign-in using `signInWithRedirect` + `getRedirectResult`
- Protected routes — unauthenticated users redirected to login
- User avatar (initial or Google photo) top right
- Open sign-up (no allowlist — anyone with Google account can sign in)

### ✅ Workouts (Blocks 3+4)
- Quick Start cards: Push Day, Pull Day, Legs Day, Upper Body, Lower Body
- Custom Workout button (UI exists, full CRUD partially done)
- Active session screen with pre-loaded exercises per template
- Sets/reps/weight inputs — last session numbers pre-filled from Firestore
- Finish Workout → saves to Firestore
- Recent Sessions list with session detail view (read-only)
- Per-exercise 1RM trend chart using Epley formula: `weight × (1 + reps/30)`
- Default exercises per template:
  - **Push:** Bench Press, Overhead Press, Incline DB Press, Tricep Pushdown, Lateral Raise
  - **Pull:** Deadlift, Pull-ups, Barbell Row, Face Pull, Bicep Curl
  - **Legs:** Squat, Romanian Deadlift, Leg Press, Leg Curl, Calf Raise
  - **Upper:** Bench Press, Pull-ups, Overhead Press, Barbell Row, Lateral Raise
  - **Lower:** Squat, Romanian Deadlift, Leg Press, Leg Curl, Calf Raise

### ✅ Body (Block 5)
- Latest stats card: Weight (kg) + PBF% with delta badges
- Delta color logic: Weight↓=green, PBF↓=green, SMM↑=green, Leg Lean↑=green
- Goal progress bar: user-configurable metric + target value + target date
- Status pills: Fat Loss (Improving/Hold/Focus) + Muscle (Strong/Steady/Improve) based on 3-month trend
- Rule-based trend summary (e.g. "Fat mass down 3.3 kg over 3 months · SMM up 0.6 kg")
- Trend charts: Weight, BF%, SMM, Leg Lean Mass — with 3M/6M/All range chips
- Derived metric cards: Fat Mass (Weight × PBF%/100), Lean Mass (Weight − Fat Mass)
- Change vs Previous table with colored delta badges
- Log entry modal: 5 required inputs + optional tape measurements + notes + live derived preview
- History cards with delete option

### ✅ Labs (Block 6)
- Flexible test entry — not fixed columns
- Dropdown seeded with 20+ common tests: TSH, Vit D, B12, Hb, HbA1c, Total Cholesterol, LDL, HDL, Triglycerides, Creatinine, Fasting Glucose, Insulin, Ferritin, Folate, Uric Acid, ALT, AST, Bilirubin, Calcium, Sodium, Potassium
- Custom test creation — saved to Firestore, remembered in future dropdowns
- Dynamic table: columns = all unique tests across all entries
- Up/down arrows vs previous reading with correct improvement direction per marker
- Out-of-range flagging in red using hard-coded ranges
- Horizontally scrollable, sticky date column

### ✅ Home (Block 4)
- Personalised greeting: "Hey, [first name]" + today's date
- Today's workout suggestion (rotates Push→Pull→Legs based on last session)
- Streak counter: consecutive weeks with ≥3 sessions
- Latest body comp card: current weight + delta + status pills
- Latest labs card: most recent test date + out-of-range count

### ✅ PWA + Deploy (Block 7)
- PWA manifest: name FitTrack, theme #10b981, standalone display
- Firebase Hosting config (firebase.json + .firebaserc)
- SPA redirect: all routes → index.html
- Build: `npm run build` → output to `dist/`

---

## Key Testing Scenarios

### Auth
- [ ] Sign in with Google → lands on Home
- [ ] Sign out → redirected to login
- [ ] Refresh page → stays logged in

### Workouts
- [ ] Tap Push Day → session screen with correct exercises
- [ ] Edit reps/weight → Finish → saved to Firestore
- [ ] Recent Sessions shows logged session
- [ ] Second Push session → last numbers pre-filled
- [ ] 3+ sessions in a week → streak increments on Home
- [ ] 1RM chart appears after 2+ sessions for same exercise

### Body
- [ ] Log new entry → Latest stats card updates
- [ ] Weight down → green delta, PBF down → green, SMM up → green
- [ ] Goal progress bar moves toward target correctly
- [ ] Status pills reflect 3-month trend correctly
- [ ] Range chips (3M/6M/All) filter charts
- [ ] Delete entry → removed from charts and history

### Labs
- [ ] Add test from dropdown → saved
- [ ] Type custom test name → Add as custom → appears in future dropdowns
- [ ] Table shows up/down arrows vs previous correctly
- [ ] Out-of-range value → flagged red
- [ ] Multiple test dates → arrows compare correctly

### Home
- [ ] Workout suggestion rotates Push→Pull→Legs correctly
- [ ] Body comp card shows correct delta color
- [ ] Labs card shows out-of-range count

---

## Known Issues / Minor TODOs
- React Router v6→v7 deprecation warnings (non-blocking, fix before v2)
- shadcn Button ref warning with Radix UI (non-blocking)
- Custom workout template full CRUD not complete (UI button exists, logic partial)

---

## What's Left from PRD

- [ ] **Custom workout templates CRUD** — create, edit, delete custom templates (not just use existing ones)
- [ ] **Streak logic** — needs end-to-end testing with real workout data
- [ ] **Firebase deploy** — run `firebase deploy` to push to live `.web.app` URL
- [ ] **Invite friends** — share app URL with 3–5 friends for Block 2 goal

---

## V1.1 Feature Backlog (Discussed, Not Built)

### 1. Data Export (CSV/Excel) — ~1 hour
Export workout history, body comp entries, lab results as CSV or Excel.  
Use `papaparse` (CSV) or `xlsx` library.  
Add export button on each screen (Workouts, Body, Labs).

**Cascade prompt to use:**
> "Add a data export feature to FitTrack. On the Workouts page, add an Export button that downloads workout session history as CSV (date, template, exercises, sets, reps, weight). On the Body page, export body comp entries as CSV (all fields). On the Labs page, export lab results as CSV (date + all test values). Use the papaparse library for CSV generation. File names: fittrack-workouts-{date}.csv, fittrack-body-{date}.csv, fittrack-labs-{date}.csv"

---

### 2. Multi-person Lab Tracking (up to 5 profiles) — ~2-3 hours
Track lab results for family members (e.g. parents) under the same login.  
Data model: `users/{uid}/profiles/{profileId}/labs`  
Profile switcher in UI — "Viewing: Myself / Dad / Mum"

**Cascade prompt to use:**
> "Add multi-person profile support to the Labs screen. Under the logged-in user, allow up to 5 profiles (e.g. Myself, Dad, Mum, custom name). Add a profile switcher at the top of the Labs page. Each profile has its own lab data stored at users/{uid}/profiles/{profileId}/labs. Add a 'Manage Profiles' option to create/rename/delete profiles. Default profile is 'Myself'. All existing lab data belongs to the Myself profile."

---

### 3. Lab Report PDF Storage — ~1 hour
Upload and store PDF lab reports in Firebase Storage.  
Show 'View Report' link per lab entry.  
Same pattern as HomeServe receipt upload — reuse that code.

**Cascade prompt to use:**
> "Add PDF upload to the Labs entry form. Each lab entry can have an optional PDF report attached. Use Firebase Storage to upload the file to users/{uid}/lab-reports/{labEntryId}.pdf. Store the download URL in the Firestore lab doc as reportUrl. In the lab table, show a 'View Report' icon/link for entries that have a PDF. Reuse the same upload pattern used in HomeServe's receipt upload feature."

---

## Build Commands

```bash
# Run locally
npm run dev

# Build for production
npm run build

# Deploy to Firebase Hosting
firebase deploy
```

---

## Context for Next Chat

- FitTrack is separate from HomeServe — different app, same Firebase org
- Firebase project ID: `forge-6a3e3`
- Always use `cleanData()` before Firestore writes
- Use Windsurf Cascade (Cmd+L) for all code changes
- Mobile-first UI, emerald green (#10b981) accent throughout
- PRD document: `Fitness_App_V1_PRD.docx` — reference for scope decisions
- Mockups: `mockups.html` — reference for UI layout

---

*Good night! Great session — V1 is essentially done. 🎉*
