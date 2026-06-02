# اشتراكات ستارلينك (Starlink Subscriptions)

تطبيق Android لإدارة اشتراكات ستارلينك الشهرية للزبائن — متابعة تواريخ الاستحقاق، تسجيل المدفوعات، إرسال تذكيرات عبر واتساب/SMS، واستيراد بيانات الفواتير من الإيميل تلقائياً.

## الميزات

- 📊 **لوحة متابعة** مع إحصائيات (متأخر / مستحق قريباً / مدفوع / متوقع هذا الشهر)
- 📈 **مخطط إيرادات** لآخر 6 أشهر
- 🔍 بحث وفرز وتصفية بالحالة
- 👁️ عرض جدول أو بطاقات
- 💬 **تذكير عبر واتساب** بضغطة واحدة (تكامل أصلي)
- 📨 إرسال **SMS** أو **اتصال هاتفي** مباشر
- 📥 **استيراد إيميل ستارلينك** (عربي + إنجليزي) — استخراج التاريخ والمبلغ ورقم الخدمة تلقائياً بدون خادم
- 🔄 **تجديد تلقائي** للاشتراكات (شهري / ربع سنوي / سنوي)
- 💾 **نسخة احتياطية / استعادة** بصيغة JSON، وتصدير CSV
- ⚙️ **إعدادات** قابلة للتخصيص: اسم الشركة، العملة الافتراضية، قالب رسالة التذكير
- 🌓 **وضع داكن / فاتح**
- 🇱🇾 واجهة عربية كاملة (RTL)
- 🔒 جميع البيانات محفوظة محلياً على الجهاز

## البناء

### عبر GitHub Actions (موصى به)

ادفع الكود إلى GitHub وسيُبنى APK تلقائياً. حمّل ملف `starlink-subscriptions-debug.apk` من Artifacts بعد اكتمال workflow.

### محلياً

تتطلب: JDK 17 + Android SDK (API 34) + ANDROID_HOME.

```bash
./gradlew :app:assembleDebug
# الإخراج: app/build/outputs/apk/debug/app-debug.apk
```

للنسخة الموقّعة (Release):

```bash
./gradlew :app:assembleRelease
# يجب توقيع الـ APK يدوياً قبل التوزيع
```

## الهيكل

```
app/src/main/
├── AndroidManifest.xml
├── java/com/sasaida/app/
│   ├── MainActivity.kt       — WebView container
│   └── AndroidBridge.kt      — JS↔Android bridge (واتساب، SMS، اتصال، مشاركة)
├── res/
│   ├── drawable/             — أيقونة ستارلينك (طبق + إشارات سيان)
│   ├── mipmap-anydpi-v26/    — Adaptive icon
│   └── values/               — colors, strings, themes
└── assets/
    ├── index.html            — واجهة المستخدم
    ├── styles.css            — تصميم Starlink (كحلي + سيان)
    ├── script.js             — منطق التطبيق + parser الإيميل
    └── data/                 — بيانات أولية
```

## معلومات الحزمة

- **Package:** `com.sasaida.app`
- **Version:** 2.0.0 (versionCode 2)
- **minSdk:** 26 (Android 8.0)
- **targetSdk:** 34 (Android 14)
