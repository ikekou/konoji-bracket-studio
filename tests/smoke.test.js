const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor(tagName, id = "") {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.min = "";
    this.max = "";
    this.checked = false;
    this.style = {};
    this.attributes = {};
    this.classList = {
      values: new Set(),
      toggle: (name, force) => {
        const enabled = force ?? !this.classList.values.has(name);
        if (enabled) this.classList.values.add(name);
        else this.classList.values.delete(name);
      },
    };
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  remove() {}

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  setPointerCapture() {}

  getBoundingClientRect() {
    return { width: 320, height: 180 };
  }

  querySelector(selector) {
    if (selector === "strong") return fakeDocument.getElementById(`${this.id}Strong`);
    const id = selector.match(/^#(.+)$/)?.[1];
    return id ? fakeDocument.getElementById(id) : fakeDocument.createElement("span");
  }

  set innerHTML(value) {
    this._innerHTML = value;
    const ids = [...value.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    for (const id of ids) fakeDocument.getElementById(id);
  }

  get innerHTML() {
    return this._innerHTML || "";
  }
}

class FakeCanvas extends FakeElement {
  constructor(id, width = 320, height = 180) {
    super("canvas", id);
    this.width = width;
    this.height = height;
    this.context = new FakeCanvasContext();
  }

  getContext() {
    return this.context;
  }
}

class FakeCanvasContext {
  constructor() {
    this.calls = [];
  }

  record(name) {
    this.calls.push(name);
  }

  setTransform() { this.record("setTransform"); }
  clearRect() { this.record("clearRect"); }
  fillRect() { this.record("fillRect"); }
  beginPath() { this.record("beginPath"); }
  moveTo() { this.record("moveTo"); }
  lineTo() { this.record("lineTo"); }
  closePath() { this.record("closePath"); }
  fill() { this.record("fill"); }
  stroke() { this.record("stroke"); }
  save() { this.record("save"); }
  restore() { this.record("restore"); }
  setLineDash() { this.record("setLineDash"); }
  fillText() { this.record("fillText"); }
  measureText(text) { return { width: String(text).length * 7 }; }
}

const elements = new Map();
const radioInputs = [
  Object.assign(new FakeElement("input"), { value: "outer", checked: true }),
  Object.assign(new FakeElement("input"), { value: "inner", checked: false }),
];

const fakeDocument = {
  body: new FakeElement("body"),
  createElement(tagName) {
    return tagName === "canvas" ? new FakeCanvas("") : new FakeElement(tagName);
  },
  getElementById(id) {
    if (!elements.has(id)) {
      const isCanvas = id === "previewCanvas" || id.endsWith("ViewCanvas");
      const element = isCanvas ? new FakeCanvas(id) : new FakeElement("div", id);
      if (id === "previewCanvas") {
        element.getBoundingClientRect = () => ({ width: 900, height: 560 });
      }
      elements.set(id, element);
    }
    return elements.get(id);
  },
  querySelector(selector) {
    const labelMatch = selector.match(/^\[data-label-for="([^"]+)"\]$/);
    if (labelMatch) return this.getElementById(`${labelMatch[1]}Label`);
    const limitMatch = selector.match(/^\[data-limits-for="([^"]+)"\]$/);
    if (limitMatch) return this.getElementById(`${limitMatch[1]}Limits`);
    const radioMatch = selector.match(/^input\[name="dimensionMode"\]\[value="([^"]+)"\]$/);
    if (radioMatch) return radioInputs.find((input) => input.value === radioMatch[1]);
    return this.createElement("div");
  },
  querySelectorAll(selector) {
    if (selector === 'input[name="dimensionMode"]') return radioInputs;
    return [];
  },
};

const fakeWindow = {
  devicePixelRatio: 1,
  listeners: {},
  addEventListener(type, handler) {
    this.listeners[type] = handler;
  },
  URL: {
    createObjectURL: () => "blob:test",
    revokeObjectURL: () => {},
  },
};

const context = {
  Blob: class Blob {
    constructor(parts) {
      this.parts = parts;
    }
  },
  URL: fakeWindow.URL,
  console,
  document: fakeDocument,
  window: fakeWindow,
};

vm.createContext(context);
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
vm.runInContext(appSource, context, { filename: "app.js" });

const stats = context.window.__konoji.getMeshStats();
assert.equal(stats.triangles, 28);
assert.equal(stats.volumeMm3, 2720);
assert.match(context.window.__konoji.makeStl(), /^solid konoji_bracket\n/);

for (const id of ["previewCanvas", "frontViewCanvas", "topViewCanvas", "sideViewCanvas"]) {
  const calls = fakeDocument.getElementById(id).getContext("2d").calls;
  assert.ok(calls.includes("fill"), `${id} should draw filled geometry`);
  assert.ok(calls.includes("stroke"), `${id} should draw outlines`);
}

const toggleDims = fakeDocument.getElementById("toggleDims");
toggleDims.listeners.click({ currentTarget: toggleDims });

const resetParams = fakeDocument.getElementById("resetParams");
resetParams.listeners.click();
assert.equal(context.window.__konoji.getState().topArm, 21);

console.log("smoke tests passed");
