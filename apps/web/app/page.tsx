"use client";

/**
 * Cela 2027 — futuristic Manus-style dashboard (Arabic RTL, dark):
 * 3D glowing pipeline network on top, chat + live execution timeline,
 * produced files viewer. Python steps run in the browser via Pyodide.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, Plan, Evidence } from "@cela/core";
import NetworkGraph, { type PipelineId } from "@/components/NetworkGraph";

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
  PLANNING: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  RUNNING: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  AWAITING_SANDBOX: "border-purple-400/40 bg-purple-400/10 text-purple-300",
  VERIFIED: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  FAILED: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  DENIED: "border-rose-400/40 bg-rose-400/10 text-rose-300",
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
  const [activeNode, setActiveNode] = useState<PipelineId | null>(null);
  const [failed, setFailed] = useState(false);
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
    setFailed(false);
    setActiveNode("goal");
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
          case "task_started":
            setActiveNode("goal");
            break;
          case "task_status":
            setStatus(e.status);
            if (e.status === "PLANNING") setActiveNode("plan");
            else if (e.status === "RUNNING") setActiveNode("execute");
            break;
          case "plan_created":
            setPlan(e.plan);
            setActiveNode("plan");
            break;
          case "agent_message":
            setSummary(e.content);
            break;
          case "step_started":
            setSteps((prev) => ({
              ...prev,
              [e.stepId]: { id: e.stepId, title: e.title, tool: e.tool },
            }));
            setActiveNode("execute");
            break;
          case "step_finished":
            setSteps((prev) => ({
              ...prev,
              [e.stepId]: { ...prev[e.stepId], status: e.status, evidence: e.evidence, error: e.error },
            }));
            if (e.status === "FAILED" || e.status === "DENIED") {
              setFailed(true);
              setActiveNode("execute");
            } else {
              setActiveNode("verify");
            }
            break;
          case "sandbox_request":
            handleSandboxRequest(e, tid);
            break;
          case "artifact":
            setFiles((prev) => ({ ...prev, [e.path]: e.content }));
            setSelectedFile((cur) => cur ?? e.path);
            setActiveNode("evidence");
            break;
          case "task_finished":
            setStatus(e.status);
            setSummary(e.summary);
            setRunning(false);
            if (e.status === "VERIFIED") setActiveNode("evidence");
            else {
              setFailed(true);
              setActiveNode("goal");
            }
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
      setFailed(true);
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
    <main className="flex h-screen flex-col bg-[#050816] text-slate-200">
      {/* Header */}
      <header className="sticky top-0 z-50 shrink-0 border-b border-cyan-500/25 bg-[#050816]/85 backdrop-blur">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 text-lg font-black text-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.45)]">
              ◆
            </div>
            <div>
              <h1 className="bg-gradient-to-r from-cyan-300 to-blue-500 bg-clip-text text-xl font-black text-transparent">
                Cela 2027
              </h1>
              <p className="text-[11px] text-cyan-500/80">CeliaOS — وكيل مستقل: يخطط، ينفّذ، يتحقق بالأدلة</p>
            </div>
          </div>
          {status && (
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLE[status] ?? ""}`}>
              {STATUS_LABEL[status] ?? status}
            </span>
          )}
        </div>
      </header>

      {/* 3D pipeline network */}
      <div className="relative h-40 shrink-0 border-b border-cyan-500/20 bg-grid lg:h-44">
        <NetworkGraph active={activeNode} failed={failed} />
        <div className="pointer-events-none absolute bottom-2 right-0 left-0 text-center text-[10px] tracking-wide text-cyan-500/60">
          خط أنابيب الوكيل: الهدف ← الخطة ← السياسة ← التنفيذ ← التحقق ← الأدلة
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        {/* Files panel */}
        <aside className="flex min-h-[38vh] w-full flex-col border-l border-cyan-500/20 bg-[#070b1a]/80 lg:h-auto lg:w-[38%]">
          <div className="flex items-center justify-between border-b border-cyan-500/20 px-4 py-2">
            <h2 className="text-sm font-bold text-cyan-300">
              ملفات مساحة العمل{" "}
              <span className="text-slate-500">({filePaths.length})</span>
            </h2>
            {filePaths.length > 0 && (
              <button
                onClick={downloadAll}
                className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold text-cyan-300 hover:bg-cyan-400/20"
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
              <ul className="w-44 shrink-0 overflow-y-auto border-l border-cyan-500/20 p-2">
                {filePaths.map((p) => (
                  <li key={p}>
                    <button
                      onClick={() => setSelectedFile(p)}
                      className={`w-full truncate rounded px-2 py-1.5 text-right text-xs font-mono ${
                        selectedFile === p
                          ? "bg-cyan-400/15 text-cyan-300"
                          : "text-slate-400 hover:bg-slate-800/60"
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
                        className="rounded border border-cyan-500/25 px-2 py-0.5 text-[11px] text-slate-400 hover:text-cyan-300"
                      >
                        تنزيل الملف
                      </button>
                    </div>
                    <pre className="rounded-lg border border-cyan-500/15 bg-[#050816] p-3 text-[12px] leading-relaxed text-slate-300">
                      {files[selectedFile]}
                    </pre>
                  </>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Chat + timeline */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-8">
            {!taskId && (
              <div className="mx-auto mt-8 max-w-xl text-center">
                <h2 className="bg-gradient-to-r from-cyan-200 to-blue-400 bg-clip-text text-2xl font-black text-transparent">
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
                <div className="rounded-2xl rounded-tr-sm border border-cyan-400/40 bg-cyan-400/10 p-4">
                  <p className="mb-1 text-[11px] font-semibold text-cyan-300">الهدف</p>
                  <p className="text-sm text-slate-100">{goal}</p>
                </div>

                {/* plan */}
                {plan && (
                  <div className="rounded-2xl border border-cyan-500/25 bg-slate-900/60 p-4">
                    <p className="mb-1 text-[11px] font-semibold text-cyan-400">الخطة</p>
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
                          ? "border-emerald-400/30 bg-emerald-400/5"
                          : s.status === "FAILED" || s.status === "DENIED"
                            ? "border-rose-400/30 bg-rose-400/5"
                            : "border-cyan-500/20 bg-slate-900/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-200">{s.title}</span>
                        <span className="shrink-0 rounded bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300">
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
                  <div className="rounded-2xl border border-purple-400/30 bg-[#050816] p-3">
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
                        ? "border-emerald-400/30 bg-emerald-400/10"
                        : "border-rose-400/30 bg-rose-400/10"
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
          <div className="border-t border-cyan-500/20 bg-[#070b1a]/80 p-4">
            {!taskId ? (
              <div className="mx-auto max-w-2xl">
                <div className="mb-2 flex flex-wrap gap-2">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setGoal(ex)}
                      className="rounded-full border border-cyan-500/20 px-3 py-1 text-[11px] text-slate-400 hover:border-cyan-400/40 hover:text-cyan-300"
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
                    className="flex-1 rounded-xl border border-cyan-500/30 bg-slate-900/60 px-4 py-3 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
                  />
                  <button
                    onClick={startTask}
                    disabled={!goal.trim() || running}
                    className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-black text-slate-950 shadow-[0_0_16px_rgba(34,211,238,0.35)] hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40"
                  >
                    نفّذ →
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
                    setActiveNode(null);
                    setFailed(false);
                  }}
                  className="rounded-lg border border-cyan-500/25 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-400/40"
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
