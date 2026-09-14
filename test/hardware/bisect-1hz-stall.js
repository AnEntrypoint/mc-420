#!/usr/bin/env node
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const [, , host, capSecondsArg] = process.argv;
if (!host) {
  console.error('usage: node bisect-1hz-stall.js <host> [captureSeconds=15]');
  process.exit(2);
}
const captureSeconds = parseInt(capSecondsArg || '15', 10);
const CONF_PATH = '/etc/aloop.conf';
const LOG_PATH = '/var/log/aloop.log';

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn)).on('error', reject)
      .connect({ host, username: 'root', password: 'aloop', readyTimeout: 15000 });
  });
}

function execOnce(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream
        .on('close', (code) => resolve({ code, out, errOut }))
        .on('data', (d) => { out += d.toString(); })
        .stderr.on('data', (d) => { errOut += d.toString(); });
    });
  });
}

function writeFileContent(conn, remotePath, content) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const tmpPath = remotePath + '.tmp-bisect';
      const writeStream = sftp.createWriteStream(tmpPath);
      writeStream.on('close', () => {
        sftp.unlink(remotePath, () => {
          sftp.rename(tmpPath, remotePath, (err2) => (err2 ? reject(err2) : resolve()));
        });
      });
      writeStream.on('error', reject);
      writeStream.end(content);
    });
  });
}

async function restartAndWait(conn) {
  await execOnce(conn, 'rc-service aloop restart');
  for (let i = 0; i < 20; i++) {
    const r = await execOnce(conn, 'rc-service aloop status');
    if (/started/.test(r.out)) return true;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return false;
}

async function captureLogWindow(conn, seconds) {
  await execOnce(conn, `: > ${LOG_PATH}`);
  console.log(`[bisect] capturing ${seconds}s of log...`);
  await new Promise((res) => setTimeout(res, seconds * 1000));
  const r = await execOnce(conn, `cat ${LOG_PATH}`);
  return r.out;
}

const LINE_RE = /\[diag-gap\] t=(\d+)\.(\d+) readi (gap|ITSELF took)=([\d.]+)ms \(expected ~([\d.]+)ms\)/;
function parseDiagGap(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, sec, msFrac, kind, magnitude] = m;
    events.push({ t: parseInt(sec, 10) + parseInt(msFrac, 10) / 1000, kind: kind === 'gap' ? 'gap' : 'itself', magnitudeMs: parseFloat(magnitude) });
  }
  return events;
}
function summarize(label, text) {
  const events = parseDiagGap(text);
  const gapEvents = events.filter((e) => e.kind === 'gap');
  const bigEvents = gapEvents.filter((e) => e.magnitudeMs >= 10);
  let periodStr = 'n/a (fewer than 2 big events)';
  if (bigEvents.length >= 2) {
    const intervals = [];
    for (let i = 1; i < bigEvents.length; i++) intervals.push(bigEvents[i].t - bigEvents[i - 1].t);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    const stddev = Math.sqrt(variance);
    const regular = stddev < mean * 0.1;
    periodStr = `mean=${mean.toFixed(3)}s stddev=${stddev.toFixed(4)} (${regular ? 'REGULAR' : 'irregular'})`;
  }
  console.log(`[bisect] ${label}: ${events.length} diag-gap lines, ${bigEvents.length}/${gapEvents.length} big (>=10ms) gap events, period: ${periodStr}`);
  return { bigCount: bigEvents.length, totalGapCount: gapEvents.length };
}

async function main() {
  console.log(`[bisect] target=${host}, captureSeconds=${captureSeconds}`);
  const conn = await connect();
  try {
    const confRead = await execOnce(conn, `cat ${CONF_PATH}`);
    if (confRead.code !== 0) throw new Error(`could not read ${CONF_PATH}: ${confRead.errOut}`);
    const originalConf = confRead.out;
    const disableCore3ActivelySet = /^\s*disable_core3_lv2\s*=\s*1/m.test(originalConf);
    if (disableCore3ActivelySet) {
      console.warn('[bisect] WARNING: disable_core3_lv2=1 already present in the live config -- this run will still restore whatever was there, but the "baseline" capture below is NOT a true Core-3-enabled baseline.');
    }
    const backupPath = path.join(__dirname, `aloop.conf.backup.${Date.now()}`);
    fs.writeFileSync(backupPath, originalConf);
    console.log(`[bisect] saved a local backup of the live config -> ${backupPath}`);

    console.log('[bisect] === BASELINE (Core-3 LV2 host active, current shipped default) ===');
    if (!(await restartAndWait(conn))) throw new Error('service did not report started after baseline restart');
    const baselineLog = await captureLogWindow(conn, captureSeconds);
    const baselineSummary = summarize('BASELINE', baselineLog);

    console.log('[bisect] === CANDIDATE (disable_core3_lv2=1, Core-3 host path skipped) ===');
    const candidateConf = originalConf.replace(/\n?# ?disable_core3_lv2 = 1.*$/m, '') + '\ndisable_core3_lv2 = 1\n';
    await writeFileContent(conn, CONF_PATH, candidateConf);
    if (!(await restartAndWait(conn))) throw new Error('service did not report started after candidate restart');
    const candidateLog = await captureLogWindow(conn, captureSeconds);
    const candidateSummary = summarize('CANDIDATE', candidateLog);

    console.log('[bisect] === RESTORING original config ===');
    await writeFileContent(conn, CONF_PATH, originalConf);
    if (!(await restartAndWait(conn))) console.warn('[bisect] WARNING: service did not report started after restore restart -- check the device manually.');
    else console.log('[bisect] device restored to its original config and confirmed started.');

    console.log('[bisect] === VERDICT ===');
    if (baselineSummary.bigCount === 0 && candidateSummary.bigCount === 0) {
      console.log('[bisect] Neither capture showed the stall -- either it is intermittent beyond this capture window, or it is genuinely fixed. Re-run with a longer captureSeconds to be sure.');
    } else if (baselineSummary.bigCount > 0 && candidateSummary.bigCount === 0) {
      console.log('[bisect] Stall present in BASELINE, ABSENT with disable_core3_lv2=1 -- strong evidence the Core-3 LV2 host code path IS involved.');
    } else if (baselineSummary.bigCount === 0 && candidateSummary.bigCount > 0) {
      console.log('[bisect] Stall ABSENT in baseline, present with disable_core3_lv2=1 -- unexpected; the toggle itself may have introduced something, or this is noise. Re-run to confirm.');
    } else {
      console.log('[bisect] Stall present in BOTH captures -- the Core-3 LV2 host code path is NOT the (sole) cause; look elsewhere.');
    }
  } finally {
    conn.end();
  }
}

main().catch((err) => {
  console.error('[bisect] error:', err.message);
  process.exit(1);
});
