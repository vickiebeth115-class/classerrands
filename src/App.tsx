import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  ClipboardList, 
  CheckCircle2, 
  UserCircle, 
  Plus, 
  Trash2, 
  Search, 
  Upload, 
  Clock,
  LogOut,
  Settings,
  ChevronRight,
  FileCheck,
  Calendar,
  Lock
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from './lib/utils';
import { Role, Student, Errand, ErrandStatus, PRESET_TASKS } from './types';
import { db, auth, ensureAuth } from './lib/firebase';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  doc, 
  onSnapshot, 
  query, 
  orderBy,
  getDocFromServer,
  serverTimestamp 
} from 'firebase/firestore';

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
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
    },
    operationType,
    path
  };
  console.error('Firestore Error Details: ', JSON.stringify(errInfo));
}

// --- Local Storage Helpers (for session only) ---
const STORAGE_KEYS = {
  USER: 'class_errand_user'
};

function getStorage<T>(key: string, defaultValue: T): T {
  const saved = localStorage.getItem(key);
  try {
    return saved ? JSON.parse(saved) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Constants ---
const PASSWORDS = {
  TEACHER: 'teacher888',
  OFFICER: 'class666'
};

// --- Components ---

export default function App() {
  const [currentUser, setCurrentUser] = useState<{ role: Role, name: string } | null>(() => getStorage(STORAGE_KEYS.USER, null));
  const [students, setStudents] = useState<Student[]>([]);
  const [errands, setErrands] = useState<Errand[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'students' | 'manage' | 'assignment'>('dashboard');
  
  // Modals
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showAddErrand, setShowAddErrand] = useState(false);
  const [showAssignTask, setShowAssignTask] = useState<Errand | null>(null);
  const [showReview, setShowReview] = useState<Errand | null>(null);
  const [loginRole, setLoginRole] = useState<Role | null>(null);

  const [isAuthReady, setIsAuthReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ students: string, errands: string }>({ students: 'Pending', errands: 'Pending' });

  // Firestore Sync & Auth Initialization
  useEffect(() => {
    // 1. Ensure Auth
    const setup = async () => {
      await ensureAuth();
      setIsAuthReady(true);
    };
    setup();

    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (user) setIsAuthReady(true);
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!isAuthReady || !auth.currentUser) {
      console.log("Firestore sync waiting: auth not ready or no user", { isAuthReady, uid: auth.currentUser?.uid });
      return;
    }

    console.log("Starting Firestore sync for user:", auth.currentUser.uid);

    // Connection test
    const testConnection = async () => {
      const dbDetails = {
        projectId: auth.app.options.projectId,
        databaseId: (db as any)._databaseId?.database || "(default)"
      };
      console.log("Connection check details:", dbDetails);
      
      try {
        await getDocFromServer(doc(db, 'system', 'connection_test'));
        console.log("Firestore: check performed successfully");
      } catch (error: any) {
        if (error.code === 'permission-denied') {
          console.log("Firestore: check denied by rules (expected if doc protected), reachability OK");
        } else {
          console.error("Firestore: check failed with non-permission error:", error);
        }
      }
    };
    testConnection();

    let unsubscribeStudents: (() => void) | null = null;
    let unsubscribeErrands: (() => void) | null = null;

    const startListeners = async () => {
      console.log("[Firestore] Starting listeners...");
      await ensureAuth();
      
      // TEST WRITE
      try {
        const testPath = 'system';
        const testDoc = doc(db, testPath, 'connection_test');
        await setDoc(testDoc, { lastPing: new Date().toISOString(), userId: auth.currentUser?.uid }, { merge: true });
        console.log("[Firestore] Test write successful");
      } catch (e) {
        console.error("[Firestore] Test write failed:", e);
      }

      const studentsPath = 'students';
      const qStudents = query(collection(db, studentsPath));
      
      const unsubS = onSnapshot(qStudents, (snapshot) => {
        console.log(`[Firestore] Students update: ${snapshot.size} docs`);
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
        setSyncStatus(prev => ({ ...prev, students: 'Connected' }));
        setStudents(data.sort((a, b) => (a.seatNumber || '').localeCompare(b.seatNumber || '')));
      }, (error) => {
        console.error("[Firestore] Students error:", error.code, error.message);
        setSyncStatus(prev => ({ ...prev, students: `Error: ${error.code}` }));
        handleFirestoreError(error, OperationType.GET, studentsPath);
      });

      const errandsPath = 'errands';
      const qErrands = query(collection(db, errandsPath));
      const unsubE = onSnapshot(qErrands, (snapshot) => {
        console.log(`[Firestore] Errands update: ${snapshot.size} docs`);
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Errand));
        setSyncStatus(prev => ({ ...prev, errands: 'Connected' }));
        setErrands(data.sort((a, b) => (a.date || '').localeCompare(a.date || '')));
      }, (error) => {
        console.error("[Firestore] Errands error:", error.code, error.message);
        setSyncStatus(prev => ({ ...prev, errands: `Error: ${error.code}` }));
        handleFirestoreError(error, OperationType.GET, errandsPath);
      });

      unsubscribeStudents = unsubS;
      unsubscribeErrands = unsubE;
    };

    startListeners();

    return () => {
      if (unsubscribeStudents) unsubscribeStudents();
      if (unsubscribeErrands) unsubscribeErrands();
    };
  }, [isAuthReady]);

  useEffect(() => setStorage(STORAGE_KEYS.USER, currentUser), [currentUser]);

  const handleLogin = (role: Role, password?: string) => {
    if (role === 'TEACHER' && password !== PASSWORDS.TEACHER) {
      alert('老師密碼錯誤！');
      return;
    }
    if (role === 'OFFICER' && password !== PASSWORDS.OFFICER) {
      alert('幹部密碼錯誤！');
      return;
    }

    let name = '一般學生';
    if (role === 'TEACHER') name = '老師';
    if (role === 'OFFICER') name = '幹部';
    setCurrentUser({ role, name });
    setLoginRole(null);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setActiveTab('dashboard');
  };

  const addStudent = async (name: string, seatNumber: string) => {
    const path = 'students';
    try {
      await addDoc(collection(db, path), { name, seatNumber });
      setShowAddStudent(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const removeStudent = async (id: string) => {
    const path = `students/${id}`;
    try {
      await deleteDoc(doc(db, 'students', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const addErrand = async (studentId: string, date: string, reason: string, description: string, photo: string | null) => {
    const student = students.find(s => s.id === studentId);
    if (!student) return;

    const path = 'errands';
    try {
      await addDoc(collection(db, path), {
        studentId: student.id,
        studentName: student.name,
        date,
        reason,
        description,
        photoUrl: photo || null,
        status: 'PENDING',
        isReviewed: false,
        createdAt: serverTimestamp()
      });
      setShowAddErrand(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const deleteErrand = async (id: string) => {
    if (currentUser?.role !== 'TEACHER') return;
    const path = `errands/${id}`;
    try {
      await deleteDoc(doc(db, 'errands', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const assignTask = async (errandId: string, task: string, date: string) => {
    const path = `errands/${errandId}`;
    try {
      await updateDoc(doc(db, 'errands', errandId), { 
        assignedTask: task, 
        assignmentDate: date,
        status: 'IN_PROGRESS' 
      });
      setShowAssignTask(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const reviewErrand = async (errandId: string, proofPhoto: string | null) => {
    const path = `errands/${errandId}`;
    try {
      await updateDoc(doc(db, 'errands', errandId), { 
        status: 'COMPLETED',
        isReviewed: true,
        reviewedBy: currentUser?.role,
        reviewTimestamp: new Date().toISOString(),
        reviewProofUrl: proofPhoto || null
      });
      setShowReview(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  if (!currentUser) {
    return (
      <LoginScreen 
        onLogin={handleLogin} 
        loginRole={loginRole} 
        setLoginRole={setLoginRole} 
      />
    );
  }


  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-10">
          <div className="bg-indigo-600 p-2 rounded-xl text-white">
            <ClipboardList size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">班級公差系統</h1>
        </div>

        <nav className="flex-1 space-y-2">
          <NavItem 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')}
            icon={<ClipboardList size={20} />} 
            label="公差儀表板" 
          />
          {currentUser.role === 'TEACHER' && (
            <NavItem 
              active={activeTab === 'students'} 
              onClick={() => setActiveTab('students')}
              icon={<Users size={20} />} 
              label="班級名單管理" 
            />
          )}
          {currentUser.role !== 'STUDENT' && (
            <NavItem 
              active={activeTab === 'manage'} 
              onClick={() => setActiveTab('manage')}
              icon={<Plus size={20} />} 
              label="登錄公差" 
            />
          )}
          {currentUser.role !== 'STUDENT' && (
            <NavItem 
              active={activeTab === 'assignment'} 
              onClick={() => setActiveTab('assignment')}
              icon={<ChevronRight size={20} />} 
              label="任務指派" 
            />
          )}
        </nav>

        <div className="pt-6 border-t border-slate-100">
          <div className="flex items-center gap-3 mb-6 p-2">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-indigo-600">
              <UserCircle size={24} />
            </div>
            <div>
              <p className="text-sm font-semibold">{currentUser.name}</p>
              <p className="text-xs text-slate-500">{currentUser.role === 'TEACHER' ? '導師' : '班級幹部'}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-2 text-slate-600 hover:text-red-600 transition-colors py-2 px-3 rounded-lg hover:bg-red-50"
          >
            <LogOut size={18} />
            <span className="text-sm font-medium">登出系統</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <header className="mb-10 flex justify-between items-end">
          <div>
            <p className="text-slate-500 text-sm font-medium mb-1">
              {format(new Date(), 'yyyy年MM月dd日 EEEE')}
            </p>
            <h2 className="text-3xl font-bold tracking-tight">
              {activeTab === 'dashboard' && '公差名單概況'}
              {activeTab === 'students' && '班級名單'}
              {activeTab === 'manage' && '公差登錄與管理'}
              {activeTab === 'assignment' && '任務指派中心'}
            </h2>
          </div>
          
          <div className="flex gap-4">
            {activeTab === 'students' && currentUser.role === 'TEACHER' && (
              <button 
                onClick={() => setShowAddStudent(true)}
                className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 font-medium shadow-sm hover:shadow-md transition-all active:scale-95"
              >
                <Plus size={20} />
                新增學生
              </button>
            )}
            {activeTab === 'manage' && currentUser.role !== 'STUDENT' && (
              <button 
                onClick={() => setShowAddErrand(true)}
                className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 font-medium shadow-sm hover:shadow-md transition-all active:scale-95"
              >
                <Plus size={20} />
                新增公差申請
              </button>
            )}
          </div>
        </header>

        <section>
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 gap-6">
              {/* Debug Sync Status */}
              {(syncStatus.students.includes('Error') || syncStatus.errands.includes('Error')) && (
                <div className="bg-red-50 p-4 rounded-xl border border-red-200 flex flex-col gap-2 shadow-sm animate-pulse">
                  <div className="flex items-center gap-2 text-red-700 font-bold">
                    <Lock size={16} />
                    <span>資料同步連線中... (目前狀態: {syncStatus.students === 'Connected' ? '學(V)' : '學(X)'} {syncStatus.errands === 'Connected' ? '公(V)' : '公(X)'})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono text-red-600">
                    <div>學生名單: {syncStatus.students}</div>
                    <div>公差記錄: {syncStatus.errands}</div>
                    <div>UUID: {auth.currentUser?.uid || 'NONE'}</div>
                    <div>DB: {(db as any)._databaseId?.database || "(default)"}</div>
                    <div>Project: {auth.app.options.projectId}</div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button 
                      onClick={() => window.location.reload()}
                      className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-700 transition-colors"
                    >
                      重新整理網頁
                    </button>
                    <button 
                      onClick={async () => {
                        await ensureAuth();
                        window.location.reload();
                      }}
                      className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-900 transition-colors"
                    >
                      重新驗證身份
                    </button>
                  </div>
                </div>
              )}

              <ErrandStats errands={errands} />
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-100">
                      <th className="p-4 pl-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">學生</th>
                      <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">公差日期</th>
                      <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">事由</th>
                      <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">任務</th>
                      <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">狀態</th>
                      <th className="p-4 pr-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">審核</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {errands.map(errand => (
                      <tr key={errand.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="p-4 pl-6">
                          <p className="font-semibold">{errand.studentName}</p>
                        </td>
                        <td className="p-4">
                          <p className="text-slate-600 text-sm">{errand.date}</p>
                        </td>
                        <td className="p-4 text-sm max-w-xs overflow-hidden text-ellipsis whitespace-nowrap">
                          {errand.reason}
                        </td>
                        <td className="p-4">
                          {errand.assignedTask ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full font-medium">
                                {errand.assignedTask}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs italic">未指派</span>
                          )}
                        </td>
                        <td className="p-4">
                          <StatusBadge status={errand.status} />
                        </td>
                        <td className="p-4 pr-6">
                          {errand.status === 'IN_PROGRESS' && currentUser.role !== 'STUDENT' ? (
                            <button 
                              onClick={() => setShowReview(errand)}
                              className="text-indigo-600 text-sm font-semibold hover:underline"
                            >
                              審核完成
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {errand.status === 'COMPLETED' ? (
                                <button 
                                  onClick={() => errand.reviewProofUrl && window.open(errand.reviewProofUrl)}
                                  className="flex items-center gap-1.5 text-green-700 hover:bg-green-50 p-1 px-2 rounded-lg transition-colors"
                                  title="點擊查看證明照片"
                                >
                                  <FileCheck size={16} className="text-green-500" />
                                  <span className="text-xs font-bold whitespace-nowrap">
                                    {errand.reviewedBy === 'TEACHER' ? '師審' : '幹審'}
                                  </span>
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400">{errand.status === 'IN_PROGRESS' ? '進行中' : '-'}</span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {errands.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-10 text-center text-slate-400 italic">
                          尚無公差資料
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'students' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {students.sort((a, b) => parseInt(a.seatNumber) - parseInt(b.seatNumber)).map(student => (
                <div key={student.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 group relative">
                  <div className="flex justify-between items-start">
                    <div className="bg-indigo-50 text-indigo-700 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm">
                      {student.seatNumber}
                    </div>
                    {currentUser.role === 'TEACHER' && (
                      <button 
                        onClick={() => removeStudent(student.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                  <h3 className="text-lg font-bold mt-3">{student.name}</h3>
                </div>
              ))}
              {students.length === 0 && (
                <div className="col-span-full py-20 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
                  <Users size={48} className="mx-auto text-slate-300 mb-4" />
                  <p className="text-slate-500 font-medium">尚未匯入學生名單</p>
                  <p className="text-slate-400 text-sm mt-1">請點擊上方按鈕手動新增</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'manage' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
              <h3 className="text-xl font-bold mb-6">公差名單維護</h3>
              <div className="space-y-4">
                {errands.filter(e => e.status === 'PENDING').map(errand => (
                  <div key={errand.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold">{errand.studentName}</span>
                        <span className="text-xs bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">{errand.date}</span>
                      </div>
                      <p className="text-sm text-slate-600">{errand.reason}</p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setShowAssignTask(errand)}
                        className="bg-white border border-indigo-200 text-indigo-600 px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-indigo-50"
                      >
                        分派任務
                      </button>
                      {currentUser.role === 'TEACHER' && (
                        <button 
                          onClick={() => deleteErrand(errand.id)}
                          className="bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-red-50 shadow-sm"
                        >
                          註銷
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {errands.filter(e => e.status === 'PENDING').length === 0 && (
                  <div className="text-center py-10">
                    <Clock size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-slate-400 italic">暫無待處理的公差申請</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'assignment' && (
             <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
              <h3 className="text-xl font-bold mb-6">任務分派中心</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-slate-100 rounded-2xl p-6 bg-indigo-50/30">
                  <h4 className="font-bold text-indigo-900 mb-4 flex items-center gap-2 text-lg">
                    <Calendar size={20} />
                    近期指派
                  </h4>
                  <div className="space-y-3">
                    {errands.filter(e => e.status === 'IN_PROGRESS').map(e => (
                      <div key={e.id} className="bg-white p-3 rounded-xl shadow-sm flex justify-between items-center">
                        <div>
                          <p className="font-bold text-sm">{e.studentName}</p>
                          <p className="text-xs text-indigo-600 font-medium">{e.assignedTask}</p>
                        </div>
                        <p className="text-[10px] text-slate-400">{e.assignmentDate}</p>
                      </div>
                    ))}
                    {errands.filter(e => e.status === 'IN_PROGRESS').length === 0 && (
                      <p className="text-center py-8 text-slate-400 text-sm bg-white/50 rounded-xl italic">
                        目前沒有進行中的任務
                      </p>
                    )}
                  </div>
                </div>

                <div className="border border-slate-100 rounded-2xl p-6 bg-slate-50">
                  <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2 text-lg">
                    <CheckCircle2 size={20} />
                    昨日/今日已完成
                  </h4>
                  <div className="space-y-3">
                    {errands.filter(e => e.status === 'COMPLETED').slice(0, 5).map(e => (
                      <div key={e.id} className="bg-white p-3 rounded-xl border border-slate-100 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-600">
                          <CheckCircle2 size={16} />
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-sm">{e.studentName}</p>
                          <p className="text-xs text-slate-500">{e.assignedTask}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-slate-400">{e.reviewTimestamp ? format(new Date(e.reviewTimestamp), 'HH:mm') : ''}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
             </div>
          )}
        </section>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showAddStudent && (
          <Modal title="新增學生名單" onClose={() => setShowAddStudent(false)}>
            <StudentForm onSubmit={addStudent} />
          </Modal>
        )}
        {showAddErrand && (
          <Modal title="登錄公差事由" onClose={() => setShowAddErrand(false)}>
            <ErrandForm students={students} onSubmit={addErrand} />
          </Modal>
        )}
        {showAssignTask && (
          <Modal title={`指派任務: ${showAssignTask.studentName}`} onClose={() => setShowAssignTask(null)}>
            <AssignTaskForm 
              onSubmit={(task, date) => assignTask(showAssignTask.id, task, date)} 
            />
          </Modal>
        )}
        {showReview && (
          <Modal title={`審核任務完成: ${showReview.studentName}`} onClose={() => setShowReview(null)}>
            <ReviewForm 
              task={showReview.assignedTask || ''} 
              onSubmit={(proof) => reviewErrand(showReview.id, proof)} 
            />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Subcomponents ---

function LoginScreen({ onLogin, loginRole, setLoginRole }: { 
  onLogin: (role: Role, pass?: string) => void, 
  loginRole: Role | null, 
  setLoginRole: (role: Role | null) => void 
}) {
  const [password, setPassword] = useState('');

  const handleRoleClick = (role: Role) => {
    if (role === 'STUDENT') {
      onLogin('STUDENT');
    } else {
      setLoginRole(role);
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 bg-[url('https://images.unsplash.com/photo-1517404215738-15263e9f9178?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"></div>
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden relative z-10 p-10"
      >
        <AnimatePresence mode="wait">
          {!loginRole ? (
            <motion.div 
              key="roles"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <div className="flex flex-col items-center mb-10">
                <div className="bg-indigo-600 p-4 rounded-2xl text-white mb-6 shadow-indigo-100 shadow-xl">
                  <ClipboardList size={32} />
                </div>
                <h1 className="text-3xl font-black tracking-tight text-slate-900">班級公差系統</h1>
                <p className="text-slate-500 mt-2 font-medium">請選擇您的身份登入</p>
              </div>

              <div className="space-y-4">
                <LoginButton 
                  icon={<UserCircle size={22} />} 
                  label="導師登入 (Teacher)" 
                  onClick={() => handleRoleClick('TEACHER')}
                  variant="primary"
                />
                <LoginButton 
                  icon={<Settings size={22} />} 
                  label="幹部登入 (Officer)" 
                  onClick={() => handleRoleClick('OFFICER')}
                  variant="secondary"
                />
                <button 
                  onClick={() => handleRoleClick('STUDENT')}
                  className="w-full text-slate-500 text-sm font-medium hover:text-indigo-600 transition-colors py-2"
                >
                  以一般學生身份查看 (唯讀模式)
                </button>
                <div className="pt-6">
                  <p className="text-xs text-center text-slate-400 leading-relaxed">
                    導師擁有完整名單管理、公差審核、及「註銷」公差之權限。<br/>
                    幹部可新增公差、指派任務、及標記公差已完成。
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="password"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <button 
                onClick={() => setLoginRole(null)}
                className="text-slate-400 hover:text-slate-600 flex items-center gap-2 text-sm font-medium mb-4"
              >
                <ChevronRight size={16} className="rotate-180" />
                返回選擇身份
              </button>
              
              <div className="text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-900 mx-auto mb-4">
                  <Lock size={32} />
                </div>
                <h2 className="text-2xl font-bold">請輸入{loginRole === 'TEACHER' ? '導師' : '幹部'}密碼</h2>
                <p className="text-slate-500 text-sm mt-1">此操作需要權限驗證</p>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); onLogin(loginRole, password); }} className="space-y-4">
                <input 
                  type="password"
                  autoFocus
                  className="w-full px-4 py-4 rounded-2xl border-2 border-slate-100 focus:border-indigo-600 focus:ring-0 outline-none text-center text-xl tracking-[0.5em] font-black"
                  placeholder="••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all">
                  驗證並登入
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function LoginButton({ icon, label, onClick, variant }: { icon: React.ReactNode, label: string, onClick: () => void, variant: 'primary' | 'secondary' }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold transition-all active:scale-95 group",
        variant === 'primary' 
          ? "bg-slate-900 text-white hover:bg-slate-800" 
          : "bg-white border-2 border-slate-100 text-slate-700 hover:border-indigo-600 hover:text-indigo-600 shadow-sm"
      )}
    >
      <span className={cn("transition-transform group-hover:scale-110", variant === 'secondary' && "text-indigo-600")}>{icon}</span>
      {label}
    </button>
  );
}

function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all duration-200 border-2",
        active 
          ? "bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100" 
          : "text-slate-500 border-transparent hover:bg-slate-50 hover:text-slate-700"
      )}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string, onClose: () => void, children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" 
        onClick={onClose} 
      />
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl relative z-60 animate-in fade-in zoom-in duration-200"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-xl font-bold tracking-tight">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <Plus size={24} className="rotate-45 text-slate-400" />
          </button>
        </div>
        <div className="p-8">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

function StudentForm({ onSubmit }: { onSubmit: (name: string, seatNumber: string) => void }) {
  const [name, setName] = useState('');
  const [seat, setSeat] = useState('');

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); onSubmit(name, seat); }}>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-2">學生姓名</label>
        <input 
          required
          autoFocus
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none transition-all font-medium"
          placeholder="例如：王小明"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-2">座號</label>
        <input 
          required
          type="number"
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none transition-all font-medium"
          placeholder="例如：01"
          value={seat}
          onChange={(e) => setSeat(e.target.value)}
        />
      </div>
      <button className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 mt-4">
        確認新增
      </button>
    </form>
  );
}

function ErrandForm({ students, onSubmit }: { students: Student[], onSubmit: (sid: string, date: string, res: string, desc: string, img: string | null) => void }) {
  const [sid, setSid] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reason, setReason] = useState('各處室遞送公文');
  const [desc, setDesc] = useState('');
  const [img, setImg] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImg(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); onSubmit(sid, date, reason, desc, img); }}>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-2">選擇學生</label>
        <select 
          required
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-600 outline-none font-medium"
          value={sid}
          onChange={(e) => setSid(e.target.value)}
        >
          <option value="">請選擇一位學生...</option>
          {students.map(s => <option key={s.id} value={s.id}>{s.seatNumber} - {s.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">公差日期</label>
          <input 
            type="date"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-600 outline-none font-medium"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">標題事由</label>
          <select 
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-600 outline-none font-medium"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {PRESET_TASKS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-2">詳細說明 (文字)</label>
        <textarea 
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-600 outline-none font-medium min-h-[100px]"
          placeholder="請輸入詳細內容..."
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-2">相關附件/照片證據 (選填)</label>
        <div className="relative">
          <input type="file" accept="image/*" className="hidden" id="file-upload" onChange={handleFileChange} />
          <label htmlFor="file-upload" className="w-full border-2 border-dashed border-slate-200 rounded-xl py-6 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 transition-all">
            {img ? (
              <img src={img} className="h-32 w-full object-contain mb-2" alt="Uploaded" />
            ) : (
              <>
                <Upload size={24} className="text-slate-400 mb-2" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">點擊或拖曳上傳</span>
              </>
            )}
          </label>
        </div>
      </div>
      <button disabled={!sid} className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 disabled:opacity-50">
        確認登錄公差
      </button>
    </form>
  );
}

function AssignTaskForm({ onSubmit }: { onSubmit: (task: string, date: string) => void }) {
  const [task, setTask] = useState(PRESET_TASKS[0]);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); onSubmit(task, date); }}>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-2 text-center">指派具體任務內容</label>
        <div className="grid grid-cols-2 gap-3">
          {PRESET_TASKS.map(t => (
            <button
              type="button"
              key={t}
              onClick={() => setTask(t)}
              className={cn(
                "py-3 px-4 rounded-2xl text-sm font-bold transition-all",
                task === t ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "bg-white border-2 border-slate-100 text-slate-600 hover:border-indigo-200"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-2">指派日期</label>
        <input 
          type="date"
          className="w-full px-4 py-3 rounded-xl border border-slate-200 outline-none font-medium text-center"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <button className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold hover:bg-slate-900 transition-all mt-4">
        送出指派
      </button>
    </form>
  );
}

function ReviewForm({ task, onSubmit }: { task: string, onSubmit: (proof: string | null) => void }) {
  const [proof, setProof] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setProof(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); onSubmit(proof); }}>
      <div className="text-center bg-indigo-50 p-6 rounded-2xl border border-indigo-100 mb-6">
        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-1">正在核核任務</p>
        <p className="text-2xl font-black text-indigo-900">{task}</p>
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center justify-between">
          <span>完成證明 (上傳照片證物)</span>
          <span className="text-[10px] text-red-500">* 必要</span>
        </label>
        <div className="relative">
          <input type="file" accept="image/*" className="hidden" id="proof-upload" onChange={handleFileChange} />
          <label htmlFor="proof-upload" className="w-full border-2 border-dashed border-slate-200 rounded-2xl min-h-[160px] flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-slate-50 transition-all overflow-hidden group">
            {proof ? (
              <img src={proof} className="w-full h-full object-cover" alt="Proof" />
            ) : (
              <div className="text-center p-4">
                <Upload size={32} className="text-slate-300 mx-auto mb-2 transition-transform group-hover:-translate-y-1" />
                <p className="text-sm font-bold text-slate-400">點擊上傳完成證明照片</p>
                <p className="text-[10px] text-slate-300 mt-1 uppercase tracking-tight">Camera / Files</p>
              </div>
            )}
          </label>
        </div>
      </div>
      <button disabled={!proof} className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-indigo-600 transition shadow-xl shadow-slate-200 disabled:opacity-50">
        標記為已完成 (並留存審核紀錄)
      </button>
    </form>
  );
}

function StatusBadge({ status }: { status: ErrandStatus }) {
  const styles = {
    PENDING: "bg-slate-100 text-slate-600",
    IN_PROGRESS: "bg-blue-100 text-blue-700 animate-pulse",
    COMPLETED: "bg-green-100 text-green-700"
  };
  const labels = {
    PENDING: "待處理",
    IN_PROGRESS: "執行中",
    COMPLETED: "已完成"
  };

  return (
    <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", styles[status])}>
      {labels[status]}
    </span>
  );
}

function ErrandStats({ errands }: { errands: Errand[] }) {
  const completed = errands.filter(e => e.status === 'COMPLETED').length;
  const inProgress = errands.filter(e => e.status === 'IN_PROGRESS').length;
  const pending = errands.filter(e => e.status === 'PENDING').length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <StatCard label="待分派公差" value={pending} color="slate" icon={<Clock size={20} />} />
      <StatCard label="任務執行中" value={inProgress} color="indigo" icon={<ChevronRight size={20} />} />
      <StatCard label="今日已結案" value={completed} color="green" icon={<CheckCircle2 size={20} />} />
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string, value: number, color: string, icon: React.ReactNode }) {
  const themes: Record<string, string> = {
    slate: "bg-white border-slate-200 text-slate-900",
    indigo: "bg-white border-indigo-100 text-indigo-700",
    green: "bg-white border-green-100 text-green-700"
  };

  return (
    <div className={cn("p-6 rounded-3xl border-2 shadow-sm transition-all hover:shadow-md", themes[color])}>
      <div className="flex justify-between items-start mb-4">
        <div className="p-2 rounded-xl bg-slate-50">{icon}</div>
        <span className="text-4xl font-black">{value}</span>
      </div>
      <p className="text-sm font-bold opacity-70 uppercase tracking-wide">{label}</p>
    </div>
  );
}
