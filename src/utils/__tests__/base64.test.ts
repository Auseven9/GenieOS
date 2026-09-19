import {encodeBase64, decodeBase64} from '../base64';

describe('base64 codec', () => {
  it('matches known base64 test vectors', () => {
    const toBytes = (s: string) =>
      new Uint8Array(Array.from(s, c => c.charCodeAt(0)));
    // RFC 4648 test vectors.
    expect(encodeBase64(toBytes(''))).toBe('');
    expect(encodeBase64(toBytes('f'))).toBe('Zg==');
    expect(encodeBase64(toBytes('fo'))).toBe('Zm8=');
    expect(encodeBase64(toBytes('foo'))).toBe('Zm9v');
    expect(encodeBase64(toBytes('foob'))).toBe('Zm9vYg==');
    expect(encodeBase64(toBytes('fooba'))).toBe('Zm9vYmE=');
    expect(encodeBase64(toBytes('foobar'))).toBe('Zm9vYmFy');
  });

  it('decodes known base64 test vectors back to the original bytes', () => {
    const toBytes = (s: string) =>
      Array.from(new Uint8Array(Array.from(s, c => c.charCodeAt(0))));
    expect(Array.from(decodeBase64('Zg=='))).toEqual(toBytes('f'));
    expect(Array.from(decodeBase64('Zm8='))).toEqual(toBytes('fo'));
    expect(Array.from(decodeBase64('Zm9v'))).toEqual(toBytes('foo'));
    expect(Array.from(decodeBase64('Zm9vYmFy'))).toEqual(toBytes('foobar'));
  });

  it('round-trips every tail length (0, 1, 2 bytes remaining) correctly', () => {
    for (let len = 0; len <= 10; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = (i * 37 + 5) % 256;
      }
      const roundTripped = decodeBase64(encodeBase64(bytes));
      expect(Array.from(roundTripped)).toEqual(Array.from(bytes));
    }
  });

  it('round-trips the full byte range including 0x00 and 0xff', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      bytes[i] = i;
    }
    expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(
      Array.from(bytes),
    );
  });
});
