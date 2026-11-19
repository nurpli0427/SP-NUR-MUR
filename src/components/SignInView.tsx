import React, { useState } from 'react';
import { ExternalLink, LockKeyhole, ShieldCheck, Stethoscope } from 'lucide-react';

interface SignInViewProps {
  onSignIn: () => Promise<void>;
  onSignInRedirect: () => Promise<void>;
  error: string | null;
  popupBlocked: boolean;
  redirectCookieBlocked: boolean;
  isEmbeddedIframe: boolean;
}

export const SignInView: React.FC<SignInViewProps> = ({
  onSignIn,
  onSignInRedirect,
  error,
  popupBlocked,
  redirectCookieBlocked,
  isEmbeddedIframe,
}) => {
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await onSignIn();
    } finally {
      setLoading(false);
    }
  };

  const handleRedirectClick = async () => {
    setRedirecting(true);
    try {
      await onSignInRedirect();
    } finally {
      setRedirecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col lg:flex-row">
      <div className="flex-1 flex flex-col justify-between p-8 lg:p-14 max-w-2xl">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-teal-700 flex items-center justify-center text-white">
            <Stethoscope className="w-5 h-5" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            護安錄 CareNote RN
          </span>
        </div>

        <div className="py-10 space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-medium text-teal-700 dark:text-teal-400">
              特別護理師專屬臨床照護紀錄平台
            </p>
            <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight [text-wrap:balance]">
              精準編寫 SOAP 與 DART 護理紀錄，守護病患隱私與床邊連續照護
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
              整合即時雲端同步、病患分級權限控管、異常生命徵象監控、行動裝置推播提醒、DOC / PDF 正式報表匯出與離線自動備份。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="pt-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                SOAP / DART 雙格式結構化編寫
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                內建臨床快選片語與生命徵象異常自動偵測，支援一鍵匯出 Word 與 PDF。
              </p>
            </div>
            <div className="pt-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                離線編輯與零遺失自動備份
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                隔離病房斷網仍可持續建檔，連線後自動同步並保留本地版本快照。
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3.5 text-sm text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg space-y-2">
              <div>{error}</div>
              {redirectCookieBlocked && (
                <div className="text-xs text-red-700 dark:text-red-300/90 leading-relaxed space-y-1">
                  <div>請擇一方式完成驗證：</div>
                  <div>1. 點擊瀏覽器網址列或網站設定，允許此網站「彈出式視窗」，再重新點擊下方「使用 Google 醫療人員帳號登入」（彈窗模式不依賴跨站 Cookie）。</div>
                  <div>2. 若使用 Safari / iOS 或隱私防護瀏覽器，請暫時關閉「防止跨網站追蹤／封鎖第三方 Cookie」，或使用同網域 Auth Proxy 模式（於 Vercel 設定 VITE_USE_SAME_ORIGIN_AUTH=true）。</div>
                </div>
              )}
              {popupBlocked && !redirectCookieBlocked && (
                <div className="text-xs text-red-700 dark:text-red-300/90 leading-relaxed">
                  {isEmbeddedIframe
                    ? '提示：內嵌預覽視窗受瀏覽器安全限制容易攔截彈窗，建議點擊下方「在新分頁開啟並登入」，系統將自動切換為獨立分頁驗證。'
                    : '提示：請於瀏覽器網址列右側點擊「封鎖彈出式視窗」圖示並設為「永遠允許」，或點擊下方「改用整頁跳轉登入 (Redirect)」。'}
                </div>
              )}
            </div>
          )}

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleClick()}
              disabled={loading || redirecting}
              className="inline-flex items-center justify-center gap-2.5 px-6 py-3 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <LockKeyhole className="w-4 h-4" />
              {loading ? '正在驗證臨床帳號...' : '使用 Google 醫療人員帳號登入'}
            </button>

            {popupBlocked && isEmbeddedIframe && typeof window !== 'undefined' && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <ExternalLink className="w-4 h-4" />
                在新分頁開啟並登入
              </a>
            )}

            {popupBlocked && !redirectCookieBlocked && !isEmbeddedIframe && (
              <button
                type="button"
                onClick={() => void handleRedirectClick()}
                disabled={loading || redirecting}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/50 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <ExternalLink className="w-4 h-4" />
                {redirecting ? '正在導向 Google 驗證頁...' : '改用整頁跳轉登入 (Redirect)'}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <ShieldCheck className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
          <span>僅限經授權指派之特別護理師與督導存取病患資料 · 稽核軌跡全程留存</span>
        </div>
      </div>

      <div className="hidden lg:block lg:flex-1 relative bg-slate-900 overflow-hidden">
        <img
          src="/src/assets/images/clinical_ward_backdrop_1795098348244.jpg"
          alt="現代特別護理站與加護病房走廊"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/30 to-transparent" />
        <div className="absolute bottom-10 left-10 right-10 text-white space-y-2">
          <p className="text-xs font-medium text-teal-300">
            臨床實務導向設計
          </p>
          <p className="text-xl font-semibold leading-snug max-w-lg">
            「讓特別護理師把專注力留給病床邊的每一位生命，交班與法規紀錄交給即時且安全的結構化系統。」
          </p>
        </div>
      </div>
    </div>
  );
};
