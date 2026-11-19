import React, { useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import {
  formatDateTime,
  getReminderCategoryLabel,
  maskPatientName,
} from '../lib/clinicalHelpers';
import {
  createCareReminder,
  deleteCareReminder,
  updateReminderStatus,
} from '../lib/nursingService';
import {
  type PushPermissionState,
  requestPushPermission,
  sendClinicalPushNotification,
} from '../lib/pushNotifications';
import {
  type CareReminder,
  FIELD_LIMITS,
  type PatientChart,
  type ReminderCategory,
  type UserProfile,
} from '../types/nursing';

interface RemindersPushViewProps {
  profile: UserProfile;
  patients: PatientChart[];
  reminders: CareReminder[];
  privacyMask: boolean;
  permissionState: PushPermissionState;
  onPermissionChange: (state: PushPermissionState) => void;
}

export const RemindersPushView: React.FC<RemindersPushViewProps> = ({
  profile,
  patients,
  reminders,
  privacyMask,
  permissionState,
  onPermissionChange,
}) => {
  const canWrite = profile.role !== 'supervisor_viewer';

  const [patientId, setPatientId] = useState(patients[0]?.patientId || '');
  const [title, setTitle] = useState('Q2H 翻身拍背與受壓部位皮膚檢視');
  const [category, setCategory] = useState<ReminderCategory>('turning');
  const [delayMinutes, setDelayMinutes] = useState<number>(30);
  const [repeatMinutes, setRepeatMinutes] = useState<number>(120);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const patientMap = new Map(patients.map((p) => [p.patientId, p]));

  const handleEnablePush = async () => {
    const res = await requestPushPermission();
    onPermissionChange(res);
    if (res === 'granted') {
      await sendClinicalPushNotification({
        title: '護安錄 CareNote RN 已啟用行動推播',
        body: '您將即時收到特護病患的生命徵象量測、翻身與交班提醒。',
      });
      setFeedback('已授權行動與桌面系統推播通知，並已發送確認推播。');
    } else if (res === 'denied') {
      setFeedback('瀏覽器已封鎖通知權限，請至裝置或瀏覽器網站設定開啟「通知」。');
    }
  };

  const handleTestPush = async () => {
    const sent = await sendClinicalPushNotification({
      title: '臨床排程測試推播 · CareNote RN',
      body: '提醒：請於 5 分鐘內完成特護床位生命徵象覆評與管路固定檢視。',
      requireInteraction: true,
    });
    setFeedback(
      sent
        ? '已送出測試推播至作業系統通知中心。'
        : '推播未發送，請先點擊上方按鈕授權瀏覽器通知權限。'
    );
  };

  const handleCreateReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    const patient = patientMap.get(patientId || patients[0]?.patientId || '');
    if (!patient) {
      setFeedback('請先建立或選擇照護病患。');
      return;
    }
    if (!title.trim()) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      await createCareReminder(profile, patient, {
        title,
        category,
        dueAtMs: Date.now() + Math.max(1, delayMinutes) * 60 * 1000,
        repeatMinutes,
      });
      setFeedback(`已建立推播排程：「${title}」，將於 ${delayMinutes} 分鐘後提醒。`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '建立提醒失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSnooze = async (rem: CareReminder) => {
    await updateReminderStatus(rem.reminderId, 'snoozed', Date.now() + 15 * 60 * 1000);
  };

  const handleComplete = async (rem: CareReminder) => {
    if (rem.repeatMinutes > 0) {
      await updateReminderStatus(
        rem.reminderId,
        'pending',
        Date.now() + rem.repeatMinutes * 60 * 1000
      );
      setFeedback(`已完成「${rem.title}」，並自動排程下一次週期（${rem.repeatMinutes} 分鐘後）。`);
    } else {
      await updateReminderStatus(rem.reminderId, 'completed');
    }
  };

  return (
    <div className="space-y-6">
      {/* Push Notification Status Card */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-teal-700 dark:text-teal-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              行動裝置與桌面推播通知整合
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            目前權限狀態：
            <span className="font-semibold ml-1">
              {permissionState === 'granted'
                ? '已開啟（可接收鎖屏與背景通知）'
                : permissionState === 'denied'
                ? '已封鎖（需於瀏覽器設定重新允許）'
                : permissionState === 'unsupported'
                ? '此裝置瀏覽器不支援 Web Push'
                : '尚未授權'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {permissionState !== 'granted' && permissionState !== 'unsupported' && (
            <button
              type="button"
              onClick={() => void handleEnablePush()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Bell className="w-3.5 h-3.5" />
              啟用推播提醒權限
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleTestPush()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            發送測試推播
          </button>
        </div>
      </section>

      {feedback && (
        <div className="p-3.5 text-xs font-medium bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-teal-900 dark:text-teal-200 rounded-lg">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Create Reminder Form */}
        {canWrite && (
          <form
            onSubmit={(e) => void handleCreateReminder(e)}
            className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Plus className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              新增特別護理推播排程
            </h3>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                照護病患
              </label>
              <select
                value={patientId || patients[0]?.patientId || ''}
                onChange={(e) => setPatientId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                {patients.length === 0 ? (
                  <option value="">尚無授權病患</option>
                ) : (
                  patients.map((p) => (
                    <option key={p.patientId} value={p.patientId}>
                      {p.bedNumber} · {maskPatientName(p.fullName, privacyMask)}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                提醒類別
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ReminderCategory)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="turning">翻身拍背照護</option>
                <option value="vitals">生命徵象量測</option>
                <option value="medication">給藥與點滴檢視</option>
                <option value="assessment">傷口與管路評估</option>
                <option value="handover">交班紀錄截止</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                推播提醒內容
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.REMINDER_TITLE_MAX}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  首次推播（幾分鐘後）
                </label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={delayMinutes}
                  onChange={(e) => setDelayMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono-num bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  週期重複（0 = 單次）
                </label>
                <select
                  value={repeatMinutes}
                  onChange={(e) => setRepeatMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  <option value={0}>不重複 (單次)</option>
                  <option value={60}>每 1 小時 (Q1H)</option>
                  <option value={120}>每 2 小時 (Q2H)</option>
                  <option value={240}>每 4 小時 (Q4H)</option>
                  <option value={480}>每 8 小時 (Q8H)</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || patients.length === 0}
              className="w-full py-2.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              {submitting ? '排程建立中...' : '建立行動推播提醒'}
            </button>
          </form>
        )}

        {/* Active Reminder List */}
        <section
          className={`${
            canWrite ? 'lg:col-span-7' : 'lg:col-span-12'
          } bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden`}
        >
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              排程清單 ({reminders.length})
            </h3>
          </div>

          {reminders.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <Clock className="w-7 h-7 text-slate-300 mx-auto" />
              <div>尚無護理排程提醒</div>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {reminders.map((rem) => {
                const isDone = rem.status === 'completed';
                const isOverdue = !isDone && rem.dueAtMs <= Date.now();
                return (
                  <div
                    key={rem.reminderId}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {rem.bedNumber} · {maskPatientName(rem.patientName, privacyMask)} ·{' '}
                        {getReminderCategoryLabel(rem.category)}
                        {rem.repeatMinutes > 0 ? ` · 每 ${rem.repeatMinutes} 分鐘` : ''}
                      </div>
                      <div
                        className={`text-sm font-medium ${
                          isDone
                            ? 'line-through text-slate-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {rem.title}
                      </div>
                      <div
                        className={`text-xs font-mono-num ${
                          isDone
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : isOverdue
                            ? 'text-red-600 dark:text-red-400 font-medium'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {isDone
                          ? '已完成執行'
                          : `${isOverdue ? '已到期 · ' : '預定時間 · '}${formatDateTime(rem.dueAtMs)}`}
                      </div>
                    </div>

                    {canWrite && (
                      <div className="flex items-center gap-2 shrink-0">
                        {!isDone && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleSnooze(rem)}
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                            >
                              延後 15 分
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleComplete(rem)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 rounded-lg cursor-pointer whitespace-nowrap"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              完成
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => void deleteCareReminder(rem.reminderId)}
                          className="p-1.5 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                          aria-label="刪除提醒"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
