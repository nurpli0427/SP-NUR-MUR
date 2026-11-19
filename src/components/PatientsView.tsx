import React, { useState } from 'react';
import { Plus, Shield, UserCheck, Users } from 'lucide-react';
import {
  getCareLevelLabel,
  getRoleLabel,
  maskMrn,
  maskPatientName,
} from '../lib/clinicalHelpers';
import { createPatientChart, updatePatientAssignments } from '../lib/nursingService';
import {
  type CareLevel,
  FIELD_LIMITS,
  type PatientChart,
  type PatientGender,
  type StaffPublicProfile,
  type UserProfile,
} from '../types/nursing';

interface PatientsViewProps {
  profile: UserProfile;
  patients: PatientChart[];
  staffList: StaffPublicProfile[];
  privacyMask: boolean;
  onStartRecordForPatient: (patientId: string) => void;
}

export const PatientsView: React.FC<PatientsViewProps> = ({
  profile,
  patients,
  staffList,
  privacyMask,
  onStartRecordForPatient,
}) => {
  const canWrite = profile.role !== 'supervisor_viewer';
  const isHeadNurse = profile.role === 'head_nurse';

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [mrn, setMrn] = useState('');
  const [fullName, setFullName] = useState('');
  const [bedNumber, setBedNumber] = useState('');
  const [ward, setWard] = useState('特護病房 A 區');
  const [age, setAge] = useState<number>(65);
  const [gender, setGender] = useState<PatientGender>('M');
  const [careLevel, setCareLevel] = useState<CareLevel>('Special');
  const [diagnosis, setDiagnosis] = useState('');
  const [allergies, setAllergies] = useState('無已知藥物或食物過敏');
  const [selectedStaff, setSelectedStaff] = useState<string[]>([profile.uid]);

  const [submitting, setSubmitting] = useState(false);
  const [editingAccessPatientId, setEditingAccessPatientId] = useState<string | null>(null);
  const [editStaffSelection, setEditStaffSelection] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const staffNameMap = new Map(staffList.map((s) => [s.uid, s]));

  const toggleStaff = (uid: string, list: string[], setter: (v: string[]) => void) => {
    if (list.includes(uid)) {
      if (list.length <= 1) return;
      setter(list.filter((id) => id !== uid));
    } else if (list.length < FIELD_LIMITS.MAX_ASSIGNED_NURSES) {
      setter([...list, uid]);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mrn.trim() || !fullName.trim() || !bedNumber.trim() || !diagnosis.trim()) return;
    setSubmitting(true);
    setStatusMessage(null);
    try {
      await createPatientChart(profile, {
        mrn,
        fullName,
        bedNumber,
        ward,
        age,
        gender,
        diagnosis,
        careLevel,
        allergies,
        assignedNurseIds: selectedStaff.includes(profile.uid)
          ? selectedStaff
          : [profile.uid, ...selectedStaff],
        primaryNurseId: profile.uid,
        status: 'active',
      });
      setMrn('');
      setFullName('');
      setBedNumber('');
      setDiagnosis('');
      setShowCreateForm(false);
      setStatusMessage('病患建檔完成，已依指派護理師清單設定隱私存取權限。');
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : '建檔失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const openAccessEditor = (patient: PatientChart) => {
    setEditingAccessPatientId(patient.patientId);
    setEditStaffSelection(patient.assignedNurseIds);
  };

  const handleSaveAssignments = async (patient: PatientChart) => {
    setSubmitting(true);
    try {
      await updatePatientAssignments(
        patient.patientId,
        editStaffSelection,
        patient.primaryNurseId
      );
      setEditingAccessPatientId(null);
      setStatusMessage(`已更新 ${maskPatientName(patient.fullName, privacyMask)} 的授權照護護理師名單。`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : '權限更新失敗');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            受託照護病患與隱私權限範圍
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            每位病患僅限名單內被授權指派之特別護理師與護理長可瀏覽與編寫紀錄
          </p>
        </div>

        {canWrite && (
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {showCreateForm ? '收合建檔表單' : '新增照護病患'}
          </button>
        )}
      </div>

      {statusMessage && (
        <div className="p-3.5 text-xs font-medium bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-teal-900 dark:text-teal-200 rounded-lg">
          {statusMessage}
        </div>
      )}

      {showCreateForm && canWrite && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
        >
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            建立新病患照護檔案
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                病歷號 (MRN) *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.MRN_MAX}
                value={mrn}
                onChange={(e) => setMrn(e.target.value)}
                placeholder="例：MRN-2026-0842"
                className="w-full px-3 py-2 text-sm font-mono-num bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                病患姓名 *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.NAME_MAX}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="例：陳志明"
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                床號 *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.BED_MAX}
                value={bedNumber}
                onChange={(e) => setBedNumber(e.target.value)}
                placeholder="例：ICU-102"
                className="w-full px-3 py-2 text-sm font-mono-num bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                病房區域
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.WARD_MAX}
                value={ward}
                onChange={(e) => setWard(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                年齡
              </label>
              <input
                type="number"
                min={0}
                max={130}
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono-num bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                性別
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as PatientGender)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="M">男</option>
                <option value="F">女</option>
                <option value="Other">其他</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                特別照護等級
              </label>
              <select
                value={careLevel}
                onChange={(e) => setCareLevel(e.target.value as CareLevel)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="Special">一對一特護</option>
                <option value="ICU">加護特護</option>
                <option value="PostOp">術後密切照護</option>
                <option value="Hospice">安寧緩和特護</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                過敏史警示
              </label>
              <input
                type="text"
                maxLength={FIELD_LIMITS.ALLERGY_MAX}
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              主要臨床診斷 / 照護摘要 *
            </label>
            <input
              type="text"
              required
              maxLength={FIELD_LIMITS.DIAGNOSIS_MAX}
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="例：冠狀動脈繞道手術後（CABG Day 2）、高血壓病史"
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>

          {staffList.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                指派授權護理師（最多 {FIELD_LIMITS.MAX_ASSIGNED_NURSES} 位）
              </div>
              <div className="flex flex-wrap gap-2">
                {staffList.map((s) => {
                  const active = selectedStaff.includes(s.uid);
                  return (
                    <button
                      key={s.uid}
                      type="button"
                      onClick={() => toggleStaff(s.uid, selectedStaff, setSelectedStaff)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-teal-700 text-white border-teal-700'
                          : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {s.displayName} ({getRoleLabel(s.role)})
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
            >
              {submitting ? '建立中...' : '確認建立病患檔案'}
            </button>
          </div>
        </form>
      )}

      {/* Patient Cards Grid */}
      {patients.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center space-y-3">
          <Users className="w-8 h-8 text-slate-300 mx-auto" />
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
            目前沒有已授權的病患檔案
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            點擊右上角「新增照護病患」即可建立病患資料並設定特護人員存取範圍。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {patients.map((patient) => {
            const canManageAccess = isHeadNurse || patient.primaryNurseId === profile.uid;
            const isEditingThis = editingAccessPatientId === patient.patientId;

            return (
              <article
                key={patient.patientId}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-teal-700 dark:text-teal-400 font-medium">
                      {patient.bedNumber} · {patient.ward} · {getCareLevelLabel(patient.careLevel)}
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-1">
                      {maskPatientName(patient.fullName, privacyMask)}
                    </h3>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num mt-0.5">
                      {maskMrn(patient.mrn, privacyMask)} · {patient.age} 歲 · {patient.gender === 'M' ? '男' : patient.gender === 'F' ? '女' : '其他'}
                    </div>
                  </div>

                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => onStartRecordForPatient(patient.patientId)}
                      className="px-3 py-1.5 text-xs font-medium text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      編寫護理紀錄
                    </button>
                  )}
                </div>

                <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">臨床診斷：</span>
                    {patient.diagnosis}
                  </div>
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">過敏警示：</span>
                    <span className={patient.allergies.includes('無') ? '' : 'text-red-600 dark:text-red-400 font-medium'}>
                      {patient.allergies}
                    </span>
                  </div>
                </div>

                {/* Privacy Access Control List */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                      <Shield className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                      授權存取人員 ({patient.assignedNurseIds.length})
                    </span>
                    {canManageAccess && (
                      <button
                        type="button"
                        onClick={() =>
                          isEditingThis
                            ? setEditingAccessPatientId(null)
                            : openAccessEditor(patient)
                        }
                        className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                      >
                        {isEditingThis ? '關閉設定' : '調整授權人員'}
                      </button>
                    )}
                  </div>

                  {!isEditingThis ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {patient.assignedNurseIds
                        .map((uid) => staffNameMap.get(uid)?.displayName || (uid === profile.uid ? profile.displayName : uid.slice(0, 8)))
                        .join(' · ')}
                    </div>
                  ) : (
                    <div className="space-y-2.5 pt-1">
                      <div className="flex flex-wrap gap-1.5">
                        {staffList.map((s) => {
                          const active = editStaffSelection.includes(s.uid);
                          return (
                            <button
                              key={s.uid}
                              type="button"
                              onClick={() =>
                                toggleStaff(s.uid, editStaffSelection, setEditStaffSelection)
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border cursor-pointer ${
                                active
                                  ? 'bg-teal-700 text-white border-teal-700'
                                  : 'bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                              }`}
                            >
                              <UserCheck className="w-3 h-3" />
                              {s.displayName}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleSaveAssignments(patient)}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                      >
                        儲存存取權限
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
