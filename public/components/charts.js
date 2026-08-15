// Minimal dependency-free canvas line chart for the token detail panel's
// price/volume history. No charting library - just a 2D canvas draw.

export function drawLineChart(canvas, points, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 320;
  const cssHeight = canvas.clientHeight || 120;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  if (!points || points.length < 2) {
    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('Not enough history yet', 8, cssHeight / 2);
    return;
  }

  const color = opts.color || '#22d3a5';
  const fillColor = opts.fillColor || 'rgba(34,211,165,0.12)';
  const padding = 6;

  const values = points.map((p) => p.v);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = max - min;

  const stepX = (cssWidth - padding * 2) / (points.length - 1);
  const toXY = (p, i) => {
    const x = padding + i * stepX;
    const y = cssHeight - padding - ((p.v - min) / range) * (cssHeight - padding * 2);
    return [x, y];
  };

  // Filled area under the line.
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = toXY(p, i);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  const [lastX] = toXY(points[points.length - 1], points.length - 1);
  ctx.lineTo(lastX, cssHeight - padding);
  ctx.lineTo(padding, cssHeight - padding);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Line itself.
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = toXY(p, i);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Last point marker.
  const [lx, ly] = toXY(points[points.length - 1], points.length - 1);
  ctx.beginPath();
  ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
