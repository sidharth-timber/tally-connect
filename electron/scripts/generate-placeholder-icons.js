// Generates placeholder Timber-blue square icons so the app can launch before
// real branding assets are supplied (see plan: "Branding assets... don't
// exist in the repo today"). Replace the output files under
// src/renderer/assets/ and build/ with real Timber artwork when available.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Solid-color square PNG with a lighter ring, so it reads as an icon rather
// than a flat swatch, at [size]x[size], RGB (colorType 2, no alpha).
function buildPNG(size, [r, g, b]) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk('IHDR', ihdrData);

  const raw = Buffer.alloc((1 + size * 3) * size);
  const margin = Math.max(1, Math.floor(size * 0.12));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const onEdge = x < margin || x >= size - margin || y < margin || y >= size - margin;
      const px = rowStart + 1 + x * 3;
      if (onEdge) {
        raw[px] = Math.min(255, r + 40);
        raw[px + 1] = Math.min(255, g + 40);
        raw[px + 2] = Math.min(255, b + 40);
      } else {
        raw[px] = r;
        raw[px + 1] = g;
        raw[px + 2] = b;
      }
    }
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function buildICO(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = [];
  const images = [];
  let offset = 6 + count * 16;

  for (const { size, data } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(data);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images]);
}

const TIMBER_BLUE = [31, 111, 235];

const assetsDir = path.join(__dirname, '..', 'src', 'renderer', 'assets');
const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

const icon256 = buildPNG(256, TIMBER_BLUE);
const icon32 = buildPNG(32, TIMBER_BLUE);
const icon16 = buildPNG(16, TIMBER_BLUE);

fs.writeFileSync(path.join(assetsDir, 'icon.png'), icon256);
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), icon32);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildICO([
  { size: 16, data: icon16 },
  { size: 32, data: icon32 },
  { size: 256, data: icon256 },
]));

console.log('Placeholder icons written to src/renderer/assets/ and build/icon.ico');
