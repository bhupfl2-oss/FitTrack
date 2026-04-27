import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import AppShell from "@/components/layout/AppShell";
import ProtectedRoute from "@/components/layout/ProtectedRoute";
import Home from "@/pages/Home";
import Workouts from "@/pages/Workouts";
import WorkoutSession from "@/pages/WorkoutSession";
import RunningSession from "@/pages/RunningSession";
import Body from "@/pages/Body";
import Labs from "@/pages/Labs";
import Export from "@/pages/Export";
import Login from "@/pages/Login";

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<AppShell />}>
            <Route index element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="workouts" element={<ProtectedRoute><Workouts /></ProtectedRoute>} />
            <Route path="workout-session" element={<ProtectedRoute><WorkoutSession /></ProtectedRoute>} />
            <Route path="running-session" element={<ProtectedRoute><RunningSession /></ProtectedRoute>} />
            <Route path="body" element={<ProtectedRoute><Body /></ProtectedRoute>} />
            <Route path="labs" element={<ProtectedRoute><Labs /></ProtectedRoute>} />
            <Route path="export" element={<ProtectedRoute><Export /></ProtectedRoute>} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
