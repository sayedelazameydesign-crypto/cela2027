# Cela 2027

<p align="center"><b>وكيل ذكاء اصطناعي مستقل — يخطط، ينفّذ، يتحقق بالأدلة.</b></p>

Cela 2027 نظام وكيل ذكي بأسلوب مانوس (Manus) وعقل كلود (Claude): واجهة ويب عربية داكنة فيوتشرية حيث تكتب هدفاً، فيخطط الوكيل خطواته علنياً، ينفّذها (كتابة/تعديل ملفات + تشغيل Python في صندوق معزول)، ثم **لا يعلن اكتمال المهمة إلا بعد تحقق مستقل بالأدلة** — نفس فلسفة مستودع [agi-system](https://github.com/sayedelazameydesign-crypto/agi-system): «لا ادعاءات بدون أدلة».

## المزايا

- **شبكة خط أنابيب 3D حية (Three.js):** عقد متوهجة (الهدف ← الخطة ← السياسة ← التنفيذ ← التحقق ← الأدلة) تنبض مع كل حدث حقيقي من الوكيل، وتومض أحمر عند الفشل
- **حلقة وكيل كاملة:** Goal → Plan → Policy → Execute → Verify → Evidence → Ledger
- **وكيل برمجي:** أدوات `read / ls / write / edit / patch / scaffold_project` داخل مساحة عمل معزولة (احتواء مسارات صارم ضد `../`)
- **صندوق Python:** تنفيذ داخل متصفح المستخدم عبر Pyodide (WASM) — عزل حقيقي وتكلفة سيرفر صفرية
- **سجل أحداث مُهاش:** سلسلة SHA-256 غير قابلة للتعديل — `replay` و`verify` لكل مهمة
- **مخّ OpenRouter:** مفتاح واحد يفتح Claude وGPT وGemini مع توجيه تلقائي وبدائل عند الفشل
- **وضع محاكاة محلية:** يعمل كامل الواجهة والحلقة بدون أي مفتاح API (للتجربة والعرض)
- **واجهة عربية RTL فيوتشرية داكنة:** دردشة + خطوط زمن حية + عارض ملفات + تنزيل المشروع المُنتَج

## البنية

```
cela2027/
├── apps/web/            واجهة Next.js 15 + Tailwind + Three.js (عربية RTL، فيوتشرية)
│   ├── app/api/task/    إنشاء المهام + بث SSE + جسر الصندوق + الملفات
│   ├── components/NetworkGraph.tsx   شبكة خط الأنابيب 3D
│   └── public/pyodide-worker.js   صندوق Python في المتصفح
├── packages/core/       النواة: orchestrator, policy, ledger, planner, verifier, workspace
├── packages/llm/        ModelProvider + ProviderFabric + OpenRouter/Gemini adapters
├── packages/sandbox/    واجهة Sandbox الموحدة (Pyodide الآن / Docker لاحقاً)
├── packages/store/      طبقة التخزين (ذاكرة الآن / Supabase لاحقاً)
├── docs/ARCHITECTURE.md وثائق البنية
├── docs/PROVIDERS.md    دليل عقد المزودين وحدود مرحلة P1
└── docs/SAFE_EVOLUTION.md سياسة التوسعة الآمنة وبوابة التوافق
```

## التشغيل السريع

```bash
# 1) التثبيت
npm install

# 2) (اختياري) إعداد أسرار السيرفر محليًا — بدونه يعمل وضع المحاكاة
# Next.js يعمل من apps/web، لذلك ملف البيئة المحلي يوضع هناك.
cp .env.example apps/web/.env.local
# OPENROUTER_API_KEY للمخطط الحالي؛ GEMINI_API_KEY للـAdapter المعزول في P2.

# 3) بوابة التوافق الكاملة: architecture/change policy + lockfile + types + tests + build
npm run verify

# أو الاختبارات فقط — على Windows استخدم --no-cache إذا تعطل الكاش
npm test -- --no-cache

# 4) التشغيل
npm run dev    # ثم افتح http://localhost:3000
```

## النشر المجاني (بدون بطاقة)

1. **Vercel Hobby** (مجاني بدون بطاقة): اربط المستودع من [vercel.com/new](https://vercel.com/new) — إعدادات افتراضية لمشروع Next.js.
2. أضف `OPENROUTER_API_KEY` في Environment Variables (المفتاح يبقى في السيرفر فقط).
3. (اختياري) **Supabase Free** للتخزين الدائم لاحقاً — واجهة `@cela/store` جاهزة للتبديل.

## القاعدة الذهبية

> لا حالة تُعلن `VERIFIED` إلا بعد أن يقرأ المُتحقِّق مساحة العمل بنفسه ويشهد على الأدلة — لا يثق أبداً بما يدّعيه المنفّذ أو النموذج.

## حالة المشروع (v1)

| القدرة | الحالة |
|---|---|
| شبكة 3D حية متتبعة للوكيل | ✓ تعمل |
| حلقة الوكيل + بث SSE | ✓ تعمل |
| أدوات الملفات المعزولة | ✓ تعمل |
| صندوق Pyodide بالمتصفح | ✓ يعمل |
| سجل مُهاش + تحقق بالأدلة | ✓ يعمل |
| مخطِّط OpenRouter | ✓ (يعمل بوضع المحاكاة بدون مفتاح) |
| ModelProvider + ProviderFabric | ✓ أساس تعاقدي؛ غير مفعّل في Planner بعد |
| Gemini Adapter | ✓ P2 باختبارات HTTP محاكاة؛ غير مفعّل في runtime |
| تصفح الإنترنت | مؤجل للمرحلة 2 |
| الوكلاء المتعددون / التحسين الذاتي (SICA) | مؤجل |

## الترخيص

MIT © 2026
