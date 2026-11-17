import { defineQariCredit } from './qari-credit.element';

/**
 * Attributes <qari-reader> will support (PRD section 6, as changed 2026-11-16); behaviour lands in Q5.
 * `mode` is `default` (CPU) or `accelerated` (GPU). `credit="off"` hides the "Powered by Qari" credit, shown by default.
 */
export const QARI_READER_ATTRIBUTES = ['voice-config', 'voices', 'mode', 'pace', 'highlight', 'auto-scroll', 'credit'] as const;

export const QARI_READER_TAG = 'qari-reader';

/**
 * Q0 placeholder for the <qari-reader> Web Component: registers the tag and renders an RTL shell (Arabic only in the
 * beta), with the "Powered by Qari" credit underneath unless credit="off".
 */
export class QariReaderElement extends HTMLElement {
  static readonly observedAttributes = [...QARI_READER_ATTRIBUTES];

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(name: string): void {
    if (name === 'credit' && this.isConnected) this.render();
  }

  private render(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const showCredit = this.getAttribute('credit') !== 'off';
    root.innerHTML = `
      <style>
        :host { display: block; font: inherit; }
        :host([hidden]) { display: none; }
        footer { margin-block-start: .5rem; text-align: end; }
      </style>
      <div part="shell" dir="rtl" lang="ar">
        <slot>قارئ</slot>
      </div>
      ${showCredit ? '<footer part="credit-row"><qari-credit></qari-credit></footer>' : ''}`;
  }
}

/** Registers <qari-reader> once; safe to call more than once. */
export function defineQariReader(registry: CustomElementRegistry = customElements): void {
  defineQariCredit(registry);
  if (!registry.get(QARI_READER_TAG)) registry.define(QARI_READER_TAG, QariReaderElement);
}
