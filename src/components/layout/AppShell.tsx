import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav";

export default function AppShell() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      <Outlet />
      <BottomNav />
    </div>
  );
}
