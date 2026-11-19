import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, Printer, X } from 'lucide-react';
import {
  formatDateTime,
  getShiftLabel,
  getStatusLabel,
  maskMrn,
  maskPatientName,
} from '../lib/clinicalHelpers';
import type { CareRecord, PatientChart } from '../types/nursing';

interface PrintPreviewModalProps {
  open: boolean;
  record: CareRecord;
  patient: PatientChart | undefined;
  exporterName: string;
  defaultPrivacyMask: boolean;
  canExportSavedFile: boolean;
  exporting: 'pdf' | 'doc' | 'docx' | null;
  onClose: () => void;
  onExport: (kind: 'pdf' | 'doc' | 'docx') => Promise<void>;
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  open,
  record,
  patient,
  exporterName,
  defaultPrivacyMask,
  canExportSavedFile,
  exporting,
  onClose,
  onExport,
}) => {
  const [previewMask, setPreviewMask] = useState(defaultPrivacyMask);
  const [simulateWatermark, setSimulateWatermark] = useState(record.status === 'signed');

  useEffect(() => {
    if (open) {
      setPreviewMask(defaultPrivacyMask);
      setSimulateWatermark(record.status === 'signed');
    }
  }, [open, defaultPrivacyMask, record.status]);

  useEffect(() => {
    const cleanup = () => document.body.classList.remove('printing-clinical-sheet');
    window.addEventListener('afterprint', cleanup);
    return () => {
      window.removeEventListener('afterprint', cleanup);
      cleanup();
    };
  }, []);

  if (!open) return null;

  const isSigned = record.status === 'signed' || simulateWatermark;
  const sigLabel = record.signatureText || record.signedByName || record.authorName;
  const sigTimestamp = record.signedAtMs || Date.now();
  const rowSignatureText = isSigned
    ? `—— 簽名：${sigLabel} (${formatDateTime(sigTimestamp)})`
    : `—— 暫記：${record.authorName} (未簽署)`;

  const pName = maskPatientName(record.patientName, previewMask);
  const mrn = maskMrn(record.mrn, previewMask);

  const sections =
    record.format === 'SOAP'
      ? [
          { title: 'S 主觀資料 (Subjective)', content: record.soap.subjective },
          { title: 'O 客觀資料 (Objective)', content: record.soap.objective },
          { title: 'A 護理評估 (Assessment)', content: record.soap.assessment },
          { title: 'P 護理計畫 (Plan)', content: record.soap.plan },
        ]
      : [
          { title: 'D 資料 (Data)', content: record.dart.data },
          { title: 'A 護理行動 (Action)', content: record.dart.action },
          { title: 'R 反應評值 (Response)', content: record.dart.response },
          { title: 'T 衛教指導 (Teaching)', content: record.dart.teaching },
        ];

  const handlePrint = () => {
    document.body.classList.add('printing-clinical-sheet');
    window.print();
    window.setTimeout(() => {
      document.body.classList.remove('printing-clinical-sheet');
    }, 500);
  };

  return createPortal(
    <div
      className="print-modal-overlay fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-2 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-preview-modal-title"
    >
      <div className="print-modal-dialog bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Modal Controls */}
        <div className="no-print px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white dark:bg-slate-900">
          <div className="min-w-0">
            <h3
              id="print-preview-modal-title"
              className="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              預覽列印格式 — 模擬浮水印與簽名檔文件排版
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              比照匯出 PDF / Word 版面呈現斜向電子浮水印、每行簽名標註與目前編輯內容
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {record.status !== 'signed' && (
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={simulateWatermark}
                  onChange={(e) => setSimulateWatermark(e.target.checked)}
                  className="accent-teal-700"
                />
                模擬簽署浮水印
              </label>
            )}

            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={previewMask}
                onChange={(e) => setPreviewMask(e.target.checked)}
                className="accent-teal-700"
              />
              隱私遮罩預覽
            </label>

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              列印此頁
            </button>

            {canExportSavedFile && (
              <>
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => void onExport('doc')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  DOC
                </button>
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => void onExport('docx')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  DOCX
                </button>
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => void onExport('pdf')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  {exporting === 'pdf' ? '匯出中...' : '匯出 PDF'}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="關閉預覽視窗"
              className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Simulated Paper Canvas */}
        <div className="print-modal-scroll flex-1 overflow-y-auto bg-slate-200/80 dark:bg-slate-950 p-4 sm:p-8">
          {!canExportSavedFile && (
            <div className="no-print max-w-[794px] mx-auto mb-3 px-3.5 py-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg">
              目前正在預覽尚未儲存的新紀錄草稿；如需匯出正式 DOC / PDF 檔案，請先儲存或簽署定稿後再匯出。
            </div>
          )}

          <div className="printable-clinical-sheet max-w-[794px] w-full mx-auto bg-white text-slate-900 p-7 sm:p-10 border border-slate-300 shadow-lg rounded-sm relative overflow-hidden">
            {/* Word/Header Watermark Banner */}
            {isSigned && (
              <div className="border border-dashed border-teal-700 bg-teal-50/70 text-teal-800 px-3 py-2 text-xs font-semibold text-center mb-4 relative z-10">
                電子簽署保護浮水印：{sigLabel} · {formatDateTime(sigTimestamp)}
              </div>
            )}

            {/* Document Header */}
            <div className="border-b-2 border-teal-700 pb-3 mb-5 relative z-10">
              <div className="text-xl font-bold text-slate-900">
                護安錄 CareNote RN — 特別護理師臨床護理紀錄
              </div>
              <div className="text-xs text-slate-600 mt-1">
                預覽時間：{formatDateTime(Date.now())} · 操作人員：{exporterName} · 狀態：
                {record.status === 'signed'
                  ? '已簽署定稿'
                  : simulateWatermark
                  ? '模擬簽署定稿排版'
                  : getStatusLabel(record.status)}
                {previewMask ? ' · 隱私遮罩保護中' : ''}
              </div>
            </div>

            {/* Record Card with Diagonal Watermark Overlay */}
            <div className="relative overflow-hidden border border-slate-300 rounded-md p-5 bg-white">
              {isSigned && (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 pointer-events-none select-none flex flex-col justify-around items-center z-[1] overflow-hidden"
                >
                  <div className="-rotate-[22deg] text-lg sm:text-xl font-bold tracking-widest text-teal-700/12 whitespace-nowrap">
                    電子簽署定稿 · {sigLabel} · {formatDateTime(sigTimestamp)}
                  </div>
                  <div className="-rotate-[22deg] text-base sm:text-lg font-bold tracking-widest text-teal-700/10 whitespace-nowrap">
                    CareNote RN VERIFIED · {sigLabel}
                  </div>
                  <div className="-rotate-[22deg] text-lg sm:text-xl font-bold tracking-widest text-teal-700/12 whitespace-nowrap">
                    電子簽署定稿 · {sigLabel} · {formatDateTime(sigTimestamp)}
                  </div>
                </div>
              )}

              <div className="relative z-[2] space-y-4">
                {/* Focus Title + Row Signature */}
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-base font-bold text-slate-900">
                    1. {record.focusTitle || '（尚未填寫護理焦點）'}
                    <span
                      className={`text-[11px] italic font-normal ml-2 ${
                        isSigned ? 'text-teal-700' : 'text-slate-400'
                      }`}
                    >
                      {rowSignatureText}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-teal-700 whitespace-nowrap">
                    {record.format} · {getStatusLabel(record.status)}
                  </div>
                </div>

                {/* Patient & Vitals Table */}
                <table className="w-full border-collapse text-xs">
                  <tbody>
                    <tr>
                      <td className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-semibold w-[18%]">
                        病患 / 病歷號
                      </td>
                      <td className="border border-slate-200 px-2.5 py-1.5 w-[32%]">
                        {pName} ({mrn})
                      </td>
                      <td className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-semibold w-[18%]">
                        床號 / 病房
                      </td>
                      <td className="border border-slate-200 px-2.5 py-1.5 w-[32%]">
                        {record.bedNumber}
                        {patient?.ward ? ` · ${patient.ward}` : ''}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-semibold">
                        記錄時間
                      </td>
                      <td className="border border-slate-200 px-2.5 py-1.5 font-mono-num tabular-nums">
                        {formatDateTime(record.recordedAtMs)}
                      </td>
                      <td className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-semibold">
                        班別
                      </td>
                      <td className="border border-slate-200 px-2.5 py-1.5">
                        {getShiftLabel(record.shift)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-semibold">
                        生命徵象
                      </td>
                      <td colSpan={3} className="border border-slate-200 px-2.5 py-1.5 font-mono-num tabular-nums">
                        體溫 {record.vitals.temperature.toFixed(1)}°C · 脈搏 {record.vitals.heartRate}{' '}
                        bpm · 呼吸 {record.vitals.respiratoryRate}/min · 血壓{' '}
                        {record.vitals.bpSystolic}/{record.vitals.bpDiastolic} mmHg · 血氧{' '}
                        {record.vitals.spo2}% · 疼痛 {record.vitals.painScore}/10
                        <span
                          className={`font-sans text-[11px] italic ml-2 ${
                            isSigned ? 'text-teal-700' : 'text-slate-400'
                          }`}
                        >
                          {rowSignatureText}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {record.hasAlert && record.alertReason && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-1.5 text-xs font-semibold rounded">
                    異常警示：{record.alertReason}
                  </div>
                )}

                {record.amendmentReason && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5 text-xs font-semibold rounded">
                    簽署後修訂原因：{record.amendmentReason}
                    {record.amendedByName
                      ? `（修訂者：${record.amendedByName} · ${formatDateTime(record.amendedAtMs)}）`
                      : ''}
                  </div>
                )}

                {/* SOAP / DART Sections with Per-Line Signature */}
                <div className="space-y-3">
                  {sections.map((sec) => {
                    const lines = (sec.content || '（未填寫）').split('\n');
                    return (
                      <div key={sec.title} className="space-y-1">
                        <div className="text-xs font-bold text-teal-700">{sec.title}</div>
                        <div className="text-[12.5px] text-slate-800 leading-relaxed space-y-0.5">
                          {lines.map((line, idx) => {
                            const isLast = idx === lines.length - 1;
                            return (
                              <div key={`${sec.title}_${idx}`}>
                                <span>{line || ' '}</span>
                                {isLast && (
                                  <span
                                    className={`text-[11px] italic ml-2 ${
                                      isSigned ? 'text-teal-700' : 'text-slate-400'
                                    }`}
                                  >
                                    {rowSignatureText}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer Verification Line */}
                <div className="border-t border-slate-200 pt-2.5 mt-3 text-[11.5px] text-slate-600 text-right">
                  編寫護理師：{record.authorName} ·{' '}
                  {isSigned
                    ? `電子簽名檔：${sigLabel} (${formatDateTime(sigTimestamp)})`
                    : '狀態：尚未定稿簽署'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
