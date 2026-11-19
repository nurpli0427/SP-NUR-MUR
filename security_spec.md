# Security Specification — CareNote RN (Special Nurse Care Record System)

## 1. Data Invariants
1. **Identity & Role Integrity**: Self-registered users in `/users/{userId}` and `/staffPublic/{userId}` MUST only create profiles with `role == 'special_nurse'` (unless the caller is a verified head nurse admin). Users cannot escalate their own `role` on update.
2. **PII Isolation**: `/users/{userId}` contains `email` and is readable (`get`) ONLY by `userId == request.auth.uid` or verified `isAdmin()`. Peer staff lookup uses `/staffPublic/{userId}` which stores zero PII.
3. **Patient Scoping & Referential Integrity**: Every `/careRecords/{recordId}` and `/reminders/{reminderId}` document MUST reference an existing `/patients/{patientId}` document via `exists()`, and the creating/updating nurse MUST be listed in that patient's `assignedNurseIds` (or be a verified `isAdmin()`).
4. **Supervisor Read-Only Isolation**: Users with `role == 'supervisor_viewer'` cannot create, update, or delete `/patients`, `/careRecords`, or `/reminders`.
5. **Terminal State Locking**: Once a `/careRecords/{recordId}` document reaches `status == 'signed'`, regular nurses cannot update or delete it; only `isAdmin()` (head nurse) may unlock or amend it.
6. **Temporal & Author Immutability**: `createdAt` and `authorId` / `createdBy` must equal `request.time` and `request.auth.uid` on creation and remain immutable on update.
7. **Immutable Audit Trail**: `/auditLogs/{logId}` allows `create` only with `actorUid == request.auth.uid` and `createdAt == request.time`; `update` and `delete` are unconditionally denied.
8. **Zero-Trust List Queries**: Every `allow list` rule evaluates `resource.data` directly without `get()` or `exists()` calls to prevent O(n) read amplification and unauthorized data scraping.
9. **Immutable Care Record Revision History**: `/careRecords/{recordId}/revisions/{revisionId}` MUST reference an existing parent `/careRecords/{recordId}` via `exists()` and sync `assignedNurseIds`/`patientId` from the parent record; updates and deletes are unconditionally denied.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Privilege Escalation on Signup**: Regular user creates `/users/{uid}` with `role: "head_nurse"`. -> `PERMISSION_DENIED`.
2. **Role Tampering on Profile Update**: Regular nurse updates `/users/{uid}` changing `role` to `"head_nurse"`. -> `PERMISSION_DENIED`.
3. **PII Blanket Read**: Nurse A calls `getDoc(doc(db, 'users', 'nurse-b-uid'))`. -> `PERMISSION_DENIED`.
4. **Unassigned Patient Read/List**: Nurse A queries `/patients` or reads `/patients/p-unassigned` where `nurseA` is not in `assignedNurseIds`. -> `PERMISSION_DENIED`.
5. **Orphaned Care Record Create**: Nurse creates `/careRecords/rec-1` referencing non-existent `patientId: "non-existent-id"`. -> `PERMISSION_DENIED`.
6. **Unauthorized Care Record Injection**: Nurse A creates `/careRecords/rec-2` for Patient X (assigned only to Nurse B). -> `PERMISSION_DENIED`.
7. **Author Spoofing**: Nurse A creates `/careRecords/rec-3` with `authorId: "nurse-b-uid"`. -> `PERMISSION_DENIED`.
8. **Shadow Ghost Field Injection**: Nurse A creates or updates a care record with an extra undocumented field `isOverrideApproved: true`. -> `PERMISSION_DENIED`.
9. **Signed Record Tampering**: Nurse A attempts to update `soap.assessment` on a care record whose existing `status == "signed"` without a valid `amendmentReason`. -> `PERMISSION_DENIED`.
10. **Supervisor Write Bypass**: A `supervisor_viewer` attempts to create or edit a care record or revision. -> `PERMISSION_DENIED`.
11. **Path ID Poisoning / Resource Exhaustion**: Client writes `/careRecords/invalid$id!with*badchars` or a 50KB `focusTitle`. -> `PERMISSION_DENIED`.
12. **Audit Log & Revision History Tampering / Spoofed Email Admin**: Nurse deletes/updates `/auditLogs/log-1` or `/careRecords/rec-1/revisions/rev-1`, or signs in with unverified email matching admin email (`email_verified: false`). -> `PERMISSION_DENIED`.
