#!/usr/bin/env node
// Watches for a new green build-binary.yml run on the current HEAD commit,
// downloads the aloop-aarch64-musl artifact, and deploys it to the live
// device via the same stop -> sftp fastPut -> chmod -> start sequence
// deploy.js uses (never a bare restart -- musl ETXTBSY against a
// currently-executing binary's inode, see AGENTS.md's dsp-hotdeploy.js
// note). Meant for exactly this session's iterate-on-a-live-bug loop:
// push a commit, this notices it went green, deploys automatically, no
// manual gh run download / node deploy.js round trip per iteration.
//
// Usage: node auto-deploy-watch.js [--host 192.168.137.100] [--once]
//   --once   check once and exit (0 if deployed, 1 if not yet ready)
//   default: poll every 15s until the current HEAD's build goes green,
//            deploy, then keep watching for the NEXT commit's build too
//            (so it can be left running across multiple iterations)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Client } = require('ssh2');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}
const HOST = arg('--host', '192.168.137.100');
const ONCE = process.argv.includes('--once');
const POLL_MS = 15000;
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function gh(args) {
  return execFileSync('gh', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}
function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function currentHeadSha() {
  return git(['rev-parse', 'HEAD']);
}

function findGreenRun(sha) {
  const out = gh([
    'run', 'list', '--branch', 'main', '--workflow', 'build-binary.yml',
    '--limit', '10', '--json', 'databaseId,status,conclusion,headSha',
  ]);
  const runs = JSON.parse(out);
  return runs.find((r) => r.headSha === sha && r.status === 'completed' && r.conclusion === 'success');
}

function findFailedRun(sha) {
  const out = gh([
    'run', 'list', '--branch', 'main', '--workflow', 'build-binary.yml',
    '--limit', '10', '--json', 'databaseId,status,conclusion,headSha',
  ]);
  const runs = JSON.parse(out);
  return runs.find((r) => r.headSha === sha && r.status === 'completed' && r.conclusion !== 'success');
}

function downloadArtifact(runId) {
  const workDir = path.join(os.tmpdir(), `aloop-autodeploy-${runId}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  gh(['run', 'download', String(runId), '-n', 'aloop-aarch64-musl', '-D', workDir]);
  const binPath = path.join(workDir, 'aloop');
  if (!fs.existsSync(binPath)) throw new Error(`expected aloop binary at ${binPath}`);
  return binPath;
}

function execP(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream
        .on('close', (code) => resolve({ code, out, errOut }))
        .on('data', (d) => (out += d.toString()))
        .stderr.on('data', (d) => (errOut += d.toString()));
    });
  });
}

function deployToDevice(localPath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', async () => {
        try {
          await execP(conn, 'rc-service aloop stop');
          await new Promise((res, rej) => {
            conn.sftp((err, sftp) => {
              if (err) return rej(err);
              sftp.fastPut(localPath, '/opt/aloop/aloop', {}, (e2) => (e2 ? rej(e2) : res()));
            });
          });
          await execP(conn, 'chmod +x /opt/aloop/aloop');
          const md5 = await execP(conn, 'md5sum /opt/aloop/aloop');
          await execP(conn, 'rc-service aloop start');
          await new Promise((r) => setTimeout(r, 2000));
          const status = await execP(conn, 'rc-service aloop status; cat /proc/uptime');
          conn.end();
          resolve({ md5: md5.out.trim(), status: status.out.trim() });
        } catch (e) {
          conn.end();
          reject(e);
        }
      })
      .on('error', reject)
      .connect({ host: HOST, username: 'root', password: 'aloop', readyTimeout: 15000 });
  });
}

async function tryDeployForSha(sha) {
  const green = findGreenRun(sha);
  if (green) {
    console.log(`[auto-deploy] commit ${sha.slice(0, 10)} is green (run ${green.databaseId}) -- deploying`);
    const bin = downloadArtifact(green.databaseId);
    const result = await deployToDevice(bin);
    console.log(`[auto-deploy] deployed: ${result.md5}`);
    console.log(`[auto-deploy] status: ${result.status.replace(/\n/g, ' | ')}`);
    return 'deployed';
  }
  const failed = findFailedRun(sha);
  if (failed) {
    console.log(`[auto-deploy] commit ${sha.slice(0, 10)} FAILED CI (run ${failed.databaseId}) -- not deploying. Check: gh run view ${failed.databaseId} --log-failed`);
    return 'failed';
  }
  console.log(`[auto-deploy] commit ${sha.slice(0, 10)} -- no completed build-binary.yml run yet, waiting`);
  return 'pending';
}

async function main() {
  let lastDeployedSha = null;
  for (;;) {
    const sha = currentHeadSha();
    if (sha !== lastDeployedSha) {
      const outcome = await tryDeployForSha(sha);
      if (outcome === 'deployed') {
        lastDeployedSha = sha;
        if (ONCE) return 0;
      } else if (ONCE) {
        return 1;
      }
    } else if (ONCE) {
      return 0;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().then((code) => process.exit(code || 0)).catch((e) => {
  console.error('[auto-deploy] FAILED:', e.message);
  process.exit(1);
});
