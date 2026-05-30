import { doc, getDoc, getDocs, collection, query, orderBy, limit, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface NutritionGoals {
  calorieGoal: number;
  proteinGoal: number;
  carbGoal: number;
  fatGoal: number;
  calculatedAt: string;
  basis: string; // human-readable explanation
}

/**
 * Calculates personalised daily calorie + macro targets using:
 * - Profile: age, gender, height, activity level, primary goal, food preference
 * - Body: latest weight, body fat %, muscle mass (more accurate than profile weight)
 * - Workouts: actual session frequency + types (running vs lifting) last 4 weeks
 * - Labs: TSH (thyroid), HbA1c (insulin resistance) modifiers
 */
export async function calculateNutritionGoals(uid: string): Promise<NutritionGoals> {

  // ── Fetch all data in parallel ──────────────────────────────────────────
  const [profileSnap, bodySnap, labSnap, workoutSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid, 'profile', 'data')),
    getDocs(query(collection(db, 'users', uid, 'bodyComp'), orderBy('date', 'desc'), limit(1))),
    getDocs(query(collection(db, 'users', uid, 'labs'), orderBy('date', 'desc'), limit(1))),
    getDocs(query(collection(db, 'users', uid, 'workoutSessions'), orderBy('date', 'desc'), limit(50))),
  ]);

  const profile = profileSnap.exists() ? profileSnap.data() as any : {};
  const body = bodySnap.docs.length > 0 ? bodySnap.docs[0].data() as any : null;
  const labs = labSnap.docs.length > 0 ? labSnap.docs[0].data() as any : null;

  // ── Basic profile fields ─────────────────────────────────────────────────
  const gender: string = (profile.gender || 'male').toLowerCase();
  const heightCm: number = profile.heightCm || 170;
  const dob: string = profile.dob || '';
  const activityLevel: string = profile.activityLevel || 'Moderate';
  const primaryGoal: string = profile.primaryGoal || 'General fitness';
  const fitnessFocus: string[] = profile.fitnessFocus || [];
  const fitnessTarget: string = (profile.fitnessTarget || '').toLowerCase();
  const foodPreference: string = (profile.foodPreference || '').toLowerCase();
  const chronicConditions: string[] = profile.chronicConditions || [];

  // Age from DOB
  let age = 30;
  if (dob) {
    const birth = new Date(dob);
    const now = new Date();
    age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() ||
      (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
      age--;
    }
  }

  // ── Weight: prefer body page (most recent scale reading) ─────────────────
  let weightKg: number = body?.weightKg ? Number(body.weightKg) : (profile.weightKg || 70);
  let bodyFatPct: number | null = body?.pbf ? Number(body.pbf) : null;
  let muscleKg: number | null = body?.smm ? Number(body.smm) : null;

  // Lean body mass (used for protein target)
  const leanMassKg: number = muscleKg
    ?? (bodyFatPct != null ? weightKg * (1 - bodyFatPct / 100) : weightKg * 0.75);

  // ── BMR via Mifflin-St Jeor ───────────────────────────────────────────────
  let bmr: number;
  if (gender === 'female') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  } else {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  }

  // ── Workout analysis: actual activity from last 4 weeks ───────────────────
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  let runSessions = 0;
  let liftSessions = 0;
  let totalWeeklyKm = 0;

  workoutSnap.docs.forEach(d => {
    const s = d.data() as any;
    const sessionDate = new Date(s.date || s.sessionDate || '');
    if (sessionDate >= fourWeeksAgo) {
      const template = (s.template || '').toLowerCase();
      if (s.type === 'running' || template.includes('run') || template.includes('cardio')) {
        runSessions++;
        totalWeeklyKm += (s.distanceKm || 0);
      } else {
        liftSessions++;
      }
    }
  });

  const totalSessions = runSessions + liftSessions;
  const weeklyRunKm = totalWeeklyKm / 4; // average per week
  const hasMarathonTag = fitnessFocus.includes("🏁 Marathon training") || fitnessTarget.includes("marathon") || fitnessTarget.includes("long distance");
  const isMarathonRunner = weeklyRunKm >= 40 || runSessions >= 12 || hasMarathonTag; // 40km+/week or 3 runs/week
  const isEnduranceAthlete = weeklyRunKm >= 20 || runSessions >= 8;
  // isPrimarilyRunner reserved for future use

  // ── Activity multiplier ───────────────────────────────────────────────────
  // Use actual workout data if available, else fall back to profile selection
  let activityMultiplier: number;

  if (totalSessions >= 1) {
    // Use actual workout frequency
    const sessionsPerWeek = totalSessions / 4;
    if (isMarathonRunner || sessionsPerWeek >= 6) {
      activityMultiplier = 1.9; // very high — marathon training
    } else if (isEnduranceAthlete || sessionsPerWeek >= 5) {
      activityMultiplier = 1.75;
    } else if (sessionsPerWeek >= 4) {
      activityMultiplier = 1.65;
    } else if (sessionsPerWeek >= 3) {
      activityMultiplier = 1.55;
    } else if (sessionsPerWeek >= 2) {
      activityMultiplier = 1.45;
    } else {
      activityMultiplier = 1.375;
    }
  } else {
    // Fall back to profile selection
    const multipliers: Record<string, number> = {
      'sedentary': 1.2,
      'light': 1.375,
      'moderate': 1.55,
      'very active': 1.725,
    };
    activityMultiplier = multipliers[activityLevel.toLowerCase()] || 1.55;
  }

  // ── TDEE (Total Daily Energy Expenditure) ─────────────────────────────────
  let tdee = Math.round(bmr * activityMultiplier);

  // ── Lab modifiers ─────────────────────────────────────────────────────────
  let labNote = '';
  if (labs?.results && Array.isArray(labs.results)) {
    const tsh = labs.results.find((r: any) =>
      r.testName?.toLowerCase().includes('tsh'));
    const hba1c = labs.results.find((r: any) =>
      r.testName?.toLowerCase().replace(/\s/g, '').includes('hba1c'));

    if (tsh) {
      const tshVal = Number(tsh.value);
      if (tshVal > 4.0) {
        // Hypothyroid — reduce TDEE by ~5%
        tdee = Math.round(tdee * 0.95);
        labNote = 'TSH elevated (hypothyroid risk) — calorie target reduced slightly. ';
      } else if (tshVal < 0.4) {
        // Hyperthyroid — increase TDEE by ~5%
        tdee = Math.round(tdee * 1.05);
        labNote = 'TSH low (hyperthyroid risk) — calorie target increased slightly. ';
      }
    }

    if (hba1c) {
      const hba1cVal = Number(hba1c.value);
      if (hba1cVal > 5.6) {
        // Pre-diabetic / insulin resistant — shift macros to lower carb
        labNote += 'HbA1c elevated — carb target reduced, protein increased. ';
      }
    }
  }

  // ── Chronic condition modifiers ───────────────────────────────────────────
  const hasThyroid = chronicConditions.some(c => c.toLowerCase().includes('thyroid'));
  // hasDiabetes reserved for future use
  if (hasThyroid && !labNote.includes('TSH')) {
    tdee = Math.round(tdee * 0.95);
  }

  // ── Goal adjustment ───────────────────────────────────────────────────────
  let calorieGoal: number;
  let goalNote: string;

  const goal = primaryGoal.toLowerCase();

  if (goal.includes('fat loss')) {
    // Deficit: deeper if BF% is high
    const bfPct = bodyFatPct || 25;
    const deficit = bfPct > 30 ? 500 : bfPct > 25 ? 400 : 300;
    calorieGoal = Math.max(1200, tdee - deficit);
    goalNote = `Fat loss: ${deficit} kcal deficit from TDEE ${tdee}`;
  } else if (goal.includes('muscle')) {
    // Surplus for muscle gain
    const surplus = isMarathonRunner ? 200 : 300;
    calorieGoal = tdee + surplus;
    goalNote = `Muscle gain: ${surplus} kcal surplus from TDEE ${tdee}`;
  } else if (isMarathonRunner || isEnduranceAthlete) {
    // Endurance athletes need maintenance or slight surplus
    calorieGoal = tdee + (isMarathonRunner ? 200 : 100);
    goalNote = `Endurance athlete: maintenance + small surplus from TDEE ${tdee}`;
  } else {
    // General fitness / health monitoring
    calorieGoal = tdee;
    goalNote = `General fitness: maintenance at TDEE ${tdee}`;
  }

  calorieGoal = Math.round(calorieGoal / 50) * 50; // round to nearest 50

  // ── Macro split ───────────────────────────────────────────────────────────
  let proteinGoal: number;
  let carbGoal: number;
  let fatGoal: number;

  const hasElevatedHba1c = labs?.results?.some((r: any) =>
    r.testName?.toLowerCase().replace(/\s/g, '').includes('hba1c') && Number(r.value) > 5.6
  );

  if (isMarathonRunner) {
    // High carb for endurance: 55% carb, 20% protein, 25% fat
    proteinGoal = Math.round(leanMassKg * 1.6); // 1.6g/kg lean mass
    carbGoal = Math.round((calorieGoal * 0.55) / 4);
    fatGoal = Math.round((calorieGoal * 0.25) / 9);
  } else if (goal.includes('muscle')) {
    // High protein for muscle: 30% protein, 45% carb, 25% fat
    proteinGoal = Math.round(leanMassKg * 2.2); // 2.2g/kg lean mass
    carbGoal = Math.round((calorieGoal * 0.45) / 4);
    fatGoal = Math.round((calorieGoal * 0.25) / 9);
  } else if (goal.includes('fat loss') || hasElevatedHba1c) {
    // High protein, moderate carb for fat loss
    proteinGoal = Math.round(leanMassKg * 2.0);
    carbGoal = Math.round((calorieGoal * 0.35) / 4);
    fatGoal = Math.round((calorieGoal * 0.30) / 9);
  } else {
    // Balanced: 25% protein, 45% carb, 30% fat
    proteinGoal = Math.round(leanMassKg * 1.8);
    carbGoal = Math.round((calorieGoal * 0.45) / 4);
    fatGoal = Math.round((calorieGoal * 0.30) / 9);
  }

  // Vegan/veg adjustment — bump protein slightly (plant protein less bioavailable)
  if (foodPreference.includes('veg') || foodPreference.includes('vegan')) {
    proteinGoal = Math.round(proteinGoal * 1.1);
  }

  // Sanity caps
  proteinGoal = Math.min(proteinGoal, 250);
  carbGoal = Math.min(carbGoal, 500);
  fatGoal = Math.min(fatGoal, 150);

  // ── Build basis string ────────────────────────────────────────────────────
  const basisParts = [
    `BMR ${Math.round(bmr)} kcal`,
    `× ${activityMultiplier} activity`,
    goalNote,
    labNote || null,
    isMarathonRunner ? 'Marathon runner macro split' : null,
    isEnduranceAthlete && !isMarathonRunner ? 'Endurance athlete adjustment' : null,
  ].filter(Boolean);

  const goals: NutritionGoals = {
    calorieGoal,
    proteinGoal,
    carbGoal,
    fatGoal,
    calculatedAt: new Date().toISOString(),
    basis: basisParts.join(' · '),
  };

  // ── Save to profile ───────────────────────────────────────────────────────
  await setDoc(
    doc(db, 'users', uid, 'profile', 'data'),
    {
      calorieGoal,
      proteinGoal,
      carbGoal,
      fatGoal,
      nutritionGoalsBasis: goals.basis,
      nutritionGoalsCalculatedAt: goals.calculatedAt,
    },
    { merge: true }
  );

  return goals;
}