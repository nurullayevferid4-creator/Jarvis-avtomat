// ISO BMFF (MP4/MOV) başlıq analizi: müddət, ölçü, kodek, fırlanma, kəsilmiş/korlanmış fayl aşkarı.
// Fayl tam yaddaşa oxunmur: reader.read(offset, length) ilə yalnız qutu başlıqları və "moov" oxunur.
// reader: { size:number, read:(offset,length)=>Promise<Uint8Array> }

import { AppError } from "../errors.js";

const MAX_MOOV = 16 * 1024 * 1024;
const VIDEO_CODECS = { avc1: "h264", avc3: "h264", hvc1: "hevc", hev1: "hevc", av01: "av1", vp09: "vp9", mp4v: "mpeg4", apch: "prores", apcn: "prores", ap4h: "prores" };
const AUDIO_CODECS = { mp4a: "aac", "ac-3": "ac3", "ec-3": "eac3", Opus: "opus", alac: "alac", sowt: "pcm", twos: "pcm", ".mp3": "mp3" };

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// buf içində [start,end) aralığında uşaq qutuları
function* boxes(buf, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = u32(buf, p);
    const type = fourcc(buf, p + 4);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      size = u64(buf, p + 8);
      header = 16;
    } else if (size === 0) size = end - p;
    if (size < header || p + size > end) return; // korlanmış uşaq qutu: dayan
    yield { type, start: p, header, end: p + size, body: p + header };
    p += size;
  }
}

function parseTrak(buf, trak) {
  const t = { handler: null, width: 0, height: 0, rotation: 0, timescale: 0, duration: 0, codec: null, rawCodec: null, enabled: true };
  for (const c of boxes(buf, trak.body, trak.end)) {
    if (c.type === "tkhd") {
      const v = buf[c.body];
      t.enabled = (buf[c.body + 3] & 1) === 1;
      const off = c.body + (v === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4); // version/flags + creation/modification + track_id + reserved + duration
      // duration 'off' əvvəlində; matris və ölçü: reserved(8) layer(2) alt(2) volume(2) reserved(2) matrix(36) width(4) height(4)
      const m = off + 8 + 2 + 2 + 2 + 2;
      if (m + 36 + 8 <= c.end) {
        const a = i32(buf, m) / 65536;
        const b2 = i32(buf, m + 4) / 65536;
        t.rotation = Math.round((Math.atan2(b2, a) * 180) / Math.PI);
        if (t.rotation < 0) t.rotation += 360;
        t.width = u32(buf, m + 36) / 65536;
        t.height = u32(buf, m + 40) / 65536;
      }
    } else if (c.type === "mdia") {
      for (const d of boxes(buf, c.body, c.end)) {
        if (d.type === "mdhd") {
          const v = buf[d.body];
          t.timescale = v === 1 ? u32(buf, d.body + 4 + 16) : u32(buf, d.body + 4 + 8);
          t.duration = v === 1 ? u64(buf, d.body + 4 + 20) : u32(buf, d.body + 4 + 12);
        } else if (d.type === "hdlr") {
          t.handler = fourcc(buf, d.body + 8);
        } else if (d.type === "minf") {
          for (const s of boxes(buf, d.body, d.end)) {
            if (s.type !== "stbl") continue;
            for (const x of boxes(buf, s.body, s.end)) {
              if (x.type !== "stsd" || x.body + 8 > x.end) continue;
              const entry = boxes(buf, x.body + 8, x.end).next().value;
              if (!entry) continue;
              t.rawCodec = entry.type;
              if (t.handler === "vide") {
                t.codec = VIDEO_CODECS[entry.type] || entry.type;
                if (entry.body + 78 <= entry.end) {
                  t.sampleWidth = u16(buf, entry.body + 24);
                  t.sampleHeight = u16(buf, entry.body + 26);
                  for (const e of boxes(buf, entry.body + 78, entry.end)) {
                    if (e.type === "avcC" && e.body + 4 <= e.end) { t.avcProfile = buf[e.body + 1]; t.avcLevel = buf[e.body + 3]; }
                    if (e.type === "hvcC" && e.body + 2 <= e.end) t.hevcProfile = buf[e.body + 1] & 0x1f;
                  }
                }
              } else if (t.handler === "soun") {
                t.codec = AUDIO_CODECS[entry.type] || entry.type;
                if (entry.body + 28 <= entry.end) {
                  t.channels = u16(buf, entry.body + 16);
                  t.sampleRate = u32(buf, entry.body + 24) / 65536;
                }
              }
            }
          }
        }
      }
    }
  }
  return t;
}

// Qaytarır: { container, brand, duration_s, width, height, rotation, video:{codec,...}|null, audio:{...}|null, bitrate_kbps, has_faststart, complete }
export async function analyzeMp4(reader) {
  const size = reader.size;
  if (!size || size < 16) throw new AppError("VALIDATION_ERROR", "Video faylı çox kiçikdir");
  let pos = 0;
  let brand = null;
  let moov = null;
  let mdatEnd = 0;
  let moovBeforeMdat = false;
  let sawMdat = false;
  let complete = true;
  let guard = 0;
  while (pos + 8 <= size && guard++ < 10000) {
    const head = await reader.read(pos, Math.min(16, size - pos));
    let bs = u32(head, 0);
    const type = fourcc(head, 4);
    let hs = 8;
    if (bs === 1) {
      if (head.length < 16) break;
      bs = u64(head, 8);
      hs = 16;
    } else if (bs === 0) bs = size - pos;
    if (bs < hs) throw new AppError("VALIDATION_ERROR", "Video qutu strukturu korlanıb");
    if (pos + bs > size) {
      complete = false; // qutu faylın sonundan çıxır: yarımçıq yükləmə
      if (type === "mdat") sawMdat = true;
      break;
    }
    if (type === "ftyp") brand = fourcc(await reader.read(pos + hs, 4), 0);
    if (type === "mdat") { sawMdat = true; mdatEnd = pos + bs; }
    if (type === "moov") {
      if (bs > MAX_MOOV) throw new AppError("VALIDATION_ERROR", "Video metadata bölməsi çox böyükdür");
      moov = await reader.read(pos, bs);
      moovBeforeMdat = !sawMdat;
    }
    pos += bs;
  }
  if (!brand) throw new AppError("VALIDATION_ERROR", "Bu MP4/MOV faylı deyil (ftyp yoxdur)");
  if (!complete) throw new AppError("VALIDATION_ERROR", "Video faylı yarımçıqdır (yükləmə tam deyil)");
  if (!moov) throw new AppError("VALIDATION_ERROR", "Video metadata (moov) tapılmadı: fayl korlanıb və ya tam deyil");

  const mv = [...boxes(moov, 8, moov.length)];
  let movieDuration = 0;
  const mvhd = mv.find((b) => b.type === "mvhd");
  if (mvhd) {
    const v = moov[mvhd.body];
    const ts = v === 1 ? u32(moov, mvhd.body + 4 + 16) : u32(moov, mvhd.body + 4 + 8);
    const du = v === 1 ? u64(moov, mvhd.body + 4 + 20) : u32(moov, mvhd.body + 4 + 12);
    if (ts) movieDuration = du / ts;
  }
  const traks = mv.filter((b) => b.type === "trak").map((t) => parseTrak(moov, t));
  const v = traks.find((t) => t.handler === "vide" && t.enabled !== false) || traks.find((t) => t.handler === "vide");
  const a = traks.find((t) => t.handler === "soun");
  if (!v) throw new AppError("VALIDATION_ERROR", "Faylda video treki yoxdur");
  let w = Math.round(v.width || v.sampleWidth || 0);
  let h = Math.round(v.height || v.sampleHeight || 0);
  if (v.rotation === 90 || v.rotation === 270) [w, h] = [h, w]; // göstərilən ölçü
  const vdur = v.timescale ? v.duration / v.timescale : 0;
  const duration = Math.max(vdur, movieDuration);
  if (!(duration > 0) || !w || !h) throw new AppError("VALIDATION_ERROR", "Videonun müddəti və ya ölçüsü oxuna bilmədi");
  return {
    container: brand === "qt  " ? "mov" : "mp4",
    brand,
    duration_s: Math.round(duration * 100) / 100,
    width: w,
    height: h,
    aspect: Math.round((w / h) * 1000) / 1000,
    rotation: v.rotation || 0,
    video: { codec: v.codec, profile: v.avcProfile || v.hevcProfile || null, level: v.avcLevel || null },
    audio: a ? { codec: a.codec, channels: a.channels || null, sample_rate: a.sampleRate || null } : null,
    bitrate_kbps: Math.round((size * 8) / duration / 1000),
    faststart: moovBeforeMdat,
    size,
    complete: true,
  };
}

export const bufferReader = (bytes) => ({ size: bytes.length, read: async (o, l) => bytes.subarray(o, Math.min(bytes.length, o + l)) });
