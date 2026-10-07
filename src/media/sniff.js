// Fayl növü yalnız başlıq baytlarına görə təyin olunur (Content-Type başlığına inanılmır).

const startsWith = (b, sig, off = 0) => sig.every((v, i) => b[off + i] === v);

// head: Uint8Array (ilk ≥ 16 bayt). Qaytarır: { content_type, kind } və ya null
export function sniffType(head) {
  if (!head || head.length < 12) return null;
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { content_type: "image/jpeg", kind: "image" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { content_type: "image/png", kind: "image" };
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { content_type: "application/pdf", kind: "document" };
  // ISO BMFF: bayt 4..8 = "ftyp"
  if (startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
    if (brand === "qt  ") return { content_type: "video/quicktime", kind: "video" };
    // heic/heif/avif şəkil konteynerləridir, video kimi qəbul edilmir
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(brand)) return null;
    return { content_type: "video/mp4", kind: "video" };
  }
  return null;
}
