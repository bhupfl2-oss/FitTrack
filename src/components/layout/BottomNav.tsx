import { useState, useEffect } from "react";
import { Home, Dumbbell, LineChart, FlaskConical, UtensilsCrossed } from "lucide-react";
import { useLocation, Link } from "react-router-dom";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";

const muscleGroupMap: Record<string, string[]> = {
  push: ['Push', 'Chest', 'Shoulders', 'Triceps'],
  pushday: ['Push', 'Chest', 'Shoulders', 'Triceps'],
  pull: ['Pull', 'Back', 'Biceps'],
  pullday: ['Pull', 'Back', 'Biceps'],
  legs: ['Legs', 'Quads', 'Hamstrings', 'Glutes'],
  legsday: ['Legs', 'Quads', 'Hamstrings', 'Glutes'],
  upper: ['Push', 'Pull', 'Chest', 'Back'],
  lower: ['Legs', 'Quads', 'Hamstrings'],
  running: ['Cardio'],
};

export default function BottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const [workoutAlert, setWorkoutAlert] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetchAlert = async () => {
      try {
        const q = query(
          collection(db, 'users', user.uid, 'workoutSessions'),
          orderBy('date', 'desc'),
          limit(50)
        );
        const snap = await getDocs(q);
        const sessions = snap.docs.map(d => ({ date: d.data().date, template: d.data().template }));
        const now = new Date();
        const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        const recent = sessions.filter((s: any) => new Date(s.date) >= fourteenDaysAgo);

        const groupLastDates: Record<string, Date | null> = { Push: null, Pull: null, Legs: null };
        for (const session of recent) {
          const t = (session.template || '').toLowerCase().replace(/\s+/g, '');
          const mapped = muscleGroupMap[t] || [];
          for (const group of ['Push', 'Pull', 'Legs'] as const) {
            if (mapped.includes(group)) {
              const d = new Date(session.date);
              if (!groupLastDates[group] || d > groupLastDates[group]!) groupLastDates[group] = d;
            }
          }
        }

        const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
        let alert = false;
        for (const group of ['Push', 'Pull', 'Legs'] as const) {
          const last = groupLastDates[group];
          if (!last || last < tenDaysAgo) { alert = true; break; }
        }
        setWorkoutAlert(alert);
      } catch (_) {}
    };
    fetchAlert();
  }, [user]);

  const navItems = [
    { path: "/",          icon: Home,            label: "Home",     accent: "text-emerald-400" },
    { path: "/workouts",  icon: Dumbbell,        label: "Workouts", accent: "text-emerald-400" },
    { path: "/food",      icon: UtensilsCrossed, label: "Food",     accent: "text-orange-400"  },
    { path: "/body",      icon: LineChart,       label: "Body",     accent: "text-emerald-400" },
    { path: "/labs",      icon: FlaskConical,    label: "Labs",     accent: "text-blue-400"    },
  ];

  if (location.pathname === '/ai-coach') return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-slate-950 border-t border-slate-800 z-50">
      {/* Scrollable row — all 6 items visible on most phones, swipeable on very small screens */}
      <div
        className="flex items-center h-16 overflow-x-auto"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {navItems.map(({ path, icon: Icon, label, accent }) => {
          const isActive = location.pathname === path;
          const showAlert = path === '/workouts' && workoutAlert;
          return (
            <Link
              key={path}
              to={path}
              className={`flex flex-col items-center justify-center gap-1 transition-colors relative flex-shrink-0 ${
                isActive ? accent : 'text-slate-500'
              }`}
              style={{ minWidth: '60px', flex: '1 0 60px', paddingBottom: '2px' }}
            >
              <div className="relative">
                <Icon size={20} />
                {showAlert && (
                  <span className="absolute -top-0.5 -right-1 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </div>
              <span className="text-[10px] font-mono tracking-tight">{label}</span>
              {/* Active indicator dot */}
              {isActive && (
                <span
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                  style={{ background: 'currentColor' }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}