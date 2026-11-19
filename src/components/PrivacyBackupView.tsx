import React, { useEffect, useState } from 'react';
import {
  Archive,
  Download,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import { formatDateTime, getRoleLabel } from '../lib/clinicalHelpers';
import {
  downloadSnapshotJson,
  getAllLocalDrafts,
  getBackupSnapshots,
} from '../lib/offlineBackup';
import { updateMyProfile, updateStaffRole, writeAuditLog } from '../lib/nursingService';
import type {
  AuditLog,
  LocalBackupSnapshot,
  LocalDraftEntry,
  StaffPublicProfile,
  UserProfile,
  UserRole,
} from '../types/nursing';

interface PrivacyBackupViewProps {
  profile: UserProfile;
  staffList: StaffPublicProfile[];
  auditLogs: AuditLog[];
  onTriggerManualBackup: () => Promise<void>;
  onRestoreDraft: (draft: LocalDraftEntry) => void;
  onProfileUpdated: () => Promise<void>;
}

export const PrivacyBackupView: React.FC<PrivacyBackupViewProps> = ({
  profile,
  staffList,
  auditLogs,
  onTriggerManualBackup,
  onRestoreDraft,
  onProfileUpdated,
}) => {
  const isHeadNurse = profile.role === 'head_nurse';

  const [displayName, setDisplayName] = useState(profile.displayName);
  const [department, setDepartment] = useState(profile.department);
  const [licenseNo, setLicenseNo] = useState(profile.licenseNo);
  const [signatureText, setSignatureText] = useState(
    profile.signatureText || `特別護理師 ${profile.displayName} RN`
  );
  const [savingProfile, setSavingProfile] = useState(false);

  const [snapshots, setSnapshots] = useState<LocalBackupSnapshot[]>([]);
  const [drafts, setDrafts] = useState<LocalDraftEntry[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadLocalVault = async () => {
    const [snaps, localDrafts] = await Promise.all([
      getBackupSnapshots(),
      getAllLocalDrafts(),
    ]);
    setSnapshots(snaps);
    setDrafts(localDrafts);
  };

  useEffect(() => {
    void loadLocalVault();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateMyProfile(profile.uid, {
        displayName,
        department,
        licenseNo,
        signatureText,
        pushEnabled: profile.pushEnabled,
      });
      await onProfileUpdated();
      setFeedback('個人執業資料與自訂文字簽名檔已更新並同步至雲端。');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新個人資料失敗');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRoleChange = async (targetUid: string, role: UserRole) => {
    try {
      await updateStaffRole(profile, targetUid, role);
      setFeedback('人員權限等級已更新並寫入不可竄改稽核紀錄。');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '權限更新失敗');
    }
  };

  const handleBackupNow = async () => {
    setBackingUp(true);
    try {
      await onTriggerManualBackup();
      await loadLocalVault();
      setFeedback('已完成本地離線加密保險庫快照備份。');
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestoreFromSnapshot = async (snap: LocalBackupSnapshot) => {
    if (snap.drafts.length > 0) {
      onRestoreDraft(snap.drafts[0]);
      await writeAuditLog(
        profile,
        'backup_restored',
        'backup',
        snap.snapshotId,
        `從離線備份快照 (${formatDateTime(snap.createdAtMs)}) 還原草稿`
      );
      return;
    }
    if (snap.records.length > 0) {
      const latest = snap.records[0];
      onRestoreDraft({
        draftKey: `restored_${latest.recordId}`,
        recordId: latest.status === 'signed' ? '' : latest.recordId,
        patientId: latest.patientId,
        format: latest.format,
        shift: latest.shift,
        focusTitle: latest.focusTitle,
        vitals: latest.vitals,
        soap: latest.soap,
        dart: latest.dart,
        updatedAtMs: Date.now(),
      });
      await writeAuditLog(
        profile,
        'backup_restored',
        'backup',
        snap.snapshotId,
        `從備份快照載入紀錄副本（${latest.focusTitle}）`
      );
    }
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div className="p-3.5 text-xs font-medium bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-teal-900 dark:text-teal-200 rounded-lg">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Nurse Profile */}
        <form
          onSubmit={(e) => void handleSaveProfile(e)}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <UserCog className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              執業護理師身分與簽名檔設定
            </h2>
            <span className="text-xs font-medium text-teal-700 dark:text-teal-400">
              {getRoleLabel(profile.role)}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                護理師姓名（顯示於紀錄作者）
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                所屬部門 / 組別
              </label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                護理師執照字號
              </label>
              <input
                type="text"
                value={licenseNo}
                onChange={(e) => setLicenseNo(e.target.value)}
                placeholder="例：護理字第 108294 號"
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                登入帳號（僅本人與主管可見）
              </label>
              <input
                type="text"
                disabled
                value={profile.email}
                className="w-full px-3 py-2 text-sm bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              自訂文字簽名檔（將附於每行紀錄後與匯出浮水印）
            </label>
            <input
              type="text"
              required
              maxLength={120}
              value={signatureText}
              onChange={(e) => setSignatureText(e.target.value)}
              placeholder="例：特別護理師 陳怡君 RN · 護字第108294號"
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
            <div className="mt-1.5 text-xs text-teal-700 dark:text-teal-400 italic">
              簽名預覽：—— 簽名：{signatureText || `特別護理師 ${displayName} RN`}
            </div>
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
          >
            {savingProfile ? '更新中...' : '儲存身分與簽名檔'}
          </button>
        </form>

        {/* Auto-Backup & Offline Draft Vault */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                離線自動備份與本機還原點
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                IndexedDB 每 60 秒與簽署前自動建立版本快照（保留最新 20 份）
              </p>
            </div>
            <button
              type="button"
              disabled={backingUp}
              onClick={() => void handleBackupNow()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Archive className="w-3.5 h-3.5" />
              {backingUp ? '備份中...' : '立即建立備份'}
            </button>
          </div>

          {drafts.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                偵測到 {drafts.length} 筆尚未定稿的本地暫存草稿：
              </div>
              {drafts.slice(0, 3).map((d) => (
                <div
                  key={d.draftKey}
                  className="flex items-center justify-between gap-2 p-2.5 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50 rounded-lg text-xs"
                >
                  <div className="truncate">
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {d.focusTitle || '未命名草稿'} ({d.format})
                    </span>
                    <span className="text-slate-500 ml-2 font-mono-num">
                      {formatDateTime(d.updatedAtMs)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestoreDraft(d)}
                    className="inline-flex items-center gap-1 font-medium text-teal-700 dark:text-teal-400 hover:underline shrink-0 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    繼續編輯
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-56 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
            {snapshots.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                尚無本地備份快照，點擊「立即建立備份」即可產生第一份保險庫備份。
              </div>
            ) : (
              snapshots.map((snap) => (
                <div
                  key={snap.snapshotId}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="font-medium text-slate-800 dark:text-slate-200 font-mono-num">
                      {formatDateTime(snap.createdAtMs)} ·{' '}
                      {snap.triggerType === 'manual'
                        ? '手動備份'
                        : snap.triggerType === 'pre_sign'
                        ? '簽署前保護備份'
                        : '自動排程備份'}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      病患 {snap.patientsCount} 位 · 紀錄 {snap.recordsCount} 筆
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(snap.drafts.length > 0 || snap.records.length > 0) && (
                      <button
                        type="button"
                        onClick={() => void handleRestoreFromSnapshot(snap)}
                        className="text-teal-700 dark:text-teal-400 hover:underline font-medium cursor-pointer"
                      >
                        載入編輯
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => downloadSnapshotJson(snap)}
                      className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      JSON
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* RBAC Staff Management (Head Nurse Only) */}
      {isHeadNurse && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                護理團隊角色與存取權限控管（護理長專用）
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                管控特別護理師寫入權限、交班督導唯讀權限與解鎖簽署權責
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 text-slate-500">
                  <th className="py-2.5 px-4">人員姓名</th>
                  <th className="py-2.5 px-4">部門組別</th>
                  <th className="py-2.5 px-4">目前權限等級</th>
                  <th className="py-2.5 px-4 text-right">指派角色</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {staffList.map((staff) => (
                  <tr key={staff.uid}>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                      {staff.displayName}
                      {staff.uid === profile.uid ? ' (本人)' : ''}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {staff.department}
                    </td>
                    <td className="py-3 px-4 text-teal-700 dark:text-teal-400 font-medium">
                      {getRoleLabel(staff.role)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <select
                        value={staff.role}
                        disabled={staff.uid === profile.uid}
                        onChange={(e) =>
                          void handleRoleChange(staff.uid, e.target.value as UserRole)
                        }
                        className="px-2.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-800 dark:text-slate-200 disabled:opacity-50"
                      >
                        <option value="special_nurse">特別護理師</option>
                        <option value="supervisor_viewer">督導稽核 (唯讀)</option>
                        <option value="head_nurse">護理長 / 主管</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Immutable Compliance Audit Trail */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            隱私存取與匯出稽核軌跡 ({auditLogs.length})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            系統自動留存護理紀錄建檔、定稿簽署、解鎖修訂、DOC/PDF 匯出與權限異動紀錄（不可修改或刪除）
          </p>
        </div>

        {auditLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            尚無稽核軌跡資料
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-80 overflow-y-auto">
            {auditLogs.map((log) => (
              <div
                key={log.logId}
                className="px-5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
              >
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {log.actorName}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 mx-1.5">·</span>
                  <span className="text-slate-700 dark:text-slate-300">{log.summary}</span>
                </div>
                <span className="font-mono-num text-slate-400 shrink-0">
                  {log.createdAt?.toMillis ? formatDateTime(log.createdAt.toMillis()) : '剛剛'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
