# Global Draw — Real Deployment Build

এটা আগের Claude আর্টিফ্যাক্ট প্রোটোটাইপের **স্ট্যান্ডঅ্যালোন সংস্করণ** — Node.js/Express ব্যাকএন্ড + সাধারণ HTML/CSS/JS ফ্রন্টএন্ড, যেকোনো hosting-এ ডিপ্লয় করা যায়। এখনো এটা **ভার্চুয়াল কয়েন সিস্টেম** — real money ইন্টিগ্রেশন যোগ করা নেই।

## যা আছে
- রিয়েল ইউজার ডাটাবেজ (JSON ফাইল ভিত্তিক, `data/db.json` — ছোট থেকে মাঝারি স্কেলের জন্য যথেষ্ট)
- পাসওয়ার্ড salted+hashed (Node-এর বিল্ট-ইন `crypto.scrypt`, কোনো external auth package ছাড়াই)
- সাইন করা সেশন টোকেন (JWT-এর মতো, কিন্তু dependency-free)
- এডমিন-approval ইউজার ফ্লো + এডমিন ব্যালেন্স-এড টুল
- সার্ভার-সাইড cron (প্রতি ৫ মিনিটে চেক করে, `DRAW_HOUR_UTC`-তে ড্র প্রসেস করে)
- **সত্যিকারের cryptographically-secure random draw** (`crypto.randomInt`) — আগের প্রোটোটাইপে ছিল date-seeded predictable random, যেটা real deployment-এ ব্যবহার করা ঠিক না কারণ যে কেউ ফলাফল আগে থেকে হিসাব করে ফেলতে পারত। এই সংস্করণে সেটা ঠিক করা হয়েছে।

## যা নেই (এবং কেন)
- **Real payment gateway** — কোনো টাকা এখানে যুক্ত হয় না। যোগ করতে হলে আগে গেমিং লাইসেন্স লাগবে (Curaçao, Malta ইত্যাদি)।
- KYC/AML যাচাই
- একাধিক সার্ভার ইনস্ট্যান্সের জন্য shared database (JSON ফাইল single-instance-এর জন্য ঠিক আছে; স্কেল করলে Postgres/MySQL-এ সরানো উচিত)

---

## ১. লোকালি চালানো

```bash
cd lottery-deploy
cp .env.example .env
# .env ফাইল খুলে JWT_SECRET আর ADMIN_CODE বসান
npm install
npm start
```

ব্রাউজারে `http://localhost:3000` খুলুন।

`JWT_SECRET` জেনারেট করতে:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## ২. এডমিন অ্যাকাউন্ট বানানো

রেজিস্ট্রেশন ফর্মে "Have an admin invite code?" চেপে `.env`-এ যে `ADMIN_CODE` দিয়েছেন সেটা বসান। এই কোড কাউকে শেয়ার করবেন না — এটাই একমাত্র জিনিস যা এডমিন অ্যাক্সেস নিয়ন্ত্রণ করে।

## ৩. ডিপ্লয়মেন্ট (নিজের ডোমেইনসহ)

এই অ্যাপের **persistent disk** দরকার (কারণ `data/db.json`-এ ডেটা লেখা হয়), তাই Vercel-এর মতো pure-serverless হোস্টিং কাজ করবে না। যেগুলো কাজ করবে:

### অপশন A — Railway / Render (সবচেয়ে সহজ)
1. এই ফোল্ডারটা GitHub রিপোতে পুশ করুন।
2. Railway.app বা Render.com-এ নতুন Web Service বানান, রিপো কানেক্ট করুন।
3. Environment variables ট্যাবে `.env`-এর সব ভ্যারিয়েবল বসান।
4. **Persistent volume/disk যোগ করুন** এবং `/app/data` (বা repo-র `data/` ফোল্ডার) পাথে মাউন্ট করুন — না করলে রিডিপ্লয়ে সব ডেটা মুছে যাবে।
5. ডিপ্লয়ের পর সার্ভিস একটা URL দেবে (যেমন `your-app.up.railway.app`)।
6. আপনার ডোমেইন যোগ করতে চাইলে Railway/Render-এর "Custom Domain" সেটিংয়ে গিয়ে আপনার ডোমেইন রেজিস্ট্রারে একটা CNAME রেকর্ড বসান — তারা নিজেরাই ফ্রি HTTPS সার্টিফিকেট দিয়ে দেয়।

### অপশন B — নিজের VPS (DigitalOcean, Linode ইত্যাদি) + Docker
```bash
docker build -t global-draw .
docker run -d \
  --name global-draw \
  -p 3000:3000 \
  -v /path/on/server/data:/app/data \
  --env-file .env \
  --restart unless-stopped \
  global-draw
```
তারপর Nginx/Caddy দিয়ে রিভার্স প্রক্সি + Let's Encrypt HTTPS সেটআপ করুন, ডোমেইনটা সার্ভারের IP-তে A রেকর্ড দিয়ে পয়েন্ট করুন।

### অপশন C — VPS ছাড়া সরাসরি
```bash
npm install --production
NODE_ENV=production node server.js
```
`pm2` বা `systemd` দিয়ে প্রসেসটা চালু রাখুন যাতে সার্ভার রিস্টার্ট হলেও অ্যাপ আবার চালু হয়।

---

## নিরাপত্তা চেকলিস্ট (deploy করার আগে)
- [ ] `.env`-এ `JWT_SECRET` র‍্যান্ডম, লম্বা মান দেওয়া (ডিফল্ট রাখবেন না)
- [ ] `.env`-এ `ADMIN_CODE` বদলে দেওয়া (ডিফল্ট `CHANGE-ME-ADMIN-CODE` ব্যবহার করবেন না)
- [ ] `data/` ফোল্ডার persistent volume-এ আছে
- [ ] HTTPS চালু আছে (পাসওয়ার্ড plaintext-এ যাচ্ছে না)
- [ ] rate limiting যোগ করা ভালো হবে (login/register endpoint brute-force ঠেকাতে) — এই বিল্ডে নেই, প্রয়োজনে `express-rate-limit` যোগ করতে বলুন

## আইনি রিমাইন্ডার
এই সিস্টেম **ভার্চুয়াল কয়েন** দিয়ে চলে, real money নয়। যদি ভবিষ্যতে real-money টিকেট বিক্রি শুরু করতে চান, সেটা একটা গেমিং/লটারি লাইসেন্সের অধীনে পড়বে — বেশিরভাগ দেশে লাইসেন্স ছাড়া এটা অবৈধ। এই কোডবেস সেই ধাপের জন্য প্রস্তুত না; পেমেন্ট গেটওয়ে যোগ করার আগে লাইসেন্সিং নিয়ে আইনজীবীর সাথে কথা বলুন।
