import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import Home from "@/pages/Home";
import Workouts from "@/pages/Workouts";
import Body from "@/pages/Body";
import Labs from "@/pages/Labs";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="workouts" element={<Workouts />} />
          <Route path="body" element={<Body />} />
          <Route path="labs" element={<Labs />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
