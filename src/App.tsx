import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/hooks/useAuth";
import { useOnboarding } from "@/hooks/useOnboarding";
import AppShell from "@/components/layout/AppShell";
import ProtectedRoute from "@/components/layout/ProtectedRoute";
import Home from "@/pages/Home";
import Workouts from "@/pages/Workouts";
import WorkoutSession from "@/pages/WorkoutSession";
import RunningSession from "@/pages/RunningSession";
import Body from "@/pages/Body";
import Labs from "@/pages/Labs";
import LabTestDetail from "@/pages/LabTestDetail";
import LabUpload from "@/pages/LabUpload";
import Export from "@/pages/Export";
import Wellness from "@/pages/Wellness";
import HabitDetail from "@/pages/HabitDetail";
import Profile from "@/pages/Profile";
import AICoach from "@/pages/AICoach";
import Login from "@/pages/Login";
import OnboardingWizard from "@/pages/OnboardingWizard";

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const { onboardingComplete, loading: onboardingLoading } = useOnboarding();

  if (authLoading || onboardingLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user && onboardingComplete === false) {
    return <OnboardingWizard />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/ai-coach" element={<ProtectedRoute><AICoach /></ProtectedRoute>} />
      <Route path="/" element={<AppShell />}>
        <Route index element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="workouts" element={<ProtectedRoute><Workouts /></ProtectedRoute>} />
        <Route path="workout-session" element={<ProtectedRoute><WorkoutSession /></ProtectedRoute>} />
        <Route path="running-session" element={<ProtectedRoute><RunningSession /></ProtectedRoute>} />
        <Route path="body" element={<ProtectedRoute><Body /></ProtectedRoute>} />
        <Route path="labs" element={<ProtectedRoute><Labs /></ProtectedRoute>} />
        <Route path="labs/:testId" element={<ProtectedRoute><LabTestDetail /></ProtectedRoute>} />
        <Route path="labs/upload" element={<ProtectedRoute><LabUpload /></ProtectedRoute>} />
        <Route path="export" element={<ProtectedRoute><Export /></ProtectedRoute>} />
        <Route path="wellness" element={<ProtectedRoute><Wellness /></ProtectedRoute>} />
        <Route path="wellness/:habitId" element={<ProtectedRoute><HabitDetail /></ProtectedRoute>} />
        <Route path="profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;
