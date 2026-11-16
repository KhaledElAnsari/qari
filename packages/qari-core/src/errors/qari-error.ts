import type { Backend } from '../backend/backend-probe';

/** Every failure a listener can see; each one has its own message (decision 2026-11-16, docs/decisions.md). */
export const QARI_ERROR_CODES = [
  'browser-unsupported',
  'voice-download-failed',
  'voice-unavailable',
  'accelerated-mode-unavailable',
  'accelerated-mode-failed',
  'reading-failed',
  'nothing-to-read',
  'unexpected',
] as const;
export type QariErrorCode = (typeof QARI_ERROR_CODES)[number];

/** A sentence shown to listeners, in both UI languages. */
export interface FriendlyText {
  ar: string;
  en: string;
}

/** What listeners call the two ways of running a voice; the UI and every message take the names from here. */
export const MODE_LABELS: Readonly<Record<Backend, FriendlyText>> = {
  wasm: { ar: 'الوضع الافتراضي', en: 'default mode' },
  webgpu: { ar: 'الوضع المسرَّع', en: 'accelerated mode' },
};

interface ErrorCopy {
  text: FriendlyText;
  /** Trying the same thing again can work (e.g. a dropped connection). */
  canRetry: boolean;
  /** The UI should offer default mode as the way out. */
  suggestsDefaultMode: boolean;
}

const defaultMode = MODE_LABELS.wasm;
const accelerated = MODE_LABELS.webgpu;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Plain words only: no browser, device or file-format terms (Khaled's rule for user-facing errors).
const COPY: Readonly<Record<QariErrorCode, ErrorCopy>> = {
  'browser-unsupported': {
    text: {
      ar: 'هذا المتصفح لا يستطيع تشغيل القارئ. جرّب أحدث إصدار من Chrome أو Safari أو Firefox.',
      en: 'This browser can\'t run the reader. Try the latest Chrome, Safari or Firefox.',
    },
    canRetry: false,
    suggestsDefaultMode: false,
  },
  'voice-download-failed': {
    text: {
      ar: 'تعذّر تنزيل الصوت. تأكّد من اتصالك بالإنترنت ثم حاول مرة أخرى.',
      en: 'The voice couldn\'t be downloaded. Check your internet connection and try again.',
    },
    canRetry: true,
    suggestsDefaultMode: false,
  },
  'voice-unavailable': {
    text: {
      ar: 'هذا الصوت غير متاح الآن. اختر صوتًا آخر أو حاول لاحقًا.',
      en: 'This voice isn\'t available right now. Choose another voice or try again later.',
    },
    canRetry: true,
    suggestsDefaultMode: false,
  },
  'accelerated-mode-unavailable': {
    text: {
      ar: `${accelerated.ar} لا يعمل على هذا الجهاز. استخدم ${defaultMode.ar}.`,
      en: `${capitalize(accelerated.en)} doesn't work on this device. Use ${defaultMode.en}.`,
    },
    canRetry: false,
    suggestsDefaultMode: true,
  },
  'accelerated-mode-failed': {
    text: {
      ar: `توقّف ${accelerated.ar} أثناء القراءة. اضغط زر التشغيل للمحاولة مرة أخرى، أو انتقل إلى ${defaultMode.ar}.`,
      en: `${capitalize(accelerated.en)} stopped while reading. Press play to try again, or switch to ${defaultMode.en}.`,
    },
    canRetry: true,
    suggestsDefaultMode: true,
  },
  'reading-failed': {
    text: {
      ar: 'حدث خطأ أثناء القراءة. اضغط زر التشغيل للمحاولة مرة أخرى.',
      en: 'Something went wrong while reading. Press play to try again.',
    },
    canRetry: true,
    suggestsDefaultMode: false,
  },
  'nothing-to-read': {
    text: {
      ar: 'لا يوجد نص يمكن قراءته. الصق نصًا عربيًا ثم اضغط زر التشغيل.',
      en: 'There\'s no text to read. Paste Arabic text, then press play.',
    },
    canRetry: false,
    suggestsDefaultMode: false,
  },
  'unexpected': {
    text: {
      ar: 'حدث خطأ غير متوقّع. أعد تحميل الصفحة ثم حاول مرة أخرى.',
      en: 'Something unexpected went wrong. Reload the page and try again.',
    },
    canRetry: true,
    suggestsDefaultMode: false,
  },
};

/**
 * The only error qari hands to hosts. `text` is safe to show listeners; `detail` holds the technical
 * cause for developers and logs, and must never be shown in the UI.
 */
export class QariError extends Error {
  override readonly name = 'QariError';

  constructor(readonly code: QariErrorCode, readonly detail?: string) {
    super(COPY[code].text.en);
  }

  get text(): FriendlyText {
    return COPY[this.code].text;
  }

  get canRetry(): boolean {
    return COPY[this.code].canRetry;
  }

  get suggestsDefaultMode(): boolean {
    return COPY[this.code].suggestsDefaultMode;
  }
}

/** Technical description of anything thrown, for `detail`. */
export function describeError(error: unknown): string {
  if (error instanceof QariError) return error.detail ?? error.code;
  return error instanceof Error ? error.message : String(error);
}

/** Keeps a QariError as it is; anything else becomes `fallback`, with its message kept as the detail. */
export function toQariError(error: unknown, fallback: QariErrorCode): QariError {
  return error instanceof QariError ? error : new QariError(fallback, describeError(error));
}

/** Reads a code sent across the Worker boundary, treating anything unknown as 'unexpected'. */
export function parseErrorCode(value: unknown): QariErrorCode {
  return QARI_ERROR_CODES.includes(value as QariErrorCode) ? value as QariErrorCode : 'unexpected';
}
