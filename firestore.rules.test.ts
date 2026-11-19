/**
 * Phase 0 Security Rules Verification Suite (Dirty Dozen Adversarial Payloads)
 * Intended for execution with @firebase/rules-unit-testing against Firestore Emulator.
 */

export const DIRTY_DOZEN_CASES = [
  {
    id: 1,
    name: 'Self-Privilege Escalation on Signup',
    path: 'users/nurse_a',
    operation: 'create',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    payload: { role: 'head_nurse', uid: 'nurse_a' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 2,
    name: 'Role Tampering on Profile Update',
    path: 'users/nurse_a',
    operation: 'update',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    payload: { role: 'head_nurse' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 3,
    name: 'PII Blanket Read on Another User',
    path: 'users/nurse_b',
    operation: 'get',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 4,
    name: 'Unassigned Patient Read',
    path: 'patients/patient_other',
    operation: 'get',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 5,
    name: 'Orphaned Care Record Create',
    path: 'careRecords/rec_orphan',
    operation: 'create',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    payload: { patientId: 'missing_patient', authorId: 'nurse_a' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 6,
    name: 'Unauthorized Care Record Injection for Unassigned Patient',
    path: 'careRecords/rec_unauth',
    operation: 'create',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    payload: { patientId: 'patient_other', authorId: 'nurse_a' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 7,
    name: 'Author Spoofing',
    path: 'careRecords/rec_spoof',
    operation: 'create',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    payload: { patientId: 'patient_a', authorId: 'nurse_b' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 8,
    name: 'Shadow Ghost Field Injection',
    path: 'careRecords/rec_ghost',
    operation: 'update',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    payload: { isOverrideApproved: true },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 9,
    name: 'Signed Record Tampering',
    path: 'careRecords/rec_signed',
    operation: 'update',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    payload: { focusTitle: 'Tampered after signature' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 10,
    name: 'Supervisor Read-Only Write Bypass',
    path: 'careRecords/rec_sup',
    operation: 'create',
    auth: { uid: 'supervisor_1', email: 'sup@hospital.org', email_verified: true },
    payload: { patientId: 'patient_a', authorId: 'supervisor_1' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 11,
    name: 'Path ID Poisoning',
    path: 'careRecords/bad$id!poison',
    operation: 'create',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    payload: { recordId: 'bad$id!poison' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 12,
    name: 'Audit Log Deletion & Unverified Admin Spoof',
    path: 'auditLogs/log_1',
    operation: 'delete',
    auth: { uid: 'attacker', email: 'nurpli0427@gmail.com', email_verified: false },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 13,
    name: 'Care Record Revision History Tampering',
    path: 'careRecords/rec_1/revisions/rev_1',
    operation: 'update',
    auth: { uid: 'nurse_a', email: 'nursea@hospital.org', email_verified: true },
    payload: { changeReason: 'Altered historical reason' },
    expected: 'PERMISSION_DENIED'
  }
] as const;
