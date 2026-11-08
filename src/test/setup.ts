import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

Object.defineProperty(globalThis, "window", {
  value: dom.window,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "document", {
  value: dom.window.document,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "localStorage", {
  value: dom.window.localStorage,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "sessionStorage", {
  value: dom.window.sessionStorage,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "HTMLElement", {
  value: dom.window.HTMLElement,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "Node", {
  value: dom.window.Node,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "Storage", {
  value: dom.window.Storage,
  configurable: true,
  writable: true,
});

const fileBase = `file://${process.cwd()}/`;
const pgliteSource = `file://${process.cwd()}/node_modules/@electric-sql/pglite/dist/index.js`;

Object.defineProperty(dom.window.document, "baseURI", {
  value: fileBase,
  configurable: true,
});

const pgliteScript = dom.window.document.createElement("script");
pgliteScript.src = pgliteSource;
Object.defineProperty(dom.window.document, "currentScript", {
  value: pgliteScript,
  configurable: true,
});

const raf = (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(Date.now()), 0);
const caf = (id: number) => dom.window.clearTimeout(id);

Object.defineProperty(dom.window, "requestAnimationFrame", {
  value: raf,
  configurable: true,
  writable: true,
});

Object.defineProperty(dom.window, "cancelAnimationFrame", {
  value: caf,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "requestAnimationFrame", {
  value: raf,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "cancelAnimationFrame", {
  value: caf,
  configurable: true,
  writable: true,
});

Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
  value: () => {},
  configurable: true,
  writable: true,
});

const ensureArrayBufferPolyfill = (Ctor: typeof Blob | typeof File | undefined) => {
  if (!Ctor || typeof (Ctor as typeof Blob).prototype?.arrayBuffer === "function") return;
  (Ctor as typeof Blob).prototype.arrayBuffer = function arrayBuffer() {
    return new Response(this).arrayBuffer();
  };
};

ensureArrayBufferPolyfill(dom.window.Blob);
ensureArrayBufferPolyfill(dom.window.File);
ensureArrayBufferPolyfill(globalThis.Blob);
ensureArrayBufferPolyfill(globalThis.File);
