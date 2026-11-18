import createEspeak from './espeak-ng/espeak-ng.mjs';
import type { Espeak } from './g2p';

/**
 * Starts espeak-ng (1.52.0, Arabic data, the same files as the Python pipeline) from the downloaded espeak-ng.wasm and
 * calls it the way Python's phonemizer does (glue.c): espeak_Initialize(0x02, 0, path, 0), voice "ar", and
 * espeak_TextToPhonemes(UTF-8, IPA | tie U+0361) per clause, joined by spaces.
 */
export async function loadEspeak(wasm: Uint8Array): Promise<Espeak> {
  const module = await createEspeak({ wasmBinary: wasm });
  const status = module.ccall('nabra_espeak_init', 'number', ['string', 'string'], ['/espeak-ng-data', 'ar']);
  if (status !== 0) throw new Error(`espeak-ng did not start (code ${status})`);
  return { phonemize: text => module.ccall('nabra_espeak_phonemize', 'string', ['string'], [text]) as string };
}
