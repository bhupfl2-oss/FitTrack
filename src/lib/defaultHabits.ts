import { collection, doc, getDocs, setDoc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface DefaultHabit {
  id: string;
  name: string;
  icon: string;
  goalType: string;
  targetValue: number;
  targetUnit: string;
}

const DEFAULT_HABIT_DEFS = [
  { name: 'Steps',  icon: '🚶', goalType: 'count_per_day', targetValue: 8000, targetUnit: 'steps' },
  { name: 'Water',  icon: '💧', goalType: 'count_per_day', targetValue: 8,    targetUnit: 'glasses' },
  { name: 'Sleep',  icon: '😴', goalType: 'count_per_day', targetValue: 8,    targetUnit: 'hours' },
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Ensures the 3 default habits exist for the user.
 * Returns their IDs keyed by lowercase name.
 */
// Module-level cache — avoids re-checking Firestore on every page load
const _cache: Record<string, Record<string, DefaultHabit>> = {};

export async function ensureDefaultHabits(uid: string): Promise<Record<string, DefaultHabit>> {
  if (_cache[uid]) return _cache[uid];
  const snap = await getDocs(collection(db, 'users', uid, 'habits'));
  const existing = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  const result: Record<string, DefaultHabit> = {};

  for (const def of DEFAULT_HABIT_DEFS) {
    const key = def.name.toLowerCase();
    const found = existing.find((h: any) =>
      h.name?.toLowerCase() === key || h.name?.toLowerCase().includes(key)
    );

    if (found) {
      result[key] = { id: found.id, name: found.name, icon: found.icon || def.icon, goalType: found.goalType || def.goalType, targetValue: found.targetValue || def.targetValue, targetUnit: found.targetUnit || def.targetUnit };
    } else {
      // Auto-create
      const ref = await addDoc(collection(db, 'users', uid, 'habits'), {
        name: def.name,
        icon: def.icon,
        goalType: def.goalType,
        targetValue: def.targetValue,
        targetUnit: def.targetUnit,
        isDefault: true,
        createdAt: serverTimestamp(),
      });
      result[key] = { id: ref.id, ...def };
    }
  }

  _cache[uid] = result;
  return result;
}

/**
 * Get today's log value for a habit.
 */
export async function getHabitLogToday(uid: string, habitId: string): Promise<number> {
  const snap = await getDoc(doc(db, 'users', uid, 'habits', habitId, 'logs', todayStr()));
  if (!snap.exists()) return 0;
  const data = snap.data();
  return data.value ?? data.steps ?? data.glasses ?? data.hours ?? 0;
}

/**
 * Set today's log value for a habit.
 */
export async function setHabitLogToday(uid: string, habitId: string, value: number): Promise<void> {
  const today = todayStr();
  await setDoc(
    doc(db, 'users', uid, 'habits', habitId, 'logs', today),
    { value, date: today, completedAt: new Date().toISOString() },
    { merge: true }
  );
}