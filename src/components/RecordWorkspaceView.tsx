import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  FilePenLine,
  FileText,
  Lock,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Unlock,
} from 'lucide-react';
import {
  CLINICAL_TEMPLATES,
  detectCurrentShift,
  evaluateVitalAlerts,
  formatDateTime,
  getShiftLabel,
  getStatusLabel,
  maskMrn,
  maskPatientName,
  sanitizeVitals,
} from '../lib/clinicalHelpers';
import {
  exportCareRecordsToDoc,
  exportCareRecordsToDocx,
  exportCareRecordsToPdf,
} from '../lib/exportRecords';
import { deleteLocalDraft, saveLocalDraft } from '../lib/offlineBackup';
import {
  deleteDraftRecord,
  saveCareRecord,
  unlockSignedRecord,
  writeAuditLog,
} from '../lib/nursingService';
import {
  type CareRecord,
  type CareRecordFormat,
  type CareRecordStatus,
  type DartContent,
  FIELD_LIMITS,
  type LocalDraftEntry,
  type PatientChart,
  type ShiftType,
  type SoapContent,
  type UserProfile,
  type VitalSigns,
} from '../types/nursing';

interface RecordWorkspaceViewProps {
  profile: UserProfile;
  patients: PatientChart[];
  records: CareRecord[];
  selectedRecord: CareRecord | null;
  initialPatientId?: string;
  privacyMask: boolean;
  isOnline: boolean;
  restoredDraft: LocalDraftEntry | null;
  onClearRestoredDraft: () => void;
  onSelectRecord: (rec: CareRecord | null) => void;
  onTriggerAutoBackup: (reason: 'auto' | 'manual' | 'pre_sign') => Promise<void>;
}

const DEFAULT_VITALS: VitalSigns = {
  temperature: 36.6,
  heartRate: 76,
  respiratoryRate: 16,
  bpSystolic: 122,
  bpDiastolic: 76,
  spo2: 98,
  painScore: 1,
};

const EMPTY_SOAP: SoapContent = {
  subjective: '',
  objective: '',
  assessment: '',
  plan: '',
};

const EMPTY_DART: DartContent = {
  data: '',
  action: '',
  response: '',
  teaching: '',
};

export const RecordWorkspaceView: React.FC<RecordWorkspaceViewProps> = ({
  profile,
  patients,
  records,
  selectedRecord,
  initialPatientId,
  privacyMask,
  isOnline,
  restoredDraft,
  onClearRestoredDraft,
  onSelectRecord,
  onTriggerAutoBackup,
}) => {
  const canWrite = profile.role !== 'supervisor_viewer';
  const isHeadNurse = profile.role === 'head_nurse';

  const [searchQuery, setSearchQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<'ALL' | CareRecordFormat>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | CareRecordStatus>('ALL');

  // Editor state
  const [editingRecordId, setEditingRecordId] = useState<string | undefined>(undefined);
  const [patientId, setPatientId] = useState<string>(initialPatientId || patients[0]?.patientId || '');
  const [format, setFormat] = useState<CareRecordFormat>('SOAP');
  const [shift, setShift] = useState<ShiftType>(detectCurrentShift());
  const [focusTitle, setFocusTitle] = useState('');
  const [vitals, setVitals] = useState<VitalSigns>(DEFAULT_VITALS);
  const [soap, setSoap] = useState<SoapContent>(EMPTY_SOAP);
  const [dart, setDart] = useState<DartContent>(EMPTY_DART);
  const [recordedAtMs, setRecordedAtMs] = useState<number>(Date.now());
  const [customSignature, setCustomSignature] = useState<string>(
    profile.signatureText || `特別護理師 ${profile.displayName} RN`
  );

  // Post-signature amendment workflow state
  const [showAmendPrompt, setShowAmendPrompt] = useState(false);
  const [isAmendingSigned, setIsAmendingSigned] = useState(false);
  const [amendmentReason, setAmendmentReason] = useState('');

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'doc' | 'docx' | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [localDraftSavedAt, setLocalDraftSavedAt] = useState<number | null>(null);

  const patientMap = useMemo(
    () => new Map(patients.map((p) => [p.patientId, p])),
    [patients]
  );

  // Keep default customSignature synced when profile updates
  useEffect(() => {
    if (!selectedRecord) {
      setCustomSignature(profile.signatureText || `特別護理師 ${profile.displayName} RN`);
    }
  }, [profile.signatureText, profile.displayName, selectedRecord]);

  // Sync editor when selecting an existing record
  useEffect(() => {
    if (selectedRecord) {
      setEditingRecordId(selectedRecord.recordId);
      setPatientId(selectedRecord.patientId);
      setFormat(selectedRecord.format);
      setShift(selectedRecord.shift);
      setFocusTitle(selectedRecord.focusTitle);
      setVitals(selectedRecord.vitals);
      setSoap(selectedRecord.soap);
      setDart(selectedRecord.dart);
      setRecordedAtMs(selectedRecord.recordedAtMs);
      setCustomSignature(
        selectedRecord.signatureText ||
          profile.signatureText ||
          `特別護理師 ${profile.displayName} RN`
      );
      setIsAmendingSigned(false);
      setShowAmendPrompt(false);
      setAmendmentReason('');
      setFeedback(null);
    }
  }, [selectedRecord, profile.signatureText, profile.displayName]);

  // Apply restored local draft if triggered from Backup Center
  useEffect(() => {
    if (restoredDraft) {
      setEditingRecordId(restoredDraft.recordId || undefined);
      if (restoredDraft.patientId) setPatientId(restoredDraft.patientId);
      setFormat(restoredDraft.format);
      setShift(restoredDraft.shift);
      setFocusTitle(restoredDraft.focusTitle);
      setVitals(restoredDraft.vitals);
      setSoap(restoredDraft.soap);
      setDart(restoredDraft.dart);
      setIsAmendingSigned(false);
      setShowAmendPrompt(false);
      setFeedback({ type: 'success', text: '已從離線備份快照還原草稿內容，請確認後儲存同步。' });
      onClearRestoredDraft();
    }
  }, [restoredDraft, onClearRestoredDraft]);

  // Default patientId when patients load
  useEffect(() => {
    if (!patientId && patients.length > 0) {
      setPatientId(initialPatientId || patients[0].patientId);
    }
  }, [patients, patientId, initialPatientId]);

  const isLockedSigned = selectedRecord?.status === 'signed' && !isAmendingSigned;
  const editorReadOnly = !canWrite || isLockedSigned;

  // Auto-save draft to IndexedDB every 1.5s while editing
  useEffect(() => {
    if (editorReadOnly || !patientId) return;
    if (!focusTitle && !soap.subjective && !soap.objective && !dart.data && !dart.action) return;

    const timer = window.setTimeout(() => {
      const draftKey = editingRecordId || `new_${patientId}`;
      void saveLocalDraft({
        draftKey,
        recordId: editingRecordId || '',
        patientId,
        format,
        shift,
        focusTitle,
        vitals,
        soap,
        dart,
        updatedAtMs: Date.now(),
      }).then(() => {
        setLocalDraftSavedAt(Date.now());
      });
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [editorReadOnly, editingRecordId, patientId, format, shift, focusTitle, vitals, soap, dart]);

  const vitalEvaluation = useMemo(
    () => evaluateVitalAlerts(sanitizeVitals(vitals)),
    [vitals]
  );

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records.filter((rec) => {
      if (formatFilter !== 'ALL' && rec.format !== formatFilter) return false;
      if (statusFilter !== 'ALL' && rec.status !== statusFilter) return false;
      if (!q) return true;
      return (
        rec.focusTitle.toLowerCase().includes(q) ||
        rec.patientName.toLowerCase().includes(q) ||
        rec.bedNumber.toLowerCase().includes(q) ||
        rec.mrn.toLowerCase().includes(q) ||
        rec.authorName.toLowerCase().includes(q) ||
        rec.signatureText.toLowerCase().includes(q)
      );
    });
  }, [records, searchQuery, formatFilter, statusFilter]);

  const startNewRecord = (targetPatientId?: string) => {
    onSelectRecord(null);
    setEditingRecordId(undefined);
    setPatientId(targetPatientId || patients[0]?.patientId || '');
    setFormat('SOAP');
    setShift(detectCurrentShift());
    setFocusTitle('');
    setVitals(DEFAULT_VITALS);
    setSoap(EMPTY_SOAP);
    setDart(EMPTY_DART);
    setRecordedAtMs(Date.now());
    setCustomSignature(profile.signatureText || `特別護理師 ${profile.displayName} RN`);
    setIsAmendingSigned(false);
    setShowAmendPrompt(false);
    setAmendmentReason('');
    setFeedback(null);
  };

  const applyTemplate = (tplId: string) => {
    const tpl = CLINICAL_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    setFormat(tpl.format);
    setFocusTitle(tpl.focusTitle);
    if (tpl.soap) setSoap(tpl.soap);
    if (tpl.dart) setDart(tpl.dart);
    setFeedback({ type: 'success', text: `已套用臨床範例：「${tpl.title}」` });
  };

  const handleConfirmAmendmentReason = (e: React.FormEvent) => {
    e.preventDefault();
    if (amendmentReason.trim().length < 2) {
      setFeedback({ type: 'error', text: '請輸入至少 2 字的更改原因後再開始修訂紀錄。' });
      return;
    }
    setIsAmendingSigned(true);
    setShowAmendPrompt(false);
    setCustomSignature(profile.signatureText || `特別護理師 ${profile.displayName} RN`);
    setFeedback({
      type: 'success',
      text: `已核准開啟修訂模式（原因：${amendmentReason.trim()}），完成修改後請點擊「確認修訂並重新簽署」。`,
    });
  };

  const handleSave = async (targetStatus: CareRecordStatus) => {
    const targetPatient = patientMap.get(patientId);
    if (!targetPatient) {
      setFeedback({ type: 'error', text: '請先選擇病患，若無病患請先至「病患名單」建立。' });
      return;
    }
    if (!focusTitle.trim()) {
      setFeedback({ type: 'error', text: '請輸入「護理焦點 / 主題」。' });
      return;
    }
    if ((targetStatus === 'signed' || isAmendingSigned) && !customSignature.trim()) {
      setFeedback({ type: 'error', text: '簽署定稿前請確認「文字簽名檔」內容不可為空。' });
      return;
    }
    if (isAmendingSigned && amendmentReason.trim().length < 2) {
      setFeedback({ type: 'error', text: '更改已簽署紀錄必須輸入修訂原因。' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      if (targetStatus === 'signed' || isAmendingSigned) {
        await onTriggerAutoBackup('pre_sign');
      }
      const savedId = await saveCareRecord(profile, targetPatient, {
        recordId: editingRecordId,
        format,
        shift,
        focusTitle,
        status: isAmendingSigned ? 'signed' : targetStatus,
        vitals,
        soap,
        dart,
        recordedAtMs,
        signatureText: customSignature.trim(),
        isSignedAmendment: isAmendingSigned,
        amendmentReason: amendmentReason.trim(),
      });
      await deleteLocalDraft(editingRecordId || `new_${patientId}`);
      setEditingRecordId(savedId);
      setIsAmendingSigned(false);
      setFeedback({
        type: 'success',
        text: isAmendingSigned
          ? `已完成簽署後修訂並重新電子簽章（原因：${amendmentReason.trim()}）。`
          : isOnline
          ? targetStatus === 'signed'
            ? `護理紀錄已完成電子簽署定稿（簽名：${customSignature.trim()}）並同步至雲端。`
            : '護理紀錄已儲存並同步至雲端。'
          : '目前處於離線模式：已寫入本地離線快取並建立備份，恢復連線後將自動同步。',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : '儲存失敗，請檢查權限或欄位內容。',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUnlock = async () => {
    if (!selectedRecord || !isHeadNurse) return;
    setSaving(true);
    try {
      await unlockSignedRecord(profile, selectedRecord);
      setFeedback({ type: 'success', text: '已解鎖此筆紀錄，可進行增補修訂。' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : '解鎖失敗。',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!selectedRecord || selectedRecord.status !== 'draft') return;
    setSaving(true);
    try {
      await deleteDraftRecord(selectedRecord.recordId);
      startNewRecord(selectedRecord.patientId);
      setFeedback({ type: 'success', text: '草稿已刪除。' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : '刪除失敗。',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async (kind: 'pdf' | 'doc' | 'docx', batch: boolean) => {
    const targetRecords = batch
      ? filteredRecords
      : selectedRecord
      ? [selectedRecord]
      : [];

    if (targetRecords.length === 0) {
      setFeedback({ type: 'error', text: '沒有可匯出的護理紀錄。' });
      return;
    }

    setExporting(kind);
    try {
      if (kind === 'pdf') {
        await exportCareRecordsToPdf(targetRecords, patientMap, profile.displayName, privacyMask);
        await writeAuditLog(
          profile,
          'record_exported_pdf',
          'careRecord',
          targetRecords[0].recordId,
          `匯出 PDF 護理紀錄共 ${targetRecords.length} 筆${privacyMask ? '（含隱私遮罩）' : ''}`
        );
      } else if (kind === 'docx') {
        await exportCareRecordsToDocx(targetRecords, patientMap, profile.displayName, privacyMask);
        await writeAuditLog(
          profile,
          'record_exported_doc',
          'careRecord',
          targetRecords[0].recordId,
          `匯出 Word (.docx) 護理紀錄共 ${targetRecords.length} 筆`
        );
      } else {
        exportCareRecordsToDoc(targetRecords, patientMap, profile.displayName, privacyMask);
        await writeAuditLog(
          profile,
          'record_exported_doc',
          'careRecord',
          targetRecords[0].recordId,
          `匯出 Word (.doc) 護理紀錄共 ${targetRecords.length} 筆`
        );
      }
      setFeedback({
        type: 'success',
        text: `已成功匯出 ${kind.toUpperCase()} 檔案（已含簽署浮水印與每行簽名）。`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : '匯出過程發生錯誤。',
      });
    } finally {
      setExporting(null);
    }
  };

  const activeSignaturePreview =
    selectedRecord?.status === 'signed' && !isAmendingSigned
      ? selectedRecord.signatureText || selectedRecord.signedByName
      : customSignature;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left List Pane */}
      <aside className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              護理紀錄清單 ({filteredRecords.length})
            </h2>
            {canWrite && (
              <button
                type="button"
                onClick={() => startNewRecord()}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                新增紀錄
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋病患、床號、焦點或簽名..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {(['ALL', 'SOAP', 'DART'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormatFilter(fmt)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    formatFilter === fmt
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {fmt === 'ALL' ? '全部' : fmt}
                </button>
              ))}
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | CareRecordStatus)}
              aria-label="篩選紀錄狀態"
              className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200"
            >
              <option value="ALL">所有狀態</option>
              <option value="draft">草稿</option>
              <option value="pending_review">待覆核</option>
              <option value="signed">已簽署定稿</option>
              <option value="alert">異常警示</option>
            </select>
          </div>

          {filteredRecords.length > 0 && (
            <div className="pt-1 flex items-center gap-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                批次匯出：
              </span>
              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => void handleExport('pdf', true)}
                className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer whitespace-nowrap"
              >
                PDF
              </button>
              <span className="text-slate-300">·</span>
              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => void handleExport('doc', true)}
                className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer whitespace-nowrap"
              >
                .doc
              </button>
              <span className="text-slate-300">·</span>
              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => void handleExport('docx', true)}
                className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer whitespace-nowrap"
              >
                .docx
              </button>
            </div>
          )}
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[720px] overflow-y-auto">
          {filteredRecords.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <FileText className="w-6 h-6 mx-auto text-slate-300" />
              <div>尚無符合條件的護理紀錄</div>
            </div>
          ) : (
            filteredRecords.map((rec) => {
              const active = selectedRecord?.recordId === rec.recordId;
              const rowSignature =
                rec.status === 'signed'
                  ? `簽名：${rec.signatureText || rec.signedByName}`
                  : `暫記：${rec.authorName}`;
              return (
                <button
                  key={rec.recordId}
                  type="button"
                  onClick={() => onSelectRecord(rec)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    active
                      ? 'bg-teal-50/70 dark:bg-teal-950/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono-num text-slate-500 dark:text-slate-400">
                      {rec.bedNumber} · {maskPatientName(rec.patientName, privacyMask)}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        rec.status === 'signed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : rec.status === 'alert' || rec.hasAlert
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {rec.format} · {getStatusLabel(rec.status)}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-1 truncate">
                    {rec.focusTitle}
                  </div>
                  <div className="text-xs text-teal-700 dark:text-teal-400 italic mt-1 truncate">
                    —— {rowSignature}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between gap-2">
                    <span className="truncate">
                      {rec.amendmentReason ? `已修訂：${rec.amendmentReason}` : rec.authorName}
                    </span>
                    <span className="font-mono-num shrink-0">
                      {formatDateTime(rec.recordedAtMs)}
                      {rec._hasPendingWrites ? ' · 待同步' : ''}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Editor Pane */}
      <section className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {selectedRecord
                ? isAmendingSigned
                  ? '修訂已簽署護理紀錄（需重新簽章）'
                  : isLockedSigned
                  ? '已定稿護理紀錄（已鎖定 · 匯出含浮水印）'
                  : '編輯護理紀錄'
                : '建立新特別護理紀錄'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {localDraftSavedAt
                ? `已於 ${formatDateTime(localDraftSavedAt)} 自動保存本地草稿（支援離線編輯）`
                : '所有編寫過程均受自動本地備份保護'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedRecord && (
              <>
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => void handleExport('doc', false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  {exporting === 'doc' ? '匯出中...' : '匯出 DOC'}
                </button>
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => void handleExport('docx', false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  {exporting === 'docx' ? '匯出中...' : '匯出 DOCX'}
                </button>
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => void handleExport('pdf', false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 rounded-lg hover:bg-teal-100 dark:hover:bg-teal-900/50 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  {exporting === 'pdf' ? '匯出中...' : '匯出 PDF'}
                </button>
              </>
            )}

            {selectedRecord?.status === 'signed' && !isAmendingSigned && canWrite && (
              <button
                type="button"
                onClick={() => setShowAmendPrompt((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FilePenLine className="w-3.5 h-3.5" />
                更改已簽署紀錄
              </button>
            )}

            {isLockedSigned && isHeadNurse && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleUnlock()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Unlock className="w-3.5 h-3.5" />
                解鎖轉為待覆核
              </button>
            )}
          </div>
        </div>

        {/* Mandatory Amendment Reason Input Gate */}
        {showAmendPrompt && selectedRecord?.status === 'signed' && (
          <form
            onSubmit={handleConfirmAmendmentReason}
            className="p-4 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl space-y-3"
          >
            <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              簽署後更改紀錄必須輸入明確原因（將永久記錄於病歷修訂欄位與稽核軌跡）
            </div>
            <input
              type="text"
              required
              minLength={2}
              maxLength={240}
              value={amendmentReason}
              onChange={(e) => setAmendmentReason(e.target.value)}
              placeholder="請輸入更改原因，例：補充病患術後疼痛評分變化及給藥反應..."
              className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-amber-300 dark:border-amber-700 rounded-lg text-slate-900 dark:text-slate-100"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAmendPrompt(false)}
                className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-amber-100/60 rounded-lg cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg cursor-pointer"
              >
                確認原因並開啟修訂
              </button>
            </div>
          </form>
        )}

        {/* Active Amendment Banner or Prior Amendment History */}
        {isAmendingSigned && (
          <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
            <div>
              <span className="font-semibold">正在修訂已簽署紀錄</span> · 修訂原因：{amendmentReason}
            </div>
            <button
              type="button"
              onClick={() => {
                setIsAmendingSigned(false);
                if (selectedRecord) {
                  setFocusTitle(selectedRecord.focusTitle);
                  setVitals(selectedRecord.vitals);
                  setSoap(selectedRecord.soap);
                  setDart(selectedRecord.dart);
                }
              }}
              className="font-medium underline shrink-0 cursor-pointer"
            >
              取消修訂
            </button>
          </div>
        )}

        {selectedRecord?.amendmentReason && !isAmendingSigned && (
          <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-300">
            <span className="font-semibold text-amber-700 dark:text-amber-400">
              最近一次簽署後修訂原因：
            </span>
            {selectedRecord.amendmentReason}（修訂者：{selectedRecord.amendedByName} ·{' '}
            {formatDateTime(selectedRecord.amendedAtMs)}）
          </div>
        )}

        {feedback && (
          <div
            className={`p-3.5 rounded-lg text-xs font-medium border flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Format, Patient & Shift Selection */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              照護病患（受權限控管）
            </label>
            <select
              value={patientId}
              disabled={Boolean(editingRecordId) || editorReadOnly}
              onChange={(e) => setPatientId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 disabled:opacity-60"
            >
              {patients.length === 0 ? (
                <option value="">尚無授權病患</option>
              ) : (
                patients.map((p) => (
                  <option key={p.patientId} value={p.patientId}>
                    {p.bedNumber} · {maskPatientName(p.fullName, privacyMask)} ({maskMrn(p.mrn, privacyMask)})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              護理紀錄格式
            </label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {(['SOAP', 'DART'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  disabled={editorReadOnly}
                  onClick={() => setFormat(fmt)}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    format === fmt
                      ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {fmt} 格式
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              執勤班別
            </label>
            <select
              value={shift}
              disabled={editorReadOnly}
              onChange={(e) => setShift(e.target.value as ShiftType)}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 disabled:opacity-60"
            >
              <option value="Day">{getShiftLabel('Day')}</option>
              <option value="Evening">{getShiftLabel('Evening')}</option>
              <option value="Night">{getShiftLabel('Night')}</option>
            </select>
          </div>
        </div>

        {/* Clinical Quick Templates */}
        {!editorReadOnly && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-teal-600" />
              臨床快速範本：
            </span>
            {CLINICAL_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl.id)}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-teal-50 dark:hover:bg-teal-950/50 hover:text-teal-800 dark:hover:text-teal-300 rounded-md transition-colors cursor-pointer whitespace-nowrap"
              >
                {tpl.title} ({tpl.format})
              </button>
            ))}
          </div>
        )}

        {/* Focus Title */}
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
            護理焦點 / 評估主題（最多 {FIELD_LIMITS.FOCUS_MAX} 字）
          </label>
          <input
            type="text"
            maxLength={FIELD_LIMITS.FOCUS_MAX}
            disabled={editorReadOnly}
            value={focusTitle}
            onChange={(e) => setFocusTitle(e.target.value)}
            placeholder="例：術後傷口疼痛與引流管通暢評估 / 呼吸道痰液清除照護"
            className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:opacity-60"
          />
        </div>

        {/* Vital Signs Telemetry Matrix */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              生命徵象量測數值
            </span>
            {vitalEvaluation.hasAlert && (
              <span className="text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                偵測異常：{vitalEvaluation.reasons.join('、')}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { key: 'temperature', label: '體溫 (°C)', step: '0.1', min: 30, max: 45 },
              { key: 'heartRate', label: '脈搏 (bpm)', step: '1', min: 20, max: 250 },
              { key: 'respiratoryRate', label: '呼吸 (/min)', step: '1', min: 4, max: 80 },
              { key: 'bpSystolic', label: '收縮壓', step: '1', min: 40, max: 300 },
              { key: 'bpDiastolic', label: '舒張壓', step: '1', min: 20, max: 200 },
              { key: 'spo2', label: '血氧 (%)', step: '1', min: 40, max: 100 },
              { key: 'painScore', label: '疼痛 (0-10)', step: '1', min: 0, max: 10 },
            ].map((item) => (
              <div key={item.key}>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  {item.label}
                </label>
                <input
                  type="number"
                  step={item.step}
                  min={item.min}
                  max={item.max}
                  disabled={editorReadOnly}
                  value={vitals[item.key as keyof VitalSigns]}
                  onChange={(e) =>
                    setVitals((prev) => ({
                      ...prev,
                      [item.key]: Number(e.target.value),
                    }))
                  }
                  className="w-full px-2.5 py-1.5 text-sm font-mono-num tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 disabled:opacity-60"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Structured SOAP or DART Fields with per-line signature display */}
        {format === 'SOAP' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                key: 'subjective',
                title: 'S — 主觀資料 (Subjective)',
                placeholder: '病患主訴症狀、疼痛感受、情緒表達或家屬陳述...',
              },
              {
                key: 'objective',
                title: 'O — 客觀資料 (Objective)',
                placeholder: '身體評估發現、傷口敷料滲液、管路引流性狀與檢驗數值...',
              },
              {
                key: 'assessment',
                title: 'A — 護理評估 (Assessment)',
                placeholder: '護理問題分析、風險程度判斷、臨床變化趨勢評估...',
              },
              {
                key: 'plan',
                title: 'P — 護理計畫與措施 (Plan)',
                placeholder: '預計執行之護理措施、追蹤時間間隔、交班注意要點...',
              },
            ].map((sec) => (
              <div key={sec.key} className="space-y-1">
                <label className="block text-xs font-semibold text-teal-800 dark:text-teal-300">
                  {sec.title}
                </label>
                <textarea
                  rows={5}
                  maxLength={FIELD_LIMITS.SECTION_MAX}
                  disabled={editorReadOnly}
                  value={soap[sec.key as keyof SoapContent]}
                  onChange={(e) =>
                    setSoap((prev) => ({ ...prev, [sec.key]: e.target.value }))
                  }
                  placeholder={sec.placeholder}
                  className="w-full p-3 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:opacity-60"
                />
                {selectedRecord?.status === 'signed' && (
                  <div className="text-right text-[11px] italic text-teal-700 dark:text-teal-400">
                    —— 簽名：{activeSignaturePreview} ({formatDateTime(selectedRecord.signedAtMs)})
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                key: 'data',
                title: 'D — 評估資料 (Data)',
                placeholder: '與本焦點相關的主觀主訴與客觀觀察數據...',
              },
              {
                key: 'action',
                title: 'A — 護理行動 (Action)',
                placeholder: '針對此焦點即時執行的護理處置、給藥、管路或協同醫療處置...',
              },
              {
                key: 'response',
                title: 'R — 反應與評值 (Response)',
                placeholder: '處置後病患的生理改善情形、舒適度或症狀變化...',
              },
              {
                key: 'teaching',
                title: 'T — 衛教指導 (Teaching)',
                placeholder: '對病患或主要照顧者執行的疾病衛教、注意事項與出院準備...',
              },
            ].map((sec) => (
              <div key={sec.key} className="space-y-1">
                <label className="block text-xs font-semibold text-teal-800 dark:text-teal-300">
                  {sec.title}
                </label>
                <textarea
                  rows={5}
                  maxLength={FIELD_LIMITS.SECTION_MAX}
                  disabled={editorReadOnly}
                  value={dart[sec.key as keyof DartContent]}
                  onChange={(e) =>
                    setDart((prev) => ({ ...prev, [sec.key]: e.target.value }))
                  }
                  placeholder={sec.placeholder}
                  className="w-full p-3 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:opacity-60"
                />
                {selectedRecord?.status === 'signed' && (
                  <div className="text-right text-[11px] italic text-teal-700 dark:text-teal-400">
                    —— 簽名：{activeSignaturePreview} ({formatDateTime(selectedRecord.signedAtMs)})
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Custom Text Signature Block */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              本次簽署文字簽名檔（匯出 PDF / DOC 時將產生簽署浮水印並附於每行紀錄後）
            </label>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              預設帶入個人設定，亦可於簽署前微調
            </span>
          </div>
          <input
            type="text"
            maxLength={120}
            disabled={editorReadOnly}
            value={customSignature}
            onChange={(e) => setCustomSignature(e.target.value)}
            placeholder="例：特別護理師 陳怡君 RN · 護字第108294號"
            className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 disabled:opacity-60"
          />
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {selectedRecord?.status === 'signed' ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                <Lock className="w-3.5 h-3.5" />
                電子簽名檔：{selectedRecord.signatureText || selectedRecord.signedByName} ·{' '}
                {formatDateTime(selectedRecord.signedAtMs)}
              </span>
            ) : (
              <span>簽署定稿後將鎖定內容，更改紀錄時須輸入修訂原因並留存稽核紀錄</span>
            )}
          </div>

          {!editorReadOnly && (
            <div className="flex flex-wrap items-center gap-2.5">
              {selectedRecord?.status === 'draft' && !isAmendingSigned && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleDeleteDraft()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  刪除草稿
                </button>
              )}

              {!isAmendingSigned && (
                <>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSave('draft')}
                    className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    暫存草稿
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSave('pending_review')}
                    className="px-4 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    儲存並送交覆核
                  </button>
                </>
              )}

              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave('signed')}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5" />
                {saving
                  ? '處理中...'
                  : isAmendingSigned
                  ? '確認修訂並重新簽署'
                  : '簽署定稿'}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
