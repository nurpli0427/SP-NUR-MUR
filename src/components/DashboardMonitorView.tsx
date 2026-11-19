import React from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  Users,
} from 'lucide-react';
import {
  formatDateTime,
  getCareLevelLabel,
  getShiftLabel,
  getStatusLabel,
  maskMrn,
  maskPatientName,
} from '../lib/clinicalHelpers';
import type { CareRecord, CareReminder, PatientChart } from '../types/nursing';

interface DashboardMonitorViewProps {
  patients: PatientChart[];
  records: CareRecord[];
  reminders: CareReminder[];
  privacyMask: boolean;
  canWrite: boolean;
  onSelectRecord: (record: CareRecord) => void;
  onCreateNewRecord: (patientId?: string) => void;
  onGoReminders: () => void;
  onCompleteReminder: (reminder: CareReminder) => Promise<void>;
}

export const DashboardMonitorView: React.FC<DashboardMonitorViewProps> = ({
  patients,
  records,
  reminders,
  privacyMask,
  canWrite,
  onSelectRecord,
  onCreateNewRecord,
  onGoReminders,
  onCompleteReminder,
}) => {
  const activePatients = patients.filter((p) => p.status === 'active');
  const alertRecords = records.filter((r) => r.hasAlert || r.status === 'alert');
  const pendingReviewOrDraft = records.filter(
    (r) => r.status === 'draft' || r.status === 'pending_review'
  );
  const signedRecords = records.filter((r) => r.status === 'signed');
  const pendingOfflineSync = records.filter((r) => r._hasPendingWrites);
  const dueReminders = reminders.filter(
    (r) => r.status !== 'completed' && r.dueAtMs <= Date.now() + 30 * 60 * 1000
  );

  // Latest record per patient for bedside monitoring matrix
  const latestByPatient = new Map<string, CareRecord>();
  for (const rec of records) {
    if (!latestByPatient.has(rec.patientId)) {
      latestByPatient.set(rec.patientId, rec);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Metric Strip (Single-Elevation Hairline Grid) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>照護中病患</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold font-mono-num tabular-nums text-slate-900 dark:text-slate-100">
            {activePatients.length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            已指派授權總數 {patients.length} 位
          </div>
        </div>

        <div className="p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>待簽署 / 待覆核紀錄</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold font-mono-num tabular-nums text-amber-600 dark:text-amber-400">
            {pendingReviewOrDraft.length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            已定稿 {signedRecords.length} 筆 · 本地待同步 {pendingOfflineSync.length} 筆
          </div>
        </div>

        <div className="p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>生命徵象異常警示</span>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <div className="text-2xl font-bold font-mono-num tabular-nums text-red-600 dark:text-red-400">
            {alertRecords.length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {alertRecords.length > 0 ? '需即時追蹤與覆評' : '目前無異常警示'}
          </div>
        </div>

        <div className="p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>即將到期推播提醒</span>
            <BellRing className="w-4 h-4 text-teal-700 dark:text-teal-400" />
          </div>
          <div className="text-2xl font-bold font-mono-num tabular-nums text-teal-700 dark:text-teal-400">
            {dueReminders.length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            未來 30 分鐘內需執行項目
          </div>
        </div>
      </div>

      {/* Main Split: Real-time Patient Status Matrix + Urgent Alerts & Reminders */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                床邊特別護理即時監控狀態
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                即時反映各病患最新生命徵象、紀錄簽署狀態與雲端同步進度
              </p>
            </div>
            {canWrite && (
              <button
                type="button"
                onClick={() => onCreateNewRecord()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                快速建檔
              </button>
            )}
          </div>

          {activePatients.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <FileText className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                尚未建立或被指派任何照護病患
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                請前往「病患名單與權限」建立新病患並指派負責特別護理師，系統即會即時顯示臨床監控狀態。
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4 whitespace-nowrap">床號 / 病患</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">照護等級</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">最新生命徵象</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">紀錄狀態</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                  {activePatients.map((patient) => {
                    const latest = latestByPatient.get(patient.patientId);
                    const pName = maskPatientName(patient.fullName, privacyMask);
                    const mrn = maskMrn(patient.mrn, privacyMask);

                    return (
                      <tr
                        key={patient.patientId}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {patient.bedNumber} · {pName}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                            {mrn} · {patient.ward}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {getCareLevelLabel(patient.careLevel)}
                        </td>
                        <td className="py-3 px-4">
                          {latest ? (
                            <div className="text-xs font-mono-num tabular-nums text-slate-700 dark:text-slate-300 space-y-0.5">
                              <div>
                                T {latest.vitals.temperature.toFixed(1)}°C · P {latest.vitals.heartRate} · SpO2 {latest.vitals.spo2}%
                              </div>
                              <div className="text-slate-500 dark:text-slate-400">
                                BP {latest.vitals.bpSystolic}/{latest.vitals.bpDiastolic} · 疼痛 {latest.vitals.painScore}/10
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">尚無紀錄</span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {latest ? (
                            <div className="space-y-0.5">
                              <div
                                className={`text-xs font-medium ${
                                  latest.status === 'alert' || latest.hasAlert
                                    ? 'text-red-600 dark:text-red-400'
                                    : latest.status === 'signed'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-amber-700 dark:text-amber-400'
                                }`}
                              >
                                {latest.format} · {getStatusLabel(latest.status)}
                                {latest._hasPendingWrites ? ' · 離線待同步' : ''}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                                {formatDateTime(latest.recordedAtMs)} ·{' '}
                                {latest.status === 'signed'
                                  ? `簽名：${latest.signatureText || latest.signedByName}`
                                  : `暫記：${latest.authorName}`}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                              待建立首筆紀錄
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {latest ? (
                            <button
                              type="button"
                              onClick={() => onSelectRecord(latest)}
                              className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                            >
                              檢視 / 編輯
                            </button>
                          ) : canWrite ? (
                            <button
                              type="button"
                              onClick={() => onCreateNewRecord(patient.patientId)}
                              className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                            >
                              立即編寫
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right Column: Live Reminders & Alert Stream */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              即時警示與排程提醒
            </h2>
            <button
              type="button"
              onClick={onGoReminders}
              className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              管理排程
            </button>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 flex-1">
            {alertRecords.slice(0, 3).map((rec) => (
              <div key={rec.recordId} className="p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    臨床異常 · {rec.bedNumber} {maskPatientName(rec.patientName, privacyMask)}
                  </span>
                  <span className="text-xs text-slate-500 font-mono-num">
                    {formatDateTime(rec.recordedAtMs)}
                  </span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  {rec.alertReason || rec.focusTitle}
                </p>
                <button
                  type="button"
                  onClick={() => onSelectRecord(rec)}
                  className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  開啟紀錄處置
                </button>
              </div>
            ))}

            {dueReminders.slice(0, 5).map((rem) => {
              const isOverdue = rem.dueAtMs < Date.now();
              return (
                <div key={rem.reminderId} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-xs font-medium ${
                        isOverdue
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {isOverdue ? '已到期 · ' : '即將到期 · '}
                      {rem.bedNumber} {maskPatientName(rem.patientName, privacyMask)}
                    </span>
                    <span className="text-xs text-slate-500 font-mono-num">
                      {formatDateTime(rem.dueAtMs)}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {rem.title}
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => void onCompleteReminder(rem)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      標記已執行
                    </button>
                  )}
                </div>
              );
            })}

            {alertRecords.length === 0 && dueReminders.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
                <div>所有照護指標穩定，目前無待處置異常或到期提醒</div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Recent Shift Activity */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            最新護理紀錄動態（依時間排序）
          </h3>
        </div>
        {records.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            尚無護理紀錄，點擊上方「快速建檔」即可開始填寫 SOAP 或 DART 護理紀錄。
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {records.slice(0, 6).map((rec) => (
              <button
                key={rec.recordId}
                type="button"
                onClick={() => onSelectRecord(rec)}
                className="w-full text-left px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {rec.focusTitle}
                    <span className="ml-2 text-xs font-normal italic text-teal-700 dark:text-teal-400">
                      —— {rec.status === 'signed' ? `簽名：${rec.signatureText || rec.signedByName}` : `暫記：${rec.authorName}`}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {rec.bedNumber} · {maskPatientName(rec.patientName, privacyMask)} · {rec.format} · {getShiftLabel(rec.shift)}
                    {rec.amendmentReason ? ` · 已修訂：${rec.amendmentReason}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-xs font-medium ${
                      rec.status === 'signed'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : rec.status === 'alert' || rec.hasAlert
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {getStatusLabel(rec.status)}
                  </span>
                  <span className="text-xs text-slate-400 font-mono-num">
                    {formatDateTime(rec.recordedAtMs)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
