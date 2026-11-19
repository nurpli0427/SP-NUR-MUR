import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { CareRecord, PatientChart } from '../types/nursing';
import {
  formatDateTime,
  getShiftLabel,
  getStatusLabel,
  maskMrn,
  maskPatientName,
} from './clinicalHelpers';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getSignatureLabel(record: CareRecord): string {
  return record.signatureText || record.signedByName || record.authorName;
}

function getWatermarkText(record: CareRecord): string {
  if (record.status !== 'signed') return '';
  return `已電子簽署定稿 · ${getSignatureLabel(record)} · ${formatDateTime(record.signedAtMs)}`;
}

function buildRecordBlocks(
  record: CareRecord,
  patient: PatientChart | undefined,
  maskPrivacy: boolean
): (Paragraph | Table)[] {
  const pName = maskPatientName(record.patientName, maskPrivacy);
  const mrn = maskMrn(record.mrn, maskPrivacy);
  const isSigned = record.status === 'signed';
  const sigLabel = getSignatureLabel(record);
  const rowSignatureSuffix = isSigned
    ? `  —— 簽名：${sigLabel} (${formatDateTime(record.signedAtMs)})`
    : `  —— 暫記：${record.authorName} (尚未簽署)`;

  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  const cellBorders = { top: border, bottom: border, left: border, right: border };

  const headerRows = [
    new TableRow({
      children: [
        new TableCell({
          borders: cellBorders,
          width: { size: 22, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: '病患姓名 / 病歷號', bold: true, size: 20 })] })],
        }),
        new TableCell({
          borders: cellBorders,
          width: { size: 28, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: `${pName} (${mrn})`, size: 20 })] })],
        }),
        new TableCell({
          borders: cellBorders,
          width: { size: 22, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: '床號 / 病房', bold: true, size: 20 })] })],
        }),
        new TableCell({
          borders: cellBorders,
          width: { size: 28, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `${record.bedNumber}${patient?.ward ? ` · ${patient.ward}` : ''}`,
                  size: 20,
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          borders: cellBorders,
          children: [new Paragraph({ children: [new TextRun({ text: '記錄時間 / 班別', bold: true, size: 20 })] })],
        }),
        new TableCell({
          borders: cellBorders,
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `${formatDateTime(record.recordedAtMs)} · ${getShiftLabel(record.shift)}`,
                  size: 20,
                }),
              ],
            }),
          ],
        }),
        new TableCell({
          borders: cellBorders,
          children: [new Paragraph({ children: [new TextRun({ text: '格式 / 狀態', bold: true, size: 20 })] })],
        }),
        new TableCell({
          borders: cellBorders,
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `${record.format} · ${getStatusLabel(record.status)}`,
                  size: 20,
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          borders: cellBorders,
          children: [new Paragraph({ children: [new TextRun({ text: '生命徵象', bold: true, size: 20 })] })],
        }),
        new TableCell({
          borders: cellBorders,
          columnSpan: 3,
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `體溫 ${record.vitals.temperature.toFixed(1)}°C  |  脈搏 ${record.vitals.heartRate} bpm  |  呼吸 ${record.vitals.respiratoryRate}/min  |  血壓 ${record.vitals.bpSystolic}/${record.vitals.bpDiastolic} mmHg  |  血氧 ${record.vitals.spo2}%  |  疼痛 ${record.vitals.painScore}/10`,
                  size: 20,
                }),
                new TextRun({
                  text: rowSignatureSuffix,
                  italics: true,
                  color: '0F766E',
                  size: 18,
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ];

  const blocks: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 80 },
      children: [
        new TextRun({
          text: `${record.focusTitle} (${record.format})`,
          bold: true,
          color: '0F172A',
          size: 26,
        }),
        new TextRun({
          text: rowSignatureSuffix,
          italics: true,
          color: '0F766E',
          size: 18,
        }),
      ],
    }),
  ];

  if (isSigned) {
    blocks.push(
      new Paragraph({
        spacing: { before: 40, after: 100 },
        children: [
          new TextRun({
            text: `【電子簽署浮水印】${getWatermarkText(record)}`,
            bold: true,
            color: '0F766E',
            size: 18,
          }),
        ],
      })
    );
  }

  blocks.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: headerRows,
    })
  );

  if (record.hasAlert && record.alertReason) {
    blocks.push(
      new Paragraph({
        spacing: { before: 120, after: 80 },
        children: [
          new TextRun({
            text: `臨床異常警示：${record.alertReason}`,
            bold: true,
            color: 'B91C1C',
            size: 20,
          }),
        ],
      })
    );
  }

  if (record.amendmentReason) {
    blocks.push(
      new Paragraph({
        spacing: { before: 80, after: 80 },
        children: [
          new TextRun({
            text: `簽署後修訂紀錄原因：${record.amendmentReason}（修訂者：${record.amendedByName} · ${formatDateTime(record.amendedAtMs)}）`,
            bold: true,
            color: 'B45309',
            size: 19,
          }),
        ],
      })
    );
  }

  const sections =
    record.format === 'SOAP'
      ? [
          { label: 'S — 主觀資料 (Subjective)', body: record.soap.subjective },
          { label: 'O — 客觀資料 (Objective)', body: record.soap.objective },
          { label: 'A — 護理評估 (Assessment)', body: record.soap.assessment },
          { label: 'P — 護理計畫 (Plan)', body: record.soap.plan },
        ]
      : [
          { label: 'D — 資料 (Data)', body: record.dart.data },
          { label: 'A — 護理行動 (Action)', body: record.dart.action },
          { label: 'R — 反應評值 (Response)', body: record.dart.response },
          { label: 'T — 衛教指導 (Teaching)', body: record.dart.teaching },
        ];

  for (const sec of sections) {
    blocks.push(
      new Paragraph({
        spacing: { before: 140, after: 40 },
        children: [new TextRun({ text: sec.label, bold: true, color: '0F766E', size: 22 })],
      })
    );
    const lines = (sec.body || '（未填寫）').split('\n');
    lines.forEach((line, lineIdx) => {
      const isLastLine = lineIdx === lines.length - 1;
      blocks.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: line || ' ', size: 21, color: '1E293B' }),
            ...(isLastLine
              ? [
                  new TextRun({
                    text: rowSignatureSuffix,
                    italics: true,
                    color: '0F766E',
                    size: 18,
                  }),
                ]
              : []),
          ],
        })
      );
    });
  }

  blocks.push(
    new Paragraph({
      spacing: { before: 140, after: 200 },
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: `記錄護理師：${record.authorName}${
            isSigned
              ? `   |   電子簽名檔：${sigLabel} (${formatDateTime(record.signedAtMs)})`
              : '   |   尚未定稿簽署'
          }`,
          italics: true,
          color: '475569',
          size: 19,
        }),
      ],
    })
  );

  return blocks;
}

export async function exportCareRecordsToDocx(
  records: CareRecord[],
  patientMap: Map<string, PatientChart>,
  exporterName: string,
  maskPrivacy: boolean
): Promise<void> {
  const signedRecords = records.filter((r) => r.status === 'signed');
  const headerWatermarkText =
    signedRecords.length > 0
      ? `【電子簽署浮水印】${getSignatureLabel(signedRecords[0])} · 共 ${signedRecords.length} 筆已定稿`
      : '護安錄 CareNote RN — 草稿檢視（尚未簽署定稿）';

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: '護安錄 CareNote RN — 特別護理師臨床護理紀錄',
          bold: true,
          color: '0F172A',
          size: 32,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `匯出時間：${formatDateTime(Date.now())}  |  匯出人員：${exporterName}  |  總筆數：${records.length} 筆${
            maskPrivacy ? '  |  已啟用病患隱私遮罩' : ''
          }`,
          color: '64748B',
          size: 19,
        }),
      ],
    }),
  ];

  for (const rec of records) {
    children.push(...buildRecordBlocks(rec, patientMap.get(rec.patientId), maskPrivacy));
  }

  const doc = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: headerWatermarkText,
                    color: '94A3B8',
                    italics: true,
                    size: 18,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const stamp = new Date().toISOString().slice(0, 10);
  triggerDownload(blob, `護理紀錄_${stamp}.docx`);
}

export function exportCareRecordsToDoc(
  records: CareRecord[],
  patientMap: Map<string, PatientChart>,
  exporterName: string,
  maskPrivacy: boolean
): void {
  const html = buildPrintableClinicalHtml(records, patientMap, exporterName, maskPrivacy);
  const signedRecords = records.filter((r) => r.status === 'signed');
  const wordWatermarkBanner =
    signedRecords.length > 0
      ? `<div style="border: 1px dashed #0f766e; background: #f0fdfa; color: #0f766e; padding: 8px 12px; font-size: 10pt; margin-bottom: 14px; text-align: center; font-weight: bold;">電子簽署保護浮水印：${escapeHtml(
          getSignatureLabel(signedRecords[0])
        )} · 匯出時間 ${formatDateTime(Date.now())}</div>`
      : '';

  const wordDoc = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <title>特別護理師臨床護理紀錄</title>
        <style>
          body { font-family: "Noto Sans TC", "Microsoft JhengHei", sans-serif; color: #0f172a; line-height: 1.6; }
          table { border-collapse: collapse; width: 100%; margin: 10px 0; }
          td, th { border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 10.5pt; }
          .sig-inline { color: #0f766e; font-size: 9.5pt; font-style: italic; }
        </style>
      </head>
      <body>${wordWatermarkBanner}${html}</body>
    </html>
  `;
  const blob = new Blob(['\ufeff', wordDoc], { type: 'application/msword;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  triggerDownload(blob, `護理紀錄_${stamp}.doc`);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');
}

function buildPrintableClinicalHtml(
  records: CareRecord[],
  patientMap: Map<string, PatientChart>,
  exporterName: string,
  maskPrivacy: boolean
): string {
  const signedCount = records.filter((r) => r.status === 'signed').length;
  const header = `
    <div style="border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 18px;">
      <div style="font-size: 20px; font-weight: 700; color: #0f172a;">護安錄 CareNote RN — 特別護理師臨床護理紀錄</div>
      <div style="font-size: 12px; color: #475569; margin-top: 4px;">
        匯出時間：${formatDateTime(Date.now())} · 匯出人員：${escapeHtml(exporterName)} · 紀錄筆數：${records.length} 筆（已簽署定稿 ${signedCount} 筆）${
          maskPrivacy ? ' · 隱私遮罩保護中' : ''
        }
      </div>
    </div>
  `;

  const items = records
    .map((rec, idx) => {
      const patient = patientMap.get(rec.patientId);
      const pName = maskPatientName(rec.patientName, maskPrivacy);
      const mrn = maskMrn(rec.mrn, maskPrivacy);
      const isSigned = rec.status === 'signed';
      const sigLabel = getSignatureLabel(rec);
      const rowSigHtml = isSigned
        ? `<span style="color: #0f766e; font-size: 11px; font-style: italic; margin-left: 8px;">—— 簽名：${escapeHtml(sigLabel)} (${formatDateTime(rec.signedAtMs)})</span>`
        : `<span style="color: #94a3b8; font-size: 11px; font-style: italic; margin-left: 8px;">—— 暫記：${escapeHtml(rec.authorName)} (未簽署)</span>`;

      const watermarkOverlay = isSigned
        ? `
          <div style="position: absolute; inset: 0; pointer-events: none; overflow: hidden; display: flex; flex-direction: column; justify-content: space-around; align-items: center; z-index: 1;">
            <div style="transform: rotate(-22deg); font-size: 20px; font-weight: 700; color: rgba(15, 118, 110, 0.11); white-space: nowrap; letter-spacing: 2px;">
              電子簽署定稿 · ${escapeHtml(sigLabel)} · ${formatDateTime(rec.signedAtMs)}
            </div>
            <div style="transform: rotate(-22deg); font-size: 18px; font-weight: 700; color: rgba(15, 118, 110, 0.09); white-space: nowrap; letter-spacing: 2px;">
              CareNote RN VERIFIED · ${escapeHtml(sigLabel)}
            </div>
          </div>
        `
        : '';

      const sections =
        rec.format === 'SOAP'
          ? [
              { title: 'S 主觀資料 (Subjective)', content: rec.soap.subjective },
              { title: 'O 客觀資料 (Objective)', content: rec.soap.objective },
              { title: 'A 護理評估 (Assessment)', content: rec.soap.assessment },
              { title: 'P 護理計畫 (Plan)', content: rec.soap.plan },
            ]
          : [
              { title: 'D 資料 (Data)', content: rec.dart.data },
              { title: 'A 護理行動 (Action)', content: rec.dart.action },
              { title: 'R 反應評值 (Response)', content: rec.dart.response },
              { title: 'T 衛教指導 (Teaching)', content: rec.dart.teaching },
            ];

      return `
        <div style="position: relative; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 6px; padding: 16px; margin-bottom: 18px; page-break-inside: avoid; background: #ffffff;">
          ${watermarkOverlay}
          <div style="position: relative; z-index: 2;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 10px;">
              <div style="font-size: 15px; font-weight: 700; color: #0f172a;">
                ${idx + 1}. ${escapeHtml(rec.focusTitle)} ${rowSigHtml}
              </div>
              <div style="font-size: 12px; color: #0f766e; font-weight: 600; white-space: nowrap;">
                ${rec.format} · ${getStatusLabel(rec.status)}
              </div>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px;">
              <tr>
                <td style="border: 1px solid #e2e8f0; background: #f8fafc; padding: 6px 8px; font-weight: 600; width: 18%;">病患 / 病歷號</td>
                <td style="border: 1px solid #e2e8f0; padding: 6px 8px; width: 32%;">${escapeHtml(pName)} (${escapeHtml(mrn)})</td>
                <td style="border: 1px solid #e2e8f0; background: #f8fafc; padding: 6px 8px; font-weight: 600; width: 18%;">床號 / 病房</td>
                <td style="border: 1px solid #e2e8f0; padding: 6px 8px; width: 32%;">${escapeHtml(rec.bedNumber)}${patient?.ward ? ` · ${escapeHtml(patient.ward)}` : ''}</td>
              </tr>
              <tr>
                <td style="border: 1px solid #e2e8f0; background: #f8fafc; padding: 6px 8px; font-weight: 600;">記錄時間</td>
                <td style="border: 1px solid #e2e8f0; padding: 6px 8px;">${formatDateTime(rec.recordedAtMs)}</td>
                <td style="border: 1px solid #e2e8f0; background: #f8fafc; padding: 6px 8px; font-weight: 600;">班別</td>
                <td style="border: 1px solid #e2e8f0; padding: 6px 8px;">${getShiftLabel(rec.shift)}</td>
              </tr>
              <tr>
                <td style="border: 1px solid #e2e8f0; background: #f8fafc; padding: 6px 8px; font-weight: 600;">生命徵象</td>
                <td colspan="3" style="border: 1px solid #e2e8f0; padding: 6px 8px;">
                  體溫 ${rec.vitals.temperature.toFixed(1)}°C · 脈搏 ${rec.vitals.heartRate} bpm · 呼吸 ${rec.vitals.respiratoryRate}/min · 血壓 ${rec.vitals.bpSystolic}/${rec.vitals.bpDiastolic} mmHg · 血氧 ${rec.vitals.spo2}% · 疼痛 ${rec.vitals.painScore}/10
                  ${rowSigHtml}
                </td>
              </tr>
            </table>

            ${
              rec.hasAlert && rec.alertReason
                ? `<div style="background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 6px 10px; font-size: 12px; font-weight: 600; margin-bottom: 10px; border-radius: 4px;">異常警示：${escapeHtml(rec.alertReason)}</div>`
                : ''
            }

            ${
              rec.amendmentReason
                ? `<div style="background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 6px 10px; font-size: 12px; font-weight: 600; margin-bottom: 10px; border-radius: 4px;">簽署後修訂原因：${escapeHtml(rec.amendmentReason)}（修訂者：${escapeHtml(rec.amendedByName)} · ${formatDateTime(rec.amendedAtMs)}）</div>`
                : ''
            }

            ${sections
              .map((s) => {
                const lines = (s.content || '（未填寫）').split('\n');
                const renderedLines = lines
                  .map((line, lineIdx) => {
                    const isLast = lineIdx === lines.length - 1;
                    return `<div>${escapeHtml(line || ' ')}${isLast ? rowSigHtml : ''}</div>`;
                  })
                  .join('');
                return `
                  <div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; font-weight: 700; color: #0f766e; margin-bottom: 2px;">${s.title}</div>
                    <div style="font-size: 12.5px; color: #1e293b; line-height: 1.55;">${renderedLines}</div>
                  </div>
                `;
              })
              .join('')}

            <div style="border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 10px; font-size: 11.5px; color: #475569; text-align: right;">
              編寫護理師：${escapeHtml(rec.authorName)} · ${
                isSigned
                  ? `電子簽名檔：${escapeHtml(sigLabel)} (${formatDateTime(rec.signedAtMs)})`
                  : '狀態：尚未定稿簽署'
              }
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  return `${header}${items}`;
}

export async function exportCareRecordsToPdf(
  records: CareRecord[],
  patientMap: Map<string, PatientChart>,
  exporterName: string,
  maskPrivacy: boolean
): Promise<void> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = '794px'; // A4 width at 96dpi
  container.style.padding = '36px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily = "'Noto Sans TC', 'Plus Jakarta Sans', sans-serif";
  container.innerHTML = buildPrintableClinicalHtml(records, patientMap, exporterName, maskPrivacy);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    pdf.save(`護理紀錄_${stamp}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
