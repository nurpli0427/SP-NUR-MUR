import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import {
  Activity,
  Bell,
  Cloud,
  CloudOff,
  Eye,
  EyeOff,
  FileText,
  LogOut,
  Menu,
  Moon,
  Plus,
  Shield,
  Stethoscope,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { DashboardMonitorView } from './components/DashboardMonitorView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PatientsView } from './components/PatientsView';
import { PrivacyBackupView } from './components/PrivacyBackupView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { RecordWorkspaceView } from './components/RecordWorkspaceView';
import { RemindersPushView } from './components/RemindersPushView';
import { SignInView } from './components/SignInView';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { getRoleLabel } from './lib/clinicalHelpers';
import { auth, googleProvider } from './lib/firebase';
import {
  ensureUserProfile,
  subscribeAuditLogs,
  subscribeCareRecords,
  subscribePatients,
  subscribeReminders,
  subscribeStaffDirectory,
  updateReminderStatus,
} from './lib/nursingService';
import { createBackupSnapshot } from './lib/offlineBackup';
import {
  getPushPermissionState,
  type PushPermissionState,
  sendClinicalPushNotification,
} from './lib/pushNotifications';
import type {
  AuditLog,
  CareRecord,
  CareReminder,
  LocalDraftEntry,
  PatientChart,
  StaffPublicProfile,
  UserProfile,
} from './types/nursing';

type NavSection = 'monitor' | 'records' | 'patients' | 'reminders' | 'privacy_backup';

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'monitor', label: '即時監控看板', icon: Activity },
  { id: 'records', label: '護理紀錄編寫', icon: FileText },
  { id: 'patients', label: '病患名單與權限', icon: Users },
  { id: 'reminders', label: '行動推播提醒', icon: Bell },
  { id: 'privacy_backup', label: '隱私稽核與備份', icon: Shield },
];

export default function App() {
  const isOnline = useOnlineStatus();
  const [darkMode, setDarkMode] = useState(false);
  const [privacyMask, setPrivacyMask] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [redirectChecked, setRedirectChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [redirectCookieBlocked, setRedirectCookieBlocked] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [activeSection, setActiveSection] = useState<NavSection>('monitor');
  const [patients, setPatients] = useState<PatientChart[]>([]);
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [reminders, setReminders] = useState<CareReminder[]>([]);
  const [staffList, setStaffList] = useState<StaffPublicProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [hasPendingSync, setHasPendingSync] = useState(false);

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [initialPatientForNewRecord, setInitialPatientForNewRecord] = useState<string | undefined>(
    undefined
  );
  const [restoredDraft, setRestoredDraft] = useState<LocalDraftEntry | null>(null);
  const [pushPermission, setPushPermission] = useState<PushPermissionState>(
    getPushPermissionState()
  );

  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  // Surface a manual recovery option if initialization takes longer than 4 seconds
  useEffect(() => {
    if (authReady && redirectChecked) return;
    const timer = window.setTimeout(() => {
      setLoadingTimedOut(true);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [authReady, redirectChecked]);

  // Complete any pending signInWithRedirect result (with 3.5s timeout guard)
  useEffect(() => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setRedirectChecked(true);
      }
    }, 3500);

    void getRedirectResult(auth)
      .then((result) => {
        if (settled) return;
        const attempted = sessionStorage.getItem('carenote_redirect_attempted') === '1';
        if (result?.user) {
          sessionStorage.removeItem('carenote_redirect_attempted');
        } else if (attempted && !auth.currentUser) {
          sessionStorage.removeItem('carenote_redirect_attempted');
          setPopupBlocked(false);
          setRedirectCookieBlocked(true);
          setAuthError(
            '已完成 Google 跳轉，但瀏覽器阻擋跨網域暫存憑證（第三方 Cookie），導致登入狀態無法回傳。'
          );
        }
      })
      .catch((err) => {
        if (settled) return;
        sessionStorage.removeItem('carenote_redirect_attempted');
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/unauthorized-domain') {
          setAuthError(
            `目前網域（${window.location.hostname}）尚未加入 Firebase 授權網域。請至 Firebase Console (sp-nur-mur) → Authentication → Settings → Authorized domains 新增此網域。`
          );
        } else {
          setAuthError(err instanceof Error ? err.message : 'Google 跳轉登入失敗，請再試一次。');
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!settled) {
          settled = true;
          setRedirectChecked(true);
        }
      });

    return () => window.clearTimeout(timeoutId);
  }, []);

  // Listen to Firebase Auth state (with 5s safety fallback so loading never stalls)
  useEffect(() => {
    let active = true;
    const fallbackTimer = window.setTimeout(() => {
      if (active) {
        setAuthReady(true);
      }
    }, 5000);

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      window.clearTimeout(fallbackTimer);
      setFirebaseUser(user);
      if (user) {
        const isBootstrap =
          user.email?.toLowerCase() === 'nurpli0427@gmail.com' && user.emailVerified;
        const fallbackProfile: UserProfile = {
          uid: user.uid,
          displayName: user.displayName || user.email?.split('@')[0] || '特別護理師',
          email: user.email || '',
          role: isBootstrap ? 'head_nurse' : 'special_nurse',
          department: isBootstrap ? '特護督導中心' : '重症特別護理組',
          licenseNo: '',
          signatureText: `特別護理師 ${user.displayName || user.email?.split('@')[0] || '護理師'} RN`,
          pushEnabled: true,
        };

        try {
          const userProfile = await Promise.race<UserProfile>([
            ensureUserProfile(user),
            new Promise<UserProfile>((resolve) => {
              window.setTimeout(() => resolve(fallbackProfile), 6000);
            }),
          ]);
          if (!active) return;
          setProfile(userProfile);
          setAuthError(null);
          setPopupBlocked(false);
          setRedirectCookieBlocked(false);
        } catch (err) {
          if (!active) return;
          setAuthError(err instanceof Error ? err.message : '載入使用者權限失敗');
        }
      } else {
        setProfile(null);
        setPatients([]);
        setRecords([]);
        setReminders([]);
        setStaffList([]);
        setAuditLogs([]);
      }
      if (active) {
        setAuthReady(true);
      }
    });

    return () => {
      active = false;
      window.clearTimeout(fallbackTimer);
      unsub();
    };
  }, []);

  const isBootstrappedAdmin = Boolean(
    firebaseUser?.email?.toLowerCase() === 'nurpli0427@gmail.com' &&
      firebaseUser?.emailVerified
  );

  // Subscribe to Firestore real-time collections ONLY after auth & profile are ready
  useEffect(() => {
    if (!firebaseUser || !profile) return;

    const isAdminUser = profile.role === 'head_nurse' || isBootstrappedAdmin;

    const unsubs = [
      subscribeStaffDirectory(isAdminUser, setStaffList),
      subscribePatients(firebaseUser.uid, isBootstrappedAdmin, setPatients),
      subscribeCareRecords(firebaseUser.uid, isBootstrappedAdmin, (items, pending) => {
        setRecords(items);
        setHasPendingSync(pending);
      }),
      subscribeReminders(firebaseUser.uid, isBootstrappedAdmin, setReminders),
      subscribeAuditLogs(firebaseUser.uid, isBootstrappedAdmin, setAuditLogs),
    ];

    return () => {
      for (const u of unsubs) u();
    };
  }, [firebaseUser, profile, isBootstrappedAdmin]);

  const triggerBackup = useCallback(
    async (triggerType: 'auto' | 'manual' | 'pre_sign') => {
      if (!profile) return;
      await createBackupSnapshot({
        triggerType,
        nurseUid: profile.uid,
        nurseName: profile.displayName,
        patients,
        records,
      });
    },
    [profile, patients, records]
  );

  // Automatic local IndexedDB backup every 60 seconds
  useEffect(() => {
    if (!profile) return;
    const timer = window.setInterval(() => {
      void triggerBackup('auto');
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [profile, triggerBackup]);

  // Real-time mobile/desktop push reminder loop (checks every 15s)
  useEffect(() => {
    if (!profile || reminders.length === 0) return;
    const checkDue = () => {
      const now = Date.now();
      for (const rem of reminders) {
        if (rem.status === 'pending' && rem.dueAtMs <= now) {
          void sendClinicalPushNotification({
            title: `特別護理提醒 · ${rem.bedNumber}`,
            body: rem.title,
            tag: rem.reminderId,
            requireInteraction: true,
          });
          void updateReminderStatus(rem.reminderId, 'notified');
        }
      }
    };
    checkDue();
    const interval = window.setInterval(checkDue, 15_000);
    return () => window.clearInterval(interval);
  }, [profile, reminders]);

  const isEmbeddedIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const handleSignIn = async () => {
    setAuthError(null);
    setPopupBlocked(false);
    setRedirectCookieBlocked(false);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        setPopupBlocked(true);
        setAuthError(
          isEmbeddedIframe
            ? '目前預覽內嵌視窗的彈出視窗遭瀏覽器封鎖（auth/popup-blocked）。請於瀏覽器網址列右側點擊「允許彈出式視窗」後重試，或點擊下方「在新分頁開啟並登入」。'
            : '瀏覽器封鎖了 Google 登入彈出視窗（auth/popup-blocked）。請點擊瀏覽器網址列右側「封鎖彈出式視窗」圖示並設為「永遠允許」，再重新點擊主登入按鈕；或點擊下方「改用整頁跳轉登入 (Redirect)」。'
        );
      } else if (code === 'auth/unauthorized-domain') {
        setAuthError(
          `目前網域（${window.location.hostname}）尚未加入 Firebase 授權網域。請至 Firebase Console (sp-nur-mur) → Authentication → Settings → Authorized domains 新增此網域。`
        );
      } else if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        setAuthError('Google 登入視窗已關閉或取消，請再試一次。');
      } else {
        setAuthError(err instanceof Error ? err.message : 'Google 帳號登入取消或失敗');
      }
    }
  };

  const handleSignInRedirect = async () => {
    setAuthError(null);
    try {
      sessionStorage.setItem('carenote_redirect_attempted', '1');
      await signInWithRedirect(auth, googleProvider);
    } catch (err) {
      sessionStorage.removeItem('carenote_redirect_attempted');
      setAuthError(
        err instanceof Error
          ? err.message
          : '跳轉登入失敗，請改為允許彈出式視窗後再試。'
      );
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const selectedRecord = useMemo(
    () => records.find((r) => r.recordId === selectedRecordId) || null,
    [records, selectedRecordId]
  );

  const refreshProfile = async () => {
    if (firebaseUser) {
      const updated = await ensureUserProfile(firebaseUser);
      setProfile(updated);
    }
  };

  if (!authReady || !redirectChecked) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-sm text-slate-600 dark:text-slate-300">
          正在連線至臨床資料庫與驗證安全權限...
        </div>
        {loadingTimedOut && (
          <button
            type="button"
            onClick={() => {
              setAuthReady(true);
              setRedirectChecked(true);
            }}
            className="px-4 py-2 text-xs font-medium text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 rounded-lg transition-colors cursor-pointer"
          >
            連線時間較長，點擊略過等待並繼續
          </button>
        )}
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    return (
      <ErrorBoundary>
        <SignInView
          onSignIn={handleSignIn}
          onSignInRedirect={handleSignInRedirect}
          error={authError}
          popupBlocked={popupBlocked}
          redirectCookieBlocked={redirectCookieBlocked}
          isEmbeddedIframe={isEmbeddedIframe}
          activeAuthDomain={auth.app.options.authDomain || ''}
        />
      </ErrorBoundary>
    );
  }

  const currentNavTitle = NAV_ITEMS.find((n) => n.id === activeSection)?.label || '即時監控看板';
  const canWrite = profile.role !== 'supervisor_viewer';

  return (
    <ErrorBoundary>
      <div className="app-shell-root min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-30">
          <div className="h-16 px-5 flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-800">
            <div className="w-8 h-8 rounded-lg bg-teal-700 flex items-center justify-center text-white shrink-0">
              <Stethoscope className="w-4 h-4" />
            </div>
            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
              護安錄 CareNote RN
            </span>
          </div>

          <nav className="flex-1 p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Sync & Nurse Account Footer */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-xs">
              {isOnline ? (
                <>
                  <Cloud className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  <span className="text-slate-600 dark:text-slate-300">
                    {hasPendingSync ? '雲端同步中...' : '雲端即時連線中'}
                  </span>
                </>
              ) : (
                <>
                  <CloudOff className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-amber-700 dark:text-amber-400 font-medium">
                    離線編輯模式（本機自動備份）
                  </span>
                </>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {profile.displayName}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {getRoleLabel(profile.role)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="p-1.5 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                title="登出系統"
                aria-label="登出系統"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-950/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative w-64 max-w-[80vw] bg-white dark:bg-slate-900 h-full flex flex-col border-r border-slate-200 dark:border-slate-800 z-10">
              <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  護安錄 CareNote RN
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 text-slate-500"
                  aria-label="關閉選單"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 p-3 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveSection(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg ${
                        active
                          ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="text-xs">
                  <div className="font-semibold">{profile.displayName}</div>
                  <div className="text-slate-500">{getRoleLabel(profile.role)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="text-xs text-red-600 font-medium"
                >
                  登出
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
          {/* Top Workspace Header */}
          <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300"
                aria-label="開啟導覽選單"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">
                護安錄 <span className="mx-1.5">/</span>
                <span className="text-slate-900 dark:text-slate-100 font-semibold">
                  {currentNavTitle}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <PWAInstallButton />

              <button
                type="button"
                onClick={() => setPrivacyMask((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  privacyMask
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                    : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                }`}
                title="遮罩病患姓名與病歷號以防旁人窺視"
              >
                {privacyMask ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {privacyMask ? '隱私遮罩中' : '隱私遮罩'}
              </button>

              <button
                type="button"
                onClick={() => setDarkMode((v) => !v)}
                className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                aria-label="切換深淺色主題"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRecordId(null);
                    setInitialPatientForNewRecord(patients[0]?.patientId);
                    setActiveSection('records');
                  }}
                  className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新增護理紀錄
                </button>
              )}
            </div>
          </header>

          {/* Offline Banner (Non-intrusive) */}
          {!isOnline && (
            <div className="bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-900 px-6 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
              <span>
                目前為離線狀態：可正常編寫與儲存 SOAP / DART 護理紀錄，資料已暫存於本機保險庫，恢復網路後將自動同步雲端。
              </span>
            </div>
          )}

          {/* Main Workspace Content */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
            {activeSection === 'monitor' && (
              <DashboardMonitorView
                patients={patients}
                records={records}
                reminders={reminders}
                privacyMask={privacyMask}
                canWrite={canWrite}
                onSelectRecord={(rec) => {
                  setSelectedRecordId(rec.recordId);
                  setActiveSection('records');
                }}
                onCreateNewRecord={(pid) => {
                  setSelectedRecordId(null);
                  setInitialPatientForNewRecord(pid || patients[0]?.patientId);
                  setActiveSection('records');
                }}
                onGoReminders={() => setActiveSection('reminders')}
                onCompleteReminder={async (rem) => {
                  if (rem.repeatMinutes > 0) {
                    await updateReminderStatus(
                      rem.reminderId,
                      'pending',
                      Date.now() + rem.repeatMinutes * 60 * 1000
                    );
                  } else {
                    await updateReminderStatus(rem.reminderId, 'completed');
                  }
                }}
              />
            )}

            {activeSection === 'records' && (
              <RecordWorkspaceView
                profile={profile}
                isBootstrappedAdmin={isBootstrappedAdmin}
                patients={patients}
                records={records}
                selectedRecord={selectedRecord}
                initialPatientId={initialPatientForNewRecord}
                privacyMask={privacyMask}
                isOnline={isOnline}
                restoredDraft={restoredDraft}
                onClearRestoredDraft={() => setRestoredDraft(null)}
                onSelectRecord={(rec) => setSelectedRecordId(rec?.recordId || null)}
                onTriggerAutoBackup={triggerBackup}
              />
            )}

            {activeSection === 'patients' && (
              <PatientsView
                profile={profile}
                patients={patients}
                staffList={staffList}
                privacyMask={privacyMask}
                onStartRecordForPatient={(pid) => {
                  setSelectedRecordId(null);
                  setInitialPatientForNewRecord(pid);
                  setActiveSection('records');
                }}
              />
            )}

            {activeSection === 'reminders' && (
              <RemindersPushView
                profile={profile}
                patients={patients}
                reminders={reminders}
                privacyMask={privacyMask}
                permissionState={pushPermission}
                onPermissionChange={setPushPermission}
              />
            )}

            {activeSection === 'privacy_backup' && (
              <PrivacyBackupView
                profile={profile}
                staffList={staffList}
                auditLogs={auditLogs}
                onTriggerManualBackup={() => triggerBackup('manual')}
                onRestoreDraft={(draft) => {
                  setRestoredDraft(draft);
                  setSelectedRecordId(draft.recordId || null);
                  setActiveSection('records');
                }}
                onProfileUpdated={refreshProfile}
              />
            )}
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );
}
