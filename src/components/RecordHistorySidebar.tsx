import React, { useState } from 'react';
import { ChevronDown, ChevronUp, History, RotateCcw, X } from 'lucide-react';
import { formatDateTime, getStatusLabel } from '../lib/clinicalHelpers';
import type { CareRecord, CareRecordRevision, RevisionChangeType } from '../types/nursing';

interface RecordHistorySidebarProps {
  selectedRecord: CareRecord | null;
  revisions: CareRecordRevision[];
  canWrite: boolean;
  restoringId: string | null;
  onRestoreRevision: (revision: CareRecordRevision, restoreReason?: string) => Promise<void>;
  onClose?: () => void;
}

function getChangeTypeLabel(changeType: RevisionChangeType): string {
  switch (changeType) {
    case 'created':
      return '初版建立';
    case 'updated':
      return '內容更新';
    case 'signed':
      return '電子簽署定稿';
    case 'amended':
      return '簽署後修訂';
    case 'unlocked':
      return '護理長解鎖';
    case 'restored':
      return '版本還原';
  }
}

export const RecordHistorySidebar: React.FC<RecordHistorySidebarProps> = ({
  selectedRecord,
  revisions,
  canWrite,
  restoringId,
  onRestoreRevision,
  onClose,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmingRevisionId, setConfirmingRevisionId] = useState<string | null>(null);
  const [restoreReason, setRestoreReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleOpenRestore = (rev: CareRecordRevision) => {
    setLocalError(null);
    setConfirmingRevisionId(rev.revisionId);
    setRestoreReason(
      `還原至 v${rev.versionNumber} 版本（${rev.changeReason || getChangeTypeLabel(rev.changeType)}）`
    );
  };

  const handleConfirmRestore = async (rev: CareRecordRevision) => {
    const needsReason = selectedRecord?.status === 'signed';
    if (needsReason && restoreReason.trim().length < 2) {
      setLocalError('已簽署紀錄還原時必須輸入至少 2 字的修訂原因。');
      return;
    }
    setLocalError(null);
    await onRestoreRevision(rev, restoreReason.trim());
    setConfirmingRevisionId(null);
  };

  return (
    <aside className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <History className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              歷史版本側邊欄
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {selectedRecord
                ? `共 ${revisions.length} 個版本快照`
                : '儲存紀錄後開始追蹤版本'}
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="收合歷史版本側邊欄"
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {!selectedRecord ? (
        <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2 leading-relaxed">
          <History className="w-6 h-6 mx-auto text-slate-300 dark:text-slate-700" />
          <div>目前為新增草稿</div>
          <p>
            儲存或簽署定稿後，每次修改時間、修改人員與修改原因皆會自動歸檔至此側邊欄，支援隨時檢視與一鍵還原。
          </p>
        </div>
      ) : revisions.length === 0 ? (
        <div className="p-4 space-y-3 text-xs">
          <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                目前基準版本
              </span>
              <span className="font-mono-num tabular-nums text-slate-500 dark:text-slate-400">
                {formatDateTime(selectedRecord.recordedAtMs)}
              </span>
            </div>
            <div className="text-slate-600 dark:text-slate-300">
              建檔護理師：{selectedRecord.authorName} · {getStatusLabel(selectedRecord.status)}
            </div>
            {selectedRecord.amendmentReason && (
              <div className="pt-1 text-amber-800 dark:text-amber-300">
                最近修訂原因：{selectedRecord.amendmentReason}（
                {formatDateTime(selectedRecord.amendedAtMs)}）
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            此筆紀錄建立於版本快照功能啟用前；下次儲存、修訂或解鎖時起，將自動完整保存歷次版本以供還原。
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[680px] overflow-y-auto">
          {revisions.map((rev, idx) => {
            const isLatest = idx === 0;
            const isExpanded = expandedId === rev.revisionId;
            const isConfirming = confirmingRevisionId === rev.revisionId;
            const isRestoring = restoringId === rev.revisionId;
            const sectionItems =
              rev.format === 'SOAP'
                ? [
                    { label: 'S 主觀', text: rev.soap.subjective },
                    { label: 'O 客觀', text: rev.soap.objective },
                    { label: 'A 評估', text: rev.soap.assessment },
                    { label: 'P 計畫', text: rev.soap.plan },
                  ]
                : [
                    { label: 'D 資料', text: rev.dart.data },
                    { label: 'A 行動', text: rev.dart.action },
                    { label: 'R 反應', text: rev.dart.response },
                    { label: 'T 衛教', text: rev.dart.teaching },
                  ];

            return (
              <div key={rev.revisionId} className="p-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-semibold ${
                      rev.changeType === 'amended'
                        ? 'text-amber-700 dark:text-amber-400'
                        : rev.changeType === 'signed'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : rev.changeType === 'restored'
                        ? 'text-teal-700 dark:text-teal-400'
                        : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    v{rev.versionNumber} · {getChangeTypeLabel(rev.changeType)}
                  </span>
                  <span className="font-mono-num tabular-nums text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                    {formatDateTime(rev.savedAtMs)}
                  </span>
                </div>

                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  人員：{rev.editedByName} · {rev.format} · {getStatusLabel(rev.status)}
                </div>

                <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 leading-relaxed">
                  <span className="font-medium text-slate-900 dark:text-slate-100">修改原因：</span>
                  {rev.changeReason || '常規儲存更新'}
                </div>

                <div className="text-slate-700 dark:text-slate-200 font-medium truncate">
                  焦點：{rev.focusTitle}
                </div>

                <div className="text-[11px] font-mono-num tabular-nums text-slate-500 dark:text-slate-400">
                  T {rev.vitals.temperature.toFixed(1)}°C · HR {rev.vitals.heartRate} · BP{' '}
                  {rev.vitals.bpSystolic}/{rev.vitals.bpDiastolic} · SpO2 {rev.vitals.spo2}%
                </div>

                {isExpanded && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    {sectionItems.map((sec) => (
                      <div key={sec.label} className="space-y-0.5">
                        <div className="text-[11px] font-semibold text-teal-700 dark:text-teal-400">
                          {sec.label}
                        </div>
                        <div className="text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-100 dark:border-slate-800">
                          {sec.text || '（未填寫）'}
                        </div>
                      </div>
                    ))}
                    {rev.signatureText && (
                      <div className="text-[11px] italic text-teal-700 dark:text-teal-400">
                        簽名檔：{rev.signatureText}
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-1 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : rev.revisionId)
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5" />
                        收合內容
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        檢視內容
                      </>
                    )}
                  </button>

                  {isLatest ? (
                    <span className="text-[11px] font-medium text-teal-700 dark:text-teal-400">
                      目前最新版本
                    </span>
                  ) : (
                    canWrite && (
                      <button
                        type="button"
                        disabled={isRestoring}
                        onClick={() => handleOpenRestore(rev)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/50 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <RotateCcw className="w-3 h-3" />
                        快速還原此版本
                      </button>
                    )
                  )}
                </div>

                {isConfirming && (
                  <div className="p-2.5 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg space-y-2">
                    <div className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                      {selectedRecord.status === 'signed'
                        ? `確認還原至 v${rev.versionNumber}（需填寫修訂原因並重新簽署）：`
                        : `確定要還原至 v${rev.versionNumber}（${formatDateTime(rev.savedAtMs)}）？`}
                    </div>

                    <input
                      type="text"
                      maxLength={240}
                      value={restoreReason}
                      onChange={(e) => setRestoreReason(e.target.value)}
                      placeholder="輸入還原原因..."
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-amber-300 dark:border-amber-700 rounded text-slate-900 dark:text-slate-100"
                    />

                    {localError && (
                      <div className="text-[11px] text-red-700 dark:text-red-400">
                        {localError}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={isRestoring}
                        onClick={() => {
                          setConfirmingRevisionId(null);
                          setLocalError(null);
                        }}
                        className="px-2.5 py-1 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-amber-100/60 rounded cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={isRestoring}
                        onClick={() => void handleConfirmRestore(rev)}
                        className="px-3 py-1 text-[11px] font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-60 rounded cursor-pointer"
                      >
                        {isRestoring
                          ? '還原中...'
                          : selectedRecord.status === 'signed'
                          ? '確認還原並重新簽署'
                          : '確認還原'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
};
