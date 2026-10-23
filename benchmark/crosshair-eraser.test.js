import test from "node:test";
import assert from "node:assert/strict";
import { findCrosshairTimeLabels, eraseCrosshairTimeLabels, encodePngRgb } from "../crosshair-eraser.js";
import { decodePng8 } from "../chart-raster-reader.js";

// A small dark "chart": candles area on top, a row of tick labels, and (optionally) a grey box.
function chartImage({ box = true, boxY = 326, boxHeight = 18 } = {}) {
  const width = 640;
  const height = 400;
  const pixels = Buffer.alloc(width * height * 4, 255);
  const set = (x, y, v) => {
    const i = (y * width + x) * 4;
    pixels[i] = v[0];
    pixels[i + 1] = v[1];
    pixels[i + 2] = v[2];
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) set(x, y, [15, 15, 15]);
  // Tick label text: short bright bars on one row, spread across the width.
  for (let tick = 0; tick < 8; tick += 1) {
    const x0 = 60 + tick * 70;
    for (let y = 330; y < 339; y += 1) for (let x = x0; x < x0 + 14; x += 1) if ((x + y) % 3 !== 0) set(x, y, [210, 210, 210]);
  }
  if (box) {
    for (let y = boxY; y < boxY + boxHeight; y += 1) for (let x = 300; x < 390; x += 1) set(x, y, [61, 61, 61]);
    for (let y = boxY + 5; y < boxY + 13; y += 1) for (let x = 310; x < 380; x += 1) if ((x + y) % 3 !== 0) set(x, y, [225, 225, 225]);
  }
  return { width, height, pixels };
}

test("the pointer's date box on the tick-label row is found and painted out", () => {
  const image = chartImage();
  const found = findCrosshairTimeLabels(image);
  assert.equal(found.length, 1);
  assert.ok(found[0].width >= 85 && found[0].width <= 95);
  const png = encodePngRgb(image);
  const result = eraseCrosshairTimeLabels(png);
  assert.ok(result);
  const cleaned = decodePng8(result.buffer);
  const i = (334 * cleaned.width + 340) * 4;
  assert.deepEqual([cleaned.pixels[i], cleaned.pixels[i + 1], cleaned.pixels[i + 2]], [15, 15, 15]);
});

test("a chart with no pointer is left alone", () => {
  assert.equal(eraseCrosshairTimeLabels(encodePngRgb(chartImage({ box: false }))), null);
});

test("a grey box that is not on the tick-label row is left alone", () => {
  assert.equal(findCrosshairTimeLabels(chartImage({ boxY: 362 })).length, 0);
});

test("something that is not a readable PNG is left alone", () => {
  assert.equal(eraseCrosshairTimeLabels(Buffer.from("not a picture")), null);
});

