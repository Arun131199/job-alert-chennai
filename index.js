import { fetchAllJobs } from "./scrapers/index.js";
import { filterJobs } from "./utils/filter.js";
import { sendEmail } from "./notifiers/email.js";
import { sendTelegram } from "./notifiers/telegram.js";
import { sendWhatsApp } from "./notifiers/whatsapp-twilio.js";
import { logAppliedLinks, getAppliedLinks } from "./utils/logger.js";

const KEYWORDS = ["react","frontend","javascript","html","css","tailwind","bootstrap"];
const LOCATION = "Chennai";
const MIN_EXPERIENCE_YEARS = 2; // filter by 2 years
const SALARY_MIN = 0; // set if you want a min salary
const ATTACH_RESUME_PATH = "/mnt/data/Resume.pdf"; // local test path (your uploaded resume). :contentReference[oaicite:2]{index=2}

async function main(){
  console.log("Fetching jobs...");
  const rawJobs = await fetchAllJobs({keywords: KEYWORDS, location: LOCATION});
  console.log(`Found ${rawJobs.length} raw jobs`);

  // dedupe and filter
  const appliedLinks = getAppliedLinks(); // from data/applied-log.json
  const filtered = filterJobs(rawJobs, {minExperience: MIN_EXPERIENCE_YEARS, salaryMin: SALARY_MIN, keywords: KEYWORDS})
    .filter(j => !appliedLinks.includes(j.link));

  if (filtered.length === 0){
    console.log("No new jobs after filtering.");
    return;
  }

  // send notifications
  await sendEmail(filtered, ATTACH_RESUME_PATH);
  await sendTelegram(filtered);
  await sendWhatsApp(filtered);

  // log them so we don't send duplicates next day
  logAppliedLinks(filtered.map(j => j.link));
  console.log("Done.");
}

main().catch(err => { console.error(err); process.exit(1); });
