require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const cron = require("node-cron");
const db = require("./db");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE-ME-BEFORE-DEPLOYING";
const ADMIN_CODE = process.env.ADMIN_CODE || "CHANGE-ME-ADMIN-CODE";
const TICKET_COST = parseInt(process.env.TICKET_COST || "10", 10);
const START_BALANCE = parseInt(process.env.START_BALANCE || "500", 10);
const DRAW_HOUR_UTC = parseInt(process.env.DRAW_HOUR_UTC || "20", 10);
const JACKPOT_BASE = parseInt(process.env.JACKPOT_BASE || "1000", 10);
const JACKPOT_CONTRIB = parseInt(process.env.JACKPOT_CONTRIB || "5", 10);

if (JWT_SECRET === "CHANGE-ME-BEFORE-DEPLOYING") {
  console.warn("WARNING: JWT_SECRET is not set. Set it in your .env before deploying publicly.");
}

/* ---------------------------- crypto helpers ---------------------------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(check);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 3600 * 1000 })).toString(
    "base64url"
  );
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Not authenticated" });
  req.username = payload.username;
  next();
}
function adminOnly(req, res, next) {
  const u = db.getUser(req.username);
  if (!u || u.role !== "admin") return res.status(403).json({ error: "Admins only" });
  next();
}
function publicUser(u) {
  return { username: u.username, balance: u.balance, role: u.role };
}

/* ---------------------------- draw engine ---------------------------- */
function activeDrawDate(now = new Date()) {
  const d = new Date(now);
  if (d.getUTCHours() >= DRAW_HOUR_UTC) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function drawSixNumbers() {
  const pool = Array.from({ length: 49 }, (_, i) => i + 1);
  const picked = [];
  for (let i = 0; i < 6; i++) {
    const idx = crypto.randomInt(0, pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
}
function prizeForMatches(n) {
  if (n === 6) return { tier: "jackpot", amount: null };
  if (n === 5) return { tier: "5", amount: 200 };
  if (n === 4) return { tier: "4", amount: 50 };
  if (n === 3) return { tier: "3", amount: 10 };
  return { tier: null, amount: 0 };
}
function processDraw(dateStr) {
  const winning = drawSixNumbers();
  const tickets = db.getTicketsForDate(dateStr);
  const jackpot = db.getJackpot();
  const winners = [];
  for (const t of tickets) {
    const matches = t.numbers.filter((n) => winning.includes(n)).length;
    const p = prizeForMatches(matches);
    let amount = p.amount;
    if (p.tier === "jackpot") amount = jackpot;
    t.matches = matches;
    t.prize = amount || 0;
    if (amount > 0) {
      const u = db.getUser(t.username);
      if (u) {
        u.balance += amount;
        db.saveUser(u);
      }
      winners.push({ username: t.username, matches, amount });
    }
    db.updateTicket(t);
  }
  const jackpotWon = winners.some((w)
