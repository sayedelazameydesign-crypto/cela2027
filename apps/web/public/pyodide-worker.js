/* eslint-disable */
// cela2027 — Pyodide sandbox worker
// Runs user Python inside the browser tab (WASM isolation, zero server cost).
let pyodide = null;
let loading = null;
let runNumber = 0;

async function getPyodide() {
  if (pyodide) return pyodide;
  if (!loading) {
    loading = (async () => {
      importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
      pyodide = await loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
      });
      return pyodide;
    })();
  }
  return loading;
}

function decodeBase64(value) {
  if (typeof value !== "string" || value.length > 7_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid binary file encoding");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function syncFiles(py, files) {
  // Each run gets a fresh directory; no stale files are visible through relative paths.
  const root = `/tmp/cela-run-${++runNumber}`;
  py.FS.mkdir(root);
  if (files === undefined) files = {};
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("Invalid sandbox files");
  }
  const entries = Object.entries(files);
  if (entries.length > 1000) throw new Error("Too many sandbox files");
  let total = 0;
  for (const [path, value] of entries) {
    if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((s) => !s || s === "." || s === "..")) {
      throw new Error(`Invalid sandbox path: ${path}`);
    }
    const bytes = typeof value === "string"
      ? new TextEncoder().encode(value)
      : value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1
        ? decodeBase64(value.base64)
        : (() => { throw new Error(`Invalid sandbox file: ${path}`); })();
    total += bytes.length;
    if (total > 5_000_000) throw new Error("Sandbox files exceed 5 MB");
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir += `/${part}`;
      try { py.FS.mkdir(dir); } catch (err) {
        if (err.code !== "EEXIST") throw err;
      }
    }
    py.FS.writeFile(`${root}/${path}`, bytes);
  }
  py.FS.chdir(root);
}

self.onmessage = async (e) => {
  const { runId, code, files } = e.data || {};
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let ok = false;

  try {
    const py = await getPyodide();
    syncFiles(py, files);
    py.setStdout({ batched: (s) => (stdout += s + "\n") });
    py.setStderr({ batched: (s) => (stderr += s + "\n") });
    await py.runPythonAsync(code);
    ok = true;
  } catch (err) {
    stderr += String(err && err.message ? err.message : err);
  }

  self.postMessage({
    runId,
    ok,
    stdout: stdout.trimEnd(),
    stderr: stderr.trimEnd(),
    durationMs: Date.now() - started,
  });
};
