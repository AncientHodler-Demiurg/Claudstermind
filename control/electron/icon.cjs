// Generate the tray dot as a real PNG at runtime (no shipped image files, no build step) — a filled circle
// with a 1px anti-aliased edge, coloured by overall health. Pure Node (zlib + a tiny PNG encoder), so it
// works headless and can't get out of sync with a checked-in asset.
const zlib = require("zlib");

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** RGBA filled-circle PNG (Buffer) of side `size`, colour `#rrggbb`. */
function dotPng(size, hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const c = (size - 1) / 2, rad = size / 2 - 1.2;
  const rowBytes = size * 4 + 1;                       // +1 filter byte per scanline
  const raw = Buffer.alloc(size * rowBytes);
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0;                             // filter type 0 (none)
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - c, y - c);
      const a = dist <= rad ? 255 : (dist <= rad + 1 ? Math.round(255 * (rad + 1 - dist)) : 0);
      const o = y * rowBytes + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;                            // 8-bit, colour type 6 (RGBA)
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const COLORS = { up: "#34d399", degraded: "#fbbf24", failed: "#f87171", unknown: "#8a98b5" };
/** A tray-sized colour dot Buffer for an overall state ("up" | "degraded" | "failed" | …). */
function stateDot(overall, size = 22) { return dotPng(size, COLORS[overall] || COLORS.unknown); }

module.exports = { dotPng, stateDot, COLORS };
