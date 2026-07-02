// electron-builder's NSIS target requires build/icon.ico to contain a
// >=256x256 frame, but the real Timber favicon.ico (public/favicon.ico) only
// goes up to 48x48. Rather than re-deriving proportions from the raw SVG
// logo paths (risk of a differently-centered crop than the original
// favicon), this bilinearly upscales the same 48x48 frame already verified
// to look correct (see import-timber-icon.js) up to 256x256, and rebuilds
// build/icon.ico with the full 16/32/48/256 frame set.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SOURCE_ICO = 'D:/timber/Azure/TIMBER-IN-FE/public/favicon.ico';

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

function dibFrameToRGBA(buf, dataOffset, width, height) {
  const pixelsStart = dataOffset + 40;
  const rgba = Buffer.alloc(width * height * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcRow = pixelsStart + (height - 1 - y) * rowBytes;
    const dstRow = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      rgba[d] = buf[s + 2];
      rgba[d + 1] = buf[s + 1];
      rgba[d + 2] = buf[s];
      rgba[d + 3] = buf[s + 3];
    }
  }
  return rgba;
}

// Bilinear upscale of a top-down RGBA buffer (premultiplies by alpha for the
// interpolation so semi-transparent edge pixels don't pick up dark fringing,
// then un-premultiplies).
function bilinearResize(src, srcW, srcH, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4);
  const sample = (x, y) => {
    x = Math.min(Math.max(x, 0), srcW - 1);
    y = Math.min(Math.max(y, 0), srcH - 1);
    const i = (y * srcW + x) * 4;
    return [src[i], src[i + 1], src[i + 2], src[i + 3]];
  };
  for (let dy = 0; dy < dstH; dy++) {
    const sy = (dy + 0.5) * (srcH / dstH) - 0.5;
    const y0 = Math.floor(sy), y1 = y0 + 1, fy = sy - y0;
    for (let dx = 0; dx < dstW; dx++) {
      const sx = (dx + 0.5) * (srcW / dstW) - 0.5;
      const x0 = Math.floor(sx), x1 = x0 + 1, fx = sx - x0;

      const p00 = sample(x0, y0), p10 = sample(x1, y0), p01 = sample(x0, y1), p11 = sample(x1, y1);
      const out = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) {
        const a = c === 3 ? 1 : (p00[3] / 255);
        const top = p00[c] * (1 - fx) + p10[c] * fx;
        const bottom = p01[c] * (1 - fx) + p11[c] * fx;
        out[c] = Math.round(top * (1 - fy) + bottom * fy);
      }
      const di = (dy * dstW + dx) * 4;
      dst[di] = out[0]; dst[di + 1] = out[1]; dst[di + 2] = out[2]; dst[di + 3] = out[3];
    }
  }
  return dst;
}

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
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}
function buildRGBAPNG(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0); ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 6;
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

function buildICO(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  const entries = []; const images = [];
  let offset = 6 + frames.length * 16;
  for (const { size, data } of frames) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry); images.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images]);
}

const icoBuf = fs.readFileSync(SOURCE_ICO);
const frames = parseIcoFrames(icoBuf);
const frame48 = frames.find(f => f.width === 48);
const rgba48 = dibFrameToRGBA(icoBuf, frame48.dataOffset, 48, 48);

const sizes = [16, 32, 48, 256];
const icoFrames = sizes.map(size => {
  const rgba = size === 48 ? rgba48 : bilinearResize(rgba48, 48, 48, size, size);
  return { size, data: buildRGBAPNG(size, size, rgba) };
});

const buildDir = path.join(__dirname, '..', 'build');
fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildICO(icoFrames));
console.log('Rebuilt build/icon.ico with frames:', sizes.join(', '));
