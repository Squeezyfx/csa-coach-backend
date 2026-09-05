import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { decodePng8, extractMt4PngMonthlyInventory } from "../chart-raster-reader.js";

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}

function tinyRgbPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 128, 0]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("PNG decoder reconstructs eight-bit RGB pixels without an image dependency", () => {
  const image = decodePng8(tinyRgbPng());
  assert.equal(image.width, 2);
  assert.equal(image.height, 1);
  assert.deepEqual([...image.pixels], [255, 0, 0, 255, 0, 128, 0, 255]);
});

test("raster reader rejects unsupported images without manufacturing periods", () => {
  assert.equal(extractMt4PngMonthlyInventory({
    imageBase64: Buffer.from("not a png").toString("base64"),
    mimeType: "image/png",
    timeframe: "D1",
    periodDates: ["2026-01-01"],
    timeAxisDates: ["2025-12-01", "2026-01-01", "2026-02-01"],
    priceAxisTicks: [3, 2, 1],
  }), null);
});
