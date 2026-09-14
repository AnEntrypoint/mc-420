#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const os = require('os');
const http = require('http');
const https = require('https');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const extractZip = require('extract-zip');

function arg(name, def) { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; }

const LOG_FILE = arg('--log', path.join(__dirname, '..', '.netboot-serve.log'));
const LOG_MAX_BYTES = parseInt(arg('--log-max-bytes', String(10 * 1024 * 1024)));
try { fs.writeFileSync(LOG_FILE, ''); } catch (e) {}
const _log = (...a) => {
  const line = a.join(' ');
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > LOG_MAX_BYTES) fs.writeFileSync(LOG_FILE, '[log] rotated (exceeded ' + LOG_MAX_BYTES + ' bytes)\n');
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {}
  process.stdout.write(line + '\n');
};
console.log = _log; console.error = _log;

const ROOT      = path.resolve(arg('--root', path.join(__dirname, '..', '.netboot-serve')));
const HTTP_PORT = parseInt(arg('--http', '8080'));
const BOOTFILE  = 'bootcode.bin';
const POOL_START = [192, 168, 137, 100];
const SUBNET     = [255, 255, 255, 0];
const LEASE_SECS = 3600;
const NETBOOT_SUBNET_PREFIX = '192.168.137.';

function localAddressesOnNetbootSubnet() {
  const ifaces = os.networkInterfaces();
  const found = [];
  for (const name of Object.keys(ifaces)) {
    for (const a of (ifaces[name] || [])) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith(NETBOOT_SUBNET_PREFIX)) {
        found.push({ iface: name, address: a.address });
      }
    }
  }
  return found;
}

function resolveServerIp() {
  const requested = arg('--server', '');
  const live = localAddressesOnNetbootSubnet();
  if (requested) {
    if (live.some(l => l.address === requested)) return requested;
    console.error('[serve] REFUSING --server ' + requested + ': no local interface holds that address.');
    console.error('[serve] A DHCP reply advertising an unreachable option-66 TFTP server makes the Pi');
    console.error('[serve] ACK and then fetch nothing -- it re-DISCOVERs forever with ZERO TFTP reads.');
    if (live.length) console.error('[serve] Live addresses on this subnet: ' + live.map(l => l.iface + '=' + l.address).join(', '));
  }
  if (live.length === 1) {
    console.log('[serve] auto-detected server IP ' + live[0].address + ' on ' + live[0].iface);
    return live[0].address;
  }
  if (live.length > 1) {
    console.log('[serve] multiple addresses on ' + NETBOOT_SUBNET_PREFIX + '0/24: ' + live.map(l => l.iface + '=' + l.address).join(', '));
    console.log('[serve] using ' + live[0].address + ' (pass --server to choose explicitly)');
    return live[0].address;
  }
  console.error('[serve] no local interface on ' + NETBOOT_SUBNET_PREFIX + '0/24 -- is the Pi cable plugged into the shared adapter?');
  process.exit(2);
}

const SERVER_IP = resolveServerIp();

const REPO           = 'AnEntrypoint/aloop';
const GITHUB_TOKEN    = arg('--token', process.env.GITHUB_TOKEN || process.env.ALOOP_GITHUB_TOKEN || '');
const AUTO_UPDATE     = process.env.ALOOP_NO_AUTO_UPDATE !== '1';
const UPDATE_INTERVAL_MS = parseInt(arg('--update-interval', '30000'));
const SHA_FILE  = path.join(path.dirname(ROOT), '.netboot-update-sha');
const PI_HOST   = arg('--pi', '192.168.137.100');
const PI_TOKEN  = arg('--pi-token', process.env.PI_TOKEN || '');
const NETBOOT_SERVER = SERVER_IP;

const BOARD = arg('--board', process.env.BOARD || 'pi4');
if (!fs.existsSync(path.join(ROOT, 'bootcode.bin'))) {
  console.error('[serve] netboot root looks wrong: no bootcode.bin in ' + ROOT + ' (run BOARD=' + BOARD + ' image/build-netboot.sh)');
  process.exit(2);
}
console.log('[serve] netboot root: ' + ROOT);
console.log('[serve] server IP:    ' + SERVER_IP + '  (DHCP :67, TFTP :69, HTTP :' + HTTP_PORT + ')');

const OP_RRQ = 1, OP_DATA = 3, OP_ACK = 4, OP_ERR = 5, OP_OACK = 6;
const leases = {};
function ip2buf(s) { return Buffer.from(s.split('.').map(Number)); }
const reservedAddresses = new Set(localAddressesOnNetbootSubnet().map(l => l.address).concat([SERVER_IP]));
function allocate(mac) {
  if (leases[mac]) return leases[mac];
  const taken = new Set(Object.values(leases).concat([...reservedAddresses]));
  for (let n = POOL_START[3]; n <= 250; n++) {
    const candidate = POOL_START.slice(0, 3).concat([n]).join('.');
    if (!taken.has(candidate)) return leases[mac] = candidate;
  }
  throw new Error('DHCP pool exhausted on ' + NETBOOT_SUBNET_PREFIX + '0/24');
}

function parseOpts(msg, offset) {
  const opts = {};
  while (offset < msg.length) {
    let e = msg.indexOf(0, offset); if (e < 0) break;
    const k = msg.slice(offset, e).toString().toLowerCase(); offset = e + 1;
    e = msg.indexOf(0, offset); if (e < 0) break;
    const v = msg.slice(offset, e).toString(); offset = e + 1;
    opts[k] = v;
  }
  return opts;
}
function buildOACK(o) {
  const parts = [];
  for (const k in o) { parts.push(Buffer.from(k), Buffer.from([0]), Buffer.from(String(o[k])), Buffer.from([0])); }
  return Buffer.concat([Buffer.from([0, OP_OACK]), ...parts]);
}
function handleRRQ(filename, rinfo, options) {
  const safe = path.normalize(filename).replace(/^(\.\.[/\\])+/, '');
  let full = path.join(ROOT, safe);
  if (!full.startsWith(ROOT)) return;
  if (!fs.existsSync(full)) {
    const parts = safe.split(/[/\\]/);
    if (parts.length > 1) {
      const fallback = path.join(ROOT, ...parts.slice(1));
      if (fallback.startsWith(ROOT) && fs.existsSync(fallback)) { full = fallback; }
    }
  }
  const xfer = dgram.createSocket('udp4');
  xfer.bind(0, () => {
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      const e = Buffer.alloc(4 + 15); e.writeUInt16BE(OP_ERR, 0); e.writeUInt16BE(1, 2); Buffer.from('File not found').copy(e, 4);
      xfer.send(e, rinfo.port, rinfo.address); setTimeout(() => xfer.close(), 500);
      console.error('[TFTP] NOT FOUND: ' + safe); return;
    }
    const data = fs.readFileSync(full);
    const blksize = options.blksize ? parseInt(options.blksize) : 512;
    const replyOpts = {};
    if (options.blksize) replyOpts.blksize = String(blksize);
    if (options.tsize) replyOpts.tsize = String(data.length);
    const blocks = Math.ceil(data.length / blksize) || 1;
    let acked = (options.blksize || options.tsize) ? -1 : 0;
    if (Object.keys(replyOpts).length) xfer.send(buildOACK(replyOpts), rinfo.port, rinfo.address);
    else { const d = Buffer.alloc(4 + Math.min(blksize, data.length)); d.writeUInt16BE(OP_DATA, 0); d.writeUInt16BE(1, 2); data.copy(d, 4, 0, blksize); xfer.send(d, rinfo.port, rinfo.address); acked = 0; }
    tftpReadCount++;
    console.log('[TFTP] ' + safe + ' -> ' + rinfo.address + ' (' + data.length + 'B)');
    xfer.on('message', msg => {
      if (msg.readUInt16BE(0) !== OP_ACK) return;
      const blk = msg.readUInt16BE(2);
      if (blk !== acked + 1 && !(blk === 0 && acked === -1)) return;
      acked = blk;
      if (acked >= blocks) { xfer.close(); return; }
      const start = acked * blksize, chunk = data.slice(start, start + blksize);
      const pkt = Buffer.alloc(4 + chunk.length); pkt.writeUInt16BE(OP_DATA, 0); pkt.writeUInt16BE((acked + 1) & 0xffff, 2); chunk.copy(pkt, 4);
      xfer.send(pkt, rinfo.port, rinfo.address);
    });
  });
}
const tftp = dgram.createSocket('udp4');
tftp.on('message', (msg, rinfo) => {
  if (msg.readUInt16BE(0) !== OP_RRQ) return;
  let offset = 2; const end = msg.indexOf(0, offset);
  const filename = msg.slice(offset, end).toString(); offset = end + 1;
  const modeEnd = msg.indexOf(0, offset); offset = modeEnd + 1;
  handleRRQ(filename, rinfo, parseOpts(msg, offset));
});
tftp.on('error', err => { if (err.code === 'EACCES') { console.error('[TFTP] need ADMIN: port 69'); process.exit(1); } console.error('[TFTP]', err.message); });
tftp.bind(69, '0.0.0.0', () => console.log('[TFTP] listening :69'));

const dhcpRequestCount = new Map();
let tftpReadCount = 0;
let bootOptionWarned = false;

const SUBNET_DIRECTED_BROADCAST = NETBOOT_SUBNET_PREFIX + '255';
function replyDestinations(offeredIp) { return [SUBNET_DIRECTED_BROADCAST, offeredIp]; }

const LOCAL_MACS = new Set();
for (const addrs of Object.values(os.networkInterfaces())) {
  for (const a of (addrs || [])) {
    if (a.mac && a.mac !== '00:00:00:00:00:00') LOCAL_MACS.add(a.mac.toLowerCase());
  }
}
const localMacWarned = new Set();
const DHCP_OPT_MSG_TYPE = 53;
const DHCP_OPT_SERVER_ID = 54;
const DHCP_OPT_LEASE_TIME = 51;
const DHCP_OPT_SUBNET_MASK = 1;
const DHCP_OPT_TFTP_SERVER = 66;
const DHCP_OPT_BOOTFILE = 67;
const DHCP_OPT_END = 255;
function buildDhcpReply(type, xid, mac, offeredIp) {
  const buf = Buffer.alloc(576);
  buf[0] = 2; buf[1] = 1; buf[2] = 6; buf.writeUInt32BE(xid, 4); buf.writeUInt16BE(0x8000, 10);
  ip2buf(offeredIp).copy(buf, 16); ip2buf(SERVER_IP).copy(buf, 20); mac.copy(buf, 28);
  buf.writeUInt32BE(0x63825363, 236);
  let o = 240;
  buf[o++] = DHCP_OPT_MSG_TYPE; buf[o++] = 1; buf[o++] = type;
  buf[o++] = DHCP_OPT_SERVER_ID; buf[o++] = 4; ip2buf(SERVER_IP).copy(buf, o); o += 4;
  buf[o++] = DHCP_OPT_LEASE_TIME; buf[o++] = 4; buf.writeUInt32BE(LEASE_SECS, o); o += 4;
  buf[o++] = DHCP_OPT_SUBNET_MASK; buf[o++] = 4; Buffer.from(SUBNET).copy(buf, o); o += 4;
  const tftpServerAddr = Buffer.from(SERVER_IP);
  buf[o++] = DHCP_OPT_TFTP_SERVER; buf[o++] = tftpServerAddr.length; tftpServerAddr.copy(buf, o); o += tftpServerAddr.length;
  const bootfileName = Buffer.from(BOOTFILE + '\0');
  buf[o++] = DHCP_OPT_BOOTFILE; buf[o++] = bootfileName.length; bootfileName.copy(buf, o); o += bootfileName.length;
  buf[o++] = DHCP_OPT_END;
  return buf.slice(0, o);
}
const dhcp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
dhcp.on('message', (msg) => {
  try {
    if (msg.length < 240 || msg[0] !== 1 || msg.readUInt32BE(236) !== 0x63825363) return;
    const xid = msg.readUInt32BE(4), mac = msg.slice(28, 34);
    const macStr = Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join(':');
    if (LOCAL_MACS.has(macStr)) {
      if (!localMacWarned.has(macStr)) {
        localMacWarned.add(macStr);
        console.log('[DHCP] ignoring ' + macStr + ' -- that is this host\'s own NIC, not a netboot client. ' +
          'Leasing to it would hand the host an address out of the Pi\'s pool and move SERVER_IP underneath us.');
      }
      return;
    }
    let msgType = 0, o = 240;
    while (o < msg.length) {
      const opt = msg[o++];
      if (opt === DHCP_OPT_END) break;
      if (opt === 0) continue;
      const lengthBytePromisedButAbsent = o >= msg.length;
      if (lengthBytePromisedButAbsent) break;
      const len = msg[o++];
      if (opt === DHCP_OPT_MSG_TYPE && o < msg.length) msgType = msg[o];
      o += len;
    }
    const offeredIp = allocate(macStr);
    console.log('[DHCP] ' + (msgType === 1 ? 'DISCOVER' : msgType === 3 ? 'REQUEST' : 'type' + msgType) + ' from ' + macStr + ' -> ' + offeredIp + ' (boot=' + BOOTFILE + ', tftp=' + SERVER_IP + ')');
    const reply = buildDhcpReply(msgType === 1 ? 2 : 5, xid, mac, offeredIp);
    const sendReply = () => {
      for (const dest of replyDestinations(offeredIp)) {
        dhcp.send(reply, 68, dest, err => {
          if (!err) return;
          console.error('[DHCP] send ' + err.message.replace(/^send /, '') + ' -> ' + dest);
          if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
            console.error('[DHCP] the limited broadcast left via the wrong interface. Replies are sent to the ' +
              NETBOOT_SUBNET_PREFIX + '255 directed broadcast and to the offered address so they stay on ' +
              SERVER_IP + "'s link.");
          }
        });
      }
    };
    sendReply();
    setTimeout(sendReply, 40);
    setTimeout(sendReply, 120);
    if (msgType === 3) {
      dhcpRequestCount.set(macStr, (dhcpRequestCount.get(macStr) || 0) + 1);
      const n = dhcpRequestCount.get(macStr);
      if (n >= 4 && tftpReadCount === 0 && !bootOptionWarned) {
        bootOptionWarned = true;
        console.error('[DHCP] DIAGNOSIS: ' + macStr + ' has sent ' + n + ' REQUESTs and NOTHING has been ' +
          'fetched over TFTP. We are advertising option 66 = ' + SERVER_IP + '. Verify that address is ' +
          'reachable FROM THE CLIENT and that the netboot tree was built with NETBOOT_SERVER=' + SERVER_IP +
          ' (cmdline.txt bakes the HTTP URLs at build time, so a stale tree fails after DHCP succeeds). ' +
          'A second DHCP server answering without options 66/67 would also produce this.');
      }
    }
  } catch (e) {
    console.error('[DHCP] malformed packet, ignored:', e.message);
  }
});
dhcp.on('error', err => { if (err.code === 'EACCES') { console.error('[DHCP] need ADMIN: port 67'); process.exit(1); } console.error('[DHCP]', err.message); });
dhcp.bind(67, '0.0.0.0', () => {
  dhcp.setBroadcast(true);
  try { dhcp.setMulticastInterface(SERVER_IP); } catch (e) {}
  console.log('[DHCP] listening :67 (replies via ' + SERVER_IP + ' to ' + SUBNET_DIRECTED_BROADCAST + ')');
});

const mime = { '.tar': 'application/x-tar', '.gz': 'application/gzip' };
const httpSrv = http.createServer((req, res) => {
  const safe = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(ROOT, safe);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.statusCode = 404; res.end('not found'); console.log('[HTTP] 404 ' + safe); return; }
  res.setHeader('Content-Type', mime[path.extname(full)] || 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(full).size);
  fs.createReadStream(full).pipe(res);
  console.log('[HTTP] 200 ' + safe + ' (' + fs.statSync(full).size + 'B)');
});
httpSrv.on('error', err => console.error('[HTTP]', err.message));
httpSrv.listen(HTTP_PORT, SERVER_IP, () => console.log('[HTTP] listening http://' + SERVER_IP + ':' + HTTP_PORT + '/'));

let currentSha = null, rateLimitedUntil = 0;
const EXPIRED_SHA_RETRY_MS = 5 * 60 * 1000;
const knownExpiredShas = new Map();
try { currentSha = fs.readFileSync(SHA_FILE, 'utf8').trim(); console.log('[update] last-built sha: ' + currentSha); } catch (e) {}

function ghGet(apiPath) {
  return new Promise((resolve, reject) => {
    https.get('https://api.github.com' + apiPath, {
      headers: { 'User-Agent': 'aloop-netboot-serve/1.0', 'Authorization': 'token ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github+json' }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return ghGet(new URL(res.headers.location).pathname + new URL(res.headers.location).search).then(resolve).catch(reject);
      let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}
function downloadArtifactZip(archiveUrl, destZip) {
  return new Promise((resolve, reject) => {
    const originalHost = new URL(archiveUrl).host;
    const follow = u => {
      const sameHost = new URL(u).host === originalHost;
      const headers = { 'User-Agent': 'aloop-netboot-serve/1.0' };
      if (sameHost) headers['Authorization'] = 'token ' + GITHUB_TOKEN;
      https.get(u, { headers }, res => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) return follow(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error('artifact download HTTP ' + res.statusCode));
        const tmp = destZip + '.tmp', out = fs.createWriteStream(tmp);
        const cleanupAndReject = err => { fs.rmSync(tmp, { force: true }); reject(err); };
        res.on('error', cleanupAndReject);
        res.pipe(out);
        out.on('finish', () => { fs.renameSync(tmp, destZip); resolve(); });
        out.on('error', cleanupAndReject);
      }).on('error', reject);
    };
    follow(archiveUrl);
  });
}
async function latestGreenRun(workflowFile) {
  const r = await ghGet('/repos/' + REPO + '/actions/workflows/' + workflowFile + '/runs?status=success&branch=main&per_page=1');
  if (r.status === 403 || r.status === 429) { rateLimitedUntil = Date.now() + (parseInt(r.headers['retry-after'] || '60') * 1000); console.error('[update] rate-limited'); return null; }
  if (r.status !== 200) { console.log('[update] ' + workflowFile + ' runs: GitHub status ' + r.status); return null; }
  const runs = JSON.parse(r.body).workflow_runs;
  return runs && runs[0] ? runs[0] : null;
}
class ArtifactExpiredError extends Error {}
async function downloadRunArtifact(runId, artifactName, destDir) {
  const r = await ghGet('/repos/' + REPO + '/actions/runs/' + runId + '/artifacts');
  if (r.status !== 200) throw new Error('list artifacts HTTP ' + r.status);
  const art = JSON.parse(r.body).artifacts.find(a => a.name === artifactName);
  if (!art) throw new Error('no artifact named ' + artifactName + ' on run ' + runId);
  if (art.expired) throw new ArtifactExpiredError(artifactName + ' on run ' + runId + ' expired at ' + art.expires_at);
  fs.mkdirSync(destDir, { recursive: true });
  const zipPath = path.join(destDir, artifactName + '.zip');
  await downloadArtifactZip(art.archive_download_url, zipPath);
  await extractZip(zipPath, { dir: destDir });
  return destDir;
}
function sendPiReboot() {
  if (!PI_TOKEN) { console.log('[update] no --pi-token/PI_TOKEN set — skipping REBOOT (Pi will pick up the new build on its NEXT power-cycle anyway)'); return; }
  const sock = dgram.createSocket('udp4');
  const msg = Buffer.from('REBOOT:' + PI_TOKEN);
  sock.send(msg, 4446, PI_HOST, err => { sock.close(); console.log(err ? '[update] REBOOT send failed: ' + err.message : '[update] REBOOT sent to ' + PI_HOST + ':4446'); });
}
let updateInFlight = false;
let updateInFlightSince = 0;
const CHILD_REBUILD_TIMEOUT_MS = 5 * 60 * 1000;
const IN_FLIGHT_WEDGE_MS = CHILD_REBUILD_TIMEOUT_MS * 2.4;
async function checkAndUpdate() {
  if (!AUTO_UPDATE) return;
  if (!GITHUB_TOKEN) { console.error('[update] no GITHUB_TOKEN/ALOOP_GITHUB_TOKEN/--token set — aloop/aloop is PRIVATE, auto-update cannot list runs or download artifacts without one. Set the env var or pass --token, or set ALOOP_NO_AUTO_UPDATE=1 to silence this.'); return; }
  if (updateInFlight) {
    const heldMs = Date.now() - updateInFlightSince;
    if (heldMs < IN_FLIGHT_WEDGE_MS) {
      console.log(`[update] rebuild already in progress (${Math.round(heldMs / 1000)}s), skipping this tick`);
      return;
    }
    console.error(`[update] WEDGED: rebuild guard held ${Math.round(heldMs / 1000)}s (> ${IN_FLIGHT_WEDGE_MS / 1000}s). ` +
                  'The previous rebuild never completed, so the served netboot root is STALE and any device ' +
                  'netbooting right now gets the OLD image. Forcing the guard open and retrying.');
    updateInFlight = false;
  }
  updateInFlight = true;
  updateInFlightSince = Date.now();
  let sha = null;
  try {
    if (Date.now() < rateLimitedUntil) { console.log('[update] rate-limited, skipping this tick'); return; }
    const [binRun, lv2Run] = await Promise.all([latestGreenRun('build-binary.yml'), latestGreenRun('build-lv2.yml')]);
    if (!binRun || !lv2Run) { console.log('[update] no green build-binary/build-lv2 run found yet'); return; }
    sha = binRun.head_sha + ':' + lv2Run.head_sha;
    if (sha === currentSha) { console.log('[update] up to date (sha ' + sha.slice(0, 16) + '...)'); return; }
    const expiredAt = knownExpiredShas.get(sha);
    if (expiredAt !== undefined) {
      const retryInMs = expiredAt + EXPIRED_SHA_RETRY_MS - Date.now();
      if (retryInMs > 0) {
        console.log('[update] sha ' + sha.slice(0, 16) + '... had expired artifacts, retrying in ' + Math.ceil(retryInMs / 1000) + 's (a rerun of the same commit can refresh them)');
        return;
      }
      knownExpiredShas.delete(sha);
    }
    console.log('[update] new build found: ' + sha.slice(0, 16) + '... (was ' + (currentSha ? currentSha.slice(0, 16) + '...' : 'none') + ')');

    const work = path.join(path.dirname(ROOT), '.netboot-update-work');
    fs.rmSync(work, { recursive: true, force: true });
    const binDir = await downloadRunArtifact(binRun.id, 'aloop-aarch64-musl', path.join(work, 'bin'));
    const lv2Dir = await downloadRunArtifact(lv2Run.id, 'home-fx-lv2', path.join(work, 'lv2'));
    await downloadRunArtifact(lv2Run.id, 'guitar-lofi-fx-lv2', lv2Dir);
    const resonodeDir = await downloadRunArtifact(lv2Run.id, 'resonode-lv2', path.join(work, 'resonode'));
    const pitchTrackerDir = await downloadRunArtifact(lv2Run.id, 'pitchtracker-lv2', path.join(work, 'pitchtracker'));
    const delayVerbDir = await downloadRunArtifact(lv2Run.id, 'delayverb-lv2', path.join(work, 'delayverb'));
    const aloopBin = path.join(binDir, 'aloop');
    if (!fs.existsSync(aloopBin)) throw new Error('aloop binary not found in downloaded artifact at ' + aloopBin);

    console.log('[update] rebuilding netboot root -> ' + ROOT);
    const gitBashCandidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    const bashExe = gitBashCandidates.find(p => fs.existsSync(p)) || 'bash';
    const buildScript = path.join(__dirname, 'build-netboot.sh').replace(/\\/g, '/');
    const REBUILD_TIMEOUT_MS = CHILD_REBUILD_TIMEOUT_MS;
    const alpineVersion = process.env.ALPINE_VERSION || '3.20.3';
    const alpineTarball = path.join(path.dirname(ROOT), '.netboot-cache', 'alpine-rpi-' + alpineVersion + '-aarch64.tar.gz');
    if (!fs.existsSync(alpineTarball)) {
      fs.mkdirSync(path.dirname(alpineTarball), { recursive: true });
      console.log('[update] caching Alpine tarball ' + alpineTarball);
      await downloadArtifactZip(
        'https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/aarch64/' + path.basename(alpineTarball),
        alpineTarball);
    }
    await execFileAsync(bashExe, [buildScript], {
      cwd: path.join(__dirname, '..'),
      env: Object.assign({}, process.env, { OUT: ROOT, BOARD: BOARD, ALOOP_BIN: aloopBin, LV2_DIR: lv2Dir, RESONODE_LV2_DIR: resonodeDir, PITCHTRACKER_LV2_DIR: pitchTrackerDir, DELAYVERB_LV2_DIR: delayVerbDir, NETBOOT_SERVER: NETBOOT_SERVER, ALPINE_VERSION: alpineVersion, ALPINE_TARBALL: alpineTarball }),
      timeout: REBUILD_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024
    });
    try {
      const servedOvl = path.join(ROOT, 'aloop.apkovl.tar.gz');
      const st = fs.statSync(servedOvl);
      const ageMs = Date.now() - st.mtimeMs;
      if (ageMs > 10 * 60 * 1000) {
        console.error(`[update] WARNING: ${servedOvl} is ${Math.round(ageMs / 60000)} min old right after a ` +
                      'rebuild -- the rebuild did NOT replace the served apkovl. Devices will netboot a STALE image.');
      } else {
        console.log(`[update] served apkovl refreshed (${st.size} bytes)`);
      }
    } catch (e) {
      console.error('[update] WARNING: could not stat the served apkovl after rebuild: ' + e.message);
    }
    currentSha = sha; fs.writeFileSync(SHA_FILE, sha);
    console.log('[update] netboot root rebuilt with the new build; sending REBOOT so the Pi re-fetches it');
    sendPiReboot();
  } catch (e) {
    if (e instanceof ArtifactExpiredError && sha) {
      knownExpiredShas.set(sha, Date.now());
      console.error('[update] ' + sha.slice(0, 16) + '... artifacts expired before this Pi netbooted (retention-days: 3) -- ' +
                     'will wait ' + (EXPIRED_SHA_RETRY_MS / 1000) + 's before retrying (a rerun of the same run can refresh the artifacts) instead of retrying every tick: ' + e.message);
    } else {
      console.error('[update] failed:', e.message);
    }
  } finally {
    updateInFlight = false;
  }
}

if (AUTO_UPDATE && !GITHUB_TOKEN) {
  console.error('[update] AUTO-UPDATE DISABLED: no GitHub token available (set GITHUB_TOKEN or --token, or ALOOP_NO_AUTO_UPDATE=1 to silence this warning)');
} else if (AUTO_UPDATE) {
  console.log('[update] self-update ENABLED — polling build-binary/build-lv2 every ' + (UPDATE_INTERVAL_MS / 1000) + 's');
  checkAndUpdate();
  setInterval(checkAndUpdate, UPDATE_INTERVAL_MS);
} else {
  console.log('[update] self-update DISABLED (ALOOP_NO_AUTO_UPDATE=1)');
}

console.log('[serve] ready — power-cycle the Pi (SD out, network boot). Ctrl-C to stop.');
