/**
 * Minimal, dependency-free base64 codec.
 *
 * Hermes (React Native's JS engine) does not provide `btoa`/`atob`, and this
 * app has no `Buffer` polyfill — so neither is safe to reach for here. This
 * implementation is plain ES5 arithmetic, which behaves identically under
 * Jest/Node and under Hermes/device, closing the gap where a test could pass
 * in Node while the equivalent device code silently fails.
 */

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;

    // eslint-disable-next-line no-bitwise
    const triple = (b0 << 16) | (b1 << 8) | b2;

    // eslint-disable-next-line no-bitwise
    result += BASE64_CHARS[(triple >> 18) & 0x3f];
    // eslint-disable-next-line no-bitwise
    result += BASE64_CHARS[(triple >> 12) & 0x3f];
    result +=
      // eslint-disable-next-line no-bitwise
      i + 1 < len ? BASE64_CHARS[(triple >> 6) & 0x3f] : '=';
    // eslint-disable-next-line no-bitwise
    result += i + 2 < len ? BASE64_CHARS[triple & 0x3f] : '=';
  }
  return result;
}

export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[=]+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = BASE64_CHARS.indexOf(clean[i]);
    if (value === -1) {
      continue;
    }
    // eslint-disable-next-line no-bitwise
    buffer = (buffer << 6) | value;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      // eslint-disable-next-line no-bitwise
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
