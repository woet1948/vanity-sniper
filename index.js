"use strict";
const tls = require("tls");
const WebSocket = require("ws");
const fs = require("fs");
const extractJsonFromString = require("extract-json-from-string");
const tlsTargets = [
  { host: "discord.com", servername: "discord.com" },
  { host: "canary.discord.com", servername: "canary.discord.com" },
  { host: "ptb.discord.com", servername: "ptb.discord.com" }
];
const sessionCache = new Map();
const tlsOptionsBase = {
  host: 'canary.discord.com',
  port: 8443,
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.2',
  handshakeTimeout: 0,
  rejectUnauthorized: false,
  zeroRtt: true,
  servername: 'canary.discord.com',
  keepAlive: true,
  session: sessionCache.get('canary.discord.com')
};
const tlsSockets = [];
let vanity;
let mfaToken = "";
const guilds = {};
const requestCache = new Map();
const token = "";
const server = "";
const channel = "";
function updateCache() {
  tlsTargets.forEach(({ host }) => {
    if (!requestCache.has(host)) {
      requestCache.set(host, new Map());
    }
    const hostCache = requestCache.get(host);
    hostCache.clear();
    Object.values(guilds).forEach(code => {
      const payload = JSON.stringify({ code });
      const len = Buffer.byteLength(payload);
      hostCache.set(code, Buffer.from(`PATCH /api/v7/guilds/${server}/vanity-url HTTP/1.1\r\nHost: ${host}\r\nAuthorization: ${token}\r\nUser-Agent: Mozilla/5.0\r\nX-Super-Properties: eyJicm93c2VyIjoiQ2hyb21lIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiQ2hyb21lIiwiY2xpZW50X2J1bWxkX251bWJlciI6MzU1NjI0fQ==\r\nX-Discord-MFA-Authorization: ${mfaToken}\r\nContent-Type: application/json\r\nContent-Length: ${len}\r\n\r\n${payload}`));
    });
  });
}
function sendPatch(vanityCode) {
  tlsSockets.forEach(({ socket, host }) => {
    const hostCache = requestCache.get(host);
    const buffer = hostCache.get(vanityCode);
    for (let i = 0; i < 2; i++) {
      socket.write(buffer);
    }
  });
}
tlsTargets.forEach(({ host, servername }) => {
  const socket = tls.connect({ ...tlsOptionsBase, host, servername });
  socket.setNoDelay(true);
  socket.on("error", () => process.exit(1));
  socket.on("end", () => process.exit(0));
  socket.on("data", (data) => {
    const ext = extractJsonFromString(data.toString());
    const find = ext.find((e) => e.code !== undefined || e.message !== undefined);
    if (find) {
      const codeStr = find.code !== undefined ? `code: ${find.code}` : "";
      const msgStr = find.message !== undefined ? `msg: ${find.message}` : "";
      console.log(`\x1b[33m[RES]\x1b[0m [${host}] ${[codeStr, msgStr].filter(Boolean).join(" | ")}`);

      const requestBody = JSON.stringify({
        content: `@everyone ${vanity}\n\`\`\`json\n${JSON.stringify(find)}\`\`\``,
      });
      socket.write(`POST /api/channels/${channel}/messages HTTP/1.1\r\nHost: ${host}\r\nAuthorization: ${token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(requestBody)}\r\n\r\n${requestBody}`);
    }
  });
  tlsSockets.push({ socket, host });
});
tlsSockets[0].socket.once("secureConnect", () => {
  console.log(`\x1b[36m[START]\x1b[0m ${tlsTargets.length} sunucu bagli: ${tlsTargets.map(t => t.host).join(", ")}`);
  const websocket = new WebSocket("wss://gateway.discord.gg/");
  websocket.onclose = () => process.exit(0);
  websocket.onmessage = (message) => {
    const { d, op, t } = JSON.parse(message.data);
    if (t === "GUILD_UPDATE") {
      const find = guilds[d.guild_id];
      if (find && find !== d.vanity_url_code) {
        sendPatch(find);
        vanity = `${find}`;
        console.log(`\x1b[35m[SNIPE]\x1b[0m vanity düştü: ${find}`);
      }
    } else if (t === "READY") {
      Object.keys(guilds).forEach(key => delete guilds[key]);
      d.guilds.forEach((guild) => {
        if (guild.vanity_url_code) {
          guilds[guild.id] = guild.vanity_url_code;
        }
      });
      updateCache();
      const vanityList = Object.values(guilds);
      console.log(`\x1b[36m[READY]\x1b[0m ${d.user.username} | guilds: ${d.guilds.length} | vanity: ${vanityList.length}`);
      if (vanityList.length) console.log(`\x1b[32m${vanityList.join(", ")}\x1b[0m`);
    }
    if (op === 7) return process.exit();
    if (op === 10) {
      websocket.send(JSON.stringify({
        op: 2,
        d: {
          token: token,
          intents: 1 << 0,
          properties: { os: "linux", browser: "firefox", device: "Woet" }
        }
      }));
      const heartbeatInterval = d.heartbeat_interval, heartbeatPayload = '{"op":1,"d":{}}';
      setInterval(() => websocket.send(heartbeatPayload), heartbeatInterval);
    }
  };
  setInterval(() => tlsSockets.forEach(({ socket, host }) => socket.write(`GET / HTTP/1.1\r\nHost: ${host}\r\n\r\n`)), 1000);
});
fs.readFile("mfa.txt", "utf8", (err, data) => {
  if (!err) {
    mfaToken = data.trim();
    updateCache();
    console.log(`\x1b[32m[MFA]\x1b[0m Token yuklendi`);
  }
});
fs.watchFile("mfa.txt", (curr, prev) => {
  if (curr.mtime > prev.mtime) {
    fs.readFile("mfa.txt", "utf8", (err, data) => {
      if (!err) {
        mfaToken = data.trim();
        updateCache();
        console.log(`\x1b[32m[MFA]\x1b[0m Token yenilendi`);
      }
    });
  }
});
