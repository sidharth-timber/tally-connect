// Converts the real Timber favicon.ico (classic BMP-DIB ICO frames, not
// PNG-in-ICO) into PNG assets for the Electron app, replacing the
// placeholder blue squares from generate-placeholder-icons.js. Also copies
// the ICO directly for the Windows installer/app icon (build/icon.ico),
// since Windows accepts a plain .ico there without conversion.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SOURCE_ICO = 'D:/timber/Azure/TIMBER-IN-FE/public/favicon.ico';

const CRC_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
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

// Builds an RGBA PNG (colorType 6) from a flat top-down RGBA pixel buffer.
function buildRGBAPNG(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  const ihdr = chunk('IHDR', ihdrData);

  const raw = Buffer.alloc((1 + width * 4) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Parses one 32bpp BMP-DIB ICO frame (BITMAPINFOHEADER + BGRA pixels,
// bottom-up row order, no padding needed since width*4 is 4-byte aligned)
// into a top-down RGBA buffer.
function dibFrameToRGBA(buf, dataOffset, width, height) {
  const pixelsStart = dataOffset + 40; // skip BITMAPINFOHEADER
  const rgba = Buffer.alloc(width * height * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcRow = pixelsStart + (height - 1 - y) * rowBytes; // bottom-up source
    const dstRow = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      // source is BGRA
      rgba[d] = buf[s + 2];     // R
      rgba[d + 1] = buf[s + 1]; // G
      rgba[d + 2] = buf[s];     // B
      rgba[d + 3] = buf[s + 3]; // A
    }
  }
  return rgba;
}

function parseIcoFrames(buf) {
  const count = buf.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const width = buf[off] || 256;
    const height = buf[off + 1] || 256;
    const dataOffset = buf.readUInt32LE(off + 12);
    frames.push({ width, height, dataOffset });
  }
  return frames;
}

const icoBuf = fs.readFileSync(SOURCE_ICO);
const frames = parseIcoFrames(icoBuf);
console.log('Source ICO frames:', frames.map(f => `${f.width}x${f.height}`).join(', '));

const assetsDir = path.join(__dirname, '..', 'src', 'renderer', 'assets');
const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

const frame48 = frames.find(f => f.width === 48) || frames[frames.length - 1];
const frame32 = frames.find(f => f.width === 32) || frame48;

const png48 = buildRGBAPNG(frame48.width, frame48.height, dibFrameToRGBA(icoBuf, frame48.dataOffset, frame48.width, frame48.height));
const png32 = buildRGBAPNG(frame32.width, frame32.height, dibFrameToRGBA(icoBuf, frame32.dataOffset, frame32.width, frame32.height));

fs.writeFileSync(path.join(assetsDir, 'icon.png'), png48);
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), png32);
fs.copyFileSync(SOURCE_ICO, path.join(buildDir, 'icon.ico'));

console.log('Wrote real Timber icon.png, tray-icon.png, and build/icon.ico');
