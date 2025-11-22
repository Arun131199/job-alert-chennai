import axios from "axios";
import cheerio from "cheerio";
import nodemailer from "nodemailer";

// --- CONFIG ---
const KEYWORDS = ["react", "frontend", "javascript", "html", "css", "tailwind", "bootstrap"];
const LOCATION = "Chennai";

// Example sources (scraping simple HTML job boards)
const SOURCES = [
  {
    name: "Indeed",
    url: "https://in.indeed.com/jobs?q=react+frontend&l=chennai",
    parser: ($) =>
      $(".resultContent").map((i, el) => ({
        title: $(el).find("h2").text().trim(),
        company: $(el).find(".companyName").text().trim(),
        link: "https://in.indeed.com" + $(el).find("a").attr("href"),
        source: "Indeed"
      })).get()
  },
  {
    name: "Cutshort",
    url: "https://cutshort.io/jobs/react-jobs-in-chennai",
    parser: ($) =>
      $(".job-card").map((i, el) => ({
        title: $(el).find(".job-title").text().trim(),
        company: $(el).find(".company-name").text().trim(),
        link: "https://cutshort.io" + $(el).find("a").attr("href"),
        source: "Cutshort"
      })).get()
  }
];

// --- FETCH FUNCTION ---
async function fetchJobs() {
  let results = [];

  for (const source of SOURCES) {
    try {
      const { data } = await axios.get(source.url);
      const $ = cheerio.load(data);
      const jobs = source.parser($);

      // Filter with keywords
      const filtered = jobs.filter((job) => {
        const text = (job.title + " " + job.company).toLowerCase();
        return KEYWORDS.some((k) => text.includes(k));
      });

      results.push(...filtered);
    } catch (err) {
      console.log("Error fetching ", source.name, err.message);
    }
  }

  return results;
}

// --- SEND EMAIL ---
async function sendEmail(jobList) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const html = `
    <h2>Chennai Frontend / React Jobs - Daily Alert</h2>
    ${jobList
      .map(
        (job) => `
      <p>
        <b>${job.title}</b> <br/>
        ${job.company} <br/>
        Source: ${job.source} <br/>
        <a href="${job.link}" target="_blank">Apply Here</a>
      </p>
    `
      )
      .join("")}
  `;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.TARGET_EMAIL,
    subject: "Daily Chennai Frontend Developer Jobs",
    html
  });

  console.log("Email sent successfully!");
}

// --- MAIN ---
(async () => {
  const jobs = await fetchJobs();

  if (jobs.length === 0) {
    console.log("No jobs found today.");
    return;
  }

  await sendEmail(jobs);
})();
