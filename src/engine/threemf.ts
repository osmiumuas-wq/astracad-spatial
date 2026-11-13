/**
 * 3MF export with per-vertex colours (3MF Materials and Properties extension).
 * The stress map from the last solve can be carried into a slicer that reads
 * colour groups. Slicer support for colour groups varies; the geometry is
 * standard 3MF core either way.
 */

import { APP_NAME, APP_VERSION } from './exporters.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive with stored (uncompressed) entries. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, f.data);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let o = 0;
  for (const p of [...parts, ...central, end]) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const hex2 = (v: number): string =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

/** Linear to sRGB for one channel. */
const toSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * A 3MF package in millimetres. Vertices are welded by position so the mesh is
 * watertight by index, as 3MF requires. With `colors` (linear RGB per input
 * vertex) each triangle corner points into a colour group.
 */
export function toThreeMF(
  positions: Float32Array,
  indices: Uint32Array,
  colors: Float32Array | null,
  name: string,
): { bytes: Uint8Array; vertices: number; triangles: number; colors: number } {
  const weld = new Map<string, number>();
  const verts: number[] = [];
  const remap = new Uint32Array(positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    let id = weld.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      weld.set(key, id);
      verts.push(x, y, z);
    }
    remap[i] = id;
  }
  const palette = new Map<string, number>();
  const colorOf = (v: number): number => {
    if (!colors) return 0;
    const c = `#${hex2(toSrgb(colors[v * 3]))}${hex2(toSrgb(colors[v * 3 + 1]))}${hex2(toSrgb(colors[v * 3 + 2]))}`;
    let id = palette.get(c);
    if (id === undefined) {
      id = palette.size;
      palette.set(c, id);
    }
    return id;
  };
  const tris: string[] = [];
  let triangles = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]];
    const b = remap[indices[t + 1]];
    const c = remap[indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    triangles++;
    tris.push(
      colors
        ? `<triangle v1="${a}" v2="${b}" v3="${c}" pid="2" p1="${colorOf(indices[t])}" p2="${colorOf(indices[t + 1])}" p3="${colorOf(indices[t + 2])}"/>`
        : `<triangle v1="${a}" v2="${b}" v3="${c}"/>`,
    );
  }
  const vx: string[] = [];
  for (let i = 0; i < verts.length; i += 3) {
    vx.push(`<vertex x="${verts[i].toFixed(5)}" y="${verts[i + 1].toFixed(5)}" z="${verts[i + 2].toFixed(5)}"/>`);
  }
  const colorGroup = colors
    ? `<m:colorgroup id="2">${[...palette.keys()].map((c) => `<m:color color="${c}"/>`).join('')}</m:colorgroup>`
    : '';
  const safeName = name.replace(/[<>&"]/gu, '_');
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"' +
    ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">' +
    `<metadata name="Title">${safeName}</metadata><metadata name="Application">${APP_NAME} ${APP_VERSION}</metadata>` +
    `<resources>${colorGroup}<object id="1" type="model"${colors ? ' pid="2" pindex="0"' : ''}><mesh><vertices>${vx.join('')}</vertices>` +
    `<triangles>${tris.join('')}</triangles></mesh></object></resources>` +
    '<build><item objectid="1"/></build></model>';
  const enc = new TextEncoder();
  const bytes = zipStore([
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
    },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
  return { bytes, vertices: verts.length / 3, triangles, colors: palette.size };
}
