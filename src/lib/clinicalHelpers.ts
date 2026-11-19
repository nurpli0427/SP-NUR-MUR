import {
  type CareLevel,
  type CareRecordFormat,
  type CareRecordStatus,
  FIELD_LIMITS,
  type ReminderCategory,
  type ShiftType,
  type UserRole,
  type VitalSigns,
} from '../types/nursing';

export function generateSafeId(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'id';
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `${cleanPrefix}_${ts}_${rand}`;
}

export function clampString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeVitals(v: Partial<VitalSigns>): VitalSigns {
  return {
    temperature: clampNumber(Number(v.temperature ?? 36.6), 30, 45),
    heartRate: clampNumber(Math.round(Number(v.heartRate ?? 78)), 20, 250),
    respiratoryRate: clampNumber(Math.round(Number(v.respiratoryRate ?? 16)), 4, 80),
    bpSystolic: clampNumber(Math.round(Number(v.bpSystolic ?? 120)), 40, 300),
    bpDiastolic: clampNumber(Math.round(Number(v.bpDiastolic ?? 76)), 20, 200),
    spo2: clampNumber(Math.round(Number(v.spo2 ?? 98)), 40, 100),
    painScore: clampNumber(Math.round(Number(v.painScore ?? 1)), 0, 10),
  };
}

export function evaluateVitalAlerts(vitals: VitalSigns): { hasAlert: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (vitals.temperature >= 38.0) reasons.push(`發燒 (${vitals.temperature.toFixed(1)}°C)`);
  if (vitals.temperature <= 35.5) reasons.push(`低體溫 (${vitals.temperature.toFixed(1)}°C)`);
  if (vitals.heartRate >= 115) reasons.push(`心搏過速 (${vitals.heartRate} bpm)`);
  if (vitals.heartRate <= 50) reasons.push(`心搏過緩 (${vitals.heartRate} bpm)`);
  if (vitals.respiratoryRate >= 24) reasons.push(`呼吸急促 (${vitals.respiratoryRate}/min)`);
  if (vitals.bpSystolic >= 165 || vitals.bpSystolic <= 90) {
    reasons.push(`血壓異常 (${vitals.bpSystolic}/${vitals.bpDiastolic} mmHg)`);
  }
  if (vitals.spo2 < 92) reasons.push(`血氧偏低 (SpO2 ${vitals.spo2}%)`);
  if (vitals.painScore >= 7) reasons.push(`重度疼痛 (${vitals.painScore}/10)`);

  return {
    hasAlert: reasons.length > 0,
    reasons,
  };
}

export function maskPatientName(name: string, enabled: boolean): string {
  if (!enabled || !name) return name;
  const trimmed = name.trim();
  if (trimmed.length <= 1) return '〇';
  if (trimmed.length === 2) return `${trimmed[0]}〇`;
  return `${trimmed[0]}${'〇'.repeat(trimmed.length - 2)}${trimmed[trimmed.length - 1]}`;
}

export function maskMrn(mrn: string, enabled: boolean): string {
  if (!enabled || !mrn) return mrn;
  if (mrn.length <= 4) return '****';
  return `${mrn.slice(0, 4)}****${mrn.slice(-3)}`;
}

export function formatDateTime(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function formatTimeShort(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

export function getRoleLabel(role: UserRole): string {
  switch (role) {
    case 'head_nurse':
      return '護理長 / 主管';
    case 'special_nurse':
      return '特別護理師';
    case 'supervisor_viewer':
      return '督導稽核 (唯讀)';
  }
}

export function getShiftLabel(shift: ShiftType): string {
  switch (shift) {
    case 'Day':
      return '白班 (08:00–16:00)';
    case 'Evening':
      return '小夜班 (16:00–00:00)';
    case 'Night':
      return '大夜班 (00:00–08:00)';
  }
}

export function getStatusLabel(status: CareRecordStatus): string {
  switch (status) {
    case 'draft':
      return '草稿';
    case 'pending_review':
      return '待覆核';
    case 'signed':
      return '已簽署定稿';
    case 'alert':
      return '異常警示';
  }
}

export function getCareLevelLabel(level: CareLevel): string {
  switch (level) {
    case 'ICU':
      return '加護特護';
    case 'Special':
      return '一對一特護';
    case 'PostOp':
      return '術後密切照護';
    case 'Hospice':
      return '安寧緩和特護';
  }
}

export function getReminderCategoryLabel(cat: ReminderCategory): string {
  switch (cat) {
    case 'vitals':
      return '生命徵象量測';
    case 'turning':
      return '翻身拍背照護';
    case 'medication':
      return '給藥與點滴檢視';
    case 'handover':
      return '交班紀錄截止';
    case 'assessment':
      return '傷口與管路評估';
  }
}

export function detectCurrentShift(): ShiftType {
  const hour = new Date().getHours();
  if (hour >= 8 && hour < 16) return 'Day';
  if (hour >= 16) return 'Evening';
  return 'Night';
}

export interface ClinicalTemplate {
  id: string;
  title: string;
  format: CareRecordFormat;
  focusTitle: string;
  soap?: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  };
  dart?: {
    data: string;
    action: string;
    response: string;
    teaching: string;
  };
}

export const CLINICAL_TEMPLATES: ClinicalTemplate[] = [
  {
    id: 'tpl_postop_pain',
    title: '術後傷口與疼痛照護',
    format: 'SOAP',
    focusTitle: '術後疼痛與傷口滲液監測',
    soap: {
      subjective: '病患主訴手術部位呈間歇性抽痛，翻身活動時疼痛加劇（NRS 5/10），夜間睡眠略受影響。',
      objective: '傷口敷料外觀乾燥完整，無明顯紅腫熱痛或膿性滲液；引流管固定妥當且通暢，引流液呈淡血水色約 25 mL/8hr。',
      assessment: '急性疼痛與手術組織損傷有關；目前無顯著傷口感染徵象，需持續評估止痛效果。',
      plan: '1. 依醫囑給予止痛藥物並於 30 分鐘後複評疼痛指數。\n2. 協助半坐臥姿及翻身支托傷口。\n3. 每 4 小時檢視敷料及引流液性狀與量。',
    },
  },
  {
    id: 'tpl_respiratory',
    title: '呼吸道清潔與氧合監測',
    format: 'DART',
    focusTitle: '呼吸道痰液清除與血氧維持',
    dart: {
      data: '聽診雙側下肺葉有輕微濕囉音，病患偶有咳嗽但痰液黏稠不易咳出，SpO2 94%（鼻導管 O2 3 L/min 使用中）。',
      action: '協助抬高床頭 30–45 度，執行背部叩擊與深呼吸咳嗽誘導，並依醫囑給予蒸氣吸入稀釋痰液；確認氧氣管路接頭密合無折壓。',
      response: '處置後病患順利咳出少量白色黏痰，呼吸型態較平順，SpO2 回升至 97%，未出現呼吸窘迫或發紺。',
      teaching: '指導病患及家屬每日適量溫水補充（依限水醫囑調整）及噘嘴式呼吸練習，若覺胸悶氣促立即通知護理師。',
    },
  },
  {
    id: 'tpl_turning_pressure',
    title: '壓傷預防與管路安全',
    format: 'DART',
    focusTitle: '皮膚完整性維護與管路固定',
    dart: {
      data: '長期臥床，骨突處（尾薦骨及雙足跟）皮膚完整無發紅或水泡；留置導尿管及鼻胃管固定於標記位置，皮膚無壓痕。',
      action: '執行 Q2H 左右側臥翻身及減壓枕支托，保持床單平整乾燥；檢視鼻胃管固定膠帶及導尿管引流袋低於膀胱水平。',
      response: '皮膚受壓部位按壓回血正常，無發紅或破皮情形；各管路引流順暢且位置正確。',
      teaching: '向照顧者示範翻身時避免拖拉皮膚之減壓技巧，並提醒勿任意拉扯管路固定膠帶。',
    },
  },
  {
    id: 'tpl_shift_handover',
    title: '特護交班綜合評估',
    format: 'SOAP',
    focusTitle: '班別交接生命徵象與意識狀態評估',
    soap: {
      subjective: '病患意識清醒（GCS E4V5M6），可配合護理處置與飲食，無頭暈或噁心不適主訴。',
      objective: '生命徵象維持於穩定區間，四肢末梢溫暖，微血管充填時間 < 2 秒；本班輸入/輸出量平衡，靜脈留置針注射處無紅腫浸潤。',
      assessment: '整體臨床狀況穩定，持續維持現有特別護理計畫與安全防護措施。',
      plan: '1. 維持每 4 小時生命徵象及意識評估。\n2. 落實下床活動防跌安全護欄與呼叫鈴確認。\n3. 與下一班特別護理師完成床邊交班確認。',
    },
  },
];


