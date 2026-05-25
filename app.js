const defaults = {
  dimensionMode: "outer",
  topArm: 21,
  height: 18,
  bottomArm: 31,
  wall: 1,
  depth: 40,
  bevel: 0,
  quality: 2,
};

const controlDefs = [
  { key: "topArm", label: "上辺長", min: 10, max: 200, step: 1 },
  { key: "height", label: "縦辺長 / 外高さ (H)", min: 10, max: 200, step: 1 },
  { key: "bottomArm", label: "下辺長", min: 10, max: 200, step: 1 },
  { key: "wall", label: "壁厚 (T)", min: 0.4, max: 40, step: 0.1 },
  { key: "depth", label: "奥行き / 押し出し (D)", min: 8, max: 100, step: 1 },
  { key: "bevel", label: "角R / 面取り (R)", min: 0, max: 12, step: 0.5 },
  { key: "quality", label: "曲面品質", min: 1, max: 4, step: 1 },
];

const state = { ...defaults };
const view = { rotX: -0.36, rotY: 0.58, zoom: 0.86, showDims: true };

const canvas = document.getElementById("previewCanvas");
const ctx = canvas.getContext("2d");
const controls = document.getElementById("controls");
const drawingCanvases = {
  front: document.getElementById("frontViewCanvas"),
  top: document.getElementById("topViewCanvas"),
  side: document.getElementById("sideViewCanvas"),
};
let mesh = null;
let dragStart = null;

function buildControls() {
  controls.innerHTML = "";
  for (const def of controlDefs) {
    const current = getControlValue(def.key);
    const label = getControlLabel(def);
    const min = getControlMin(def.key, def.min);
    const wrap = document.createElement("div");
    wrap.className = "control";
    wrap.innerHTML = `
      <div class="control-label">
        <span data-label-for="${def.key}">${label}</span>
        <span class="range-limits" data-limits-for="${def.key}">${min}-${def.max}</span>
      </div>
      <div class="range-row">
        <input id="${def.key}Range" type="range" min="${min}" max="${def.max}" step="${def.step}" value="${current}" aria-label="${label}" />
        <input id="${def.key}Input" class="number-field" type="number" min="${min}" max="${def.max}" step="${def.step}" value="${current}" aria-label="${label}の数値" />
        <span class="unit-label">${def.key === "quality" ? "段" : "mm"}</span>
      </div>
    `;
    controls.appendChild(wrap);

    const range = wrap.querySelector(`#${def.key}Range`);
    const input = wrap.querySelector(`#${def.key}Input`);
    const update = (value) => {
      setControlValue(def.key, Number(value));
      syncControlValues();
      updateModel();
    };
    range.addEventListener("input", (event) => update(event.target.value));
    input.addEventListener("input", (event) => update(event.target.value));
  }
}

function isDimensionKey(key) {
  return key === "topArm" || key === "height" || key === "bottomArm";
}

function getControlLabel(def) {
  if (state.dimensionMode !== "inner" || !isDimensionKey(def.key)) return def.label;
  if (def.key === "topArm") return "上内寸";
  if (def.key === "height") return "内高さ";
  return "下内寸";
}

function getControlMin(key, fallback) {
  return state.dimensionMode === "inner" && isDimensionKey(key) ? 0 : fallback;
}

function getControlValue(key) {
  if (state.dimensionMode !== "inner") return state[key];
  if (key === "topArm" || key === "bottomArm") return Math.max(0, state[key] - state.wall);
  if (key === "height") return Math.max(0, state.height - state.wall * 2);
  return state[key];
}

function setControlValue(key, rawValue) {
  const def = controlDefs.find((item) => item.key === key);
  const min = getControlMin(key, def.min);
  const value = clamp(rawValue, min, def.max);
  if (state.dimensionMode === "inner" && isDimensionKey(key)) {
    if (key === "height") {
      state.height = value + state.wall * 2;
    } else {
      state[key] = value + state.wall;
    }
    return;
  }
  if (key === "wall" && state.dimensionMode === "inner") {
    const inner = captureInnerDimensions();
    state.wall = value;
    applyInnerDimensions(inner);
    return;
  }
  state[key] = value;
}

function captureInnerDimensions() {
  return {
    topArm: Math.max(0, state.topArm - state.wall),
    height: Math.max(0, state.height - state.wall * 2),
    bottomArm: Math.max(0, state.bottomArm - state.wall),
  };
}

function applyInnerDimensions(inner) {
  state.topArm = inner.topArm + state.wall;
  state.height = inner.height + state.wall * 2;
  state.bottomArm = inner.bottomArm + state.wall;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function validateParams(params) {
  const errors = [];
  if (params.wall * 2 >= params.height) errors.push("壁厚は外高さの半分未満にしてください。");
  if (params.wall >= params.topArm) errors.push("壁厚は上辺長より小さくしてください。");
  if (params.wall >= params.bottomArm) errors.push("壁厚は下辺長より小さくしてください。");
  if (params.bevel > params.wall * 0.45) errors.push("角Rは壁厚の45%以下が推奨です。");
  return errors;
}

function roundedRectPoints(x0, y0, x1, y1, radius, segments) {
  const r = Math.max(0, Math.min(radius, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2));
  if (r === 0) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const corners = [
    { cx: x1 - r, cy: y0 + r, a0: -Math.PI / 2, a1: 0 },
    { cx: x1 - r, cy: y1 - r, a0: 0, a1: Math.PI / 2 },
    { cx: x0 + r, cy: y1 - r, a0: Math.PI / 2, a1: Math.PI },
    { cx: x0 + r, cy: y0 + r, a0: Math.PI, a1: Math.PI * 1.5 },
  ];
  const points = [];
  for (const c of corners) {
    for (let i = 0; i <= segments; i += 1) {
      const a = c.a0 + ((c.a1 - c.a0) * i) / segments;
      points.push([c.cx + Math.cos(a) * r, c.cy + Math.sin(a) * r]);
    }
  }
  return points;
}

function buildUShapeMesh(params) {
  const w = Math.max(params.topArm, params.bottomArm, params.wall);
  const h = params.height;
  const t = params.wall;
  const d = params.depth;
  const r = Math.min(params.bevel, t * 0.35, w * 0.08, h * 0.08);
  const triangles = [];
  const faces = [];
  const outlinePoints = getOpenFrameOutline(params.topArm, h, params.bottomArm, t);
  const outline = roundedCornerPolygon(outlinePoints, r, params.quality).map(([x, y]) => [x - w / 2, y - h / 2]);
  addExtrudedPolygon(triangles, faces, outline, -d / 2, d / 2);
  const area = params.topArm * t + params.bottomArm * t + h * t - t * t * 2;
  return { triangles, faces, volumeMm3: area * d };
}

function toPrintOrientation(vertex) {
  return [vertex[0], vertex[2], vertex[1] + state.height / 2];
}

function getOpenFrameOutline(topArm, h, bottomArm, t) {
  const w = Math.max(topArm, bottomArm, t);
  const topLeft = w - topArm;
  const bottomLeft = w - bottomArm;
  return [
    [bottomLeft, 0],
    [w, 0],
    [w, h],
    [topLeft, h],
    [topLeft, h - t],
    [w - t, h - t],
    [w - t, t],
    [bottomLeft, t],
  ];
}

function roundedCornerPolygon(points, radius, quality) {
  if (radius <= 0) return points;
  const segments = Math.max(1, Math.round(quality) + 1);
  const output = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    const dPrev = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    const dNext = Math.hypot(next[0] - curr[0], next[1] - curr[1]);
    const cut = Math.min(radius, dPrev * 0.35, dNext * 0.35);
    const entry = [
      curr[0] + ((prev[0] - curr[0]) / dPrev) * cut,
      curr[1] + ((prev[1] - curr[1]) / dPrev) * cut,
    ];
    const exit = [
      curr[0] + ((next[0] - curr[0]) / dNext) * cut,
      curr[1] + ((next[1] - curr[1]) / dNext) * cut,
    ];
    for (let s = 0; s <= segments; s += 1) {
      const u = s / segments;
      const x = (1 - u) * (1 - u) * entry[0] + 2 * (1 - u) * u * curr[0] + u * u * exit[0];
      const y = (1 - u) * (1 - u) * entry[1] + 2 * (1 - u) * u * curr[1] + u * u * exit[1];
      output.push([x, y]);
    }
  }
  return output;
}

function addExtrudedPolygon(tris, faces, points, z0, z1) {
  const indices = triangulate(points);
  for (const [a, b, c] of indices) {
    tris.push([[points[a][0], points[a][1], z1], [points[b][0], points[b][1], z1], [points[c][0], points[c][1], z1]]);
    tris.push([[points[c][0], points[c][1], z0], [points[b][0], points[b][1], z0], [points[a][0], points[a][1], z0]]);
  }
  faces.push(points.map(([x, y]) => [x, y, z1]));
  faces.push([...points].reverse().map(([x, y]) => [x, y, z0]));
  for (let i = 0; i < points.length; i += 1) {
    const n = (i + 1) % points.length;
    const a = [points[i][0], points[i][1], z0];
    const b = [points[n][0], points[n][1], z0];
    const c = [points[n][0], points[n][1], z1];
    const d = [points[i][0], points[i][1], z1];
    tris.push([a, b, c]);
    tris.push([a, c, d]);
    faces.push([a, b, c, d]);
  }
}

function triangulate(points) {
  const remaining = points.map((_, i) => i);
  const triangles = [];
  const winding = polygonArea(points) > 0 ? 1 : -1;
  let guard = 0;
  while (remaining.length > 3 && guard < 1000) {
    guard += 1;
    let clipped = false;
    for (let i = 0; i < remaining.length; i += 1) {
      const prev = remaining[(i - 1 + remaining.length) % remaining.length];
      const curr = remaining[i];
      const next = remaining[(i + 1) % remaining.length];
      if (!isConvex(points[prev], points[curr], points[next], winding)) continue;
      const hasInside = remaining.some((idx) => idx !== prev && idx !== curr && idx !== next && pointInTriangle(points[idx], points[prev], points[curr], points[next]));
      if (hasInside) continue;
      triangles.push([prev, curr, next]);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const n = (i + 1) % points.length;
    area += points[i][0] * points[n][1] - points[n][0] * points[i][1];
  }
  return area / 2;
}

function isConvex(a, b, c, winding) {
  const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  return cross * winding > 0.000001;
}

function pointInTriangle(p, a, b, c) {
  const area = Math.abs(cross2(a, b, c));
  const a1 = Math.abs(cross2(p, a, b));
  const a2 = Math.abs(cross2(p, b, c));
  const a3 = Math.abs(cross2(p, c, a));
  return Math.abs(area - (a1 + a2 + a3)) < 0.0001;
}

function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function updateModel() {
  const errors = validateParams(state);
  mesh = buildUShapeMesh(state);
  updateStats(errors);
  draw();
  drawOrthographicViews();
}

function updateStats(errors) {
  const badge = document.getElementById("validityBadge");
  const card = document.getElementById("validationCard");
  const text = document.getElementById("validationText");
  const ok = errors.length === 0;
  badge.textContent = ok ? "検証完了" : "要調整";
  card.classList.toggle("invalid", !ok);
  card.querySelector("strong").textContent = ok ? "検証完了" : "要調整";
  text.textContent = ok ? "3Dプリント可能な閉じた形状です。" : errors[0];

  const summary = document.getElementById("summary");
  const innerHeight = getInnerHeight(state);
  const outerWidth = Math.max(state.topArm, state.bottomArm, state.wall);
  summary.innerHTML = [
    ["指定基準", state.dimensionMode === "inner" ? "内寸" : "外寸"],
    ["外幅 (最大)", `${outerWidth.toFixed(1)} mm`],
    ["上辺長", `${state.topArm.toFixed(1)} mm`],
    ["外高さ (H)", `${state.height.toFixed(1)} mm`],
    ["内高さ", `${innerHeight.toFixed(1)} mm`],
    ["下辺長", `${state.bottomArm.toFixed(1)} mm`],
    ["奥行き (D)", `${state.depth.toFixed(1)} mm`],
    ["壁厚 (T)", `${state.wall.toFixed(1)} mm`],
    ["角R (R)", `${Math.min(state.bevel, state.wall * 0.45).toFixed(1)} mm`],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");

  const volumeCm3 = mesh.volumeMm3 / 1000;
  document.getElementById("triCount").textContent = mesh.triangles.length.toLocaleString("ja-JP");
  document.getElementById("volume").textContent = `${volumeCm3.toFixed(2)} cm³`;
  document.getElementById("weight").textContent = `${(volumeCm3 * 1.24).toFixed(1)} g`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const item of Object.values(drawingCanvases)) {
    const itemRect = item.getBoundingClientRect();
    item.width = Math.round(itemRect.width * dpr);
    item.height = Math.round(itemRect.height * dpr);
    item.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  draw();
  drawOrthographicViews();
}

function rotatePoint([x, y, z]) {
  const cy = Math.cos(view.rotY);
  const sy = Math.sin(view.rotY);
  const cx = Math.cos(view.rotX);
  const sx = Math.sin(view.rotX);
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const y1 = y * cx - z1 * sx;
  const z2 = y * sx + z1 * cx;
  return [x1, y1, z2];
}

function getDimensionSegments() {
  const modelWidth = Math.max(state.topArm, state.bottomArm, state.wall);
  const w = modelWidth / 2;
  const h = state.height / 2;
  const d = state.depth / 2;
  const topStart = w - state.topArm;
  const bottomStart = w - state.bottomArm;
  return [
    { a: [-w, h + 10, d], b: [w, h + 10, d], label: `外幅 ${modelWidth.toFixed(1)}` },
    { a: [topStart, h + 3, d + 2], b: [w, h + 3, d + 2], label: `上辺 ${state.topArm.toFixed(1)}`, color: "#1d4ed8" },
    { a: [bottomStart, -h - 5, d + 2], b: [w, -h - 5, d + 2], label: `下辺 ${state.bottomArm.toFixed(1)}`, color: "#1d4ed8", labelOffset: 12 },
    { a: [w + 8, -h, d], b: [w + 8, h, d], label: `高さ ${state.height.toFixed(1)}` },
    { a: [w + 6, -h - 10, -d], b: [w + 6, -h - 10, d], label: `奥行 ${state.depth.toFixed(1)}` },
  ];
}

function getSceneFrame(width, height) {
  const points = mesh.faces.flat();
  if (view.showDims) {
    getDimensionSegments().forEach(({ a, b }) => points.push(a, b));
  }
  const projected = points.map(rotatePoint);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padding = Math.min(width, height) * 0.12;
  const fitScale = Math.min(
    (width - padding * 2) / Math.max(1, maxX - minX),
    (height - padding * 2) / Math.max(1, maxY - minY),
  );
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    scale: fitScale * view.zoom,
  };
}

function project(point, width, height, frame) {
  const [x, y, z] = rotatePoint(point);
  return {
    x: width / 2 + (x - frame.centerX) * frame.scale,
    y: height / 2 - (y - frame.centerY) * frame.scale,
    z,
  };
}

function draw() {
  if (!mesh) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  drawGrid(width, height);
  const frame = getSceneFrame(width, height);

  const sorted = mesh.faces
    .map((face) => {
      const pts = face.map((p) => project(p, width, height, frame));
      const depth = pts.reduce((sum, p) => sum + p.z, 0) / pts.length;
      return { pts, depth, shade: faceShade(face) };
    })
    .sort((a, b) => a.depth - b.depth);

  for (const item of sorted) {
    ctx.beginPath();
    ctx.moveTo(item.pts[0].x, item.pts[0].y);
    for (let i = 1; i < item.pts.length; i += 1) {
      ctx.lineTo(item.pts[i].x, item.pts[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = `hsl(42 13% ${item.shade}%)`;
    ctx.strokeStyle = "rgba(70, 75, 80, 0.14)";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }

  if (view.showDims) drawDimensions(width, height, frame);
}

function faceShade(tri) {
  const a = tri[0], b = tri[1], c = tri[2];
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  const light = (nx * -0.35 + ny * 0.65 + nz * 0.68) / len;
  return clamp(74 + light * 16, 54, 92);
}

function drawGrid(width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(55, 65, 81, 0.06)";
  ctx.lineWidth = 1;
  for (let x = -height; x < width + height; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height, height);
    ctx.stroke();
  }
  for (let x = 0; x < width + height; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - height, height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDimensions(width, height, frame) {
  getDimensionSegments().forEach((segment) => {
    drawDimension(segment, width, height, frame);
  });
}

function drawDimension(segment, width, height, frame) {
  const { a, b, label, color = "#111827", labelOffset = -10 } = segment;
  const pa = project(a, width, height, frame);
  const pb = project(b, width, height, frame);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
  ctx.font = "14px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelX = (pa.x + pb.x) / 2;
  const labelY = (pa.y + pb.y) / 2 + labelOffset;
  const metrics = ctx.measureText(label);
  ctx.fillStyle = "rgba(247, 249, 251, 0.88)";
  ctx.fillRect(labelX - metrics.width / 2 - 5, labelY - 9, metrics.width + 10, 18);
  ctx.fillStyle = color;
  ctx.fillText(label, labelX, labelY);
  ctx.restore();
}

function drawOrthographicViews() {
  drawFrontView(drawingCanvases.front);
  drawTopView(drawingCanvases.top);
  drawSideView(drawingCanvases.side);
}

function getCanvasSize(target) {
  return {
    width: target.clientWidth,
    height: target.clientHeight,
  };
}

function prepareDrawingCanvas(target) {
  const drawingCtx = target.getContext("2d");
  const { width, height } = getCanvasSize(target);
  drawingCtx.clearRect(0, 0, width, height);
  drawingCtx.fillStyle = "#ffffff";
  drawingCtx.fillRect(0, 0, width, height);
  drawingCtx.strokeStyle = "rgba(27, 34, 41, 0.06)";
  drawingCtx.lineWidth = 1;
  for (let x = 16; x < width; x += 16) {
    drawingCtx.beginPath();
    drawingCtx.moveTo(x, 0);
    drawingCtx.lineTo(x, height);
    drawingCtx.stroke();
  }
  for (let y = 16; y < height; y += 16) {
    drawingCtx.beginPath();
    drawingCtx.moveTo(0, y);
    drawingCtx.lineTo(width, y);
    drawingCtx.stroke();
  }
  return { drawingCtx, width, height };
}

function createPlanMapper(width, height, modelWidth, modelHeight, margin = 30) {
  const scale = Math.min((width - margin * 2) / Math.max(1, modelWidth), (height - margin * 2) / Math.max(1, modelHeight));
  const x0 = (width - modelWidth * scale) / 2;
  const y0 = (height + modelHeight * scale) / 2;
  return {
    scale,
    point: (x, y) => ({ x: x0 + x * scale, y: y0 - y * scale }),
  };
}

function drawPlanPolygon(drawingCtx, mapper, points, fill = "#f2eee6") {
  drawingCtx.beginPath();
  points.forEach(([x, y], index) => {
    const p = mapper.point(x, y);
    if (index === 0) drawingCtx.moveTo(p.x, p.y);
    else drawingCtx.lineTo(p.x, p.y);
  });
  drawingCtx.closePath();
  drawingCtx.fillStyle = fill;
  drawingCtx.strokeStyle = "#2d333a";
  drawingCtx.lineWidth = 1.5;
  drawingCtx.fill();
  drawingCtx.stroke();
}

function drawPlanDimension(drawingCtx, mapper, a, b, label, offsetX = 0, offsetY = 0) {
  const pa = mapper.point(a[0], a[1]);
  const pb = mapper.point(b[0], b[1]);
  const ax = pa.x + offsetX;
  const ay = pa.y + offsetY;
  const bx = pb.x + offsetX;
  const by = pb.y + offsetY;
  drawingCtx.save();
  drawingCtx.strokeStyle = "#1d4ed8";
  drawingCtx.fillStyle = "#1d4ed8";
  drawingCtx.lineWidth = 1;
  drawingCtx.beginPath();
  drawingCtx.moveTo(ax, ay);
  drawingCtx.lineTo(bx, by);
  drawingCtx.stroke();
  drawingCtx.beginPath();
  drawingCtx.moveTo(pa.x, pa.y);
  drawingCtx.lineTo(ax, ay);
  drawingCtx.moveTo(pb.x, pb.y);
  drawingCtx.lineTo(bx, by);
  drawingCtx.stroke();
  drawingCtx.font = "12px Inter, system-ui, sans-serif";
  drawingCtx.textAlign = "center";
  drawingCtx.textBaseline = "middle";
  const labelX = (ax + bx) / 2;
  const labelY = (ay + by) / 2;
  const metrics = drawingCtx.measureText(label);
  drawingCtx.fillStyle = "rgba(255, 255, 255, 0.92)";
  drawingCtx.fillRect(labelX - metrics.width / 2 - 4, labelY - 8, metrics.width + 8, 16);
  drawingCtx.fillStyle = "#1d4ed8";
  drawingCtx.fillText(label, labelX, labelY);
  drawingCtx.restore();
}

function drawHiddenLine(drawingCtx, mapper, a, b) {
  const pa = mapper.point(a[0], a[1]);
  const pb = mapper.point(b[0], b[1]);
  drawingCtx.save();
  drawingCtx.setLineDash([4, 4]);
  drawingCtx.strokeStyle = "#8b96a3";
  drawingCtx.lineWidth = 1;
  drawingCtx.beginPath();
  drawingCtx.moveTo(pa.x, pa.y);
  drawingCtx.lineTo(pb.x, pb.y);
  drawingCtx.stroke();
  drawingCtx.restore();
}

function drawFrontView(target) {
  const { drawingCtx, width, height } = prepareDrawingCanvas(target);
  const modelWidth = Math.max(state.topArm, state.bottomArm, state.wall);
  const outline = getOpenFrameOutline(state.topArm, state.height, state.bottomArm, state.wall);
  const mapper = createPlanMapper(width, height, modelWidth, state.height, 32);
  drawPlanPolygon(drawingCtx, mapper, outline);
  drawPlanDimension(drawingCtx, mapper, [0, state.height], [modelWidth, state.height], `${modelWidth.toFixed(1)}`, 0, -18);
  drawPlanDimension(drawingCtx, mapper, [modelWidth, 0], [modelWidth, state.height], `${state.height.toFixed(1)}`, 20, 0);
  drawPlanDimension(drawingCtx, mapper, [modelWidth - state.wall, state.wall], [modelWidth, state.wall], `T ${state.wall.toFixed(1)}`, 0, 16);
}

function drawTopView(target) {
  const { drawingCtx, width, height } = prepareDrawingCanvas(target);
  const modelWidth = Math.max(state.topArm, state.bottomArm, state.wall);
  const mapper = createPlanMapper(width, height, modelWidth, state.depth, 32);
  drawPlanPolygon(drawingCtx, mapper, [[0, 0], [modelWidth, 0], [modelWidth, state.depth], [0, state.depth]], "#eef3f8");
  const topLeft = modelWidth - state.topArm;
  const bottomLeft = modelWidth - state.bottomArm;
  drawHiddenLine(drawingCtx, mapper, [topLeft, 0], [topLeft, state.depth]);
  drawHiddenLine(drawingCtx, mapper, [bottomLeft, 0], [bottomLeft, state.depth]);
  drawPlanDimension(drawingCtx, mapper, [0, state.depth], [modelWidth, state.depth], `${modelWidth.toFixed(1)}`, 0, -16);
  drawPlanDimension(drawingCtx, mapper, [modelWidth, 0], [modelWidth, state.depth], `D ${state.depth.toFixed(1)}`, 18, 0);
}

function drawSideView(target) {
  const { drawingCtx, width, height } = prepareDrawingCanvas(target);
  const mapper = createPlanMapper(width, height, state.depth, state.height, 32);
  drawPlanPolygon(drawingCtx, mapper, [[0, 0], [state.depth, 0], [state.depth, state.height], [0, state.height]], "#f3f0e8");
  drawHiddenLine(drawingCtx, mapper, [0, state.wall], [state.depth, state.wall]);
  drawHiddenLine(drawingCtx, mapper, [0, state.height - state.wall], [state.depth, state.height - state.wall]);
  drawPlanDimension(drawingCtx, mapper, [0, state.height], [state.depth, state.height], `D ${state.depth.toFixed(1)}`, 0, -16);
  drawPlanDimension(drawingCtx, mapper, [state.depth, 0], [state.depth, state.height], `${state.height.toFixed(1)}`, 18, 0);
}

function triangleNormal(tri) {
  const a = tri[0], b = tri[1], c = tri[2];
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function makeStl() {
  const lines = ["solid konoji_bracket"];
  for (const tri of mesh.triangles) {
    const printTri = tri.map(toPrintOrientation);
    const n = triangleNormal(printTri);
    lines.push(`  facet normal ${n[0].toFixed(6)} ${n[1].toFixed(6)} ${n[2].toFixed(6)}`);
    lines.push("    outer loop");
    for (const v of printTri) lines.push(`      vertex ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }
  lines.push("endsolid konoji_bracket");
  return lines.join("\n");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function syncControlValues() {
  for (const def of controlDefs) {
    const value = getControlValue(def.key);
    const min = getControlMin(def.key, def.min);
    const label = getControlLabel(def);
    const range = document.getElementById(`${def.key}Range`);
    const input = document.getElementById(`${def.key}Input`);
    range.min = min;
    input.min = min;
    range.value = value;
    input.value = value;
    range.setAttribute("aria-label", label);
    input.setAttribute("aria-label", `${label}の数値`);
    document.querySelector(`[data-label-for="${def.key}"]`).textContent = label;
    document.querySelector(`[data-limits-for="${def.key}"]`).textContent = `${min}-${def.max}`;
  }
  document.querySelector(`input[name="dimensionMode"][value="${state.dimensionMode}"]`).checked = true;
}

function getInnerHeight(params) {
  return Math.max(0, params.height - params.wall * 2);
}

canvas.addEventListener("pointerdown", (event) => {
  dragStart = { x: event.clientX, y: event.clientY, rotX: view.rotX, rotY: view.rotY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragStart) return;
  view.rotY = dragStart.rotY + (event.clientX - dragStart.x) * 0.01;
  view.rotX = clamp(dragStart.rotX + (event.clientY - dragStart.y) * 0.01, -1.2, 0.2);
  draw();
});

canvas.addEventListener("pointerup", () => {
  dragStart = null;
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  view.zoom = clamp(view.zoom - event.deltaY * 0.001, 0.35, 1.8);
  draw();
}, { passive: false });

document.getElementById("downloadStl").addEventListener("click", () => {
  updateModel();
  download(`konoji-${state.topArm}-${state.height}-${state.bottomArm}x${state.depth}.stl`, makeStl(), "model/stl");
});

document.getElementById("downloadJson").addEventListener("click", () => {
  download("konoji-settings.json", JSON.stringify(state, null, 2), "application/json");
});

document.getElementById("resetParams").addEventListener("click", () => {
  Object.assign(state, defaults);
  syncControlValues();
  updateModel();
});

document.querySelectorAll('input[name="dimensionMode"]').forEach((input) => {
  input.addEventListener("change", (event) => {
    state.dimensionMode = event.target.value;
    syncControlValues();
    updateModel();
  });
});

document.getElementById("resetView").addEventListener("click", () => {
  Object.assign(view, { rotX: -0.36, rotY: 0.58, zoom: 0.86, showDims: view.showDims });
  draw();
});

document.getElementById("toggleDims").addEventListener("click", (event) => {
  view.showDims = !view.showDims;
  event.currentTarget.classList.toggle("active", view.showDims);
  draw();
});

document.getElementById("rotateLeft").addEventListener("click", () => {
  view.rotY -= 0.35;
  draw();
});

document.getElementById("zoomIn").addEventListener("click", () => {
  view.zoom = clamp(view.zoom + 0.12, 0.35, 1.8);
  draw();
});

document.getElementById("zoomOut").addEventListener("click", () => {
  view.zoom = clamp(view.zoom - 0.12, 0.35, 1.8);
  draw();
});

window.addEventListener("resize", resizeCanvas);

buildControls();
updateModel();
resizeCanvas();

window.__konoji = {
  getState: () => ({ ...state }),
  getMeshStats: () => ({ triangles: mesh.triangles.length, volumeMm3: mesh.volumeMm3 }),
  makeStl,
};
