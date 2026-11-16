/** Raster image types Beamling reads or serves. Never SVG: it can carry scripts. */
export const RASTER_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;
export type RasterImageType = (typeof RASTER_IMAGE_TYPES)[number];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** File signatures: a declared type must match the bytes. */
export const IMAGE_SIGNATURES: Record<RasterImageType, (bytes: Buffer) => boolean> = {
  "image/jpeg": (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes) => bytes.subarray(0, 8).equals(PNG),
  "image/webp": (bytes) => bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP",
  "image/gif": (bytes) => /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6)),
  "image/avif": (bytes) => bytes.toString("latin1", 4, 8) === "ftyp" && /^avi[fs]$/.test(bytes.toString("latin1", 8, 12)),
};

/** The image type the bytes start with, or null when they are not a known raster image. */
export function sniffImageType(bytes: Buffer): RasterImageType | null {
  return RASTER_IMAGE_TYPES.find((type) => IMAGE_SIGNATURES[type](bytes)) ?? null;
}
