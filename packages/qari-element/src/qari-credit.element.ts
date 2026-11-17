/**
 * <qari-credit>: a small "Powered by Qari" credit. <qari-reader> shows it by default (turn it off with credit="off");
 * hosts that use qari-core directly can place it themselves. qari is free to use (Apache-2.0); keeping this credit
 * visible is how we ask to be mentioned.
 */
export const QARI_CREDIT_TAG = 'qari-credit';

/** Where the credit links to. */
export const QARI_HOMEPAGE = 'https://github.com/KhaledElAnsari/qari';

const TEXT = {
  ar: { lead: 'يعمل بـ', name: 'قارئ' },
  en: { lead: 'Powered by', name: 'Qari · قارئ' },
} as const;

/** Arabic or English, from the nearest `lang` (its own attribute, an ancestor's, or the page's); Arabic otherwise. */
function creditLanguage(element: HTMLElement): 'ar' | 'en' {
  const lang = element.closest('[lang]')?.getAttribute('lang') ?? document.documentElement.lang;
  return lang?.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

export class QariCreditElement extends HTMLElement {
  static readonly observedAttributes = ['lang'];

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.render();
  }

  private render(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const language = creditLanguage(this);
    const { lead, name } = TEXT[language];
    const nameHtml = QARI_HOMEPAGE
      ? `<a part="link" href="${QARI_HOMEPAGE}" target="_blank" rel="noopener">${name}</a>`
      : `<strong part="name">${name}</strong>`;
    root.innerHTML = `
      <style>
        :host { display: inline-block; font-size: .78rem; color: inherit; opacity: .75; }
        :host([hidden]) { display: none; }
        span { white-space: nowrap; }
        a, strong { color: inherit; font-weight: 600; text-decoration: none; }
        a:hover, a:focus-visible { text-decoration: underline; }
      </style>
      <span part="credit" dir="${language === 'ar' ? 'rtl' : 'ltr'}" lang="${language}">${lead} ${nameHtml}</span>`;
  }
}

/** Registers <qari-credit> once; safe to call more than once. */
export function defineQariCredit(registry: CustomElementRegistry = customElements): void {
  if (!registry.get(QARI_CREDIT_TAG)) registry.define(QARI_CREDIT_TAG, QariCreditElement);
}
