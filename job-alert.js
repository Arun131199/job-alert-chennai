/**
 * job-alert.js
 * Single-file automation: scrapes multiple sites, filters, sends email + telegram + whatsapp (Twilio),
 * attaches resume, logs already-sent links.
 *
 * NOTES:
 * - Local test resume path (uploaded in this chat): /mnt/data/Resume.pdf. :contentReference[oaicite:1]{index=1}
 * - For GitHub Actions, put the resume at ./assets/Resume.pdf or download it in the workflow.
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import cheerio from "cheerio";
import nodemailer from "nodemailer";
import fetch from "node-fetch";
import Twilio from "twilio";

// ---------- CONFIG ----------
const KEYWORDS = ["react","frontend","javascript","html","css","tailwind","bootstrap"];
const LOCATION = "Chennai";
const MIN_EXPERIENCE_YEARS = 2;
const SALARY_MIN = 0; // set >0 if you want a money floor (in INR)
const LOCAL_RESUME_PATH = "/mnt/data/Resume.pdf"; // local test path (uploaded file). :contentReference[oaicite:2]{index=2}
const REPO_RESUME_PATH = "./assets/Resume.pdf";   // recommended path when committing the resume to repo
const USE_REPO_RESUME_IN_ACTIONS = true; // set false if you plan to download resume inside workflow

const LOG_PATH = "./data/sent-links.json";
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

// ---------- HELPERS ----------
function readLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, "utf8")); }
  catch(e){ return []; }
}
function writeLog(list) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(Array.from(new Set(list)), null, 2));
}
function nowDate() { return new Date().toLocaleString(); }
function containsKeyword(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return KEYWORDS.some(k => t.includes(k.toLowerCase()));
}
function safeText(s) { return (s||"").replace(/\s+/g," ").trim(); }

// ---------- SCRAPERS ----------
async function scrapeIndeed() {
  try {
    const q = encodeURIComponent(KEYWORDS.join("+"));
    const loc = encodeURIComponent(LOCATION);
    const url = `https://in.indeed.com/jobs?q=${q}&l=${loc}`;
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }});
    const $ = cheerio.load(data);
    const out = [];
    $(".result").each((i, el) => {
      const title = safeText($(el).find("h2.jobTitle").text() || $(el).find("h2").text());
      const company = safeText($(el).find(".companyName").text());
      const rel = $(el).find("a").attr("href");
      const link = rel ? ("https://in.indeed.com" + rel) : null;
      const snippet = safeText($(el).find(".job-snippet").text());
      if (title && company && link && containsKeyword(title + " " + snippet)) {
        out.push({ title, company, link, snippet, source: "Indeed" });
      }
    });
    return out;
  } catch (e) { console.warn("Indeed failed:", e.message); return []; }
}

async function scrapeNaukri() {
  try {
    const q = encodeURIComponent(KEYWORDS.join(" "));
    const loc = encodeURIComponent(LOCATION);
    const url = `https://www.naukri.com/${encodeURIComponent(KEYWORDS.join("-"))}-jobs-in-${loc}`;
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }});
    const $ = cheerio.load(data);
    const out = [];
    $("article.jobTuple").each((i,el) => {
      const title = safeText($(el).find("a.title").text());
      const company = safeText($(el).find("a.subTitle").text());
      const link = $(el).find("a.title").attr("href");
      const snippet = safeText($(el).find(".job-desc").text());
      if (title && company && link && containsKeyword(title + " " + snippet)) out.push({ title, company, link, snippet, source: "Naukri" });
    });
    return out;
  } catch (e) { console.warn("Naukri failed:", e.message); return []; }
}

async function scrapeCutshort() {
  try {
    const url = `https://cutshort.io/search?keywords=${encodeURIComponent(KEYWORDS.join(" "))}&locations=${encodeURIComponent(LOCATION)}`;
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }});
    const $ = cheerio.load(data);
    const out = [];
    $(".job-card").each((i, el) => {
      const title = safeText($(el).find(".job-title").text());
      const company = safeText($(el).find(".company-name").text());
      const rel = $(el).find("a").attr("href");
      const link = rel ? ("https://cutshort.io" + rel) : null;
      const snippet = safeText($(el).find(".job-desc").text());
      if (title && company && link && containsKeyword(title + " " + snippet)) out.push({ title, company, link, snippet, source: "Cutshort" });
    });
    return out;
  } catch (e) { console.warn("Cutshort failed:", e.message); return []; }
}

async function scrapeGlassdoor() {
  try {
    const q = encodeURIComponent(KEYWORDS.join("+"));
    const loc = encodeURIComponent(LOCATION);
    const url = `https://www.glassdoor.co.in/Job/chennai-${loc}-jobs-SRCH_IL.0,6_IC2940587_KO7,${7+loc.length}.htm?sc.keyword=${q}`;
    // Glassdoor often blocks; attempt best-effort
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }});
    const $ = cheerio.load(data);
    const out = [];
    $(".jl").each((i, el) => {
      const title = safeText($(el).find(".jobLink").text());
      const company = safeText($(el).find(".jobEmpolyerName").text());
      const rel = $(el).find("a").attr("href");
      const link = rel ? ("https://www.glassdoor.co.in" + rel) : null;
      const snippet = safeText($(el).find(".jobDescriptionContent").text());
      if (title && company && link && containsKeyword(title + " " + snippet)) out.push({ title, company, link, snippet, source: "Glassdoor" });
    });
    return out;
  } catch (e) { console.warn("Glassdoor failed:", e.message); return []; }
}

async function scrapeMonster() {
  try {
    const q = encodeURIComponent(KEYWORDS.join("-"));
    const loc = encodeURIComponent(LOCATION);
    const url = `https://www.monsterindia.com/search/${q}-jobs-in-${loc}`;
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }});
    const $ = cheerio.load(data);
    const out = [];
    $("section.card-content").each((i, el) => {
      const title = safeText($(el).find("h3.medium").text());
      const company = safeText($(el).find("div.company").text());
      const link = $(el).find("a").attr("href");
      const snippet = safeText($(el).find(".job-description").text());
      if (title && company && link && containsKeyword(title + " " + snippet)) out.push({ title, company, link, snippet, source: "Monster" });
    });
    return out;
  } catch (e) { console.warn("Monster failed:", e.message); return []; }
}

async function scrapeLinkedInSimple() {
  try {
    // LinkedIn is strict about scraping; this is a best-effort minimal public search link
    const q = encodeURIComponent(KEYWORDS.join(" "));
    const loc = encodeURIComponent(LOCATION);
    const url = `https://www.linkedin.com/jobs/search?keywords=${q}&location=${loc}`;
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }});
    const $ = cheerio.load(data);
    const out = [];
    $("li.result-card").each((i, el) => {
      const title = safeText($(el).find("h3").text());
      const company = safeText($(el).find("h4").text());
      const link = $(el).find("a").attr("href");
      const snippet = safeText($(el).find(".result-card__snippet").text());
      if (title && company && link && containsKeyword(title + " " + snippet)) out.push({ title, company, link, snippet, source: "LinkedIn" });
    });
    return out;
  } catch (e) { console.warn("LinkedIn failed:", e.message); return []; }
}

// fetch all
async function fetchAll() {
  const all = [];
  const scrapers = [scrapeIndeed, scrapeNaukri, scrapeCutshort, scrapeGlassdoor, scrapeMonster, scrapeLinkedInSimple];
  for (const s of scrapers) {
    try {
      const res = await s();
      all.push(...res);
    } catch(e) { console.warn("Scraper error:", e.message); }
  }
  // dedupe by link or title+company
  const seen = new Set();
  const dedup = [];
  for (const j of all) {
    const id = j.link || (j.title + "|" + j.company);
    if (!seen.has(id)) { seen.add(id); dedup.push(j); }
  }
  return dedup;
}

// ---------- FILTER ----------
function parseExperience(text) {
  if (!text) return null;
  const m = text.match(/(\d+)\+?\s*(?:-|\sto\s)?\s*(\d+)?\s*years?/i);
  if (m) return parseInt(m[1], 10);
  const single = text.match(/(\d+)\s*years?/i);
  if (single) return parseInt(single[1], 10);
  return null;
}

function filterJobs(jobs) {
  return jobs.filter(job => {
    const big = (job.title + " " + (job.snippet || "") + " " + (job.company || "")).toLowerCase();
    if (!containsKeyword(big)) return false;
    // experience check (if job.experience exists)
    if (job.experience) {
      const exp = parseExperience(job.experience);
      if (exp !== null && exp < MIN_EXPERIENCE_YEARS) return false;
    }
    // salary crude check if provided in job.salary
    if (job.salary) {
      const m = (job.salary || "").replace(/[₹,]/g,"").match(/(\d{3,})/);
      if (m && parseInt(m[1],10) < SALARY_MIN) return false;
    }
    return true;
  });
}

// ---------- NOTIFIERS ----------
async function sendEmail(jobs, resumePath) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.TARGET_EMAIL) {
    console.log("SMTP / TARGET_EMAIL not configured; skipping email.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const html = `
    <h2>Chennai Frontend / React Jobs — ${nowDate()}</h2>
    <p>Found ${jobs.length} new jobs matching your criteria.</p>
    ${jobs.map(j => `
      <div style="margin-bottom:12px;">
        <strong>${j.title}</strong><br/>
        ${j.company} — ${j.source}<br/>
        <a href="${j.link}" target="_blank">Apply link</a><br/>
        <small>${j.snippet || ""}</small>
      </div>
    `).join("")}
    <hr/>
    <p>This email was generated by your job-alert bot.</p>
  `;

  const attachments = [];
  if (resumePath && fs.existsSync(resumePath)) {
    attachments.push({ filename: "Resume.pdf", path: resumePath });
  } else {
    console.warn("Resume not found at", resumePath);
  }

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.TARGET_EMAIL,
    subject: `Chennai Frontend Jobs — ${new Date().toLocaleDateString()}`,
    html,
    attachments
  });

  console.log("Email sent to", process.env.TARGET_EMAIL);
}

async function sendTelegram(jobs) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { console.log("Telegram not configured; skipping"); return; }
  const text = `Chennai jobs (${jobs.length}) - ${nowDate()}\n\n` +
    jobs.slice(0,10).map(j => `${j.title} — ${j.company}\n${j.link}`).join("\n\n");
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false })
  });
  console.log("Telegram sent");
}

async function sendWhatsApp(jobs) {
  const sid = process.env.TWILIO_SID;
  const auth = process.env.TWILIO_AUTH;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const to = process.env.TWILIO_WHATSAPP_TO;
  if (!sid || !auth || !from || !to) { console.log("Twilio not configured; skipping WhatsApp"); return; }
  const client = Twilio(sid, auth);
  const msg = jobs.slice(0,5).map(j => `${j.title} — ${j.company}\n${j.link}`).join("\n\n");
  await client.messages.create({ from, to, body: msg });
  console.log("WhatsApp (Twilio) sent");
}

// ---------- MAIN ----------
(async () => {
  console.log("Job alert run:", nowDate());
  const all = await fetchAll();
  console.log("Scraped total:", all.length);

  const filtered = filterJobs(all);
  console.log("After filtering:", filtered.length);

  // dedupe against log
  const sent = readLog();
  const toSend = filtered.filter(j => !sent.includes(j.link));
  console.log("New jobs to send:", toSend.length);

  if (toSend.length === 0) {
    console.log("No new jobs to send. Exiting.");
    return;
  }

  // choose resume path: prefer repo resume for actions, else local uploaded resume
  let resumePath = LOCAL_RESUME_PATH;
  if (USE_REPO_RESUME_IN_ACTIONS && fs.existsSync(REPO_RESUME_PATH)) resumePath = REPO_RESUME_PATH;
  if (!fs.existsSync(resumePath)) {
    console.warn("Resume not found at chosen path. Email will be sent without attachment unless resume exists.");
  }

  await sendEmail(toSend, resumePath);
  await sendTelegram(toSend);
  await sendWhatsApp(toSend);

  // log links so we don't resend
  const links = sent.concat(toSend.map(j => j.link));
  writeLog(links);
  console.log("Logged", toSend.length, "links.");
})();
