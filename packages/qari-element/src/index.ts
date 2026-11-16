/** Public API of @khaledelansari/qari-element; importing it registers <qari-reader>. */
import { defineQariReader } from './qari-reader.element';

export { QARI_READER_ATTRIBUTES, QARI_READER_TAG, QariReaderElement, defineQariReader } from './qari-reader.element';

if (typeof customElements !== 'undefined') defineQariReader();
