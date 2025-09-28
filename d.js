const WebSocket = require('ws');
const tls = require('tls');
const guilds = new Map();
const listToken = '';
const guildId = "";
const password = "";
let mfaToken = null;
let lastSequence = null;
let heartbeatInterval = null;
let globalSocket = null;
let mfaInProgress = false;
async function req(method, path, body = null, extraHeaders = {}, useClose = false) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : '';
        
        if (!globalSocket || globalSocket.destroyed || useClose) {
            globalSocket = tls.connect({
                host: 'canary.discord.com',
                port: 443,
                rejectUnauthorized: true,
                minVersion: 'TLSv1.2',
                maxVersion: 'TLSv1.2'
            });
        }
        
        const socket = globalSocket;
        
        const headers = [
            `${method} ${path} HTTP/1.1`,
            'Host: canary.discord.com',
            `Connection: ${useClose ? 'close' : 'keep-alive'}`,
            'Content-Type: application/json',
            `Content-Length: ${Buffer.byteLength(data)}`,
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0)',
            `Authorization: ${listToken}`,
            'X-Super-Properties: eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRmlyZWZveCIsImRldmljZSI6IiIsInN5c3RlbV9sb2NhbGUiOiJ0ci1UUiIsImJyb3dzZXJfdXNlcl9hZ2VudCI6Ik1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQ7IHJ2OjEzMy4wKSBHZWNrby8yMDEwMDEwMSBGaXJlZm94LzEzMy4wIiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTMzLjAiLCJvc192ZXJzaW9uIjoiMTAiLCJyZWZlcnJlciI6Imh0dHBzOi8vd3d3Lmdvb2dsZS5jb20vIiwicmVmZXJyaW5nX2RvbWFpbiI6Ind3dy5nb29nbGUuY29tIiwic2VhcmNoX2VuZ2luZSI6Imdvb2dsZSIsInJlZmVycmVyX2N1cnJlbnQiOiIiLCJyZWZlcnJpbmdfZG9tYWluX2N1cnJlbnQiOiIiLCJyZWxlYXNlX2NoYW5uZWwiOiJjYW5hcnkiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjozNTYxNDAsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGwsImhhc19jbGllbnRfbW9kcyI6ZmFsc2V9'
        ];
        if (extraHeaders['X-Discord-MFA-Authorization']) {
            headers.push(`X-Discord-MFA-Authorization: ${extraHeaders['X-Discord-MFA-Authorization']}`);
        }
        headers.push('', data);
        socket.write(headers.join('\r\n'));
        
        let output = '';
        socket.on('data', chunk => output += chunk.toString());
        socket.on('end', () => {
            try {
                const i = output.indexOf('\r\n\r\n');
                if (i === -1) return resolve('{}');
                let b = output.slice(i + 4);
                if (output.toLowerCase().includes('transfer-encoding: chunked')) {
                    let r = '', o = 0;
                    while (o < b.length) {
                        const s = b.indexOf('\r\n', o);
                        if (s === -1) break;
                        const c = parseInt(b.substring(o, s), 16);
                        if (c === 0) break;
                        r += b.substring(s + 2, s + 2 + c);
                        o = s + 2 + c + 2;
                    }
                    resolve(r || '{}');
                } else {
                    resolve(b || '{}');
                }
            } catch {
                resolve('{}');
            } finally {
                if (useClose) socket.destroy();
            }
        });
        socket.on('error', () => resolve('{}'));
    });
}

async function mfaAuth() {
    if (mfaInProgress) return mfaToken;
    mfaInProgress = true;
  
    try {
        const response = await req("PATCH", `/api/v7/guilds/${guildId}/vanity-url`, null, {}, true);
        const data = JSON.parse(response);
        if (data.code === 60003) {
            const mfaResponse = await req("POST", "/api/v9/mfa/finish", {
                ticket: data.mfa.ticket,
                mfa_type: "password",
                data: password,
            }, {}, true);
            const mfaData = JSON.parse(mfaResponse);
            if (mfaData.token) {
                console.log('mfa gecildi pampa');
                mfaInProgress = false;
                return mfaData.token;
            }
        }
    } catch {}
    mfaInProgress = false;
    return null;
}
function connectWebSocket() {
    const socket = new WebSocket("wss://gateway-us-east1-b.discord.gg");

    socket.on('open', () => {
        socket.send(JSON.stringify({
            op: 2,
            d: {
                token: listToken,
                intents: 513,
                properties: { $os: "linux", $browser: "", $device: "" }
            }
        }));
    });
    socket.on('message', async (data) => {
        const payload = JSON.parse(data);
        if (payload.s) lastSequence = payload.s;

        if (payload.op === 10) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = setInterval(() => {
                socket.send(JSON.stringify({ op: 1, d: lastSequence }));
            }, payload.d.heartbeat_interval);
        } else if (payload.op === 0 && payload.t === "GUILD_UPDATE") {
            const find = guilds.get(payload.d.guild_id);
            if (find && find !== payload.d.vanity_url_code) {
                console.log(find);
                if (!mfaToken) mfaToken = await mfaAuth();
                req("PATCH", `/api/v7/guilds/${guildId}/vanity-url`, 
                    { code: find }, 
                    { "X-Discord-MFA-Authorization": mfaToken });
            }
        } else if (payload.op === 0 && payload.t === "READY") {
            payload.d.guilds.forEach(guild => {
                if (guild.vanity_url_code) {
                    guilds.set(guild.id, guild.vanity_url_code);
                }
            });
            console.log("Guild's", payload.d.guilds.filter(g => g.vanity_url_code).map(g => ({ id: g.id, vanity_url_code: g.vanity_url_code })));
        }
    });
    socket.on('close', () => {
        clearInterval(heartbeatInterval);
        setTimeout(connectWebSocket, 5000);
    });

    socket.on('error', () => socket.close());
}
async function initialize() {
    mfaToken = await mfaAuth();
    setInterval(async () => {
        if (!mfaInProgress) {
            const newToken = await mfaAuth();
            if (newToken) mfaToken = newToken;
        }
    }, 120 * 1000);
    connectWebSocket();
}
initialize();
