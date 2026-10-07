// Sintetik, KİÇİK media fixture-ları (ffmpeg tələb etmir). Real kodek məzmunu yoxdur, yalnız düzgün konteyner strukturu.
const enc = new TextEncoder();
const cat = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of parts) { o.set(x, p); p += x.length; } return o; };
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16 = (n) => new Uint8Array([(n >>> 8) & 255, n & 255]);
const z = (n) => new Uint8Array(n);
const str = (s) => enc.encode(s);
const box = (type, ...kids) => { const body = cat(...kids); return cat(u32(8 + body.length), str(type), body); };
const fixed = (n) => u32(Math.round(n * 65536) >>> 0);

function matrix(rotation) {
  const m = { 0: [1, 0, 0, 1], 90: [0, 1, -1, 0], 180: [-1, 0, 0, -1], 270: [0, -1, 1, 0] }[rotation] || [1, 0, 0, 1];
  return cat(fixed(m[0]), fixed(m[1]), z(4), fixed(m[2]), fixed(m[3]), z(4), z(4), z(4), u32(0x40000000));
}

function videoTrak({ width, height, duration, ts, codec, rotation, id }) {
  const tkhd = box("tkhd", u32(3), z(8), u32(id), z(4), u32(duration * 1000), z(8), z(4), z(2), z(2), matrix(rotation), fixed(width), fixed(height));
  const mdhd = box("mdhd", u32(0), z(8), u32(ts), u32(duration * ts), u16(0x55c4), z(2));
  const hdlr = box("hdlr", u32(0), z(4), str("vide"), z(12), z(1));
  const entryBody = cat(z(6), u16(1), z(16), u16(width), u16(height), u32(0x480000), u32(0x480000), z(4), u16(1), z(32), u16(24), u16(0xffff));
  const cfg = codec === "avc1" ? box("avcC", new Uint8Array([1, 100, 0, 31, 0xff, 0xe0])) : codec === "hvc1" ? box("hvcC", new Uint8Array([1, 1, 0, 0])) : new Uint8Array(0);
  const stsd = box("stsd", u32(0), u32(1), box(codec, entryBody, cfg));
  return box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", box("stbl", stsd))));
}

function audioTrak({ duration, ts, codec, id }) {
  const tkhd = box("tkhd", u32(3), z(8), u32(id), z(4), u32(duration * 1000), z(8), z(4), u16(0x0100), z(2), matrix(0), z(4), z(4));
  const mdhd = box("mdhd", u32(0), z(8), u32(44100), u32(duration * 44100), u16(0x55c4), z(2));
  const hdlr = box("hdlr", u32(0), z(4), str("soun"), z(12), z(1));
  const entryBody = cat(z(6), u16(1), z(8), u16(2), u16(16), z(2), z(2), u32(44100 * 65536 >>> 0));
  const stsd = box("stsd", u32(0), u32(1), box(codec, entryBody));
  return box("trak", tkhd, mdhd.length ? box("mdia", mdhd, hdlr, box("minf", box("stbl", stsd))) : new Uint8Array(0));
}

// Qaytarır Uint8Array. truncate: faylı sondan N bayt kəs. noMoov: moov yazma.
export function buildMp4({ width = 320, height = 568, duration = 2, video = "avc1", audio = "mp4a", faststart = true, rotation = 0, brand = "isom", noMoov = false, noVideoTrack = false, truncate = 0, padding = 2048 } = {}) {
  const ts = 1000;
  const ftyp = box("ftyp", str(brand), u32(512), str("isom"), str("mp42"));
  const mvhd = box("mvhd", u32(0), z(8), u32(ts), u32(duration * ts), fixed(1), u16(0x0100), z(10), matrix(0), z(24), u32(3));
  const traks = [noVideoTrack ? new Uint8Array(0) : videoTrak({ width, height, duration, ts, codec: video, rotation, id: 1 })];
  if (audio) traks.push(audioTrak({ duration, ts, codec: audio, id: 2 }));
  const moov = noMoov ? new Uint8Array(0) : box("moov", mvhd, ...traks);
  const mdat = box("mdat", new Uint8Array(padding).fill(7));
  let out = faststart ? cat(ftyp, moov, mdat) : cat(ftyp, mdat, moov);
  if (truncate) out = out.slice(0, out.length - truncate);
  return out;
}

// Düzgün başlıqlı kiçik JPEG (SOF0 ilə ölçü) və PNG (IHDR)
export function buildJpeg(width = 64, height = 48) {
  return cat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]), str("JFIF"), new Uint8Array([0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), new Uint8Array([0xff, 0xc0, 0, 17, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), new Uint8Array([0xff, 0xd9]));
}
export function buildPng(width = 64, height = 48) {
  return cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), str("IHDR"), u32(width), u32(height), new Uint8Array([8, 2, 0, 0, 0]), u32(0), u32(0), str("IEND"), u32(0));
}
export const buildPdf = () => str("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
export const toAB = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
