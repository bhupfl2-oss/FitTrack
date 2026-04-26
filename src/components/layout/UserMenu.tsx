import { useAuth } from '@/hooks/useAuth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { LogOut } from 'lucide-react';

export default function UserMenu() {
  const { user, signOut } = useAuth();
  
  if (!user) return null;

  const getInitials = () => {
    const name = user.displayName || user.email || '';
    return name.charAt(0).toUpperCase();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button 
          className="w-10 h-10 rounded-full p-0 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 relative z-50 pointer-events-auto flex items-center justify-center text-white font-semibold transition-colors"
        >
          {user.photoURL ? (
            <img src={user.photoURL} alt="Avatar" className="w-10 h-10 rounded-full object-cover" />
          ) : (
            getInitials()
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-50">
        <div className="px-2 py-1.5 text-sm text-slate-500">
          {user.displayName || user.email}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="cursor-pointer">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
