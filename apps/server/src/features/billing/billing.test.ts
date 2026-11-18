import { describe, expect, test } from 'bun:test';
import { imageSize, isImage } from './billing.ts';

describe('logo upload (S-235)', () => {
  test('accepts only content that matches the declared type', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(isImage(png, 'image/png')).toBe(true);
    expect(isImage(jpeg, 'image/jpeg')).toBe(true);
    expect(isImage(jpeg, 'image/png')).toBe(false);
    expect(isImage(new TextEncoder().encode('<svg onload=alert(1)>'), 'image/jpeg')).toBe(false);
  });

  test('reads the pixel size, so huge bitmaps can be refused', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    expect(imageSize(new Uint8Array(png), 'image/png')).toEqual({ width: 1, height: 1 });
    // SOI, an APP0 segment of 4 bytes, then a baseline frame of 300 × 40 000.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x9c, 0x40, 0x01, 0x2c, 1, 0,
    ]);
    expect(imageSize(jpeg, 'image/jpeg')).toEqual({ width: 300, height: 40_000 });
  });
});
