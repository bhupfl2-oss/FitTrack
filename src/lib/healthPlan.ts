/**
 * Generates a personalised health checkup plan based on:
 * - Age, gender
 * - Chronic conditions (Diabetes, Hypertension, Thyroid)
 * - Fitness focus (Marathon, Strength, etc.)
 * - Food preference (Vegan/Veg → needs B12, Iron more)
 * - Primary goal
 */

export interface RecommendedTest {
  name: string;               // Canonical test name (matches tests/ collection)
  category: string;           // e.g. "Thyroid", "Metabolic", "Nutrition"
  icon: string;
  defaultIntervalMonths: number;  // How often to get it
  reason: string;             // Why this person specifically needs it
  priority: 'essential' | 'important' | 'optional';
}

interface ProfileContext {
  age?: number | null;
  gender?: string;
  chronicConditions?: string[];
  fitnessFocus?: string[];
  foodPreference?: string;
  primaryGoal?: string;
}

// Base tests everyone should get annually
const BASE_TESTS: RecommendedTest[] = [
  { name: 'Hemoglobin', category: 'Blood Count', icon: '🔴', defaultIntervalMonths: 12, reason: 'Core blood health marker', priority: 'essential' },
  { name: 'Total Cholesterol', category: 'Lipid Profile', icon: '🫁', defaultIntervalMonths: 12, reason: 'Cardiovascular risk screening', priority: 'essential' },
  { name: 'LDL', category: 'Lipid Profile', icon: '🫁', defaultIntervalMonths: 12, reason: 'Bad cholesterol — cardiovascular risk', priority: 'essential' },
  { name: 'HDL', category: 'Lipid Profile', icon: '🫁', defaultIntervalMonths: 12, reason: 'Good cholesterol — cardiovascular protection', priority: 'essential' },
  { name: 'Triglycerides', category: 'Lipid Profile', icon: '🫁', defaultIntervalMonths: 12, reason: 'Fat in blood — metabolic health', priority: 'essential' },
  { name: 'Fasting Blood Sugar', category: 'Metabolic', icon: '🍬', defaultIntervalMonths: 12, reason: 'Diabetes screening', priority: 'essential' },
  { name: 'HbA1c', category: 'Metabolic', icon: '🍬', defaultIntervalMonths: 12, reason: '3-month blood sugar average', priority: 'essential' },
  { name: 'Creatinine', category: 'Kidney', icon: '🫘', defaultIntervalMonths: 12, reason: 'Kidney function', priority: 'essential' },
  { name: 'ALT', category: 'Liver', icon: '🫀', defaultIntervalMonths: 12, reason: 'Liver enzyme — function check', priority: 'essential' },
  { name: 'TSH', category: 'Thyroid', icon: '🩸', defaultIntervalMonths: 12, reason: 'Thyroid function — affects metabolism, energy, weight', priority: 'essential' },
  { name: 'Vitamin D', category: 'Nutrition', icon: '☀️', defaultIntervalMonths: 6, reason: 'Deficiency is extremely common — affects energy, bones, immunity', priority: 'essential' },
  { name: 'Vitamin B12', category: 'Nutrition', icon: '💊', defaultIntervalMonths: 6, reason: 'Affects energy, nerve function, red blood cells', priority: 'essential' },
];

export function generateHealthPlan(profile: ProfileContext): RecommendedTest[] {
  const tests = [...BASE_TESTS];
  const age = profile.age || 30;
  const gender = (profile.gender || '').toLowerCase();
  const conditions = (profile.chronicConditions || []).map(c => c.toLowerCase());
  const focus = (profile.fitnessFocus || []).map(f => f.toLowerCase());
  const diet = (profile.foodPreference || '').toLowerCase();
  // const goal = (profile.primaryGoal || '').toLowerCase(); // reserved

  // ── Condition-specific ──────────────────────────────────────────────────

  if (conditions.some(c => c.includes('diabetes'))) {
    // HbA1c every 3 months for diabetics
    const hba1c = tests.find(t => t.name === 'HbA1c');
    if (hba1c) hba1c.defaultIntervalMonths = 3;
    tests.push({
      name: 'Insulin',
      category: 'Metabolic',
      icon: '💉',
      defaultIntervalMonths: 6,
      reason: 'Insulin resistance monitoring — important for diabetes management',
      priority: 'essential',
    });
  }

  if (conditions.some(c => c.includes('thyroid'))) {
    const tsh = tests.find(t => t.name === 'TSH');
    if (tsh) { tsh.defaultIntervalMonths = 6; tsh.reason = 'You have thyroid condition — check every 6 months'; }
    tests.push(
      { name: 'FT3', category: 'Thyroid', icon: '🩸', defaultIntervalMonths: 6, reason: 'Free T3 — active thyroid hormone', priority: 'important' },
      { name: 'FT4', category: 'Thyroid', icon: '🩸', defaultIntervalMonths: 6, reason: 'Free T4 — thyroid function detail', priority: 'important' }
    );
  }

  if (conditions.some(c => c.includes('hypertension'))) {
    tests.push(
      { name: 'Sodium', category: 'Electrolytes', icon: '⚡', defaultIntervalMonths: 6, reason: 'Electrolyte balance — important with hypertension', priority: 'important' },
      { name: 'Potassium', category: 'Electrolytes', icon: '⚡', defaultIntervalMonths: 6, reason: 'Potassium affects blood pressure regulation', priority: 'important' },
      { name: 'Uric Acid', category: 'Kidney', icon: '🫘', defaultIntervalMonths: 12, reason: 'Elevated in hypertension — gout risk', priority: 'important' }
    );
  }

  // ── Gender-specific ─────────────────────────────────────────────────────

  if (gender === 'male' && age >= 30) {
    tests.push({
      name: 'Testosterone',
      category: 'Hormones',
      icon: '⚡',
      defaultIntervalMonths: 12,
      reason: 'Testosterone declines after 30 — affects energy, muscle, mood',
      priority: age >= 35 ? 'essential' : 'important',
    });
  }

  if (gender === 'female') {
    tests.push(
      { name: 'Ferritin', category: 'Iron Studies', icon: '🩸', defaultIntervalMonths: 6, reason: 'Iron stores — women are more prone to deficiency', priority: 'essential' },
      { name: 'Iron', category: 'Iron Studies', icon: '🩸', defaultIntervalMonths: 6, reason: 'Iron levels — fatigue and anemia risk', priority: 'essential' }
    );
    if (age >= 40) {
      tests.push({ name: 'FSH', category: 'Hormones', icon: '🔬', defaultIntervalMonths: 12, reason: 'Hormonal health — perimenopause screening from 40', priority: 'important' });
    }
  }

  // ── Age-specific ─────────────────────────────────────────────────────────

  if (age >= 40) {
    const hba1c = tests.find(t => t.name === 'HbA1c');
    if (hba1c) hba1c.defaultIntervalMonths = 6;
    tests.push(
      { name: 'PSA', category: 'Cancer Screening', icon: '🔬', defaultIntervalMonths: 12, reason: 'Prostate screening recommended from 40 for men', priority: gender === 'male' ? 'important' : 'optional' },
      { name: 'Uric Acid', category: 'Kidney', icon: '🫘', defaultIntervalMonths: 12, reason: 'Gout and kidney risk increases with age', priority: 'important' }
    );
  }

  if (age >= 50) {
    tests.push(
      { name: 'Calcium', category: 'Bone Health', icon: '🦴', defaultIntervalMonths: 12, reason: 'Bone density risk increases after 50', priority: 'important' },
      { name: 'Vitamin D', category: 'Nutrition', icon: '☀️', defaultIntervalMonths: 6, reason: 'Critical for bone health after 50', priority: 'essential' }
    );
  }

  // ── Fitness focus ─────────────────────────────────────────────────────────

  const isEndurance = focus.some(f => f.includes('running') || f.includes('marathon') || f.includes('cycling') || f.includes('swimming'));
  const isStrength = focus.some(f => f.includes('strength') || f.includes('bodybuilding') || f.includes('martial'));

  if (isEndurance) {
    tests.push(
      { name: 'Ferritin', category: 'Iron Studies', icon: '🩸', defaultIntervalMonths: 6, reason: 'Endurance athletes deplete iron — low ferritin kills performance', priority: 'essential' },
      { name: 'Iron', category: 'Iron Studies', icon: '🩸', defaultIntervalMonths: 6, reason: 'Iron deficiency is #1 cause of fatigue in runners', priority: 'essential' },
      { name: 'Sodium', category: 'Electrolytes', icon: '⚡', defaultIntervalMonths: 12, reason: 'Electrolyte balance — critical for endurance athletes', priority: 'important' },
      { name: 'Magnesium', category: 'Electrolytes', icon: '⚡', defaultIntervalMonths: 12, reason: 'Muscle function and recovery for endurance sports', priority: 'important' }
    );
  }

  if (isStrength) {
    tests.push(
      { name: 'Testosterone', category: 'Hormones', icon: '⚡', defaultIntervalMonths: 12, reason: 'Strength training response depends on testosterone', priority: 'important' },
      { name: 'Creatinine', category: 'Kidney', icon: '🫘', defaultIntervalMonths: 6, reason: 'High protein intake increases creatinine — kidney monitoring important', priority: 'important' }
    );
  }

  // ── Diet-specific ─────────────────────────────────────────────────────────

  if (diet.includes('veg') || diet.includes('vegan')) {
    const b12 = tests.find(t => t.name === 'Vitamin B12');
    if (b12) { b12.defaultIntervalMonths = 6; b12.reason = 'Vegan/veg diets have no B12 — critical to check every 6 months'; b12.priority = 'essential'; }
    tests.push(
      { name: 'Iron', category: 'Iron Studies', icon: '🩸', defaultIntervalMonths: 6, reason: 'Plant-based iron is less bioavailable — deficiency risk', priority: 'essential' },
      { name: 'Ferritin', category: 'Iron Studies', icon: '🩸', defaultIntervalMonths: 6, reason: 'Iron stores — plant-based diet needs regular monitoring', priority: 'essential' },
      { name: 'Zinc', category: 'Nutrition', icon: '💊', defaultIntervalMonths: 12, reason: 'Zinc deficiency common in plant-based diets', priority: 'important' },
      { name: 'Omega-3 Index', category: 'Nutrition', icon: '🐟', defaultIntervalMonths: 12, reason: 'No fish in diet — omega-3 levels may be low', priority: 'optional' }
    );
  }

  // ── Deduplicate by name ───────────────────────────────────────────────────
  const seen = new Set<string>();
  return tests.filter(t => {
    const key = t.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Given the health plan and existing tests from Firestore,
 * returns status for each recommended test.
 */
export interface TestStatus {
  recommended: RecommendedTest;
  lastDone: Date | null;
  lastValue: number | null;
  lastUnit: string | null;
  existingTestId: string | null;
  intervalMonths: number;  // user-customized or default
  status: 'never' | 'recent' | 'due_soon' | 'overdue';
  daysUntilDue: number | null;
}

export function computeTestStatuses(
  plan: RecommendedTest[],
  existingTests: { id: string; name: string; latestReading: { value: number; date: Date } | null; reminderIntervalMonths: number | null }[]
): TestStatus[] {
  const now = new Date();

  return plan.map(rec => {
    // Match by name (case-insensitive, partial)
    const existing = existingTests.find(t =>
      t.name.toLowerCase().includes(rec.name.toLowerCase()) ||
      rec.name.toLowerCase().includes(t.name.toLowerCase())
    );

    const intervalMonths = existing?.reminderIntervalMonths || rec.defaultIntervalMonths;
    const lastDone = existing?.latestReading?.date || null;
    const lastValue = existing?.latestReading?.value || null;
    const lastUnit = null;

    if (!lastDone) {
      return { recommended: rec, lastDone: null, lastValue: null, lastUnit: null, existingTestId: existing?.id || null, intervalMonths, status: 'never', daysUntilDue: null };
    }

    const nextDue = new Date(lastDone);
    nextDue.setMonth(nextDue.getMonth() + intervalMonths);
    const daysUntilDue = Math.ceil((nextDue.getTime() - now.getTime()) / 86400000);

    let status: TestStatus['status'];
    if (daysUntilDue < 0) status = 'overdue';
    else if (daysUntilDue <= 45) status = 'due_soon';
    else status = 'recent';

    return { recommended: rec, lastDone, lastValue, lastUnit, existingTestId: existing?.id || null, intervalMonths, status, daysUntilDue };
  });
}

export function getOverdueCount(statuses: TestStatus[]): number {
  return statuses.filter(s => s.status === 'overdue' || s.status === 'never').length;
}

export function getHealthPlanSummary(statuses: TestStatus[]): string {
  const overdue = statuses.filter(s => s.status === 'overdue');
  const never = statuses.filter(s => s.status === 'never');
  const dueSoon = statuses.filter(s => s.status === 'due_soon');

  const parts: string[] = [];
  if (overdue.length) parts.push(`${overdue.length} test${overdue.length > 1 ? 's' : ''} overdue`);
  if (never.length) parts.push(`${never.length} never done`);
  if (dueSoon.length) parts.push(`${dueSoon.length} due soon`);
  if (!parts.length) return 'All tests up to date ✓';
  return parts.join(' · ');
}