// Generates the image minted as a spore in week 5.
//
//   node scripts/make-dob-image.js
//
// Written by hand rather than pulled from a photo library for one reason: on
// CKB the content of a DOB is the asset, and one byte of content locks one CKB
// of capacity. A file you can regenerate is a file whose size you chose.
// 64x64 RGB, no dependencies, zlib is in Node.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SIZE = 64;
const OUT = new URL("../tests/fixtures/dob.png", import.meta.url).pathname;

// A ring of cells around a solid centre: the cell model, drawn badly.
const pixel = (x, y) => {
  const dx = x - SIZE / 2 + 0.5;
  const dy = y - SIZE / 2 + 0.5;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r < 9) return [0x00, 0xcc, 0x9b]; // nervos green
  if (r > 26) return [0x10, 0x14, 0x1a];
  const spoke = Math.floor((Math.atan2(dy, dx) / Math.PI + 1) * 6) % 2;
  return spoke ? [0x10, 0x14, 0x1a] : [0x3c, 0x4c, 0x5e];
};

const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
for (let y = 0; y < SIZE; y++) {
  const row = y * (1 + SIZE * 3);
  raw[row] = 0; // filter type: none, so the bytes stay predictable
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b] = pixel(x, y);
    raw[row + 1 + x * 3] = r;
    raw[row + 2 + x * 3] = g;
    raw[row + 3 + x * 3] = b;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour
// 10..12 stay zero: deflate, adaptive filtering, no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`${OUT}  ${png.length} bytes`);
