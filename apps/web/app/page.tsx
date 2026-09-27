"use client";

/**
 * Cela 2027 — Manus-style dashboard (Arabic RTL, dark):
 * right side = chat + live execution timeline, left side = produced files.
 * Python steps run in the user's browser via the Pyodide worker.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, Plan, Evidence } from "@cela/core";

type StepState = {
  id: string;
  title: string;
  tool: string;
  status?: string;
  evidence?: Evidence[];
  error?: string;
};

type SandboxRequestEvent = Extract<AgentEvent, { type: "sandbox_request" }>;

const STATUS_LABEL: Record<string, string> = {
  PLANNING: "جارٍ التخطيط",
  RUNNING: "قيد التنفيذ",
  AWAITING_SANDBOX: "بانتظار الصندوق",
  VERIFIED: "مُوثَّق بالأدلة",
  FAILED: "فشل",
  DENIED: "مرفوض بالسياسة",
};

const STATUS_STYLE: Record<string, string> = {
  PLANNING: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  RUNNING: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  AWAITING_SANDBOX: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  VERIFIED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  FAILED: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  DENIED: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const EXAMPLES = [
  "ابنِ لي مشروع Python فيه أدوات رياضية مع اختبارات وشغّلها",
  "أنشئ ملف تحليل بيانات بسيط وطبع نتيجته داخل الصندوق",
  "اكتب موديول تشفير بسيط مع اختبارات شاملة ونفّذها",
];

export default function Home() {
  const [goal, setGoal] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sandboxLog, setSandboxLog] = useState<string>("");
  const workerRef = useRef<Worker | null>(null);
  const stepsEndRef = useRef<HTMLDivElement | null>(null);

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker("/pyodide-worker.js");
    }
    return workerRef.current;
  }, []);

  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps, status]);

  const handleSandboxRequest = useCallback(
    (ev: SandboxRequestEvent, tid: string) => {
      const worker = ensureWorker();
      const onMessage = (msg: MessageEvent) => {
        const d = msg.data || {};
        if (d.runId !== ev.runId) return;
        worker.removeEventListener("message", onMessage);
        setSandboxLog(
          (d.stdout || "") + (d.stderr ? `\n⚠ ${d.stderr}` : "")
        );
        fetch(`/api/task/${tid}/sandbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(d),
        }).catch(() => {});
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ runId: ev.runId, code: ev.code });
    },
    [ensureWorker]
  );

  const startTask = useCallback(async () => {
    const g = goal.trim();
    if (!g || running) return;
    setRunning(true);
    setPlan(null);
    setSteps({});
    setFiles({});
    setSummary("");
    setSandboxLog("");
    setSelectedFile(null);
    setStatus("PLANNING");
    try {
      const res = await fetch("/api/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: g }),
      });
      const data = await res.json();
      if (!res.ok || !data.taskId) throw new Error(data.error || "تعذر بدء المهمة");
      const tid = data.taskId as string;
      setTaskId(tid);

      const es = new EventSource(`/api/task/${tid}/stream`);
      es.onmessage = (m) => {
        let e: AgentEvent;
        try {
          e = JSON.parse(m.data);
        } catch {
          return;
        }
        switch (e.type) {
          case "task_status":
            setStatus(e.status);
            break;
          case "plan_created":
            setPlan(e.plan);
            break;
          case "agent_message":
            setSummary(e.content);
            break;
          case "step_started":
            setSteps((prev) => ({
              ...prev,
              [e.stepId]: { id: e.stepId, title: e.title, tool: e.tool },
            }));
            break;
          case "step_finished":
            setSteps((prev) => ({
              ...prev,
              [e.stepId]: { ...prev[e.stepId], status: e.status, evidence: e.evidence, error: e.error },
            }));
            break;
          case "sandbox_request":
            handleSandboxRequest(e, tid);
            break;
          case "artifact":
            setFiles((prev) => ({ ...prev, [e.path]: e.content }));
            setSelectedFile((cur) => cur ?? e.path);
            break;
          case "task_finished":
            setStatus(e.status);
            setSummary(e.summary);
            setRunning(false);
            es.close();
            break;
        }
      };
      es.onerror = () => {
        es.close();
        setRunning(false);
      };
    } catch (err: any) {
      setSummary(String(err?.message ?? err));
      setStatus("FAILED");
      setRunning(false);
    }
  }, [goal, running, handleSandboxRequest]);

  const downloadFile = (path: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = path.split("/").pop() || "file.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadAll = () => {
    const blob = new Blob([JSON.stringify({ taskId, files }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cela2027-${taskId ?? "workspace"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filePaths = Object.keys(files);
  const stepList = Object.values(steps);

  return (
    <main className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-celia-400 to-celia-600 text-lg font-black text-ink-950">
            C
          </div>
          <div>
            <h1 className="text-lg font-bold">Cela 2027</h1>
            <p className="text-xs text-slate-500">وكيل مستقل — يخطط، ينفّذ، يتحقق بالأدلة</p>
          </div>
        </div>
        {status && (
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLE[status] ?? ""}`}>
            {STATUS_LABEL[status] ?? status}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        {/* Files panel (left on desktop) */}
        <aside className="flex min-h-[40vh] w-full flex-col border-l border-ink-700 bg-ink-900 lg:h-auto lg:w-[38%]">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2">
            <h2 className="text-sm font-bold text-slate-300">
              ملفات مساحة العمل{" "}
              <span className="text-slate-500">({filePaths.length})</span>
            </h2>
            {filePaths.length > 0 && (
              <button
                onClick={downloadAll}
                className="rounded-md border border-celia-500/40 bg-celia-500/10 px-2.5 py-1 text-xs font-semibold text-celia-300 hover:bg-celia-500/20"
              >
                تنزيل المشروع
              </button>
            )}
          </div>
          {filePaths.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-600">
              ستظهر الملفات المُنتَجة هنا أثناء التنفيذ
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <ul className="w-44 shrink-0 overflow-y-auto border-l border-ink-700 p-2">
                {filePaths.map((p) => (
                  <li key={p}>
                    <button
                      onClick={() => setSelectedFile(p)}
                      className={`w-full truncate rounded px-2 py-1.5 text-right text-xs font-mono ${
                        selectedFile === p
                          ? "bg-celia-500/15 text-celia-300"
                          : "text-slate-400 hover:bg-ink-700"
                      }`}
                      title={p}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="min-w-0 flex-1 overflow-auto p-3">
                {selectedFile && files[selectedFile] !== undefined && (
                  <>
                    <div className="mb-2 flex justify-end">
                      <button
                        onClick={() => downloadFile(selectedFile, files[selectedFile])}
                        className="rounded border border-ink-600 px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200"
                      >
                        تنزيل الملف
                      </button>
                    </div>
                    <pre className="rounded-lg bg-ink-950 p-3 text-[12px] leading-relaxed text-slate-300">
                      {files[selectedFile]}
                    </pre>
                  </>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Chat + timeline (right) */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-8">
            {!taskId && (
              <div className="mx-auto mt-10 max-w-xl text-center">
                <h2 className="text-2xl font-black text-slate-100">
                  ماذا تريد أن أبني لك اليوم؟
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  اكتب هدفاً — سأخطط، أنفّذ داخل صندوق معزول، وأوثّق النتيجة بالأدلة.
                </p>
              </div>
            )}

            {goal && taskId && (
              <div className="mx-auto max-w-2xl space-y-4">
                {/* user goal */}
                <div className="rounded-2xl rounded-tr-sm border border-ink-600 bg-ink-800 p-4">
                  <p className="mb-1 text-[11px] font-semibold text-celia-300">الهدف</p>
                  <p className="text-sm text-slate-200">{goal}</p>
                </div>

                {/* plan */}
                {plan && (
                  <div className="rounded-2xl border border-ink-600 bg-ink-900 p-4">
                    <p className="mb-1 text-[11px] font-semibold text-celia-300">الخطة</p>
                    <p className="text-sm text-slate-300">{plan.summary}</p>
                    <p className="mt-1 text-xs text-slate-500">{plan.steps.length} خطوات</p>
                  </div>
                )}

                {/* timeline */}
                <ol className="space-y-2">
                  {stepList.map((s) => (
                    <li
                      key={s.id}
                      className={`rounded-xl border p-3 ${
                        s.status === "VERIFIED"
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : s.status === "FAILED" || s.status === "DENIED"
                            ? "border-rose-500/30 bg-rose-500/5"
                            : "border-ink-600 bg-ink-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-200">{s.title}</span>
                        <span className="shrink-0 rounded bg-ink-700 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                          {s.tool}
                        </span>
                      </div>
                      {s.status === "VERIFIED" && s.evidence && (
                        <p className="mt-1 text-[11px] text-emerald-400/80">
                          ✓ {s.evidence[0]?.detail}
                        </p>
                      )}
                      {s.error && (
                        <p className="mt-1 text-[11px] text-rose-400">{s.error}</p>
                      )}
                    </li>
                  ))}
                  <div ref={stepsEndRef} />
                </ol>

                {/* sandbox output */}
                {sandboxLog && (
                  <div className="rounded-2xl border border-ink-600 bg-ink-950 p-3">
                    <p className="mb-1 text-[11px] font-semibold text-purple-300">
                      مخرجات صندوق Python
                    </p>
                    <pre className="whitespace-pre-wrap text-[12px] text-slate-300">{sandboxLog}</pre>
                  </div>
                )}

                {/* final summary */}
                {status && ["VERIFIED", "FAILED", "DENIED"].includes(status) && (
                  <div
                    className={`rounded-2xl border p-4 ${
                      status === "VERIFIED"
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : "border-rose-500/30 bg-rose-500/10"
                    }`}
                  >
                    <p className="text-sm font-semibold">
                      {status === "VERIFIED" ? "اكتملت المهمة — مُوثَّقة بالأدلة ✓" : "انتهت المهمة بحالة: " + (STATUS_LABEL[status] ?? status)}
                    </p>
                    {summary && <p className="mt-1 text-xs text-slate-400">{summary}</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* input */}
          <div className="border-t border-ink-700 bg-ink-900 p-4">
            {!taskId ? (
              <div className="mx-auto max-w-2xl">
                <div className="mb-2 flex flex-wrap gap-2">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setGoal(ex)}
                      className="rounded-full border border-ink-600 px-3 py-1 text-[11px] text-slate-400 hover:border-celia-500/40 hover:text-celia-300"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && startTask()}
                    placeholder="مثال: ابنِ لي مشروع Python فيه أدوات رياضية مع اختبارات…"
                    className="flex-1 rounded-xl border border-ink-600 bg-ink-800 px-4 py-3 text-sm outline-none placeholder:text-slate-600 focus:border-celia-500/50"
                  />
                  <button
                    onClick={startTask}
                    disabled={!goal.trim() || running}
                    className="rounded-xl bg-celia-500 px-5 py-3 text-sm font-bold text-ink-950 hover:bg-celia-400 disabled:opacity-40"
                  >
                    نفّذ
                  </button>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-2xl items-center justify-between">
                <p className="text-xs text-slate-500">
                  {running ? "الوكيل يعمل الآن…" : "اكتملت المهمة — ابدأ هدفاً جديداً"}
                </p>
                <button
                  onClick={() => {
                    setTaskId(null);
                    setGoal("");
                    setStatus("");
                    setPlan(null);
                    setSteps({});
                    setFiles({});
                    setSummary("");
                    setSandboxLog("");
                  }}
                  className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-slate-300 hover:border-celia-500/40"
                >
                  مهمة جديدة
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
