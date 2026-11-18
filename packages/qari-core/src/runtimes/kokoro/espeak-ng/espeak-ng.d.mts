/** Types for the Emscripten loader next to this file (createEspeak from espeak-ng.mjs). */
export interface EspeakModule {
  ccall(name: string, returnType: 'number' | 'string', argTypes: string[], args: (string | number)[]): number | string;
}

export default function createEspeak(options: { wasmBinary: ArrayBuffer | Uint8Array }): Promise<EspeakModule>;
