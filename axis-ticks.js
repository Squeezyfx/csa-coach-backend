/**
 * Printed price-axis numbers are not drawn lines.
 *
 * The independent line reader (a vision step) is told to leave out ordinary axis tick labels, but it
 * sometimes returns one anyway: on an AUDUSD H1 screenshot (13 Nov 2026) with no line drawn at all,
 * the printed axis number 0.68000, sitting just above the last-price tag, came back as a "drawn line"
 * and ended up on the page as "Level to watch 0.68000".
 *
 * A line the reader returns at exactly a printed tick, with nothing from the framework behind it,
 * is therefore not trusted as a level. The ticks come from the chart reading step, which transcribes
 * every ordinary axis number; with fewer than three of them nothing is judged.
 */
export function isPrintedAxisTick(price, ticks = []) {
  const p = Number(price);
  const list = (Array.isArray(ticks) ? ticks : [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
  if (!(p > 0) || list.length < 3) return false;
  const gaps = list
    .slice(1)
    .map((tick, index) => list[index] - tick)
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);
  const spacing = gaps[Math.floor(gaps.length / 2)];
  if (!(spacing > 0)) return false;
  // Within one hundredth of the tick spacing: for 0.005 apart, half a pip.
  const tolerance = Math.max(spacing * 0.01, 1e-9);
  return list.some((tick) => Math.abs(tick - p) <= tolerance);
}
