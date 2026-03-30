/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { useState, useEffect, useMemo, Component } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  User
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  arrayUnion, 
  onSnapshot, 
  collection, 
  query, 
  where,
  Timestamp,
  getDocs,
  orderBy,
  limit,
  addDoc,
  deleteDoc,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db, firebaseConfig } from './firebase';
import { initializeApp } from 'firebase/app';
import { getAuth as getSecondaryAuth } from 'firebase/auth';
import { BEE_STUDENTS } from './data/bee_students';
import { 
  LogOut, 
  User as UserIcon, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertTriangle, 
  TrendingUp, 
  Users, 
  Search, 
  Download, 
  Settings, 
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Menu,
  X,
  LayoutDashboard,
  FileText,
  UsersRound,
  Bell,
  CalendarDays,
  Plus,
  Trash2,
  Edit,
  Save,
  Trash,
  MessageSquare,
  RefreshCw,
  Upload,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CLASS_SCHEDULE, UserProfile, AttendanceRecord, ClassStats, LeaveRequest, NetworkConfig } from './types';

// --- UTILS ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends (React.Component as any) {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error && parsed.operationType) {
          errorMessage = `Firestore ${parsed.operationType} error: ${parsed.error}. Path: ${parsed.path}`;
        }
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-red-50">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-red-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle className="w-8 h-8" />
              <h2 className="text-xl font-bold">Application Error</h2>
            </div>
            <p className="text-gray-600 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const formatRollNumber = (email: string) => {
  const match = email.match(/bee_(\d{4})(\d{3})@iiitm\.ac\.in/);
  if (!match) return null;
  return `${match[1]}BEE-${match[2]}`;
};

const getTodayDateStr = () => new Date().toISOString().split('T')[0];

const getDayName = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'long' });

const isClassTime = () => {
  const now = new Date();
  const day = now.getDay();
  if (!CLASS_SCHEDULE.classDays.includes(day)) return { active: false, reason: "No class today" };

  const [startH, startM] = CLASS_SCHEDULE.classSlot.startTime.split(':').map(Number);
  const [endH, endM] = CLASS_SCHEDULE.classSlot.endTime.split(':').map(Number);
  
  const startTime = new Date(now);
  startTime.setHours(startH, startM, 0, 0);
  
  const endTime = new Date(now);
  endTime.setHours(endH, endM, 0, 0);

  const graceMs = CLASS_SCHEDULE.classSlot.graceMinutes * 60 * 1000;
  const startWindow = startTime.getTime() - graceMs;
  const endWindow = endTime.getTime() + graceMs;
  const currentTime = now.getTime();

  if (currentTime < startWindow) {
    const diff = Math.floor((startWindow - currentTime) / 1000 / 60);
    return { active: false, reason: `Class starts in ${diff} mins`, countdown: diff };
  }
  if (currentTime > endWindow) return { active: false, reason: "Attendance window closed" };

  return { active: true, reason: "Mark Attendance Now!" };
};

// --- COMPONENTS ---

const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error' | 'info', onClose: () => void }) => (
  <motion.div
    initial={{ opacity: 0, y: -20, x: 20 }}
    animate={{ opacity: 1, y: 0, x: 0 }}
    exit={{ opacity: 0, x: 50 }}
    className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center gap-3 min-w-[300px] ${
      type === 'success' ? 'bg-emerald-500 text-white' : 
      type === 'error' ? 'bg-rose-500 text-white' : 
      'bg-blue-500 text-white'
    }`}
  >
    {type === 'success' ? <CheckCircle size={20} /> : type === 'error' ? <XCircle size={20} /> : <Clock size={20} />}
    <span className="font-medium">{message}</span>
    <button onClick={onClose} className="ml-auto hover:opacity-70"><X size={18} /></button>
  </motion.div>
);

const Loader = ({ onLogout, onRetry, user }: { onLogout?: () => void, onRetry?: () => void, user?: User | null }) => (
  <div className="flex items-center justify-center min-h-screen bg-slate-900 flex-col gap-6">
    <div className="relative w-20 h-20">
      <div className="absolute top-0 left-0 w-full h-full border-4 border-slate-700 rounded-full"></div>
      <div className="absolute top-0 left-0 w-full h-full border-4 border-indigo-500 rounded-full border-t-transparent animate-spin"></div>
    </div>
    <div className="flex flex-col items-center gap-4">
      {onRetry && (
        <div className="flex flex-col gap-2">
          <button 
            onClick={onRetry}
            className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-indigo-500 transition-all shadow-lg"
          >
            Retry Profile Load
          </button>
          <button 
            onClick={() => window.location.reload()}
            className="text-indigo-200/30 hover:text-white text-xs font-medium transition-all"
          >
            Refresh Page
          </button>
          <button 
            onClick={async () => {
              try {
                console.log("Checking Firestore connection...");
                const testDoc = await getDoc(doc(db, 'metadata', 'classStats'));
                console.log("Firestore connection OK. Document exists:", testDoc.exists());
                alert("Firestore connection OK. Check console for details.");
              } catch (err: any) {
                console.error("Firestore connection FAILED:", err);
                alert("Firestore connection FAILED: " + err.message);
              }
            }}
            className="text-indigo-200/20 hover:text-white text-[8px] font-medium transition-all mt-4"
          >
            Debug: Check Connection
          </button>
        </div>
      )}
      {user && (
        <div className="text-center mt-4 p-4 bg-white/5 rounded-2xl border border-white/10">
          <p className="text-[10px] text-indigo-200/30 uppercase tracking-widest mb-1">Logged in as</p>
          <p className="text-xs text-indigo-200/60 font-medium">{user.email}</p>
          <p className="text-[8px] text-indigo-200/20 font-mono mt-1">UID: {user.uid}</p>
          <p className="text-[8px] text-indigo-200/20 font-mono mt-1">Project: {auth.app.options.projectId}</p>
        </div>
      )}
      {onLogout && (
        <button 
          onClick={onLogout}
          className="text-indigo-200/50 hover:text-white text-sm font-medium transition-all"
        >
          Logout
        </button>
      )}
    </div>
  </div>
);

const NetworkRestricted = ({ userIp, onLogout }: { userIp: string | null, onLogout: () => void }) => (
  <div className="min-h-screen bg-[#0a0b1e] flex items-center justify-center p-6 text-white font-sans">
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-md w-full glass-dark p-10 rounded-[2.5rem] border border-white/10 text-center"
    >
      <div className="w-20 h-20 bg-rose-500/20 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-rose-500/30">
        <AlertTriangle size={40} className="text-rose-500" />
      </div>
      <h1 className="text-3xl font-display font-bold mb-4 tracking-tight">Access Restricted</h1>
      <p className="text-indigo-200/60 mb-8 leading-relaxed">
        This application is only accessible when connected to the 
        <span className="text-indigo-300 font-semibold"> College WiFi</span> in the lecture hall.
      </p>
      
      <div className="bg-white/5 rounded-2xl p-6 mb-8 border border-white/10">
        <p className="text-[10px] text-indigo-200/30 uppercase tracking-widest mb-2 font-bold">Your Current IP</p>
        <p className="text-xl font-mono text-indigo-300">{userIp || 'Detecting...'}</p>
      </div>

      <div className="space-y-4">
        <button 
          onClick={() => window.location.reload()}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl shadow-xl shadow-indigo-900/40 transition-all flex items-center justify-center gap-2"
        >
          <RefreshCw size={20} />
          Retry Connection
        </button>
        <button 
          onClick={onLogout}
          className="w-full bg-white/5 hover:bg-white/10 text-indigo-200/70 font-medium py-3 rounded-xl transition-all"
        >
          Logout
        </button>
      </div>
      
      <p className="mt-8 text-[10px] text-indigo-200/20 uppercase tracking-[0.2em] font-medium">
        IIITM Attendance Security System
      </p>
    </motion.div>
  </div>
);

// --- MAIN APP ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<{ id: number, message: string, type: 'success' | 'error' | 'info' }[]>([]);
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [adminTab, setAdminTab] = useState<'dashboard' | 'date' | 'students' | 'alerts' | 'schedule' | 'network'>('dashboard');
  const [userIp, setUserIp] = useState<string | null>(null);
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig | null>(null);
  const [isNetworkAuthorized, setIsNetworkAuthorized] = useState(true);
  const [isIpLoading, setIsIpLoading] = useState(true);

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const loadProfile = async (firebaseUser: User) => {
    console.log("Attempting to load profile for UID:", firebaseUser.uid, "Email:", firebaseUser.email);
    try {
      // 1. Check hardcoded admin first (case-insensitive)
      if (firebaseUser.email?.toLowerCase() === "hgskalsi@gmail.com") {
        console.log("Super Admin detected");
        setProfile({
          uid: firebaseUser.uid,
          name: "Super Admin",
          email: firebaseUser.email!,
          rollNumber: 'ADMIN',
          branch: 'BEE',
          joinedAt: Timestamp.now(),
          role: 'admin'
        });
        return;
      }

      // 2. Check if in admins collection
      const emailKey = firebaseUser.email?.toLowerCase().replace(/\./g, '_') || '';
      const rawEmail = firebaseUser.email?.toLowerCase() || '';
      console.log("Checking admins collection for keys:", emailKey, "and", rawEmail);
      
      let adminDoc = await getDoc(doc(db, 'admins', emailKey));
      if (!adminDoc.exists() && rawEmail !== emailKey) {
        adminDoc = await getDoc(doc(db, 'admins', rawEmail));
      }

      if (adminDoc.exists()) {
        console.log("Admin profile found in 'admins' collection");
        setProfile({
          uid: firebaseUser.uid,
          name: adminDoc.data().name,
          email: firebaseUser.email!,
          rollNumber: 'ADMIN',
          branch: 'BEE',
          joinedAt: Timestamp.now(),
          role: 'admin'
        });
        return;
      }

      // 3. Check if in users collection
      console.log("Checking users collection for UID:", firebaseUser.uid);
      let userDoc;
      try {
        userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
      }
      
      // Fallback 1: Check if email is used as Document ID
      if (userDoc && !userDoc.exists() && firebaseUser.email) {
        console.log("UID not found, checking if email is used as Document ID:", firebaseUser.email);
        try {
          userDoc = await getDoc(doc(db, 'users', firebaseUser.email));
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.email}`);
        }
      }

      if (userDoc && userDoc.exists()) {
        console.log("User profile found in 'users' collection");
        const data = userDoc.data() as UserProfile;
        setProfile({ ...data, role: data.role || 'student', uid: firebaseUser.uid });
      } else {
        console.warn(`No profile found in 'users' collection for UID: ${firebaseUser.uid} or Email ID. Trying query search by email: ${firebaseUser.email}`);
        
        // Fallback 2: search by email (case-insensitive check)
        const userEmail = firebaseUser.email?.toLowerCase() || '';
        const q = query(collection(db, 'users'), where('email', 'in', [userEmail, firebaseUser.email || '']));
        const querySnap = await getDocs(q);
        
        if (!querySnap.empty) {
          const foundDoc = querySnap.docs[0];
          console.log("Fallback FOUND user by email query. Document ID:", foundDoc.id, "Expected UID:", firebaseUser.uid);
          const data = foundDoc.data() as UserProfile;
          setProfile({ ...data, role: data.role || 'student', uid: firebaseUser.uid });
          addToast("Profile found by email query", "info");
        } else {
          console.error("User profile NOT found even by email search");
          const currentProject = auth.app.options.projectId;
          addToast(`Profile not found in project "${currentProject}". Please ensure you registered in this specific project.`, "error");
        }
      }
    } catch (err: any) {
      console.error("Error loading profile:", err);
      addToast(`Failed to load profile: ${err.message || 'Unknown error'}`, "error");
    }
  };

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'metadata', 'classStats'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        setUser(firebaseUser);
        await loadProfile(firebaseUser);
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });

    // Network Restriction Logic
    const fetchIp = async () => {
      setIsIpLoading(true);
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        setUserIp(data.ip);
        console.log("User IP fetched:", data.ip);
      } catch (err) {
        console.error("Failed to fetch IP:", err);
        addToast("Failed to detect your network IP. Please refresh.", "error");
      } finally {
        setIsIpLoading(false);
      }
    };
    fetchIp();

    const unsubNetwork = onSnapshot(doc(db, 'metadata', 'networkConfig'), (doc) => {
      if (doc.exists()) {
        const data = doc.data() as NetworkConfig;
        console.log("Network config updated:", data);
        setNetworkConfig(data);
      }
    }, (error) => {
      console.error("Network config listener error:", error);
    });

    return () => {
      unsubscribe();
      unsubNetwork();
    };
  }, []);

  useEffect(() => {
    // If restriction is not enabled, everyone is authorized
    if (networkConfig && !networkConfig.restrictionEnabled) {
      setIsNetworkAuthorized(true);
      return;
    }

    // If restriction is enabled, we need the user's IP and profile to decide
    if (networkConfig?.restrictionEnabled) {
      // Admins always bypass network restriction
      if (profile?.role === 'admin') {
        setIsNetworkAuthorized(true);
        return;
      }

      // If we are still loading the IP, we don't authorize yet
      if (isIpLoading || !userIp) {
        // We stay authorized for a brief moment while loading to avoid flicker,
        // but the render logic will handle the final state.
        // Actually, it's safer to default to authorized=true if we are still loading
        // but only if we haven't confirmed a mismatch.
        return;
      }
      
      const isAuthorized = userIp === networkConfig.allowedIp;
      console.log(`Network Check: User IP (${userIp}) vs Allowed IP (${networkConfig.allowedIp}) -> ${isAuthorized ? 'MATCH' : 'MISMATCH'}`);
      setIsNetworkAuthorized(isAuthorized);
    } else {
      // Default to authorized if no config or restriction disabled
      setIsNetworkAuthorized(true);
    }
  }, [networkConfig, userIp, profile, isIpLoading]);

  const handleLogout = async () => {
    await signOut(auth);
    setProfile(null);
    addToast("Logged out successfully", "success");
  };

  const toggleNetworkRestriction = async () => {
    try {
      const docRef = doc(db, 'metadata', 'networkConfig');
      const newState = !networkConfig?.restrictionEnabled;
      await setDoc(docRef, { 
        restrictionEnabled: newState,
        lastUpdated: Timestamp.now()
      }, { merge: true });
      addToast(`Network restriction ${newState ? 'enabled' : 'disabled'}`, "success");
    } catch (err: any) {
      addToast("Failed to toggle restriction: " + err.message, "error");
    }
  };

  const updateNetworkConfig = async (newIp: string) => {
    try {
      const docRef = doc(db, 'metadata', 'networkConfig');
      await setDoc(docRef, {
        allowedIp: newIp,
        lastUpdated: Timestamp.now()
      }, { merge: true });
      addToast("Network configuration updated", "success");
    } catch (err: any) {
      addToast("Failed to update network: " + err.message, "error");
    }
  };

  if (loading) return <Loader />;

  if (!isNetworkAuthorized) {
    return <NetworkRestricted userIp={userIp} onLogout={handleLogout} />;
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen font-sans">
        <AnimatePresence>
          {toasts.map(t => (
            <Toast key={t.id} {...t} onClose={() => setToasts(prev => prev.filter(toast => toast.id !== t.id))} />
          ))}
        </AnimatePresence>

        {!user ? (
          <AuthScreen activeTab={activeTab} setActiveTab={setActiveTab} addToast={addToast} />
        ) : !profile ? (
          <Loader onLogout={handleLogout} onRetry={() => user && loadProfile(user)} user={user} />
        ) : profile.role === 'admin' ? (
          <AdminPortal 
            profile={profile} 
            handleLogout={handleLogout} 
            activeTab={adminTab} 
            setActiveTab={setAdminTab} 
            addToast={addToast} 
            userIp={userIp}
            networkConfig={networkConfig}
            toggleNetworkRestriction={toggleNetworkRestriction}
            updateNetworkConfig={updateNetworkConfig}
          />
        ) : (
          <StudentPortal profile={profile} handleLogout={handleLogout} addToast={addToast} />
        )}
      </div>
    </ErrorBoundary>
  );
}

// --- AUTH SCREEN ---

const AuthScreen = ({ activeTab, setActiveTab, addToast }: any) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    rollNumber: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);

  const validateStudent = () => {
    const emailPattern = /^bee_(\d{4})(\d{3})@iiitm\.ac\.in$/;
    const rollPattern = /^(\d{4})BEE-(\d{3})$/;
    
    const emailMatch = formData.email.match(emailPattern);
    const rollMatch = formData.rollNumber.match(rollPattern);

    if (!emailMatch) return "Invalid email format. Use bee_YYYYXXX@iiitm.ac.in";
    if (!rollMatch) return "Invalid roll number format. Use YYYYBEE-XXX";
    
    if (emailMatch[1] !== rollMatch[1]) return "Year in email and roll number must match";
    if (emailMatch[2] !== rollMatch[2]) return "Suffix in email and roll number must match";
    
    if (formData.password.length < 6) return "Password must be at least 6 characters";
    if (formData.password !== formData.confirmPassword) return "Passwords do not match";
    
    return null;
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (activeTab === 'register') {
        const error = validateStudent();
        if (error) {
          addToast(error, "error");
          setLoading(false);
          return;
        }
        const { user: firebaseUser } = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
        const userProfile: UserProfile = {
          uid: firebaseUser.uid,
          name: formData.name,
          email: formData.email.toLowerCase(),
          rollNumber: formData.rollNumber.toUpperCase(),
          branch: 'BEE',
          joinedAt: Timestamp.now()
        };
        await setDoc(doc(db, 'users', firebaseUser.uid), userProfile);
        addToast("Registration successful!", "success");
      } else {
        await signInWithEmailAndPassword(auth, formData.email, formData.password);
        addToast("Welcome back!", "success");
      }
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        addToast("Login method disabled. Please enable Email/Password in Firebase Console.", "error");
      } else {
        addToast(err.message, "error");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="student-bg min-h-screen flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-dark w-full max-w-md p-8 rounded-3xl"
      >
        <div className="text-center mb-8">
          <h1 className="text-3xl font-display font-bold text-white mb-2 tracking-tight">BEE Attendance</h1>
          <p className="text-indigo-200/70 text-sm">Indian Institute of Information Technology & Management</p>
        </div>

        <div className="flex bg-white/5 p-1 rounded-xl mb-8">
          <button 
            onClick={() => setActiveTab('login')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'login' ? 'bg-indigo-600 text-white shadow-lg' : 'text-indigo-200/50 hover:text-white'}`}
          >
            Login
          </button>
          <button 
            onClick={() => setActiveTab('register')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'register' ? 'bg-indigo-600 text-white shadow-lg' : 'text-indigo-200/50 hover:text-white'}`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <AnimatePresence mode="wait">
            {activeTab === 'register' && (
              <motion.div
                key="register-fields"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4 overflow-hidden"
              >
                <input 
                  type="text" 
                  placeholder="Full Name" 
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500 transition-all"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
                <input 
                  type="text" 
                  placeholder="Roll Number (e.g. 2025BEE-023)" 
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500 transition-all"
                  value={formData.rollNumber}
                  onChange={e => setFormData({...formData, rollNumber: e.target.value})}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <input 
            type="email" 
            placeholder="College Email" 
            required
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500 transition-all"
            value={formData.email}
            onChange={e => setFormData({...formData, email: e.target.value})}
          />
          <input 
            type="password" 
            placeholder="Password" 
            required
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500 transition-all"
            value={formData.password}
            onChange={e => setFormData({...formData, password: e.target.value})}
          />

          {activeTab === 'register' && (
            <input 
              type="password" 
              placeholder="Confirm Password" 
              required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500 transition-all"
              value={formData.confirmPassword}
              onChange={e => setFormData({...formData, confirmPassword: e.target.value})}
            />
          )}

          <button 
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl shadow-xl shadow-indigo-900/20 transition-all flex items-center justify-center gap-2"
          >
            {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : (activeTab === 'login' ? 'Login' : 'Create Account')}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-indigo-200/40">
          {activeTab === 'login' ? "Email format: bee_2025023@iiitm.ac.in" : "Only @iiitm.ac.in emails are allowed"}
        </p>
      </motion.div>
    </div>
  );
};

// --- STUDENT PORTAL ---

const StudentPortal = ({ profile, handleLogout, addToast }: { profile: UserProfile, handleLogout: () => void, addToast: any }) => {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<ClassStats | null>(null);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [marking, setMarking] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [hideLogs, setHideLogs] = useState(false);
  const [leaveDate, setLeaveDate] = useState(getTodayDateStr());
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);

  useEffect(() => {
    const today = getTodayDateStr();
    const unsubToday = onSnapshot(doc(db, 'attendance', today), (doc) => {
      if (doc.exists()) setTodayRecord(doc.data() as AttendanceRecord);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `attendance/${today}`);
    });

    const unsubStats = onSnapshot(doc(db, 'metadata', 'classStats'), (doc) => {
      if (doc.exists()) {
        const data = doc.data() as ClassStats;
        console.log("Class stats loaded:", data);
        setStats(data);
      } else {
        console.log("Class stats document missing");
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'metadata/classStats');
    });

    // Fetch last 10 records
    const q = query(collection(db, 'attendance'), orderBy('date', 'desc'), limit(30));
    const unsubHistory = onSnapshot(q, (snapshot) => {
      console.log("Attendance history loaded, records:", snapshot.size);
      setAttendance(snapshot.docs.map(d => d.data() as AttendanceRecord));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'attendance');
    });

    const unsubLeaves = onSnapshot(query(collection(db, 'leaves'), where('uid', '==', profile.uid)), (snap) => {
      const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as LeaveRequest));
      // Sort in memory to avoid index requirement
      docs.sort((a, b) => b.requestedAt.toMillis() - a.requestedAt.toMillis());
      setLeaveRequests(docs);
    }, (err) => {
      console.error("Leaves query error:", err);
      if (err.code === 'failed-precondition') {
        addToast("Firestore index required. Check console for link.", "error");
      } else {
        addToast("Failed to load leave requests", "error");
      }
    });

    return () => {
      unsubToday();
      unsubStats();
      unsubHistory();
      unsubLeaves();
    };
  }, []);

  const attendedClasses = useMemo(() => {
    return attendance.filter(r => r.presentStudents?.some(s => s.uid === profile.uid)).length;
  }, [attendance, profile.uid]);

  const totalClasses = stats?.totalClassesHeld || 0;
  const percentage = totalClasses > 0 ? (attendedClasses / totalClasses) * 100 : 0;
  const isBelow75 = percentage < 75 && totalClasses > 0;

  const neededFor75 = Math.ceil((0.75 * totalClasses - attendedClasses) / 0.25);

  const markAttendance = async () => {
    const classStatus = isClassTime();
    if (!classStatus.active) {
      addToast(classStatus.reason, "error");
      return;
    }

    // Check for approved leave today
    const todayStr = getTodayDateStr();
    const hasApprovedLeave = leaveRequests.some(r => r.date === todayStr && r.status === 'approved');
    if (hasApprovedLeave) {
      addToast("You have an approved leave for today", "info");
      return;
    }

    setMarking(true);
    try {
      const today = getTodayDateStr();
      const attendanceDoc = doc(db, 'attendance', today);
      const docSnap = await getDoc(attendanceDoc);

      if (!docSnap.exists()) {
        addToast("No class session active for today", "error");
        return;
      }

      const data = docSnap.data() as AttendanceRecord;
      if (!data.classHeld) {
        addToast("Class is cancelled today", "error");
        return;
      }

      if (data.presentStudents?.some(s => s.uid === profile.uid)) {
        addToast("Attendance already marked!", "info");
        return;
      }

      await updateDoc(attendanceDoc, {
        presentStudents: arrayUnion({
          uid: profile.uid,
          rollNumber: profile.rollNumber,
          name: profile.name,
          markedAt: Timestamp.now()
        })
      });

      addToast("Attendance marked successfully!", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setMarking(false);
    }
  };

  const submitLeaveRequest = async () => {
    if (!leaveReason) return addToast("Please provide a reason", "error");
    try {
      await addDoc(collection(db, 'leaves'), {
        uid: profile.uid,
        name: profile.name,
        rollNumber: profile.rollNumber,
        date: leaveDate,
        reason: leaveReason,
        status: 'pending',
        requestedAt: Timestamp.now()
      });
      addToast("Leave request submitted", "success");
      setShowLeaveModal(false);
      setLeaveReason('');
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  const classStatus = isClassTime();
  const hasMarkedToday = todayRecord?.presentStudents?.some(s => s.uid === profile.uid);

  return (
    <div className="student-bg min-h-screen text-white pb-12">
      {/* Navbar */}
      <nav className="glass border-none sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center font-bold text-xl">B</div>
          <div>
            <h2 className="font-display font-bold leading-none">IIITM</h2>
            <p className="text-[10px] text-indigo-200/50 uppercase tracking-widest">Attendance System</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:block text-right">
            <p className="text-sm font-medium">{profile.name}</p>
            <p className="text-xs text-indigo-200/50">{profile.rollNumber}</p>
          </div>
          <button onClick={handleLogout} className="p-2 hover:bg-white/10 rounded-lg transition-all text-indigo-200">
            <LogOut size={20} />
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 mt-8 space-y-8">
        {/* Hero Section */}
        <section className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass rounded-3xl p-8 relative overflow-hidden"
            >
              <div className="relative z-10">
                <div className="flex items-center gap-2 text-indigo-300 text-sm font-medium mb-4">
                  <Calendar size={16} />
                  <span>{getDayName(new Date())}, {new Date().toLocaleDateString()}</span>
                </div>
                <h1 className="text-3xl font-display font-bold mb-2">{CLASS_SCHEDULE.subject}</h1>
                <p className="text-indigo-200/60 mb-8">Slot: {CLASS_SCHEDULE.classSlot.startTime} - {CLASS_SCHEDULE.classSlot.endTime}</p>
                
                <div className="flex flex-wrap items-center gap-4">
                  {hasMarkedToday ? (
                    <div className="bg-emerald-500/20 text-emerald-400 px-6 py-3 rounded-2xl flex items-center gap-2 font-bold border border-emerald-500/30">
                      <CheckCircle size={20} />
                      Marked Present
                    </div>
                  ) : todayRecord?.classHeld ? (
                    classStatus.active ? (
                      <button 
                        onClick={markAttendance}
                        disabled={marking}
                        className="bg-emerald-500 hover:bg-emerald-400 text-white px-8 py-4 rounded-2xl font-bold shadow-lg shadow-emerald-900/20 transition-all pulse-glow flex items-center gap-2"
                      >
                        {marking ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle size={20} />}
                        Mark Attendance
                      </button>
                    ) : (
                      <div className="bg-white/5 text-white/50 px-6 py-3 rounded-2xl flex items-center gap-2 font-medium border border-white/10">
                        <Clock size={20} />
                        {classStatus.reason}
                      </div>
                    )
                  ) : classStatus.active ? (
                    <div className="bg-white/5 text-white/50 px-6 py-3 rounded-2xl flex items-center gap-2 font-medium border border-white/10">
                      <Clock size={20} />
                      Waiting for admin to start class
                    </div>
                  ) : (
                    <div className="bg-white/5 text-white/50 px-6 py-3 rounded-2xl flex items-center gap-2 font-medium border border-white/10">
                      <Clock size={20} />
                      {classStatus.reason}
                    </div>
                  )}
                  
                  <button 
                    onClick={() => setShowLeaveModal(true)}
                    className="bg-white/5 hover:bg-white/10 text-white px-6 py-3 rounded-2xl flex items-center gap-2 font-medium border border-white/10 transition-all"
                  >
                    <MessageSquare size={20} />
                    Request Leave
                  </button>
                </div>
              </div>
              <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-indigo-600/10 rounded-full blur-3xl"></div>
            </motion.div>

            {isBelow75 && (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-rose-500/20 border border-rose-500/30 rounded-2xl p-6 flex items-start gap-4"
              >
                <div className="p-3 bg-rose-500 rounded-xl">
                  <AlertTriangle size={24} className="text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-rose-200">Attendance Warning</h3>
                  <p className="text-sm text-rose-200/70">Your attendance is {percentage.toFixed(1)}%. You need to attend at least {neededFor75} more classes to reach 75% eligibility.</p>
                </div>
              </motion.div>
            )}
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass rounded-3xl p-8 flex flex-col items-center justify-center text-center"
          >
            <div className="relative w-40 h-40 mb-6">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="80" cy="80" r="70" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
                <motion.circle 
                  cx="80" cy="80" r="70" fill="transparent" 
                  stroke={percentage >= 75 ? "#2ecc71" : "#e74c3c"} 
                  strokeWidth="12" 
                  strokeDasharray={440}
                  initial={{ strokeDashoffset: 440 }}
                  animate={{ strokeDashoffset: 440 - (440 * percentage) / 100 }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-display font-bold">{Math.round(percentage)}%</span>
                <span className="text-[10px] text-indigo-200/50 uppercase tracking-widest">Attendance</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 w-full">
              <div className="bg-white/5 p-3 rounded-2xl">
                <p className="text-xs text-indigo-200/50 mb-1">Attended</p>
                <p className="text-xl font-bold">{attendedClasses}</p>
              </div>
              <div className="bg-white/5 p-3 rounded-2xl">
                <p className="text-xs text-indigo-200/50 mb-1">Total</p>
                <p className="text-xl font-bold">{totalClasses}</p>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Heatmap & Logs */}
        <section className="grid lg:grid-cols-2 gap-8">
          <div className="glass rounded-3xl p-8">
            <h3 className="text-xl font-display font-bold mb-6 flex items-center gap-2">
              <CalendarDays size={20} className="text-indigo-400" />
              Attendance Calendar
            </h3>
            <div className="grid grid-cols-7 gap-2">
              {/* Simple heatmap visualization */}
              {!hideLogs && Array.from({ length: 35 }).map((_, i) => {
                const date = new Date();
                date.setDate(date.getDate() - (34 - i));
                const dateStr = date.toISOString().split('T')[0];
                const record = attendance.find(r => r.date === dateStr);
                const isPresent = record?.presentStudents?.some(s => s.uid === profile.uid);
                const isClass = record?.classHeld;
                
                return (
                  <div 
                    key={i} 
                    title={dateStr}
                    className={`aspect-square rounded-md transition-all ${
                      isPresent ? 'bg-emerald-500 shadow-lg shadow-emerald-500/20' : 
                      isClass ? 'bg-rose-500/40' : 
                      'bg-white/5'
                    }`}
                  />
                );
              })}
              {hideLogs && Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-md bg-white/5" />
              ))}
            </div>
            <div className="flex items-center gap-4 mt-6 text-xs text-indigo-200/50">
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-emerald-500 rounded-sm"></div> Present</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-rose-500/40 rounded-sm"></div> Absent</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-white/5 rounded-sm"></div> No Class</div>
            </div>
          </div>

          <div className="glass rounded-3xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-display font-bold flex items-center gap-2">
                <FileText size={20} className="text-indigo-400" />
                Recent Logs
              </h3>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setHideLogs(!hideLogs)}
                  className="text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {hideLogs ? 'Restore' : 'Clear'}
                </button>
                <button 
                  onClick={() => setShowFullHistory(true)}
                  disabled={hideLogs}
                  className={`text-xs font-bold transition-colors ${hideLogs ? 'text-indigo-200/20 cursor-not-allowed' : 'text-indigo-400 hover:text-indigo-300'}`}
                >
                  View All
                </button>
              </div>
            </div>
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {!hideLogs && attendance.slice(0, 10).map((record, i) => {
                const isPresent = record.presentStudents?.some(s => s.uid === profile.uid);
                return (
                  <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div>
                      <p className="font-medium">{record.date}</p>
                      <p className="text-xs text-indigo-200/50">{record.dayName}</p>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold ${isPresent ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                      {isPresent ? 'Present' : 'Absent'}
                    </div>
                  </div>
                );
              })}
              {(hideLogs || attendance.length === 0) && (
                <p className="text-center text-indigo-200/30 py-8">
                  {hideLogs ? 'Logs temporarily cleared' : 'No records found'}
                </p>
              )}
            </div>
          </div>

          <div className="glass rounded-3xl p-8">
            <h3 className="text-xl font-display font-bold mb-6 flex items-center gap-2">
              <MessageSquare size={20} className="text-indigo-400" />
              Leave Requests
            </h3>
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {leaveRequests.map((req, i) => (
                <div key={i} className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium">{req.date}</p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      req.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                      req.status === 'rejected' ? 'bg-rose-500/20 text-rose-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {req.status}
                    </span>
                  </div>
                  <p className="text-xs text-indigo-200/60 line-clamp-2">{req.reason}</p>
                </div>
              ))}
              {leaveRequests.length === 0 && <p className="text-center text-indigo-200/30 py-8">No requests found</p>}
            </div>
          </div>
        </section>
      </main>

      {/* Leave Request Modal */}
      <AnimatePresence>
        {showLeaveModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass rounded-3xl p-8 w-full max-w-md shadow-2xl"
            >
              <h3 className="text-2xl font-display font-bold mb-6">Request Leave</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-indigo-200/50 uppercase tracking-widest mb-2">Date</label>
                  <input 
                    type="date" 
                    value={leaveDate}
                    onChange={e => setLeaveDate(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-indigo-200/50 uppercase tracking-widest mb-2">Reason</label>
                  <textarea 
                    rows={4}
                    value={leaveReason}
                    onChange={e => setLeaveReason(e.target.value)}
                    placeholder="Briefly explain the reason for leave..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>
                <div className="flex gap-4 mt-8">
                  <button 
                    onClick={() => setShowLeaveModal(false)}
                    className="flex-1 px-6 py-3 rounded-xl font-bold text-indigo-200/50 hover:bg-white/5 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={submitLeaveRequest}
                    className="flex-1 px-6 py-3 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-900/20"
                  >
                    Submit
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full History Modal */}
      <AnimatePresence>
        {showFullHistory && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="glass rounded-3xl p-8 w-full max-w-2xl max-h-[80vh] flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-display font-bold">Attendance History</h3>
                <button onClick={() => setShowFullHistory(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={24} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-4 space-y-4 custom-scrollbar">
                  {attendance.map((record, i) => {
                    const isPresent = record.presentStudents?.some(s => s.uid === profile.uid);
                    return (
                      <div key={i} className="flex items-center justify-between p-5 bg-white/5 rounded-2xl border border-white/5">
                        <div>
                          <p className="text-lg font-bold">{record.date}</p>
                          <p className="text-sm text-indigo-200/50">{record.dayName}</p>
                        </div>
                        <div className="text-right">
                          <div className={`px-4 py-1.5 rounded-full text-xs font-bold inline-block ${isPresent ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {isPresent ? 'Present' : 'Absent'}
                          </div>
                          {isPresent && (
                            <p className="text-[10px] text-indigo-200/30 mt-1">
                              {record.presentStudents?.find(s => s.uid === profile.uid)?.markedAt.toDate().toLocaleTimeString()}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                {attendance.length === 0 && <p className="text-center text-indigo-200/30 py-12">No records found</p>}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- BINARY SEARCH HELPERS ---
const binarySearchPrefix = (arr: any[], query: string, field: 'name' | 'rollNumber') => {
  if (!query) return arr;
  const q = query.toLowerCase();
  
  let low = 0;
  let high = arr.length - 1;
  let firstIdx = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const val = (arr[mid][field] || '').toLowerCase();
    if (val.startsWith(q)) {
      firstIdx = mid;
      high = mid - 1;
    } else if (val < q) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (firstIdx === -1) return [];

  const results = [];
  for (let i = firstIdx; i < arr.length; i++) {
    const val = (arr[i][field] || '').toLowerCase();
    if (val.startsWith(q)) {
      results.push(arr[i]);
    } else {
      break;
    }
  }
  return results;
};

// --- ADMIN PORTAL ---

const AdminPortal = ({ 
  profile, 
  handleLogout, 
  activeTab, 
  setActiveTab, 
  addToast, 
  userIp,
  networkConfig,
  toggleNetworkRestriction,
  updateNetworkConfig
}: any) => {
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<ClassStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayDateStr());
  const [showBelow75Only, setShowBelow75Only] = useState(false);
  const [manualRoll, setManualRoll] = useState('');
  const [editingStudent, setEditingStudent] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearInput, setClearInput] = useState('');
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [newAllowedIp, setNewAllowedIp] = useState(networkConfig?.allowedIp || '');
  const [isUpdatingNetwork, setIsUpdatingNetwork] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ field: string, direction: 'asc' | 'desc' }>({ field: 'rollNumber', direction: 'asc' });

  useEffect(() => {
    if (networkConfig?.allowedIp) {
      setNewAllowedIp(networkConfig.allowedIp);
    }
  }, [networkConfig]);

  useEffect(() => {
    const unsubStudents = onSnapshot(collection(db, 'users'), (snap) => {
      setStudents(snap.docs.map(d => d.data() as UserProfile));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    const unsubAttendance = onSnapshot(query(collection(db, 'attendance'), orderBy('date', 'desc')), (snap) => {
      setAttendance(snap.docs.map(d => d.data() as AttendanceRecord));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'attendance');
    });

    const unsubStats = onSnapshot(doc(db, 'metadata', 'classStats'), (doc) => {
      if (doc.exists()) setStats(doc.data() as ClassStats);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'metadata/classStats');
    });

    const unsubLeaves = onSnapshot(query(collection(db, 'leaves'), orderBy('requestedAt', 'desc')), (snap) => {
      setLeaveRequests(snap.docs.map(d => ({ ...d.data(), id: d.id } as LeaveRequest)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'leaves');
    });

    setLoading(false);
    return () => {
      unsubStudents();
      unsubAttendance();
      unsubStats();
      unsubLeaves();
    };
  }, []);

  const recalculateStats = async () => {
    try {
      addToast("Recalculating total classes...", "info");
      const q = query(collection(db, 'attendance'), where('classHeld', '==', true));
      const snap = await getDocs(q);
      const count = snap.size;
      
      const statsRef = doc(db, 'metadata', 'classStats');
      await setDoc(statsRef, {
        totalClassesHeld: count,
        lastUpdated: Timestamp.now()
      }, { merge: true });
      
      addToast(`Stats updated: ${count} classes found`, "success");
    } catch (err: any) {
      addToast("Failed to recalculate: " + err.message, "error");
    }
  };

  const totalClasses = stats?.totalClassesHeld || 0;
  const todayRecord = attendance.find(r => r.date === getTodayDateStr());
  const activeStudents = useMemo(() => students.filter(s => !s.deleted), [students]);
  
  const studentsWithAttendance = useMemo(() => {
    return activeStudents.map(s => {
      const attended = attendance.filter(r => r.presentStudents?.some(ps => ps.uid === s.uid)).length;
      const perc = totalClasses > 0 ? (attended / totalClasses) * 100 : 0;
      const needed = Math.ceil((0.75 * totalClasses - attended) / 0.25);
      return { ...s, attended, perc, needed };
    });
  }, [activeStudents, attendance, totalClasses]);

  const sortedByName = useMemo(() => [...studentsWithAttendance].sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())), [studentsWithAttendance]);
  const sortedByRoll = useMemo(() => [...studentsWithAttendance].sort((a, b) => (a.rollNumber || '').toLowerCase().localeCompare((b.rollNumber || '').toLowerCase())), [studentsWithAttendance]);

  const filteredStudents = useMemo(() => {
    let base = [];
    if (!searchQuery) {
      base = studentsWithAttendance;
    } else {
      const byName = binarySearchPrefix(sortedByName, searchQuery, 'name');
      const byRoll = binarySearchPrefix(sortedByRoll, searchQuery, 'rollNumber');
      
      const uniqueMap = new Map();
      byName.forEach(s => uniqueMap.set(s.uid, s));
      byRoll.forEach(s => uniqueMap.set(s.uid, s));
      base = Array.from(uniqueMap.values());
    }

    if (showBelow75Only) {
      return base.filter(s => s.perc < 75);
    }
    return base;
  }, [searchQuery, sortedByName, sortedByRoll, studentsWithAttendance, showBelow75Only]);

  const avgAttendance = useMemo(() => {
    if (totalClasses === 0 || activeStudents.length === 0) return 0;
    const totalAttendances = attendance.reduce((acc, r) => acc + (r.presentStudents?.length || 0), 0);
    return (totalAttendances / (totalClasses * activeStudents.length)) * 100;
  }, [attendance, totalClasses, activeStudents]);

  const exportCSV = (date: string) => {
    const record = attendance.find(r => r.date === date);
    if (!record) return addToast("No record for this date", "error");
    
    const headers = ["Roll Number", "Name", "Marked At"];
    const rows = (record.presentStudents || []).map(s => [
      s.rollNumber,
      s.name,
      s.markedAt.toDate().toLocaleTimeString()
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `attendance_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const markClassHeld = async (date: string, held: boolean) => {
    try {
      const docRef = doc(db, 'attendance', date);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists() && held) {
        await setDoc(docRef, {
          date,
          dayName: getDayName(new Date(date)),
          classHeld: true,
          presentStudents: []
        });
        // Update stats
        const statsRef = doc(db, 'metadata', 'classStats');
        const statsSnap = await getDoc(statsRef);
        const currentTotal = statsSnap.exists() ? statsSnap.data().totalClassesHeld : 0;
        await setDoc(statsRef, {
          totalClassesHeld: currentTotal + 1,
          lastUpdated: Timestamp.now()
        }, { merge: true });
        addToast("Class session created", "success");
      } else if (docSnap.exists()) {
        const wasHeld = docSnap.data().classHeld;
        await updateDoc(docRef, { classHeld: held });
        
        if (wasHeld && !held) {
          const statsRef = doc(db, 'metadata', 'classStats');
          const statsSnap = await getDoc(statsRef);
          const currentTotal = statsSnap.exists() ? statsSnap.data().totalClassesHeld : 0;
          await updateDoc(statsRef, { totalClassesHeld: Math.max(0, currentTotal - 1) });
        } else if (!wasHeld && held) {
          const statsRef = doc(db, 'metadata', 'classStats');
          const statsSnap = await getDoc(statsRef);
          const currentTotal = statsSnap.exists() ? statsSnap.data().totalClassesHeld : 0;
          await updateDoc(statsRef, { totalClassesHeld: currentTotal + 1 });
        }
        addToast(`Class ${held ? 'marked as held' : 'cancelled'}`, "success");
      }
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  const markStudentPresent = async (date: string, rollNumber: string) => {
    if (!rollNumber) return;
    try {
      const student = students.find(s => (s.rollNumber || '').toLowerCase() === rollNumber.toLowerCase());
      if (!student) return addToast("Student not found", "error");
      
      const docRef = doc(db, 'attendance', date);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        await setDoc(docRef, {
          date,
          dayName: getDayName(new Date(date)),
          classHeld: true,
          presentStudents: [{
            uid: student.uid,
            rollNumber: student.rollNumber,
            name: student.name,
            markedAt: Timestamp.now()
          }]
        });
        const statsRef = doc(db, 'metadata', 'classStats');
        const statsSnap = await getDoc(statsRef);
        const currentTotal = statsSnap.exists() ? statsSnap.data()?.totalClassesHeld || 0 : 0;
        await setDoc(statsRef, {
          totalClassesHeld: currentTotal + 1,
          lastUpdated: Timestamp.now()
        }, { merge: true });
      } else {
        const data = docSnap.data() as AttendanceRecord;
        if (data.presentStudents?.some(s => s.uid === student.uid)) {
          return addToast("Student already present", "info");
        }
        await updateDoc(docRef, {
          presentStudents: arrayUnion({
            uid: student.uid,
            rollNumber: student.rollNumber,
            name: student.name,
            markedAt: Timestamp.now()
          })
        });
      }
      setManualRoll('');
      addToast("Student marked present", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  const removeStudentFromDate = async (date: string, uid: string) => {
    try {
      const docRef = doc(db, 'attendance', date);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data() as AttendanceRecord;
        const updated = (data.presentStudents || []).filter(s => s.uid !== uid);
        await updateDoc(docRef, { presentStudents: updated });
        addToast("Student removed from record", "success");
      }
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  const updateStudentName = async (uid: string, newName: string) => {
    try {
      await updateDoc(doc(db, 'users', uid), { name: newName });
      setEditingStudent(null);
      addToast("Student name updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  const deleteStudent = async (uid: string) => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ uid })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete user");

      addToast("Student deleted from Auth and Database", "success");
      setStudentToDelete(null);
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  const handleLeaveAction = async (requestId: string, status: 'approved' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'leaves', requestId), { status });
      addToast(`Leave request ${status}`, "success");
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  const handleSort = (field: string) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const SortArrow = ({ field }: { field: string }) => {
    if (sortConfig.field !== field) return <div className="w-4 h-4 opacity-20"><ChevronUp size={14} /></div>;
    return sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-indigo-600" /> : <ChevronDown size={14} className="text-indigo-600" />;
  };

  const clearAllAttendance = async () => {
    if (clearInput !== 'DELETE ALL') {
      addToast("Incorrect confirmation text", "error");
      return;
    }

    try {
      setShowClearConfirm(false);
      setClearInput('');
      addToast("Clearing attendance records...", "info");
      
      const q = query(collection(db, 'attendance'));
      const snap = await getDocs(q);
      
      const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletePromises);
      
      const statsRef = doc(db, 'metadata', 'classStats');
      await setDoc(statsRef, {
        totalClassesHeld: 0,
        lastUpdated: Timestamp.now()
      });
      
      addToast("All attendance records cleared successfully", "success");
    } catch (err: any) {
      addToast("Failed to clear records: " + err.message, "error");
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'date', label: 'By Date', icon: CalendarDays },
    { id: 'students', label: 'Students', icon: UsersRound },
    { id: 'leaves', label: 'Leaves', icon: MessageSquare },
    { id: 'alerts', label: 'Low Eligibility', icon: Bell },
    { id: 'network', label: 'Network', icon: ShieldCheck },
    { id: 'import', label: 'Bulk Import', icon: Upload },
    { id: 'schedule', label: 'Schedule', icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 admin-sidebar text-white flex flex-col fixed h-full z-50">
        <div className="p-8">
          <h1 className="text-2xl font-display font-bold tracking-tight admin-accent">BEE Admin</h1>
          <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Professor Portal</p>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === item.id ? 'admin-accent-bg text-white shadow-lg' : 'text-white/60 hover:bg-white/5 hover:text-white'}`}
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-6 border-t border-white/5">
          <div className="flex items-center gap-3 mb-6 px-2">
            <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center">
              <UserIcon size={20} className="text-white/70" />
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate">{profile.name}</p>
              <p className="text-[10px] text-white/40 truncate">{profile.email}</p>
            </div>
          </div>
          <button 
            onClick={recalculateStats}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-indigo-300 hover:bg-indigo-500/10 transition-all mb-2"
          >
            <RefreshCw size={20} />
            <span className="font-medium">Recalculate Stats</span>
          </button>
          <button 
            onClick={() => setShowClearConfirm(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-all mb-2"
          >
            <Trash2 size={20} />
            <span className="font-medium">Clear All Logs</span>
          </button>
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-all">
            <LogOut size={20} />
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 ml-64 p-10">
        <header className="flex items-center justify-between mb-10">
          <div>
            <h2 className="text-3xl font-display font-bold text-slate-900">{navItems.find(i => i.id === activeTab)?.label}</h2>
            <p className="text-slate-500">Manage BEE Data Structures Lecture attendance</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-200 flex items-center gap-2">
              <Clock size={16} className="text-indigo-500" />
              <span className="text-sm font-bold text-slate-700">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-200 text-rose-500 font-bold hover:bg-rose-50 transition-all"
            >
              <LogOut size={18} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard label="Total Classes" value={totalClasses} icon={Calendar} color="indigo" />
              <StatCard label="Registered Students" value={activeStudents.length} icon={Users} color="blue" />
              <StatCard label="Today's Present" value={todayRecord?.presentStudents?.length || 0} icon={CheckCircle} color="emerald" />
              <StatCard label="Avg Attendance" value={avgAttendance.toFixed(1) + '%'} icon={TrendingUp} color="amber" />
            </div>

            <div className="grid lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
                <h3 className="text-xl font-display font-bold mb-6">Recent Attendance Trends</h3>
                <div className="h-64 flex items-end gap-4 px-4">
                  {attendance.slice(0, 7).reverse().map((r, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-2">
                      <div className="w-full bg-indigo-50 rounded-t-lg relative group">
                        <motion.div 
                          initial={{ height: 0 }}
                          animate={{ height: `${activeStudents.length > 0 ? ((r.presentStudents?.length || 0) / activeStudents.length) * 100 : 0}%` }}
                          className="w-full admin-accent-bg rounded-t-lg"
                        />
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                          {r.presentStudents?.length || 0}
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase">{r.date.split('-').slice(1).join('/')}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
                <h3 className="text-xl font-display font-bold mb-6">Quick Actions</h3>
                <div className="space-y-4">
                  <button 
                    onClick={() => markClassHeld(getTodayDateStr(), true)}
                    className="w-full flex items-center justify-between p-4 rounded-2xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar size={20} />
                      <span className="font-bold">Start Today's Class</span>
                    </div>
                    <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                  <button 
                    onClick={() => setActiveTab('alerts')}
                    className="w-full flex items-center justify-between p-4 rounded-2xl bg-rose-50 text-rose-700 hover:bg-rose-100 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <Bell size={20} />
                      <span className="font-bold">View At-Risk Students</span>
                    </div>
                    <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'date' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <input 
                  type="date" 
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => markClassHeld(selectedDate, true)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${attendance.find(r => r.date === selectedDate)?.classHeld ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Start Class
                  </button>
                  <button 
                    onClick={() => markClassHeld(selectedDate, false)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${attendance.find(r => r.date === selectedDate)?.classHeld === false ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Cancel Class
                  </button>
                </div>
                
                <div className="h-8 w-px bg-slate-200 mx-2 hidden md:block"></div>
                
                <div className="flex items-center gap-2">
                  <input 
                    type="text" 
                    placeholder="Roll No (e.g. 023)"
                    value={manualRoll}
                    onChange={e => setManualRoll(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && markStudentPresent(selectedDate, manualRoll.includes('BEE-') ? manualRoll : `2025BEE-${manualRoll.padStart(3, '0')}`)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-40"
                  />
                  <button 
                    onClick={() => markStudentPresent(selectedDate, manualRoll.includes('BEE-') ? manualRoll : `2025BEE-${manualRoll.padStart(3, '0')}`)}
                    className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition-all"
                    title="Add Student Manually"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>
              <button 
                onClick={() => exportCSV(selectedDate)}
                className="flex items-center gap-2 bg-slate-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-slate-800 transition-all"
              >
                <Download size={18} />
                Export CSV
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest font-bold">
                  <tr>
                    <th className="px-8 py-4">Roll Number</th>
                    <th className="px-8 py-4">Name</th>
                    <th className="px-8 py-4">Marked At</th>
                    <th className="px-8 py-4">Status</th>
                    <th className="px-8 py-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attendance.find(r => r.date === selectedDate)?.presentStudents?.map((s, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-4 font-bold text-slate-700">{s.rollNumber}</td>
                      <td className="px-8 py-4 text-slate-600">{s.name}</td>
                      <td className="px-8 py-4 text-slate-500 text-sm">{s.markedAt.toDate().toLocaleTimeString()}</td>
                      <td className="px-8 py-4">
                        <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-[10px] font-bold uppercase">Present</span>
                      </td>
                      <td className="px-8 py-4">
                        <button 
                          onClick={() => removeStudentFromDate(selectedDate, s.uid)}
                          className="text-slate-400 hover:text-rose-500 transition-colors"
                          title="Remove from record"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!attendance.find(r => r.date === selectedDate) || (attendance.find(r => r.date === selectedDate)?.presentStudents?.length || 0) === 0) && (
                    <tr>
                      <td colSpan={5} className="px-8 py-12 text-center text-slate-400 font-medium italic">No attendance records found for this date</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'students' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Search by name or roll number..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-2xl pl-12 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500 font-medium">Show below 75% only</span>
                <button 
                  onClick={() => setShowBelow75Only(!showBelow75Only)}
                  className={`w-12 h-6 rounded-full transition-all relative ${showBelow75Only ? 'bg-rose-500' : 'bg-slate-200'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${showBelow75Only ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest font-bold">
                  <tr>
                    <th className="px-8 py-4 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('rollNumber')}>
                      <div className="flex items-center gap-2">
                        Roll Number
                        <SortArrow field="rollNumber" />
                      </div>
                    </th>
                    <th className="px-8 py-4 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('name')}>
                      <div className="flex items-center gap-2">
                        Name
                        <SortArrow field="name" />
                      </div>
                    </th>
                    <th className="px-8 py-4 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('attended')}>
                      <div className="flex items-center gap-2">
                        Attended
                        <SortArrow field="attended" />
                      </div>
                    </th>
                    <th className="px-8 py-4 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('percentage')}>
                      <div className="flex items-center gap-2">
                        Percentage
                        <SortArrow field="percentage" />
                      </div>
                    </th>
                    <th className="px-8 py-4">Status</th>
                    <th className="px-8 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStudents
                    .sort((a, b) => {
                      const field = sortConfig.field;
                      const dir = sortConfig.direction === 'asc' ? 1 : -1;
                      
                      if (field === 'rollNumber') return (a.rollNumber || '').localeCompare(b.rollNumber || '') * dir;
                      if (field === 'name') return (a.name || '').localeCompare(b.name || '') * dir;
                      if (field === 'attended') return (a.attended - b.attended) * dir;
                      if (field === 'percentage') return (a.perc - b.perc) * dir;
                      return 0;
                    })
                    .map((student, i) => {
                      const { attended, perc } = student;
                      
                      if (showBelow75Only && perc >= 75) return null;

                      return (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-8 py-4 font-bold text-slate-700">{student.rollNumber}</td>
                          <td className="px-8 py-4 text-slate-600">
                            {student.name}
                          </td>
                          <td className="px-8 py-4 text-slate-500 font-medium">{attended} / {totalClasses}</td>
                          <td className="px-8 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${perc >= 75 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${perc}%` }} />
                              </div>
                              <span className="text-sm font-bold text-slate-700">{perc.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-8 py-4">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${perc >= 75 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {perc >= 75 ? 'Good' : 'Low'}
                            </span>
                          </td>
                          <td className="px-8 py-4">
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => {
                                  setEditingStudent(student);
                                  setEditName(student.name);
                                }}
                                className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                              >
                                <Edit size={18} />
                              </button>
                              <button 
                                onClick={() => setStudentToDelete(student.uid)}
                                className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'leaves' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest font-bold">
                  <tr>
                    <th className="px-8 py-4">Student</th>
                    <th className="px-8 py-4">Date</th>
                    <th className="px-8 py-4">Reason</th>
                    <th className="px-8 py-4">Status</th>
                    <th className="px-8 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leaveRequests.map((req, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-4">
                        <p className="font-bold text-slate-700">{req.name}</p>
                        <p className="text-xs text-slate-400">{req.rollNumber}</p>
                      </td>
                      <td className="px-8 py-4 text-slate-600 font-medium">{req.date}</td>
                      <td className="px-8 py-4 text-slate-500 text-sm max-w-xs truncate" title={req.reason}>{req.reason}</td>
                      <td className="px-8 py-4">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                          req.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                          req.status === 'rejected' ? 'bg-rose-100 text-rose-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-8 py-4">
                        {req.status === 'pending' && (
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => handleLeaveAction(req.id!, 'approved')}
                              className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                              title="Approve"
                            >
                              <CheckCircle size={18} />
                            </button>
                            <button 
                              onClick={() => handleLeaveAction(req.id!, 'rejected')}
                              className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                              title="Reject"
                            >
                              <XCircle size={18} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {leaveRequests.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-8 py-12 text-center text-slate-400 font-medium italic">No leave requests found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="space-y-8">
            <div className="bg-rose-50 border border-rose-100 rounded-3xl p-8 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 bg-rose-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-rose-200">
                  <AlertTriangle size={32} />
                </div>
                <div>
                  <h3 className="text-2xl font-display font-bold text-rose-900">Eligibility Alerts</h3>
                  <p className="text-rose-700/70">Students with attendance below 75% are highlighted here.</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-4xl font-display font-bold text-rose-600">
                  {studentsWithAttendance.filter(s => s.perc < 75 && totalClasses > 0).length}
                </p>
                <p className="text-xs text-rose-500 font-bold uppercase tracking-widest">At Risk Students</p>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest font-bold">
                  <tr>
                    <th className="px-8 py-4">Roll Number</th>
                    <th className="px-8 py-4">Name</th>
                    <th className="px-8 py-4">Current %</th>
                    <th className="px-8 py-4">Classes Needed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {studentsWithAttendance
                    .filter(s => s.perc < 75 && totalClasses > 0)
                    .map((s, i) => (
                      <tr key={i} className="hover:bg-rose-50/30 transition-colors">
                        <td className="px-8 py-4 font-bold text-slate-700">{s.rollNumber}</td>
                        <td className="px-8 py-4 text-slate-600">{s.name}</td>
                        <td className="px-8 py-4 font-bold text-rose-600">{s.perc.toFixed(1)}%</td>
                        <td className="px-8 py-4">
                          <div className="flex items-center gap-2 text-rose-700 font-medium">
                            <TrendingUp size={16} />
                            <span>{s.needed} more classes</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  {studentsWithAttendance.filter(s => s.perc < 75 && totalClasses > 0).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-8 py-12 text-center text-emerald-500 font-medium italic">All students are currently above 75% eligibility!</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'network' && (
          <div className="space-y-8">
            <div className="bg-white rounded-[2.5rem] p-10 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-2xl font-display font-bold text-slate-900 mb-2">Network Access Control</h3>
                  <p className="text-slate-500">Restrict application access to the college WiFi network.</p>
                </div>
                <button 
                  onClick={toggleNetworkRestriction}
                  className={`px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 ${
                    networkConfig?.restrictionEnabled 
                      ? 'bg-rose-100 text-rose-600 hover:bg-rose-200' 
                      : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                  }`}
                >
                  {networkConfig?.restrictionEnabled ? <XCircle size={20} /> : <CheckCircle size={20} />}
                  {networkConfig?.restrictionEnabled ? 'Disable Restriction' : 'Enable Restriction'}
                </button>
              </div>

              <div className="grid md:grid-cols-2 gap-10">
                <div className="space-y-6">
                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                    <h4 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                      <Settings size={18} className="text-indigo-500" />
                      Configuration
                    </h4>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      updateNetworkConfig(newAllowedIp);
                    }} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Authorized Public IP</label>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={newAllowedIp}
                            onChange={e => setNewAllowedIp(e.target.value)}
                            placeholder="e.g. 103.21.124.5"
                            className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                          />
                          <button 
                            type="submit"
                            disabled={isUpdatingNetwork}
                            className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
                          >
                            {isUpdatingNetwork ? <RefreshCw size={20} className="animate-spin" /> : <Save size={20} />}
                          </button>
                        </div>
                        <p className="mt-2 text-[10px] text-slate-400 italic">
                          This should be the public IP of your college WiFi.
                        </p>
                      </div>
                    </form>
                  </div>

                  <div className="p-6 bg-indigo-50 rounded-3xl border border-indigo-100">
                    <h4 className="font-bold text-indigo-700 mb-2 flex items-center gap-2">
                      <Clock size={18} />
                      Last Updated
                    </h4>
                    <p className="text-sm text-indigo-600/70">
                      {networkConfig?.lastUpdated ? networkConfig.lastUpdated.toDate().toLocaleString() : 'Never'}
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="p-8 bg-[#0f172a] rounded-[2rem] text-white border border-white/5 shadow-2xl">
                    <h4 className="font-bold text-indigo-400 mb-6 flex items-center gap-2 uppercase text-xs tracking-widest">
                      Live Network Status
                    </h4>
                    <div className="space-y-6">
                      <div>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Your Current IP</p>
                        <p className="text-2xl font-mono text-white">{userIp || 'Detecting...'}</p>
                      </div>
                      <div className="pt-4 border-t border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-white/50">Restriction Status</span>
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                            networkConfig?.restrictionEnabled ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'
                          }`}>
                            {networkConfig?.restrictionEnabled ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-white/50">Network Match</span>
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                            userIp === networkConfig?.allowedIp ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                          }`}>
                            {userIp === networkConfig?.allowedIp ? 'Match' : 'Mismatch'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-6 bg-amber-50 rounded-3xl border border-amber-100">
                    <div className="flex gap-3">
                      <AlertTriangle size={24} className="text-amber-500 shrink-0" />
                      <div>
                        <h4 className="font-bold text-amber-800 text-sm mb-1">Important Note</h4>
                        <p className="text-xs text-amber-700/80 leading-relaxed">
                          Admins always bypass this restriction. Students will be blocked from accessing any part of the site if their IP does not match the authorized one.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'import' && (
          <div className="space-y-8">
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
              <h3 className="text-xl font-display font-bold mb-4">Bulk Student Import (BEE)</h3>
              <p className="text-slate-500 mb-8">
                This utility will create Firebase Auth accounts and Firestore profiles for all BEE students provided in the official list.
                <br />
                <span className="text-rose-500 font-bold">Warning:</span> This process may take a few minutes. Do not close the tab while importing.
              </p>
              
              <div className="bg-slate-50 rounded-2xl p-6 mb-8 border border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-slate-700">Student List Preview</h4>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{BEE_STUDENTS.length} Students Found</span>
                </div>
                <div className="max-h-64 overflow-y-auto pr-4 space-y-2 custom-scrollbar">
                  {BEE_STUDENTS.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-2 border-b border-slate-200 last:border-0">
                      <span className="font-mono text-indigo-600 font-bold">{s.roll}</span>
                      <span className="text-slate-600">{s.name}</span>
                      <span className="text-[10px] text-slate-400">bee_2025{s.roll.split('-')[1]}@iiitm.ac.in</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4">
                {!showImportConfirm ? (
                  <button 
                    onClick={() => setShowImportConfirm(true)}
                    disabled={loading}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-900/20 disabled:opacity-50"
                  >
                    <Upload size={20} />
                    Start Bulk Import
                  </button>
                ) : (
                  <div className="flex items-center gap-4 p-4 bg-rose-50 rounded-2xl border border-rose-100">
                    <p className="text-sm font-bold text-rose-700">Are you sure? This will create {BEE_STUDENTS.length} accounts.</p>
                    <button 
                      onClick={async () => {
                        setShowImportConfirm(false);
                        setLoading(true);
                        addToast("Starting bulk import...", "info");
                        
                        try {
                          // Initialize secondary app safely
                          let secondaryApp;
                          try {
                            secondaryApp = initializeApp(firebaseConfig, 'SecondaryImport');
                          } catch (e) {
                            // If already initialized, we'd need getApp, but for simplicity let's use unique name
                            secondaryApp = initializeApp(firebaseConfig, 'SecondaryImport_' + Date.now());
                          }
                          
                          const secondaryAuth = getSecondaryAuth(secondaryApp);
                          
                          let successCount = 0;
                          let errorCount = 0;
                          
                          for (const student of BEE_STUDENTS) {
                            const rollSuffix = student.roll.split('-')[1];
                            const email = `bee_2025${rollSuffix}@iiitm.ac.in`;
                            const password = "123456789";
                            
                            try {
                              // 1. Create Auth User
                              const { user } = await createUserWithEmailAndPassword(secondaryAuth, email, password);
                              
                              // 2. Create Firestore Profile
                              const userProfile: UserProfile = {
                                uid: user.uid,
                                name: student.name,
                                email: email,
                                rollNumber: student.roll,
                                branch: 'BEE',
                                joinedAt: Timestamp.now()
                              };
                              
                              await setDoc(doc(db, 'users', user.uid), userProfile);
                              
                              // 3. Sign out from secondary auth to clear state
                              await signOut(secondaryAuth);
                              
                              successCount++;
                              if (successCount % 5 === 0) addToast(`Imported ${successCount} students...`, "info");
                            } catch (err: any) {
                              if (err.code === 'auth/email-already-in-use') {
                                console.log(`Student ${email} already exists, skipping...`);
                                // Optionally update firestore profile if it's missing but auth exists
                                // But for now we just count it as "existing"
                              } else {
                                console.error(`Error importing ${email}:`, err.message);
                              }
                              errorCount++;
                            }
                          }
                          
                          addToast(`Import Complete! Success: ${successCount}, Errors/Existing: ${errorCount}`, "success");
                        } catch (err: any) {
                          addToast(err.message, "error");
                        } finally {
                          setLoading(false);
                        }
                      }}
                      className="px-4 py-2 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-500 transition-all"
                    >
                      Yes, Import
                    </button>
                    <button 
                      onClick={() => setShowImportConfirm(false)}
                      className="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-300 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'schedule' && (
          <div className="max-w-2xl space-y-8">
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
              <h3 className="text-xl font-display font-bold mb-6">Class Schedule Configuration</h3>
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Subject</label>
                    <p className="text-lg font-bold text-slate-700">{CLASS_SCHEDULE.subject}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Branch</label>
                    <p className="text-lg font-bold text-slate-700">{CLASS_SCHEDULE.branch}</p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Class Days</label>
                  <div className="flex gap-2">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                      <div key={i} className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${CLASS_SCHEDULE.classDays.includes(i) ? 'admin-accent-bg text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {day}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Start Time</label>
                    <p className="text-lg font-bold text-slate-700">{CLASS_SCHEDULE.classSlot.startTime}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">End Time</label>
                    <p className="text-lg font-bold text-slate-700">{CLASS_SCHEDULE.classSlot.endTime}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 rounded-3xl p-8 text-white">
              <h3 className="text-xl font-display font-bold mb-4">Admin Instructions</h3>
              <ul className="space-y-3 text-sm text-white/60 list-disc pl-5">
                <li>To change the schedule, modify the <code className="bg-white/10 px-1 rounded">CLASS_SCHEDULE</code> object in <code className="bg-white/10 px-1 rounded">types.ts</code>.</li>
                <li>New students must register with their <code className="bg-white/10 px-1 rounded">@iiitm.ac.in</code> email.</li>
                <li>Attendance can only be marked within {CLASS_SCHEDULE.classSlot.graceMinutes} minutes of the start time.</li>
                <li>You can manually override a class status in the "By Date" tab.</li>
              </ul>
            </div>
          </div>
        )}
      </main>

      {/* Edit Student Modal */}
      <AnimatePresence>
        {editingStudent && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
            >
              <h3 className="text-2xl font-display font-bold text-slate-900 mb-6">Edit Student</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Roll Number</label>
                  <p className="text-lg font-bold text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100">{editingStudent.rollNumber}</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Full Name</label>
                  <input 
                    type="text" 
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex gap-4 mt-8">
                  <button 
                    onClick={() => setEditingStudent(null)}
                    className="flex-1 px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => updateStudentName(editingStudent.uid, editName)}
                    className="flex-1 px-6 py-3 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-200"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Clear Logs Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
            >
              <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-2xl font-display font-bold text-slate-900 mb-2 text-center">Clear All Records?</h3>
              <p className="text-slate-500 text-center mb-6">This action is irreversible. All attendance logs will be permanently deleted.</p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Type "DELETE ALL" to confirm</label>
                  <input 
                    type="text" 
                    value={clearInput}
                    onChange={e => setClearInput(e.target.value)}
                    placeholder="DELETE ALL"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 text-center font-bold"
                  />
                </div>
                <div className="flex gap-4 mt-8">
                  <button 
                    onClick={() => {
                      setShowClearConfirm(false);
                      setClearInput('');
                    }}
                    className="flex-1 px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={clearAllAttendance}
                    disabled={clearInput !== 'DELETE ALL'}
                    className="flex-1 px-6 py-3 rounded-xl font-bold bg-rose-600 text-white hover:bg-rose-500 transition-all shadow-lg shadow-rose-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete Everything
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Student Confirmation Modal */}
      <AnimatePresence>
        {studentToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
            >
              <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <Trash2 size={32} />
              </div>
              <h3 className="text-2xl font-display font-bold text-slate-900 mb-2 text-center">Delete Student?</h3>
              <p className="text-slate-500 text-center mb-6">Are you sure you want to remove this student from the system?</p>
              
              <div className="flex gap-4 mt-8">
                <button 
                  onClick={() => setStudentToDelete(null)}
                  className="flex-1 px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => deleteStudent(studentToDelete)}
                  className="flex-1 px-6 py-3 rounded-xl font-bold bg-rose-600 text-white hover:bg-rose-500 transition-all shadow-lg shadow-rose-200"
                >
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color }: any) => {
  const colors: any = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100',
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white p-6 rounded-3xl border shadow-sm flex items-center gap-4 ${colors[color].split(' ')[2]}`}
    >
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${colors[color].split(' ')[0]} ${colors[color].split(' ')[1]}`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{label}</p>
        <p className="text-2xl font-display font-bold text-slate-900">{value}</p>
      </div>
    </motion.div>
  );
};
