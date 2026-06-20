import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { saveGoals, calculateGoalsWithAI } from '@/services/goalsService';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  showWorkoutLoad?: boolean;
}

interface ContextData {
  profile: any;
  bodyStats: any[];
  labResults: any[];
  tests: any[];
  workoutSessions: any[];
  nutritionLogs: any[];
}

// labRanges removed — reference ranges now come from tests collection

// Serializes a Date's LOCAL calendar day to YYYY-MM-DD — never use toISOString()
// for calendar-day purposes, it converts to UTC and shifts the date for IST.
const toLocalDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayLocalStr = () => toLocalDateStr(new Date());

const calculateAge = (dob: string) => {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
};

const quickChips: Record<string, string[]> = {
  workout: ["Suggest today's workout", "Why is my SMM dropping?", "How many days rest?"],
  food: ["What should I eat today?", "High protein veg meals", "Best pre-workout meal"],
  labs: ["Explain my results", "What should I retest?", "What affects Vitamin D?", "Is this package suitable for my needs?"],
  body: ["How's my body comp trending?", "Am I on track with my goals?", "What should I focus on next?", "Why is my SMM dropping?"],
  general: ["How am I doing overall?", "Plan my week", "What should I focus on?", "Log something", "What should I eat today?"],
};

const renderInline = (text: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  let key = 0;

  const boldSplit = text.split(/(\*\*.+?\*\*)/);
  boldSplit.forEach((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      parts.push(<strong key={key++} className="font-semibold text-white">{part.slice(2, -2)}</strong>);
    } else {
      const italicSplit = part.split(/(\*.+?\*)/);
      italicSplit.forEach((subPart) => {
        if (subPart.startsWith('*') && subPart.endsWith('*')) {
          parts.push(<em key={key++} className="italic">{subPart.slice(1, -1)}</em>);
        } else {
          parts.push(<span key={key++}>{subPart}</span>);
        }
      });
    }
  });

  return parts;
};

const renderMarkdown = (text: string): React.ReactNode[] => {
  const paragraphs = text.split('\n\n');

  return paragraphs.map((para, i) => {
    const lines = para.split('\n');
    const allBullets = lines.length > 0 && lines.every((line) => line.startsWith('- '));

    if (allBullets) {
      return (
        <ul key={i} className="list-disc list-inside space-y-1 my-1 pl-1">
          {lines.map((line, j) => (
            <li key={j}>{renderInline(line.slice(2))}</li>
          ))}
        </ul>
      );
    }

    return <p key={i} className="mb-2 last:mb-0">{renderInline(para)}</p>;
  });
};

export default function AICoach() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const topic = new URLSearchParams(location.search).get('topic') || 'general';

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [contextData, setContextData] = useState<ContextData | null>(null);
  const [systemContext, setSystemContext] = useState('');
  const [messageCount, setMessageCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const DAILY_LIMIT = 10;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Build context string from fetched data
  const buildContext = (data: ContextData) => {
    const parts: string[] = [];

    if (data.profile) {
      const age = calculateAge(data.profile.dob);
      const p = data.profile;
      const profileParts = [
        p.name && `Name: ${p.name}`,
        age && `Age: ${age}`,
        p.gender && `Gender: ${p.gender}`,
        p.heightCm && `Height: ${p.heightCm} cm`,
        p.foodPreference && `Diet: ${p.foodPreference}`,
        p.allergies && `Allergies: ${p.allergies}`,
        p.activityLevel && `Activity: ${p.activityLevel}`,
        p.primaryGoal && `Goal: ${p.primaryGoal}`,
        p.chronicConditions?.length && `Conditions: ${p.chronicConditions.join(', ')}`,
      ].filter(Boolean);
      if (profileParts.length) parts.push('PROFILE:\n' + profileParts.join('\n'));
    }

    if (data.bodyStats.length > 0) {
      const cur = data.bodyStats[0];
      const prev = data.bodyStats.length > 1 ? data.bodyStats[1] : null;
      const bodyParts = [
        cur.weightKg != null && `Weight: ${cur.weightKg} kg`,
        cur.pbf != null && `PBF: ${cur.pbf}%`,
        cur.smm != null && `SMM: ${cur.smm} kg`,
        prev?.weightKg != null && cur.weightKg != null && `Weight change: ${(cur.weightKg - prev.weightKg).toFixed(1)} kg`,
        prev?.pbf != null && cur.pbf != null && `PBF change: ${(cur.pbf - prev.pbf).toFixed(1)}%`,
      ].filter(Boolean);
      if (bodyParts.length) parts.push('BODY STATS (latest):\n' + bodyParts.join('\n'));
    }

    if (data.workoutSessions.length > 0) {
      const last10 = data.workoutSessions.slice(0, 10);
      parts.push('LAST 10 WORKOUTS:\n' + last10.map((s: any) => `- ${s.date}: ${s.template}`).join('\n'));
    }

    if (data.nutritionLogs.length > 0) {
      const sumMacros = (items: any[]) => items.reduce((acc, it) => {
        const q = it.quantity || 1;
        return {
          calories: acc.calories + (it.calories || 0) * q,
          protein: acc.protein + (it.protein || 0) * q,
          carbs: acc.carbs + (it.carbs || 0) * q,
          fat: acc.fat + (it.fat || 0) * q,
          fibre: acc.fibre + (it.fibre || 0) * q,
        };
      }, { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 });

      const today = todayLocalStr();
      const todayLog = data.nutritionLogs.find((l: any) => l.date === today);
      if (todayLog && todayLog.items?.length > 0) {
        const m = sumMacros(todayLog.items);
        parts.push(`TODAY'S NUTRITION (${today}):\n${m.calories} kcal, ${m.protein}g protein, ${m.carbs}g carbs, ${m.fat}g fat, ${m.fibre}g fibre\nMeals: ${todayLog.items.map((it: any) => it.name).join(', ')}`);
      } else {
        parts.push(`TODAY'S NUTRITION (${today}):\nNo meals logged yet today.`);
      }

      const recentLogs = data.nutritionLogs.filter((l: any) => l.date !== today && l.items?.length > 0).slice(0, 9);
      if (recentLogs.length > 0) {
        parts.push('RECENT NUTRITION:\n' + recentLogs.map((l: any) => {
          const m = sumMacros(l.items);
          return `- ${l.date}: ${m.calories} kcal, ${m.protein}g protein`;
        }).join('\n'));
      }
    }

    if (data.tests.length > 0) {
      // Use tests collection (new) — includes latest reading per test
      const testsWithReadings = data.tests.filter((t: any) => t.latestReading);
      if (testsWithReadings.length > 0) {
        const outOfRange = testsWithReadings.filter((t: any) => {
          const v = t.latestReading?.value;
          const low = t.referenceRangeLow;
          const high = t.referenceRangeHigh;
          if (v == null || (low == null && high == null)) return false;
          return (low != null && v < low) || (high != null && v > high);
        });
        const labLines = testsWithReadings.slice(0, 10).map((t: any) =>
          `- ${t.name}: ${t.latestReading.value} ${t.unit}`
        ).join('\n');
        if (outOfRange.length > 0) {
          parts.push(`LABS (${outOfRange.length} out of range):\n` +
            outOfRange.map((t: any) => `- ${t.name}: ${t.latestReading.value} ${t.unit}`).join('\n'));
        } else {
          parts.push(`LABS (all in range):\n${labLines}`);
        }
      }
    }

    if (data.tests.length > 0) {
      const upcoming = data.tests.filter((t: any) => t.nextDueDate);
      if (upcoming.length > 0) {
        parts.push(`UPCOMING TESTS:\n${upcoming.map((t: any) => `- ${t.testName}: ${t.nextDueDate}`).join('\n')}`);
      }
    }

    return parts.join('\n\n');
  };

  // Fetch all context data
  useEffect(() => {
    if (!user) return;

    const fetchContext = async () => {
      try {
        const profileSnap = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'));
        const profile = profileSnap.exists() ? profileSnap.data() : null;

        const bodyQuery = query(
          collection(db, 'users', user.uid, 'bodyComp'),
          orderBy('date', 'desc'),
          limit(3)
        );
        const bodySnap = await getDocs(bodyQuery);
        const bodyStats = bodySnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const labsQuery = query(
          collection(db, 'users', user.uid, 'labs'),
          orderBy('date', 'desc'),
          limit(5)
        );
        const labsSnap = await getDocs(labsQuery);
        const labResults = labsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const testsQuery = query(
          collection(db, 'users', user.uid, 'tests'),
          orderBy('nextDueDate', 'asc')
        );
        const testsSnap = await getDocs(testsQuery);
        const tests = testsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const sessionsQuery = query(
          collection(db, 'users', user.uid, 'workoutSessions'),
          orderBy('date', 'desc'),
          limit(10)
        );
        const sessionsSnap = await getDocs(sessionsQuery);
        const workoutSessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        let nutritionLogs: any[] = [];
        try {
          // nutritionLogs docs are keyed by local YYYY-MM-DD date string (no auto-increment id),
          // so a collection query ordered by documentId() needs a composite index Firestore
          // doesn't provision by default. Fetch the last 10 calendar days directly by id instead —
          // same pattern as Home.tsx's fetchWeeklyNutrition.
          const last10Dates = Array.from({ length: 10 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            return toLocalDateStr(d);
          });
          const nutritionDocs = await Promise.all(
            last10Dates.map(dateStr => getDoc(doc(db, 'users', user.uid, 'nutritionLogs', dateStr)))
          );
          nutritionLogs = nutritionDocs
            .filter(snap => snap.exists())
            .map(snap => ({ id: snap.id, ...snap.data() }));
        } catch (e) {
          console.error('Error loading nutrition logs:', e);
        }

        const data: ContextData = { profile, bodyStats, labResults, tests, workoutSessions, nutritionLogs };
        setContextData(data);
        const ctx = buildContext(data);
        setSystemContext(ctx);

        // Load daily usage count
        try {
          const usageSnap = await getDoc(doc(db, 'users', user.uid, 'aiUsage', 'coach'));
          const today = new Date().toISOString().split('T')[0];
          if (usageSnap.exists() && usageSnap.data().date === today) {
            setMessageCount(usageSnap.data().count || 0);
          } else {
            setMessageCount(0);
          }
        } catch (_) {
          setMessageCount(0);
        }

        setContextLoaded(true);
      } catch (e) {
        console.error('Error loading context:', e);
        setContextLoaded(true);
      }
    };

    fetchContext();
  }, [user]);

  // Generate opening message after context loads
  useEffect(() => {
    if (!contextLoaded) return;
    if (messages.length > 0) return;

    const name = contextData?.profile?.name?.split(' ')[0] || 'there';

    if (!topic || topic === 'general') {
      setMessages([{
        role: 'assistant',
        content: `Hey ${name}! I have your full health context loaded. What would you like to work on today?`,
      }]);
      return;
    }

    // Topic-specific opener via API
    const openerPrompts: Record<string, string> = {
      workout: 'Based on the user\'s workout history and body stats, give a 2-3 sentence personalized workout insight and ask what they\'d like help with. Be specific about their data.',
      food: 'Based on the user\'s diet preference, body stats and goals, give a 2-3 sentence personalized food insight and ask what they\'d like help with.',
      labs: 'Based on the user\'s lab results (or lack thereof), give a 2-3 sentence insight and ask what they\'d like to know more about.',
      body: 'Based on the user\'s body composition trend (weight, body fat %, SMM), give a 2-3 sentence personalized insight and ask what they\'d like help with. Be specific about their data.',
    };

    const generateOpener = async () => {
      setLoading(true);
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 400,
            system: `You are a personal health coach. ${openerPrompts[topic] || openerPrompts.general}

USER CONTEXT:
${systemContext}`,
            messages: [],
          }),
        });
        if (response.ok) {
          const data = await response.json();
          const text = data.content?.[0]?.text || 'How can I help you today?';
          setMessages([{ role: 'assistant', content: text }]);
          // increment opener count
          const newCount = messageCount + 1;
          setMessageCount(newCount);
          if (user) {
            try {
              await setDoc(doc(db, 'users', user.uid, 'aiUsage', 'coach'), {
                date: new Date().toISOString().split('T')[0],
                count: newCount,
              });
            } catch (_) {}
          }
        } else {
          setMessages([{ role: 'assistant', content: `How can I help you today?` }]);
        }
      } catch (e) {
        setMessages([{ role: 'assistant', content: `How can I help you today?` }]);
      } finally {
        setLoading(false);
      }
    };

    if (systemContext) {
      generateOpener();
    }
  }, [contextLoaded, systemContext, topic, messages.length, contextData]);

  const detectWorkoutSuggestion = (text: string): { name: string; sets: number; reps: number }[] | null => {
    const lines = text.split('\n');
    const exercises: { name: string; sets: number; reps: number }[] = [];

    for (const line of lines) {
      // Match patterns like: "Squats 4×8", "Bench Press: 3 sets of 10", "Deadlift - 4x8"
      const pattern1 = /^(?:\d+\.\s*)?(.+?)\s*[\-–:]\s*(\d+)\s*(?:sets?\s*(?:of|×|x)?\s*)?(\d+)/i;
      const pattern2 = /^(?:\d+\.\s*)?(.+?)\s+(\d+)\s*(?:×|x)\s*(\d+)/i;
      const match = line.match(pattern1) || line.match(pattern2);
      if (match) {
        const name = match[1].trim().replace(/^[-–\d\.\s]+/, '').trim();
        const sets = parseInt(match[2]) || 3;
        const reps = parseInt(match[3]) || 8;
        if (name.length > 2) exercises.push({ name, sets, reps });
      }
    }

    return exercises.length >= 2 ? exercises : null;
  };

  const loadWorkoutToDraft = async (exercises: { name: string; sets: number; reps: number }[]) => {
    if (!user) return;
    try {
      const draftExercises = exercises.map(ex => ({
        name: ex.name,
        hasWeight: true,
        sets: Array.from({ length: ex.sets }, () => ({ reps: String(ex.reps), weight: '' })),
      }));
      await setDoc(doc(db, 'users', user.uid, 'draftSessions', 'aiSuggested'), {
        type: 'AI Suggested',
        aiGenerated: true,
        exercises: draftExercises,
        sessionDate: new Date().toISOString().split('T')[0],
        savedAt: new Date().toISOString(),
      });
      navigate('/workout-session', { state: { template: 'aisuggested', aiWorkout: true } });
    } catch (e) {
      console.error('Error saving draft:', e);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');

    if (messageCount >= DAILY_LIMIT) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "You've reached your 10 message daily limit. Come back tomorrow!",
      }]);
      return;
    }

    setLoading(true);

    try {
      const conversationHistory = updatedMessages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          system: `You are a personal health coach for this user. Always use their actual data in responses. Be concise (max 3-4 sentences). Never give medical diagnoses. Friendly, direct tone.

When the user wants to log something, suggest the right page naturally:
- Log food / meal / calories → suggest going to Food page
- Log workout / exercise / run → suggest going to Workouts page
- Log weight / body stats → suggest going to Body page
- Upload lab report / blood test → suggest going to Labs page
- Log water / steps / sleep → suggest going to Home page (wellness section)
Say something like "Head to the Food page to log that — tap Food in the nav bar." Keep it brief.

TEST PACKAGE COVERAGE: If the user asks whether a lab test package suits their needs but hasn't named the package or listed its tests yet, ask them to share the package name, paste the list of tests it includes, or describe it — give 2-3 popular examples (e.g. Dr Lal PathLabs Aarogyam, Thyrocare Aarogyam C, 1mg Full Body Checkup) to make replying easy. Once they give you the package's tests, compare it against their tracked tests and upcoming/overdue tests from their context, and clearly state what's covered and what's missing.

GOAL UPDATES: If — and only if — you are recommending the user change one of their daily targets (calorie, protein, carb, fat, steps, sleep, or water goal), append a structured block at the very end of your reply, after all the text you want shown to the user:
<<<GOAL_UPDATE>>>{"calorieGoal":2000,"proteinGoal":140}<<<END_GOAL_UPDATE>>>
Only include keys for goals you are actually recommending changing (valid keys: calorieGoal, proteinGoal, carbGoal, fatGoal, stepsGoal, sleepGoal, waterGoal). Never include this block when you are simply restating today's logged intake or making general commentary — it must only appear when you are proposing a new target.

USER CONTEXT:
${systemContext}`,
          messages: conversationHistory,
        }),
      });

      if (!response.ok) throw new Error('AI request failed');
      const data = await response.json();
      const rawText = data.content?.[0]?.text || 'Sorry, I had trouble responding. Try again?';

      // Structured goal-update block: the model emits this only when it's
      // recommending a changed target, never when restating logged intake.
      const goalUpdateMatch = rawText.match(/<<<GOAL_UPDATE>>>([\s\S]*?)<<<END_GOAL_UPDATE>>>/);
      const aiText = goalUpdateMatch
        ? rawText.slice(0, goalUpdateMatch.index).trim()
        : rawText;

      const workoutExercises = detectWorkoutSuggestion(aiText);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: aiText,
        showWorkoutLoad: !!workoutExercises,
      }]);

      if (user && goalUpdateMatch) {
        try {
          const partialGoals = JSON.parse(goalUpdateMatch[1]) as Record<string, number>;
          if (partialGoals && Object.keys(partialGoals).length > 0) {
            await saveGoals(user.uid, partialGoals, 'ai_coach_recommendation');
            console.log('[Goals] AI coach recommended goal update, saved:', partialGoals);
          }
        } catch (_) { /* silent */ }
      }

      // Full recalculation if user was asking about goals/macros/nutrition targets
      if (user) {
        const goalKeywords = /goals?|targets?|macros?|how much protein|what should i eat|calories i need|nutrition plan/i;
        if (goalKeywords.test(text)) {
          calculateGoalsWithAI(user.uid, { trigger: 'ai_coach_conversation' }).catch(() => {});
        }
      }

      // increment count on successful response
      const newCount = messageCount + 1;
      setMessageCount(newCount);
      if (user) {
        try {
          await setDoc(doc(db, 'users', user.uid, 'aiUsage', 'coach'), {
            date: new Date().toISOString().split('T')[0],
            count: newCount,
          });
        } catch (_) {}
      }
    } catch (e) {
      console.error('Chat error:', e);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleChipClick = (chipText: string) => {
    sendMessage(chipText);
  };

  const hasUserSent = messages.some(m => m.role === 'user');
  const chips = quickChips[topic] || quickChips.general;

  const contextChips: string[] = [];
  if (contextData && contextData.profile) contextChips.push('Profile');
  if (contextData && contextData.bodyStats.length > 0) contextChips.push('Body stats');
  if (contextData && contextData.tests.length > 0) contextChips.push(`${contextData.tests.length} tests tracked`);
  if (contextData && contextData.workoutSessions.length > 0) contextChips.push(`Last ${contextData.workoutSessions.length} workouts`);
  if (contextData && contextData.nutritionLogs.length > 0) contextChips.push(`Last ${contextData.nutritionLogs.length} days food`);

  return (
    <div className="fixed inset-0 bg-slate-950 text-white z-50 flex flex-col" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-base font-semibold">AI Coach</h1>
        </div>
        {contextLoaded && (
          <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full">
            ✦ Context loaded
          </span>
        )}
      </div>

      {/* Context bar */}
      {contextChips.length > 0 && (
        <div className="bg-emerald-500/5 border-b border-emerald-500/10 px-4 py-2 flex-shrink-0">
          <div className="flex flex-wrap gap-1">
            {contextChips.map((chip, i) => (
              <span key={i} className="bg-emerald-500/10 text-emerald-400 text-xs px-2 py-0.5 rounded-full">
                {chip}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-emerald-500 text-white rounded-2xl rounded-tr-sm ml-auto'
                  : 'bg-slate-800 text-slate-200 rounded-2xl rounded-tl-sm'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div>{renderMarkdown(msg.content)}</div>
              ) : (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              )}
              {msg.showWorkoutLoad && (
                <button
                  onClick={() => {
                    const exercises = detectWorkoutSuggestion(msg.content);
                    if (exercises) loadWorkoutToDraft(exercises);
                  }}
                  className="bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-lg mt-2 inline-block hover:bg-emerald-600 transition-colors"
                >
                  ⚡ Load to Workouts
                </button>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Quick reply chips */}
        {!hasUserSent && !loading && messages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 pt-2">
            {chips.map((chip, i) => (
              <button
                key={i}
                onClick={() => handleChipClick(chip)}
                className="bg-slate-800 border border-slate-700 rounded-full px-3 py-1.5 text-xs text-slate-300 whitespace-nowrap hover:border-emerald-500 hover:text-emerald-400 transition-colors flex-shrink-0"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="bg-slate-950 border-t border-slate-800 px-4 pt-3 pb-6 flex-shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder={messageCount >= DAILY_LIMIT ? "Daily limit reached · come back tomorrow" : "Ask anything…"}
            disabled={loading || messageCount >= DAILY_LIMIT}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-full px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
          />
          <span className={`text-xs whitespace-nowrap flex-shrink-0 ${
            messageCount >= DAILY_LIMIT ? 'text-red-400' : messageCount >= 8 ? 'text-amber-400' : 'text-slate-500'
          }`}>
            {messageCount}/{DAILY_LIMIT}
          </span>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading || messageCount >= DAILY_LIMIT}
            className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center text-white disabled:bg-slate-700 disabled:text-slate-500 hover:bg-emerald-600 transition-colors flex-shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
