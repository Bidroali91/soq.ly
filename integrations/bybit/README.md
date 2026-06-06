# Bybit Integration (Read-Only, Mainnet)

تكامل Node.js مع Bybit Open API V5 باستخدام SDK الرسمي `bybit-api`.
وضع القراءة فقط — لا يقوم بتنفيذ أوامر تداول.

## الإعداد

1. أنشئ مفتاحاً من لوحة Bybit الرسمية: https://www.bybit.com/app/user/api-management
   - الصلاحيات: **Read-Only** فقط
   - يُنصح بتفعيل **IP whitelist**
   - عطّل صلاحية السحب
2. انسخ `.env.example` إلى `.env` واملأ المفاتيح:
   ```
   cp .env.example .env
   ```
3. التثبيت والتشغيل:
   ```
   npm install
   npm run start    # تحقق من المصادقة + وقت السيرفر
   npm run balance  # رصيد المحفظة الموحدة
   npm run ticker BTCUSDT
   ```

## ملاحظة أمنية

- **لا تُودِع** ملف `.env` في Git.
- Bybit Open API تستخدم **HMAC-SHA256** مع `API Key` / `API Secret`،
  وليس RSA. يتولى `bybit-api` SDK توقيع الطلبات تلقائياً.
- لإضافة صلاحيات تداول لاحقاً، أنشئ مفتاحاً منفصلاً بصلاحيات محدودة
  وأضف غلاف أوامر مع تأكيدات صريحة.
