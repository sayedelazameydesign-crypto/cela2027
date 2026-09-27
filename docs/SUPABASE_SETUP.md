# إعداد Supabase (مجاني — بدون بطاقة)

التخزين الدائم للمهام عبر الخطة المجانية من Supabase.

## 1) إنشاء المشروع
1. أنشئ حساباً على [supabase.com](https://supabase.com) (بدون بطاقة)
2. أنشئ مشروعاً جديداً (New Project) — منطقة قريبة منك

## 2) إنشاء الجداول
افتح **SQL Editor** والصق:

```sql
create table if not exists tasks (
  id text primary key,
  goal text not null,
  status text not null default 'PLANNING',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references tasks(id),
  role text not null,
  content text not null,
  at timestamptz not null default now()
);

-- حماية القراءة: لا صلاحيات عامة (الوصول عبر service key من السيرفر فقط)
alter table tasks enable row level security;
alter table messages enable row level security;
```

## 3) ربط cela2027
أضف في `.env.local` (محلياً) أو Environment Variables على Vercel:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...   (من Settings → API → service_role)
```

**تنبيه أمني:** `service_role` يتجاوز حماية RLS — يبقى في السيرفر فقط ولا يُضاف أبداً لـ NEXT_PUBLIC_ أو كود المتصفح.

## 4) التفعيل تلقائي
بمجرد ضبط المتغيرين يعمل `SupabaseStore` تلقائياً — لا تغيير في الكود مطلوب. بدون المتغيرات يعمل النظام بالذاكرة المؤقتة كالمعتاد.

## حدود الخطة المجانية (نلتزم بها)
- 500MB قاعدة: سياسة تنظيف artifacts الأقدم من 7 أيام (المرحلة 2)
- المشروع يتوقف بعد أسبوع خمول — يكفي فتح اللوحة لإيقاظه
