#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.argv[2] || process.env.PI_HOST || '192.168.137.100';
const SSH_USER = process.env.PI_SSH_USER || 'root';
const SSH_PASS = process.env.PI_SSH_PASS || 'aloop';
const REMOTE_BIN = '/opt/aloop/aloop';
const WORKFLOW = 'build-binary.yml';
const ARTIFACT = 'aloop-aarch64-musl';
const DEST_DIR = path.join(__dirname, '..', '..', '.deploy');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

function headSha() {
  return sh('git', ['rev-parse', 'HEAD']).trim();
}

async function waitForRun(sha, timeoutMs = 900000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${WORKFLOW} on ${sha}`);
    const runs = JSON.parse(sh('gh', ['run', 'list', '--workflow', WORKFLOW,
      '--json', 'headSha,status,conclusion,databaseId', '--limit', '20']));
    const run = runs.find(r => r.headSha === sha);
    if (run) {
      if (run.status === 'completed') {
        if (run.conclusion !== 'success')
          throw new Error(`${WORKFLOW} run ${run.databaseId} concluded ${run.conclusion}`);
        return run.databaseId;
      }
      console.log(`[deploy-binary] ${WORKFLOW} run ${run.databaseId} status=${run.status}, waiting...`);
    } else {
      console.log(`[deploy-binary] no ${WORKFLOW} run yet for ${sha}, waiting...`);
    }
    await sleep(15000);
  }
}

function findBinary(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(p);
      if (found) return found;
    } else if (entry.name === 'aloop') {
      return p;
    }
  }
  return null;
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({ host: HOST, username: SSH_USER, password: SSH_PASS, readyTimeout: 20000 });
  });
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('close', code => resolve({ code, out, errOut }));
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
    });
  });
}

function put(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(localPath, remotePath, err2 => {
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
}

async function main() {
  const sha = headSha();
  console.log(`[deploy-binary] HEAD=${sha.slice(0, 8)} target=${HOST}`);
  const runId = await waitForRun(sha);
  console.log(`[deploy-binary] run ${runId} green, downloading ${ARTIFACT}`);
  fs.rmSync(DEST_DIR, { recursive: true, force: true });
  sh('gh', ['run', 'download', String(runId), '--name', ARTIFACT, '--dir', DEST_DIR]);
  const local = findBinary(DEST_DIR);
  if (!local) throw new Error(`no aloop binary inside ${DEST_DIR}`);
  const size = fs.statSync(local).size;
  if (size < 100000) throw new Error(`suspicious binary size ${size}`);
  console.log(`[deploy-binary] ${local} (${size} bytes)`);

  const conn = await connect();
  try {
    const tmp = `${REMOTE_BIN}.new`;
    await exec(conn, `rm -f ${tmp}`);
    await put(conn, local, tmp);
    const before = await exec(conn, `md5sum ${REMOTE_BIN} 2>/dev/null || echo missing`);
    await exec(conn, `chmod +x ${tmp} && mv -f ${tmp} ${REMOTE_BIN} && sync`);
    const after = await exec(conn, `md5sum ${REMOTE_BIN}`);
    console.log(`[deploy-binary] md5 before: ${before.out.trim()}`);
    console.log(`[deploy-binary] md5 after:  ${after.out.trim()}`);
    const restarted = await exec(conn, 'rc-service aloop restart');
    console.log(`[deploy-binary] restart: ${(restarted.out + restarted.errOut).trim()}`);
    await sleep(4000);
    const st = await exec(conn, 'rc-service aloop status; cat /proc/uptime');
    console.log(`[deploy-binary] ${(st.out + st.errOut).trim()}`);
  } finally {
    conn.end();
  }
  console.log('[deploy-binary] done');
}

main().catch(err => {
  console.error('[deploy-binary] error:', err.message);
  process.exit(1);
});
