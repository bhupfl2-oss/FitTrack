import { Home, Dumbbell, LineChart, FlaskConical } from "lucide-react";
import { useLocation, Link } from "react-router-dom";

export default function BottomNav() {
  const location = useLocation();
  
  const navItems = [
    { path: "/", icon: Home, label: "Home" },
    { path: "/workouts", icon: Dumbbell, label: "Workouts" },
    { path: "/body", icon: LineChart, label: "Body" },
    { path: "/labs", icon: FlaskConical, label: "Labs" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-slate-950 border-t border-slate-800 z-50">
      <div className="flex justify-around items-center h-16 max-w-md mx-auto">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              className={`flex flex-col items-center justify-center space-y-1 transition-colors ${
                isActive ? "text-emerald-400" : "text-slate-500"
              }`}
            >
              <Icon size={20} />
              <span className="text-xs">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
