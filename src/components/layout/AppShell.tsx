import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav";
import UserMenu from "./UserMenu";

export default function AppShell() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      <header className="flex items-center justify-between px-6 pt-4 pb-2">
        <h1 className="text-xl font-bold text-white">FitTrack</h1>
        <UserMenu />
      </header>
      <Outlet />
      <BottomNav />
    </div>
  );
}
