/**
 * NationStates RMB & Dispatch Monitor
 * Connects to NS SSE for real-time events, fetches content, sends to Discord
 */

import { Webhook } from "discord-webhook-node";
import { XMLParser } from "fast-xml-parser";
import { readFileSync, writeFileSync, existsSync } from "fs";

const parser = new XMLParser({ ignoreAttributes: false });
const CONFIG_PATH = "./config.json";
const STATE_PATH = process.env.STATE_FILE || "./state.json";

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfig() {
  const raw = readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

// ─── State persistence (event deduplication) ──────────────────────────────────

let state = { processedIds: [] };

function loadState() {
  try {
    if (existsSync(STATE_PATH)) {
      const data = readFileSync(STATE_PATH, "utf8");
      if (data && data.startsWith("{")) {
        state = JSON.parse(data);
      }
    }
  } catch (e) {
    console.log(`[State] Starting fresh (${e.message})`);
  }
}

function saveState() {
  // Keep only last 5000 IDs
  if (state.processedIds.length > 5000) {
    state.processedIds = state.processedIds.slice(-5000);
  }
  writeFileSync(STATE_PATH, JSON.stringify(state));
}

function isProcessed(id) {
  return state.processedIds.includes(id);
}

function markProcessed(id) {
  state.processedIds.push(id);
  saveState();
}

// ─── XML Fetch ────────────────────────────────────────────────────────────────

async function fetchXML(url, userAgent) {
  const headers = { "User-Agent": `NS Monitor ${userAgent}` };
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const xml = await response.text();
  return parser.parse(xml);
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

async function handleRMB(event, config, webhook) {
  const { nation, postId, region, raw } = event;
  const eventId = `rmb-${postId}`;
  
  if (isProcessed(eventId)) return;
  
  console.log(`[RMB] ${nation} posted in ${region}`);

  // Wait for NS API to index
  await sleep(2000);

  let content = "";
  let timestamp = Math.floor(Date.now() / 1000);

  try {
    const url = `https://www.nationstates.net/cgi-bin/api.cgi?region=${region}&q=messages&fromid=${postId}&limit=1`;
    const result = await fetchXML(url, config.userAgent);
    
    const post = result?.REGION?.MESSAGES?.POST;
    if (post) {
      const p = Array.isArray(post) ? post[0] : post;
      content = (p.MESSAGE || "").trim();
      timestamp = parseInt(p.TIMESTAMP) || timestamp;
    }
  } catch (e) {
    console.error(`[RMB] API error: ${e.message}`);
  }

  if (!content) {
    console.log(`[RMB] No content found for ${postId}`);
    return;
  }

  const regionName = region.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  const nationName = nation.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  
  const msg = `**📍 RMB Post in ${regionName}**\n**${nationName}:** ${content.substring(0, 1800)}\n<https://www.nationstates.net/page=rmb/postid=${postId}>`;

  await webhook.send(msg);
  markProcessed(eventId);
  console.log(`[RMB] Sent to Discord`);
}

async function handleDispatch(event, config, webhook) {
  const { nation, dispatchId, title, category } = event;
  const eventId = `dispatch-${dispatchId}`;
  
  if (isProcessed(eventId)) return;
  
  console.log(`[Dispatch] ${nation} published "${title}"`);

  // Wait for NS API to index
  await sleep(3000);

  let content = "";
  let author = nation;

  try {
    const url = `https://www.nationstates.net/cgi-bin/api.cgi?q=dispatch;dispatchid=${dispatchId}`;
    const result = await fetchXML(url, config.userAgent);
    
    const dispatch = result?.WORLD?.DISPATCH || result?.DISPATCH;
    if (dispatch) {
      content = (dispatch.TEXT || "").trim();
      author = dispatch.AUTHOR || nation;
    }
  } catch (e) {
    console.error(`[Dispatch] API error: ${e.message}`);
  }

  const authorName = author.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  const truncated = content.length > 1500 ? content.substring(0, 1497) + "..." : content || "*Content not available*";
  
  const msg = `**📄 New Dispatch: ${title}**\n**By:** ${authorName} (${category})\n${truncated}\n<https://www.nationstates.net/page=dispatch/id=${dispatchId}>`;

  await webhook.send(msg);
  markProcessed(eventId);
  console.log(`[Dispatch] Sent to Discord`);
}

// ─── SSE Client ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function connectSSE(config, webhook) {
  const url = "https://www.nationstates.net/api/rmb+dispatch";
  const headers = { "User-Agent": `NS Monitor ${config.userAgent}` };
  
  console.log(`[SSE] Connecting to ${url}`);
  
  while (true) {
    try {
      const response = await fetch(url, { headers });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      console.log("[SSE] Connected");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let data = null;
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { data = JSON.parse(line.slice(6)); } catch {}
          } else if (line === "" && data?.str) {
            processEvent(data, config, webhook);
            data = null;
          }
        }
      }
    } catch (e) {
      console.error(`[SSE] Error: ${e.message}`);
    }
    
    console.log("[SSE] Reconnecting in 5s...");
    await sleep(5000);
  }
}

function processEvent(data, config, webhook) {
  const str = data.str;
  const buckets = data.buckets || [];

  // RMB: @@nation@@ lodged ... on the %%region%% Regional Message Board
  const rmbMatch = str.match(/^@@([0-9a-z_-]+)@@ lodged.*?postid=(\d+).*?%%([0-9a-z_-]+)%%/);
  if (rmbMatch) {
    const [, nation, postId, region] = rmbMatch;
    const matchNation = config.rmbNations?.some(n => n.toLowerCase() === nation.toLowerCase());
    const matchRegion = config.rmbRegions?.some(r => r.toLowerCase() === region.toLowerCase());
    if (matchNation || matchRegion) {
      handleRMB({ nation, postId, region, raw: str }, config, webhook).catch(e => console.error(`[RMB] Error: ${e.message}`));
    }
    return;
  }

  // Dispatch: @@nation@@ published "..." (Category: Subcategory)
  const dispatchMatch = str.match(/^@@([0-9a-z_-]+)@@ published.*?dispatch\/id=(\d+)[^>]*>([^<]+)<.*?\(([^:]+):\s*([^)]+)\)/);
  if (dispatchMatch) {
    const [, nation, dispatchId, title, category, subcategory] = dispatchMatch;
    if (config.dispatchNations?.some(n => n.toLowerCase() === nation.toLowerCase())) {
      handleDispatch({ nation, dispatchId, title, category: `${category}: ${subcategory}`.trim() }, config, webhook).catch(e => console.error(`[Dispatch] Error: ${e.message}`));
    }
    return;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════════");
  console.log("  NationStates RMB & Dispatch Monitor");
  console.log("════════════════════════════════════════════");

  const config = loadConfig();
  loadState();
  
  const webhook = new Webhook(config.webhookUrl);
  
  console.log(`RMB nations:    ${config.rmbNations?.join(", ") || "none"}`);
  console.log(`Dispatch nations: ${config.dispatchNations?.join(", ") || "none"}`);
  console.log("════════════════════════════════════════════\n");

  await connectSSE(config, webhook);
}

main().catch(console.error);
