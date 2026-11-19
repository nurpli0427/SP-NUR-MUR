import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'head_nurse' | 'special_nurse' | 'supervisor_viewer';

export type CareLevel = 'ICU' | 'Special' | 'PostOp' | 'Hospice';
export type PatientGender = 'M' | 'F' | 'Other';
export type PatientStatus = 'active' | 'discharged';

export type CareRecordFormat = 'SOAP' | 'DART';
export type ShiftType = 'Day' | 'Evening' | 'Night';
export type CareRecordStatus = 'draft' | 'pending_review' | 'signed' | 'alert';

export type ReminderCategory = 'vitals' | 'turning' | 'medication' | 'handover' | 'assessment';
export type ReminderStatus = 'pending' | 'notified' | 'completed' | 'snoozed';

export type AuditAction =
  | 'record_created'
  | 'record_updated'
  | 'record_signed'
  | 'record_amended'
  | 'record_unlocked'
  | 'record_exported_pdf'
  | 'record_exported_doc'
  | 'patient_created'
  | 'role_updated'
  | 'backup_restored';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  department: string;
  licenseNo: string;
  signatureText: string;
  pushEnabled: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StaffPublicProfile {
  uid: string;
  displayName: string;
  role: UserRole;
  department: string;
  active: boolean;
  updatedAt?: Timestamp;
}

export interface PatientChart {
  patientId: string;
  mrn: string;
  fullName: string;
  bedNumber: string;
  ward: string;
  age: number;
  gender: PatientGender;
  diagnosis: string;
  careLevel: CareLevel;
  allergies: string;
  assignedNurseIds: string[];
  primaryNurseId: string;
  status: PatientStatus;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface VitalSigns {
  temperature: number;
  heartRate: number;
  respiratoryRate: number;
  bpSystolic: number;
  bpDiastolic: number;
  spo2: number;
  painScore: number;
}

export interface SoapContent {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface DartContent {
  data: string;
  action: string;
  response: string;
  teaching: string;
}

export interface CareRecord {
  recordId: string;
  patientId: string;
  patientName: string;
  mrn: string;
  bedNumber: string;
  format: CareRecordFormat;
  shift: ShiftType;
  focusTitle: string;
  status: CareRecordStatus;
  assignedNurseIds: string[];
  authorId: string;
  authorName: string;
  signedBy: string;
  signedByName: string;
  signatureText: string;
  signedAtMs: number;
  amendmentReason: string;
  amendedBy: string;
  amendedByName: string;
  amendedAtMs: number;
  vitals: VitalSigns;
  soap: SoapContent;
  dart: DartContent;
  hasAlert: boolean;
  alertReason: string;
  offlineOriginId: string;
  recordedAtMs: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  // Local runtime sync metadata from Firestore snapshot
  _hasPendingWrites?: boolean;
  _fromCache?: boolean;
}

export interface CareReminder {
  reminderId: string;
  patientId: string;
  patientName: string;
  bedNumber: string;
  title: string;
  category: ReminderCategory;
  dueAtMs: number;
  repeatMinutes: number;
  status: ReminderStatus;
  assignedNurseIds: string[];
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AuditLog {
  logId: string;
  actorUid: string;
  actorName: string;
  action: AuditAction;
  targetType: 'careRecord' | 'patient' | 'user' | 'backup';
  targetId: string;
  summary: string;
  createdAt?: Timestamp;
}

export interface LocalDraftEntry {
  draftKey: string;
  recordId: string;
  patientId: string;
  format: CareRecordFormat;
  shift: ShiftType;
  focusTitle: string;
  vitals: VitalSigns;
  soap: SoapContent;
  dart: DartContent;
  updatedAtMs: number;
}

export interface LocalBackupSnapshot {
  snapshotId: string;
  createdAtMs: number;
  triggerType: 'auto' | 'manual' | 'pre_sign';
  nurseUid: string;
  nurseName: string;
  patientsCount: number;
  recordsCount: number;
  patients: PatientChart[];
  records: CareRecord[];
  drafts: LocalDraftEntry[];
}

export const FIELD_LIMITS = {
  ID_REGEX: /^[a-zA-Z0-9_\-]+$/,
  ID_MAX: 128,
  NAME_MAX: 80,
  EMAIL_MAX: 160,
  DEPT_MAX: 80,
  LICENSE_MAX: 40,
  MRN_MAX: 32,
  BED_MAX: 32,
  WARD_MAX: 60,
  DIAGNOSIS_MAX: 240,
  ALLERGY_MAX: 240,
  FOCUS_MAX: 120,
  SECTION_MAX: 3000,
  ALERT_REASON_MAX: 240,
  REMINDER_TITLE_MAX: 160,
  AUDIT_SUMMARY_MAX: 240,
  MAX_ASSIGNED_NURSES: 10,
} as const;
