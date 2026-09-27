/* eslint-disable */
// cela2027 — Pyodide sandbox worker
// Runs user Python inside the browser tab (WASM isolation, zero server cost).
let pyodide = null;
let loading = null;

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

self.onmessage = async (e) => {
  const { runId, code } = e.data || {};
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let ok = false;

  try {
    const py = await getPyodide();
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
