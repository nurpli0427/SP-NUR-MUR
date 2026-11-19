import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  type AuditAction,
  type AuditLog,
  type CareRecord,
  type CareRecordRevision,
  type CareReminder,
  FIELD_LIMITS,
  type PatientChart,
  type RevisionChangeType,
  type StaffPublicProfile,
  type UserProfile,
  type UserRole,
} from '../types/nursing';
import {
  clampNumber,
  clampString,
  evaluateVitalAlerts,
  generateSafeId,
  sanitizeVitals,
} from './clinicalHelpers';
import { db, handleFirestoreError, OperationType } from './firebase';

const BOOTSTRAP_ADMIN_EMAIL = 'nurpli0427@gmail.com';

export async function ensureUserProfile(firebaseUser: User): Promise<UserProfile> {
  const uid = firebaseUser.uid;
  const userRef = doc(db, 'users', uid);
  const staffRef = doc(db, 'staffPublic', uid);

  let existingSnap;
  try {
    existingSnap = await getDoc(userRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }

  const isBootstrapAdmin =
    firebaseUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL && firebaseUser.emailVerified;

  if (existingSnap && existingSnap.exists()) {
    const raw = existingSnap.data() as Partial<UserProfile>;
    const defaultSig = `特別護理師 ${raw.displayName || '護理師'} RN${raw.licenseNo ? ` · ${raw.licenseNo}` : ''}`;
    const data: UserProfile = {
      uid: raw.uid || uid,
      displayName: raw.displayName || '特別護理師',
      email: raw.email || firebaseUser.email || '',
      role: raw.role || 'special_nurse',
      department: raw.department || '重症特別護理組',
      licenseNo: raw.licenseNo || '',
      signatureText: raw.signatureText || defaultSig,
      pushEnabled: raw.pushEnabled ?? true,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
    // Sync staffPublic quietly if missing
    try {
      const staffSnap = await getDoc(staffRef);
      if (!staffSnap.exists()) {
        await setDoc(staffRef, {
          uid,
          displayName: clampString(data.displayName || '護理師', FIELD_LIMITS.NAME_MAX),
          role: data.role,
          department: clampString(data.department || '特別護理部', FIELD_LIMITS.DEPT_MAX),
          active: true,
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // ignore non-critical directory sync error
    }
    return data;
  }

  const initialRole: UserRole = isBootstrapAdmin ? 'head_nurse' : 'special_nurse';
  const displayName = clampString(
    firebaseUser.displayName || firebaseUser.email?.split('@')[0] || '特別護理師',
    FIELD_LIMITS.NAME_MAX
  );
  const defaultSignature = clampString(`特別護理師 ${displayName} RN`, 120);

  const newProfile: Omit<UserProfile, 'createdAt' | 'updatedAt'> & {
    createdAt: ReturnType<typeof serverTimestamp>;
    updatedAt: ReturnType<typeof serverTimestamp>;
  } = {
    uid,
    displayName,
    email: clampString(firebaseUser.email || 'unknown@clinic.local', FIELD_LIMITS.EMAIL_MAX),
    role: initialRole,
    department: isBootstrapAdmin ? '特護督導中心' : '重症特別護理組',
    licenseNo: '',
    signatureText: defaultSignature,
    pushEnabled: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(userRef, newProfile);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}`);
  }

  try {
    await setDoc(staffRef, {
      uid,
      displayName,
      role: initialRole,
      department: newProfile.department,
      active: true,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `staffPublic/${uid}`);
  }

  if (isBootstrapAdmin) {
    try {
      await setDoc(doc(db, 'admins', uid), {
        uid,
        grantedBy: uid,
        createdAt: serverTimestamp(),
      });
    } catch {
      // bootstrapped admin also verified by token email
    }
  }

  return {
    ...newProfile,
    createdAt: undefined,
    updatedAt: undefined,
  };
}

export async function updateMyProfile(
  uid: string,
  updates: {
    displayName: string;
    department: string;
    licenseNo: string;
    signatureText: string;
    pushEnabled: boolean;
  }
): Promise<void> {
  const cleanName = clampString(updates.displayName || '護理師', FIELD_LIMITS.NAME_MAX);
  const cleanDept = clampString(updates.department, FIELD_LIMITS.DEPT_MAX);
  const cleanLic = clampString(updates.licenseNo, FIELD_LIMITS.LICENSE_MAX);
  const cleanSig = clampString(
    updates.signatureText || `特別護理師 ${cleanName} RN`,
    120
  );

  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: cleanName,
      department: cleanDept,
      licenseNo: cleanLic,
      signatureText: cleanSig,
      pushEnabled: Boolean(updates.pushEnabled),
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'staffPublic', uid), {
      displayName: cleanName,
      department: cleanDept,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function updateStaffRole(
  actor: UserProfile,
  targetUid: string,
  newRole: UserRole
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      role: newRole,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'staffPublic', targetUid), {
      role: newRole,
      updatedAt: serverTimestamp(),
    });
    if (newRole === 'head_nurse') {
      await setDoc(doc(db, 'admins', targetUid), {
        uid: targetUid,
        grantedBy: actor.uid,
        createdAt: serverTimestamp(),
      });
    } else if (targetUid !== actor.uid) {
      try {
        await deleteDoc(doc(db, 'admins', targetUid));
      } catch {
        // admin doc may not exist
      }
    }
    await writeAuditLog(
      actor,
      'role_updated',
      'user',
      targetUid,
      `變更人員權限為 ${newRole}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
  }
}

export async function writeAuditLog(
  actor: UserProfile,
  action: AuditAction,
  targetType: AuditLog['targetType'],
  targetId: string,
  summary: string
): Promise<void> {
  const logId = generateSafeId('log');
  try {
    await setDoc(doc(db, 'auditLogs', logId), {
      logId,
      actorUid: actor.uid,
      actorName: clampString(actor.displayName, FIELD_LIMITS.NAME_MAX),
      action,
      targetType,
      targetId: clampString(targetId, FIELD_LIMITS.ID_MAX),
      summary: clampString(summary, FIELD_LIMITS.AUDIT_SUMMARY_MAX),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Audit log write skipped:', err);
  }
}

export function subscribeStaffDirectory(
  isAdminUser: boolean,
  onData: (staff: StaffPublicProfile[]) => void
): Unsubscribe {
  const q = isAdminUser
    ? query(collection(db, 'staffPublic'))
    : query(collection(db, 'staffPublic'), where('active', '==', true));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as StaffPublicProfile);
      onData(list);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'staffPublic');
    }
  );
}

export function subscribePatients(
  uid: string,
  isBootstrappedAdmin: boolean,
  onData: (patients: PatientChart[]) => void
): Unsubscribe {
  const q = isBootstrappedAdmin
    ? query(collection(db, 'patients'), orderBy('updatedAt', 'desc'))
    : query(collection(db, 'patients'), where('assignedNurseIds', 'array-contains', uid));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as PatientChart);
      items.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
      onData(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'patients');
    }
  );
}

export function subscribeCareRecords(
  uid: string,
  isBootstrappedAdmin: boolean,
  onData: (records: CareRecord[], hasPendingWrites: boolean, fromCache: boolean) => void
): Unsubscribe {
  const q = isBootstrappedAdmin
    ? query(collection(db, 'careRecords'), orderBy('recordedAtMs', 'desc'))
    : query(collection(db, 'careRecords'), where('assignedNurseIds', 'array-contains', uid));

  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const items = snap.docs.map((d) => {
        const raw = d.data() as Partial<CareRecord>;
        return {
          ...(raw as CareRecord),
          signatureText: raw.signatureText || raw.signedByName || '',
          amendmentReason: raw.amendmentReason || '',
          amendedBy: raw.amendedBy || '',
          amendedByName: raw.amendedByName || '',
          amendedAtMs: raw.amendedAtMs || 0,
          _hasPendingWrites: d.metadata.hasPendingWrites,
          _fromCache: d.metadata.fromCache,
        };
      });
      items.sort((a, b) => b.recordedAtMs - a.recordedAtMs);
      onData(items, snap.metadata.hasPendingWrites, snap.metadata.fromCache);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'careRecords');
    }
  );
}

export function subscribeRecordRevisions(
  recordId: string,
  uid: string,
  isBootstrappedAdmin: boolean,
  onData: (revisions: CareRecordRevision[]) => void
): Unsubscribe {
  const colRef = collection(db, 'careRecords', recordId, 'revisions');
  const q = isBootstrappedAdmin
    ? query(colRef)
    : query(colRef, where('assignedNurseIds', 'array-contains', uid));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as CareRecordRevision);
      items.sort((a, b) => {
        if (b.savedAtMs !== a.savedAtMs) return b.savedAtMs - a.savedAtMs;
        return b.versionNumber - a.versionNumber;
      });
      onData(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, `careRecords/${recordId}/revisions`);
    }
  );
}

export function subscribeReminders(
  uid: string,
  isBootstrappedAdmin: boolean,
  onData: (reminders: CareReminder[]) => void
): Unsubscribe {
  const q = isBootstrappedAdmin
    ? query(collection(db, 'reminders'), orderBy('dueAtMs', 'asc'))
    : query(collection(db, 'reminders'), where('assignedNurseIds', 'array-contains', uid));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as CareReminder);
      items.sort((a, b) => a.dueAtMs - b.dueAtMs);
      onData(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'reminders');
    }
  );
}

export function subscribeAuditLogs(
  uid: string,
  isBootstrappedAdmin: boolean,
  onData: (logs: AuditLog[]) => void
): Unsubscribe {
  const q = isBootstrappedAdmin
    ? query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'auditLogs'), where('actorUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as AuditLog);
      items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      onData(items.slice(0, 80));
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'auditLogs');
    }
  );
}

export async function createPatientChart(
  actor: UserProfile,
  input: Omit<PatientChart, 'patientId' | 'createdBy' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const patientId = generateSafeId('pat');
  const assigned = Array.from(new Set([actor.uid, ...input.assignedNurseIds])).slice(
    0,
    FIELD_LIMITS.MAX_ASSIGNED_NURSES
  );

  const payload = {
    patientId,
    mrn: clampString(input.mrn, FIELD_LIMITS.MRN_MAX),
    fullName: clampString(input.fullName, FIELD_LIMITS.NAME_MAX),
    bedNumber: clampString(input.bedNumber, FIELD_LIMITS.BED_MAX),
    ward: clampString(input.ward, FIELD_LIMITS.WARD_MAX),
    age: clampNumber(Math.round(input.age), 0, 130),
    gender: input.gender,
    diagnosis: clampString(input.diagnosis, FIELD_LIMITS.DIAGNOSIS_MAX),
    careLevel: input.careLevel,
    allergies: clampString(input.allergies || '無已知過敏史', FIELD_LIMITS.ALLERGY_MAX),
    assignedNurseIds: assigned,
    primaryNurseId: input.primaryNurseId || actor.uid,
    status: input.status || 'active',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'patients', patientId), payload);
    await writeAuditLog(
      actor,
      'patient_created',
      'patient',
      patientId,
      `建立病患資料（床號 ${payload.bedNumber}）`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `patients/${patientId}`);
  }
  return patientId;
}

export async function updatePatientAssignments(
  patientId: string,
  assignedNurseIds: string[],
  primaryNurseId: string
): Promise<void> {
  const cleaned = Array.from(new Set(assignedNurseIds)).slice(0, FIELD_LIMITS.MAX_ASSIGNED_NURSES);
  if (cleaned.length === 0) return;

  try {
    await updateDoc(doc(db, 'patients', patientId), {
      assignedNurseIds: cleaned,
      primaryNurseId: cleaned.includes(primaryNurseId) ? primaryNurseId : cleaned[0],
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `patients/${patientId}`);
  }
}

async function writeCareRecordRevision(params: {
  actor: UserProfile;
  recordId: string;
  patientId: string;
  assignedNurseIds: string[];
  versionNumber: number;
  changeType: RevisionChangeType;
  changeReason: string;
  format: CareRecord['format'];
  shift: CareRecord['shift'];
  focusTitle: string;
  status: CareRecord['status'];
  signatureText: string;
  vitals: CareRecord['vitals'];
  soap: CareRecord['soap'];
  dart: CareRecord['dart'];
  hasAlert: boolean;
  alertReason: string;
}): Promise<void> {
  const revisionId = generateSafeId('rev');
  const payload = {
    revisionId,
    recordId: params.recordId,
    patientId: params.patientId,
    assignedNurseIds: params.assignedNurseIds.slice(0, FIELD_LIMITS.MAX_ASSIGNED_NURSES),
    versionNumber: Math.max(1, Math.round(params.versionNumber)),
    changeType: params.changeType,
    changeReason: clampString(params.changeReason, 240),
    format: params.format,
    shift: params.shift,
    focusTitle: clampString(params.focusTitle, FIELD_LIMITS.FOCUS_MAX),
    status: params.status,
    signatureText: clampString(params.signatureText, 120),
    vitals: params.vitals,
    soap: params.soap,
    dart: params.dart,
    hasAlert: params.hasAlert,
    alertReason: clampString(params.alertReason, FIELD_LIMITS.ALERT_REASON_MAX),
    editedByUid: params.actor.uid,
    editedByName: clampString(params.actor.displayName, FIELD_LIMITS.NAME_MAX),
    savedAtMs: Date.now(),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'careRecords', params.recordId, 'revisions', revisionId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `careRecords/${params.recordId}/revisions/${revisionId}`);
  }
}

export async function saveCareRecord(
  actor: UserProfile,
  patient: PatientChart,
  draft: {
    recordId?: string;
    format: CareRecord['format'];
    shift: CareRecord['shift'];
    focusTitle: string;
    status: CareRecord['status'];
    vitals: CareRecord['vitals'];
    soap: CareRecord['soap'];
    dart: CareRecord['dart'];
    recordedAtMs: number;
    offlineOriginId?: string;
    signatureText?: string;
    isSignedAmendment?: boolean;
    amendmentReason?: string;
    previousAmendedAtMs?: number;
    nextVersionNumber?: number;
  }
): Promise<string> {
  const isNew = !draft.recordId;
  const recordId = draft.recordId || generateSafeId('rec');
  const vitals = sanitizeVitals(draft.vitals);
  const { hasAlert, reasons } = evaluateVitalAlerts(vitals);
  const isAmendment = Boolean(draft.isSignedAmendment);
  const computedStatus = isAmendment
    ? 'signed'
    : draft.status === 'signed'
    ? 'signed'
    : hasAlert
    ? 'alert'
    : draft.status;

  const signedBy = computedStatus === 'signed' ? actor.uid : '';
  const signedByName =
    computedStatus === 'signed' ? clampString(actor.displayName, FIELD_LIMITS.NAME_MAX) : '';
  const signatureText =
    computedStatus === 'signed'
      ? clampString(
          draft.signatureText || actor.signatureText || `特別護理師 ${actor.displayName} RN`,
          120
        )
      : '';
  const signedAtMs = computedStatus === 'signed' ? Date.now() : 0;

  const cleanAmendmentReason = isAmendment
    ? clampString(draft.amendmentReason || '', 240)
    : '';
  if (isAmendment && cleanAmendmentReason.length < 2) {
    throw new Error('更改已簽署紀錄時，必須輸入至少 2 字的修訂原因。');
  }

  const soap = {
    subjective: clampString(draft.soap.subjective, FIELD_LIMITS.SECTION_MAX),
    objective: clampString(draft.soap.objective, FIELD_LIMITS.SECTION_MAX),
    assessment: clampString(draft.soap.assessment, FIELD_LIMITS.SECTION_MAX),
    plan: clampString(draft.soap.plan, FIELD_LIMITS.SECTION_MAX),
  };

  const dart = {
    data: clampString(draft.dart.data, FIELD_LIMITS.SECTION_MAX),
    action: clampString(draft.dart.action, FIELD_LIMITS.SECTION_MAX),
    response: clampString(draft.dart.response, FIELD_LIMITS.SECTION_MAX),
    teaching: clampString(draft.dart.teaching, FIELD_LIMITS.SECTION_MAX),
  };

  const focusTitle = clampString(draft.focusTitle || '特別護理評估紀錄', FIELD_LIMITS.FOCUS_MAX);
  const alertReason = clampString(reasons.join('、'), FIELD_LIMITS.ALERT_REASON_MAX);

  const nextVer = Math.max(1, draft.nextVersionNumber ?? (isNew ? 1 : 2));
  const assignedList = patient.assignedNurseIds.slice(0, FIELD_LIMITS.MAX_ASSIGNED_NURSES);

  if (isNew) {
    const payload = {
      recordId,
      patientId: patient.patientId,
      patientName: clampString(patient.fullName, FIELD_LIMITS.NAME_MAX),
      mrn: clampString(patient.mrn, FIELD_LIMITS.MRN_MAX),
      bedNumber: clampString(patient.bedNumber, FIELD_LIMITS.BED_MAX),
      format: draft.format,
      shift: draft.shift,
      focusTitle,
      status: computedStatus,
      assignedNurseIds: assignedList,
      authorId: actor.uid,
      authorName: clampString(actor.displayName, FIELD_LIMITS.NAME_MAX),
      signedBy,
      signedByName,
      signatureText,
      signedAtMs,
      amendmentReason: '',
      amendedBy: '',
      amendedByName: '',
      amendedAtMs: 0,
      vitals,
      soap,
      dart,
      hasAlert,
      alertReason,
      offlineOriginId: clampString(draft.offlineOriginId || `dev_${actor.uid.slice(0, 8)}`, FIELD_LIMITS.ID_MAX),
      recordedAtMs: draft.recordedAtMs || Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, 'careRecords', recordId), payload);
      await writeCareRecordRevision({
        actor,
        recordId,
        patientId: patient.patientId,
        assignedNurseIds: assignedList,
        versionNumber: 1,
        changeType: computedStatus === 'signed' ? 'signed' : 'created',
        changeReason: computedStatus === 'signed' ? '建立並電子簽署定稿' : '建立初版護理紀錄',
        format: draft.format,
        shift: draft.shift,
        focusTitle,
        status: computedStatus,
        signatureText,
        vitals,
        soap,
        dart,
        hasAlert,
        alertReason,
      });
      await writeAuditLog(
        actor,
        computedStatus === 'signed' ? 'record_signed' : 'record_created',
        'careRecord',
        recordId,
        `${computedStatus === 'signed' ? `簽署建立（${signatureText}）` : '新增'} ${draft.format} 護理紀錄（${focusTitle}）`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `careRecords/${recordId}`);
    }
  } else if (isAmendment) {
    const amendedAtMs = Math.max(Date.now(), (draft.previousAmendedAtMs || 0) + 1);
    try {
      await updateDoc(doc(db, 'careRecords', recordId), {
        format: draft.format,
        shift: draft.shift,
        focusTitle,
        status: 'signed',
        signedBy,
        signedByName,
        signatureText,
        signedAtMs,
        amendmentReason: cleanAmendmentReason,
        amendedBy: actor.uid,
        amendedByName: clampString(actor.displayName, FIELD_LIMITS.NAME_MAX),
        amendedAtMs,
        vitals,
        soap,
        dart,
        hasAlert,
        alertReason,
        recordedAtMs: draft.recordedAtMs || Date.now(),
        updatedAt: serverTimestamp(),
      });
      await writeCareRecordRevision({
        actor,
        recordId,
        patientId: patient.patientId,
        assignedNurseIds: assignedList,
        versionNumber: nextVer,
        changeType: 'amended',
        changeReason: cleanAmendmentReason,
        format: draft.format,
        shift: draft.shift,
        focusTitle,
        status: 'signed',
        signatureText,
        vitals,
        soap,
        dart,
        hasAlert,
        alertReason,
      });
      await writeAuditLog(
        actor,
        'record_amended',
        'careRecord',
        recordId,
        `修訂已簽署紀錄（${focusTitle}）· 原因：${cleanAmendmentReason} · 簽名：${signatureText}`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `careRecords/${recordId}`);
    }
  } else {
    try {
      await updateDoc(doc(db, 'careRecords', recordId), {
        format: draft.format,
        shift: draft.shift,
        focusTitle,
        status: computedStatus,
        signedBy,
        signedByName,
        signatureText,
        signedAtMs,
        vitals,
        soap,
        dart,
        hasAlert,
        alertReason,
        recordedAtMs: draft.recordedAtMs || Date.now(),
        updatedAt: serverTimestamp(),
      });
      await writeCareRecordRevision({
        actor,
        recordId,
        patientId: patient.patientId,
        assignedNurseIds: assignedList,
        versionNumber: nextVer,
        changeType: computedStatus === 'signed' ? 'signed' : 'updated',
        changeReason:
          computedStatus === 'signed'
            ? '完成覆核並電子簽署定稿'
            : computedStatus === 'pending_review'
            ? '儲存內容並送交覆核'
            : '更新草稿護理內容',
        format: draft.format,
        shift: draft.shift,
        focusTitle,
        status: computedStatus,
        signatureText,
        vitals,
        soap,
        dart,
        hasAlert,
        alertReason,
      });
      await writeAuditLog(
        actor,
        computedStatus === 'signed' ? 'record_signed' : 'record_updated',
        'careRecord',
        recordId,
        `${computedStatus === 'signed' ? `簽署定稿（${signatureText}）` : '更新'} ${draft.format} 護理紀錄（${focusTitle}）`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `careRecords/${recordId}`);
    }
  }

  return recordId;
}

export async function restoreCareRecordRevision(params: {
  actor: UserProfile;
  currentRecord: CareRecord;
  revision: CareRecordRevision;
  nextVersionNumber: number;
  restoreReason?: string;
}): Promise<void> {
  const { actor, currentRecord, revision, nextVersionNumber, restoreReason } = params;
  const recordId = currentRecord.recordId;
  const vitals = sanitizeVitals(revision.vitals);
  const { hasAlert, reasons } = evaluateVitalAlerts(vitals);
  const alertReason = clampString(reasons.join('、'), FIELD_LIMITS.ALERT_REASON_MAX);
  const cleanReason = clampString(
    restoreReason?.trim() || `還原至 v${revision.versionNumber} 歷史版本`,
    240
  );

  if (currentRecord.status === 'signed') {
    if (cleanReason.length < 2) {
      throw new Error('還原已簽署紀錄時，必須提供至少 2 字的修訂原因。');
    }
    const sigText = clampString(
      revision.signatureText || actor.signatureText || `特別護理師 ${actor.displayName} RN`,
      120
    );
    const nowMs = Math.max(Date.now(), (currentRecord.amendedAtMs || 0) + 1);
    try {
      await updateDoc(doc(db, 'careRecords', recordId), {
        format: revision.format,
        shift: revision.shift,
        focusTitle: clampString(revision.focusTitle, FIELD_LIMITS.FOCUS_MAX),
        status: 'signed',
        signedBy: actor.uid,
        signedByName: clampString(actor.displayName, FIELD_LIMITS.NAME_MAX),
        signatureText: sigText,
        signedAtMs: nowMs,
        amendmentReason: cleanReason,
        amendedBy: actor.uid,
        amendedByName: clampString(actor.displayName, FIELD_LIMITS.NAME_MAX),
        amendedAtMs: nowMs,
        vitals,
        soap: revision.soap,
        dart: revision.dart,
        hasAlert,
        alertReason,
        updatedAt: serverTimestamp(),
      });
      await writeCareRecordRevision({
        actor,
        recordId,
        patientId: currentRecord.patientId,
        assignedNurseIds: currentRecord.assignedNurseIds,
        versionNumber: nextVersionNumber,
        changeType: 'restored',
        changeReason: cleanReason,
        format: revision.format,
        shift: revision.shift,
        focusTitle: revision.focusTitle,
        status: 'signed',
        signatureText: sigText,
        vitals,
        soap: revision.soap,
        dart: revision.dart,
        hasAlert,
        alertReason,
      });
      await writeAuditLog(
        actor,
        'record_restored',
        'careRecord',
        recordId,
        `還原已簽署紀錄至 v${revision.versionNumber}（${revision.focusTitle}）· 原因：${cleanReason}`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `careRecords/${recordId}`);
    }
  } else {
    const nextStatus = hasAlert
      ? 'alert'
      : currentRecord.status === 'alert'
      ? 'pending_review'
      : currentRecord.status;
    try {
      await updateDoc(doc(db, 'careRecords', recordId), {
        format: revision.format,
        shift: revision.shift,
        focusTitle: clampString(revision.focusTitle, FIELD_LIMITS.FOCUS_MAX),
        status: nextStatus,
        signedBy: '',
        signedByName: '',
        signatureText: '',
        signedAtMs: 0,
        vitals,
        soap: revision.soap,
        dart: revision.dart,
        hasAlert,
        alertReason,
        updatedAt: serverTimestamp(),
      });
      await writeCareRecordRevision({
        actor,
        recordId,
        patientId: currentRecord.patientId,
        assignedNurseIds: currentRecord.assignedNurseIds,
        versionNumber: nextVersionNumber,
        changeType: 'restored',
        changeReason: cleanReason,
        format: revision.format,
        shift: revision.shift,
        focusTitle: revision.focusTitle,
        status: nextStatus,
        signatureText: '',
        vitals,
        soap: revision.soap,
        dart: revision.dart,
        hasAlert,
        alertReason,
      });
      await writeAuditLog(
        actor,
        'record_restored',
        'careRecord',
        recordId,
        `還原紀錄至 v${revision.versionNumber}（${revision.focusTitle}）`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `careRecords/${recordId}`);
    }
  }
}

export async function unlockSignedRecord(
  actor: UserProfile,
  record: CareRecord,
  nextVersionNumber = 2
): Promise<void> {
  try {
    await updateDoc(doc(db, 'careRecords', record.recordId), {
      status: 'pending_review',
      signedBy: '',
      signedByName: '',
      signatureText: '',
      signedAtMs: 0,
      updatedAt: serverTimestamp(),
    });
    await writeCareRecordRevision({
      actor,
      recordId: record.recordId,
      patientId: record.patientId,
      assignedNurseIds: record.assignedNurseIds,
      versionNumber: nextVersionNumber,
      changeType: 'unlocked',
      changeReason: '護理長解鎖已簽署紀錄以供增補修訂',
      format: record.format,
      shift: record.shift,
      focusTitle: record.focusTitle,
      status: 'pending_review',
      signatureText: '',
      vitals: record.vitals,
      soap: record.soap,
      dart: record.dart,
      hasAlert: record.hasAlert,
      alertReason: record.alertReason,
    });
    await writeAuditLog(
      actor,
      'record_unlocked',
      'careRecord',
      record.recordId,
      `護理長解鎖已定稿紀錄以供增補修訂（${record.focusTitle}）`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `careRecords/${record.recordId}`);
  }
}

export async function deleteDraftRecord(recordId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'careRecords', recordId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `careRecords/${recordId}`);
  }
}

export async function createCareReminder(
  actor: UserProfile,
  patient: PatientChart,
  input: {
    title: string;
    category: CareReminder['category'];
    dueAtMs: number;
    repeatMinutes: number;
  }
): Promise<string> {
  const reminderId = generateSafeId('rem');
  const payload = {
    reminderId,
    patientId: patient.patientId,
    patientName: clampString(patient.fullName, FIELD_LIMITS.NAME_MAX),
    bedNumber: clampString(patient.bedNumber, FIELD_LIMITS.BED_MAX),
    title: clampString(input.title, FIELD_LIMITS.REMINDER_TITLE_MAX),
    category: input.category,
    dueAtMs: input.dueAtMs,
    repeatMinutes: clampNumber(Math.round(input.repeatMinutes), 0, 1440),
    status: 'pending' as const,
    assignedNurseIds: patient.assignedNurseIds.slice(0, FIELD_LIMITS.MAX_ASSIGNED_NURSES),
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'reminders', reminderId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `reminders/${reminderId}`);
  }
  return reminderId;
}

export async function updateReminderStatus(
  reminderId: string,
  status: CareReminder['status'],
  dueAtMs?: number
): Promise<void> {
  try {
    const patch: Record<string, unknown> = {
      status,
      updatedAt: serverTimestamp(),
    };
    if (typeof dueAtMs === 'number') {
      patch.dueAtMs = dueAtMs;
    }
    await updateDoc(doc(db, 'reminders', reminderId), patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `reminders/${reminderId}`);
  }
}

export async function deleteCareReminder(reminderId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'reminders', reminderId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `reminders/${reminderId}`);
  }
}
