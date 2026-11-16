/**
 * Attributes <qari-reader> will support (PRD section 6, as changed 2026-11-16); behaviour lands in Q5.
 * `mode` is `default` (CPU) or `accelerated` (GPU). There is no `normalize`: normalization always runs for listeners.
 */
export const QARI_READER_ATTRIBUTES = ['voice-config', 'voices', 'mode', 'pace', 'highlight', 'auto-scroll'] as const;

export const QARI_READER_TAG = 'qari-reader';

/** Q0 placeholder for the <qari-reader> Web Component: registers the tag and renders an RTL shell (Arabic only in the beta). */
export class QariReaderElement extends HTMLElement {
  static readonly observedAttributes = [...QARI_READER_ATTRIBUTES];

  connectedCallback(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>:host { display: block; font: inherit; }</style>
      <div part="shell" dir="rtl" lang="ar">
        <slot>قارئ</slot>
      </div>`;
  }
}

/** Registers <qari-reader> once; safe to call more than once. */
export function defineQariReader(registry: CustomElementRegistry = customElements): void {
  if (!registry.get(QARI_READER_TAG)) registry.define(QARI_READER_TAG, QariReaderElement);
}
