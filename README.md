# ميكرو نت (MicroNet)

تطبيق Android لإدارة شبكات MikroTik (RouterOS 6 و 7) من الهاتف — متخصص في الهوت سبوت وكروت الإنترنت.

## الميزات

- 🔌 **اتصال ثنائي:** RouterOS v6 (API ثنائي على المنفذ 8728) أو v7 (REST API)
- 📊 **لوحة متابعة:** CPU / RAM / عدد الجلسات / مدة التشغيل (تحديث ذاتي كل 8 ثوانٍ)
- 👥 **المتصلون نشطاً:** عرض مع MAC و IP والاستهلاك + زر قطع الاتصال
- 🎫 **إنشاء كروت بالجملة:** عشرات الكروت بضغطة، مع توليد عشوائي قابل للتخصيص (طول، أرقام/حروف، بادئة)
- 🖨️ **طباعة الكروت** عبر نظام Android الأصلي (PDF، طابعة بلوتوث، أي طابعة Android)
- ✏️ **محرر قالب الطباعة:** عنوان، اسم الشبكة، عدد الكروت في الصفحة، إظهار البروفايل والمدة
- 👤 **إدارة المستخدمين:** بحث، إضافة، تعديل، إيقاف، حذف، طباعة
- ⚙️ **إدارة البروفايلات والسرعات:** Rate limit، Session timeout، Idle timeout، Shared users
- 💰 **تقرير المبيعات:** إجمالي اليوم، عدد الكروت، مخطط آخر 7 أيام، سجل العمليات
- 📈 **تقرير الاستهلاك:** أعلى 30 مستخدماً + إجمالي التحميل/الرفع
- 📡 **الواجهات والأجهزة المتصلة:** حالة الواجهات + جدول DHCP leases
- 🌐 **حفظ اتصالات متعددة** (راوترات مختلفة) مع استرجاع سريع
- 🇱🇾 واجهة عربية كاملة (RTL) بتصميم داكن أنيق
- 🔒 جميع البيانات محفوظة محلياً — لا يمر شيء عبر سيرفرات خارجية

## البناء

### عبر GitHub Actions
ادفع الكود إلى GitHub وسيُبنى APK تلقائياً. حمّل `micronet-debug.apk` من تبويب Actions → Artifacts.

### محلياً
JDK 17 + Android SDK (API 34):
```bash
./gradlew :app:assembleDebug
# الناتج: app/build/outputs/apk/debug/app-debug.apk
```

## الهيكل

```
app/src/main/
├── AndroidManifest.xml
├── java/com/micronet/app/
│   ├── MainActivity.kt        — WebView container
│   ├── MikroTikBridge.kt      — RouterOS v6/v7 client (Kotlin)
│   └── PrintBridge.kt         — Android print framework
├── res/
│   ├── drawable/              — أيقونة راوتر + إشارات WiFi سيان
│   ├── mipmap-anydpi-v26/     — Adaptive icon
│   └── values/                — strings, colors, themes
└── assets/
    ├── index.html             — واجهة المستخدم
    ├── styles.css             — تصميم داكن + سيان
    └── app.js                 — منطق التطبيق الكامل
```

## بروتوكول الاتصال

- **v6:** TCP socket مباشر إلى المنفذ 8728، بروتوكول RouterOS API الثنائي مع تسجيل دخول MD5 الكلاسيكي + الحديث (6.43+).
- **v7:** HTTP/HTTPS REST على المنفذ 443 (أو 80 بدون TLS). يدعم HTTPS بشهادة الراوتر الافتراضية (التحقق معطّل لتسهيل الاستخدام داخل الشبكة).

## معلومات الحزمة

- **Package:** `com.micronet.app`
- **Version:** 1.0.0
- **minSdk:** 26 (Android 8.0)
- **targetSdk:** 34 (Android 14)

## ملاحظات

- لاستخدام v6 يجب تفعيل API على الراوتر: `/ip service enable api`
- لاستخدام v7 يجب تفعيل REST: `/ip service enable www-ssl` (أو `www`)
- يُنصح بإنشاء مستخدم منفصل للتطبيق بصلاحيات محدودة (read + hotspot)
