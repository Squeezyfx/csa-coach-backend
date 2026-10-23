/**
 * Paints out the crosshair's date box on a chart screenshot's time axis.
 *
 * With the mouse pointer on a TradingView chart, the time axis shows a solid grey box with the
 * date and time under the pointer (for example "20 Oct '26 08:00"). The chart reader kept taking
 * that box for the chart's last candle. The box is one flat colour, wider than any tick label,
 * and sits on the time axis, so it can be found from the pixels and covered with the axis
 * background before the picture goes to the AI. Nothing else is touched: price-axis tags can be
 * the trader's own drawn-line labels, so they are left alone.
 *
 * PNG only, 8-bit. Anything else (or a picture with no such box) is returned unchanged as null.
 */
import { deflateSync } from "node:zlib";
import { decodePng8 } from "./chart-raster-reader.js";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// RGBA pixels -> an 8-bit RGB PNG.
export function encodePngRgb({ width, height, pixels }) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = y * (stride + 1) + 1 + x * 3;
      raw[dst] = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const isGrey = (r, g, b) => Math.abs(r - g) <= 8 && Math.abs(g - b) <= 10;

/**
 * The row of tick labels under the plot (dates and times along the bottom): the highest band
 * below the plot that holds several separate bits of text spread across the width. A box that
 * is not on that row is never treated as the crosshair's date box.
 * Returns { y0, y1 } or null.
 */
export function findTickLabelBand(image, background) {
  const { width: w, height: h, pixels: p } = image;
  const start = Math.floor(h * 0.7);
  const bgLum = luminance(...background);
  const left = Math.floor(w * 0.05);
  const right = Math.floor(w * 0.9);
  const rows = [];
  for (let y = start; y < h; y += 1) {
    const ink = new Uint8Array(w);
    let count = 0;
    for (let x = left; x < right; x += 1) {
      const i = (y * w + x) * 4;
      if (Math.abs(luminance(p[i], p[i + 1], p[i + 2]) - bgLum) >= 75) {
        ink[x] = 1;
        count += 1;
      }
    }
    rows.push({ y, ink, count });
  }
  const isInk = (row) => row.count >= 3 && row.count <= (right - left) * 0.4;
  let band = null;
  for (let r = 0; r <= rows.length; r += 1) {
    const row = rows[r];
    if (row && isInk(row)) {
      if (!band) band = { y0: row.y, y1: row.y, rows: [] };
      band.y1 = row.y;
      band.rows.push(row);
    } else if (band && (!row || !isInk(rows[r + 1] || { count: 0 }))) {
      // End of a band (allow a one-row gap inside text).
      const height = band.y1 - band.y0 + 1;
      if (height >= 5 && height <= 20) {
        const columns = new Uint8Array(w);
        for (const bandRow of band.rows) for (let x = left; x < right; x += 1) if (bandRow.ink[x]) columns[x] = 1;
        const clusters = [];
        let from = -1;
        let gap = 0;
        for (let x = left; x <= right; x += 1) {
          if (x < right && columns[x]) {
            if (from < 0) from = x;
            gap = 0;
          } else if (from >= 0) {
            gap += 1;
            if (gap > 8 || x >= right) {
              clusters.push([from, x - gap]);
              from = -1;
              gap = 0;
            }
          }
        }
        const spread = clusters.length ? clusters[clusters.length - 1][1] - clusters[0][0] : 0;
        if (clusters.length >= 4 && spread >= (right - left) * 0.35) return { y0: band.y0, y1: band.y1 };
      }
      band = null;
    }
  }
  return null;
}

/**
 * Finds the crosshair date box. Returns [{x, y, width, height}] (usually one) or [].
 */
export function findCrosshairTimeLabels(image) {
  const { width: w, height: h, pixels: p } = image;
  if (w < 300 || h < 200) return [];
  const top = Math.floor(h * 0.72);
  const left = Math.floor(w * 0.05);
  const right = Math.floor(w * 0.9);
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [p[i], p[i + 1], p[i + 2]];
  };

  // Background of the axis band: the most common colour in the lower part of the picture.
  const counts = new Map();
  const exact = new Map();
  for (let y = top; y < h; y += 1) {
    for (let x = left; x < right; x += 2) {
      const [r, g, b] = at(x, y);
      const key = (r >> 2) * 4096 + (g >> 2) * 64 + (b >> 2);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!exact.has(key)) exact.set(key, [r, g, b]);
    }
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return [];
  const decode = (key) => exact.get(key) || [((key / 4096) | 0) << 2, (((key / 64) | 0) % 64) << 2, (key % 64) << 2];
  const background = decode(ranked[0][0]);
  const bgLum = luminance(...background);

  // Candidate fill colours: grey, clearly different from the background, and common.
  const fills = [];
  for (const [key, count] of ranked.slice(1, 12)) {
    const [r, g, b] = decode(key);
    if (!isGrey(r, g, b)) continue;
    if (Math.abs(luminance(r, g, b) - bgLum) < 25) continue;
    if (count < 150) continue;
    fills.push([r, g, b]);
  }
  const near = (c, f, t = 6) => Math.abs(c[0] - f[0]) <= t && Math.abs(c[1] - f[1]) <= t && Math.abs(c[2] - f[2]) <= t;

  const boxes = [];
  for (const fill of fills) {
    // Row runs of the fill colour, merged downwards into one bounding box.
    const active = [];
    const done = [];
    for (let y = top; y < h; y += 1) {
      const runs = [];
      let start = -1;
      for (let x = left; x <= right; x += 1) {
        const hit = x < right && near(at(x, y), fill);
        if (hit && start < 0) start = x;
        if (!hit && start >= 0) {
          if (x - start >= 6) runs.push([start, x - 1]);
          start = -1;
        }
      }
      // Join runs of this row to boxes from the row above.
      const next = [];
      for (const run of runs) {
        const parent = active.find((box) => run[0] <= box.x1 + 3 && run[1] >= box.x0 - 3);
        if (parent) {
          parent.x0 = Math.min(parent.x0, run[0]);
          parent.x1 = Math.max(parent.x1, run[1]);
          parent.y1 = y;
          parent.pixels += run[1] - run[0] + 1;
          next.push(parent);
        } else {
          next.push({ x0: run[0], x1: run[1], y0: y, y1: y, pixels: run[1] - run[0] + 1 });
        }
      }
      for (const box of active) if (!next.includes(box)) done.push(box);
      active.length = 0;
      active.push(...next);
    }
    done.push(...active);

    for (const box of done) {
      const bw = box.x1 - box.x0 + 1;
      const bh = box.y1 - box.y0 + 1;
      if (bw < 45 || bw > 170 || bh < 12 || bh > 36) continue;
      if (box.pixels / (bw * bh) < 0.45) continue;
      // Text inside: lighter pixels, a modest share of the box.
      let text = 0;
      for (let y = box.y0; y <= box.y1; y += 1) {
        for (let x = box.x0; x <= box.x1; x += 1) {
          const [r, g, b] = at(x, y);
          if (luminance(r, g, b) >= luminance(...fill) + 55 || luminance(r, g, b) <= luminance(...fill) - 55) text += 1;
        }
      }
      const share = text / (bw * bh);
      if (share < 0.06 || share > 0.45) continue;
      boxes.push({ x: box.x0, y: box.y0, width: bw, height: bh, fill, background });
    }
  }
  // The box must sit on the row of tick labels, not anywhere else in the lower part of the picture.
  const band = findTickLabelBand(image, background);
  if (!band) return [];
  const onBand = boxes.filter((box) => {
    const overlap = Math.min(box.y + box.height - 1, band.y1) - Math.max(box.y, band.y0) + 1;
    return overlap >= (band.y1 - band.y0 + 1) * 0.6 && box.height >= 14 && box.height <= 28;
  });

  // Two near-identical fill colours can find the same box twice: keep one per place.
  const merged = [];
  for (const box of onBand) {
    const twin = merged.find((other) => Math.abs(other.x - box.x) <= 6 && Math.abs(other.y - box.y) <= 6);
    if (!twin) merged.push(box);
  }
  return merged;
}

/**
 * Returns { buffer, erased } with the crosshair date box covered, or null when the picture is
 * not a PNG we can read or has no such box.
 */
export function eraseCrosshairTimeLabels(buffer) {
  const image = decodePng8(buffer);
  if (!image) return null;
  const boxes = findCrosshairTimeLabels(image);
  if (!boxes.length) return null;
  const { width: w, pixels: p } = image;
  for (const box of boxes) {
    const [r, g, b] = box.background;
    const pad = 2;
    for (let y = Math.max(0, box.y - pad); y < Math.min(image.height, box.y + box.height + pad); y += 1) {
      for (let x = Math.max(0, box.x - pad); x < Math.min(w, box.x + box.width + pad); x += 1) {
        const i = (y * w + x) * 4;
        p[i] = r;
        p[i + 1] = g;
        p[i + 2] = b;
      }
    }
  }
  return { buffer: encodePngRgb(image), erased: boxes.map(({ x, y, width, height }) => ({ x, y, width, height })) };
}
