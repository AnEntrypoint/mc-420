const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src', 'dsp', 'audio_thread.cpp');
const L = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(10));
const at = (n) => (L[n - 1] === undefined ? '' : L[n - 1]);
const block = (a, b) => L.slice(a - 1, b).join(String.fromCharCode(10));

const N = 64;
const PERIOD = 64;
const BUFFER = 128;
const SR = 48000;
const DELTA_REF = 51.9;
const QUANTA = [32, 64, 128, 256];
const QUANTUM_TOL = 0.10;
const TRIM_TOL = 1.0;
const PEER_BASELINE_RT = 121.4;
const PEER_TOL = 0.10 * PERIOD;
const LINK_IDS = ['masterPhaseSamples','linkSpeedRatio','effSpeed','linkPhaseTrim','linkSnap','rebaseSeq','phaseAtTime','forceBeatAtTime','imposeTempo','linkTargetSamples','masterPhaseSlope'];

const baseline = { bias: 185.4, rt: 121.4, peers: 0 };
const plateau = [ { t: 15, bias: 237.3, rt: 173.3 }, { t: 30, bias: 237.4, rt: 173.4 }, { t: 45, bias: 237.1, rt: 173.1 } ];
const preDeployPeers1 = [ { bias: 196.7, rt: 132.7, tag: 'window2 BEFORE peers=1' }, { bias: 190.3, rt: 126.3, tag: 'window3 BEFORE peers=1' } ];
const postDeployPeerless = { bias: 184.7, rt: 120.7, tag: 'post-deploy peerless peers=0' };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const plateauBias = mean(plateau.map((p) => p.bias));
const plateauRt = mean(plateau.map((p) => p.rt));
const dBias = plateauBias - baseline.bias;
const dRt = plateauRt - baseline.rt;
const dTrim = dBias - dRt;
const shiftMs = (dRt / SR) * 1000;
const fracPeriod = dRt / PERIOD;
const fracBuffer = dRt / BUFFER;
const fracN = dRt / N;

const quantaTest = QUANTA.map((q) => ({ quantum: q, absDiff: +Math.abs(dRt - q).toFixed(2), within10pct: Math.abs(dRt - q) <= QUANTUM_TOL * q }));
const quantumHits = QUANTA.filter((q) => Math.abs(dRt - q) <= QUANTUM_TOL * q);

const roundTripRange = block(1485, 1503);
const alsaParamRange = block(540, 608);
const roundTripLink = LINK_IDS.filter((id) => roundTripRange.indexOf(id) >= 0);
const alsaParamLink = LINK_IDS.filter((id) => alsaParamRange.indexOf(id) >= 0);

const codeFacts = {
  capDelay648: at(648).indexOf('snd_pcm_delay(cap') >= 0,
  playDelay1472: at(1472).indexOf('snd_pcm_delay(play') >= 0,
  roundTripNow1485: at(1485).indexOf('roundTripNow') >= 0 && at(1485).indexOf('playDelayFrames') >= 0,
  window4s1494: at(1494).indexOf('4.0') >= 0 && at(1494).indexOf('sampleRate') >= 0,
  alsa1501: at(1501).indexOf('alsaRoundTripSamples') >= 0 && at(1501).indexOf('roundTripEstSamples') >= 0,
  bias1503: at(1503).indexOf('latencyBiasSamples') >= 0 && at(1503).indexOf('trimSamples') >= 0,
  period1558: at(558).indexOf('set_period_size_near') >= 0,
  buffer2559: at(559).indexOf('period * 2') >= 0,
  startThreshold577: at(577).indexOf('set_start_threshold') >= 0,
  trimTerm1500: at(1500).indexOf('g_liveLatencyTrimSamples') >= 0
};
const factsPass = Object.keys(codeFacts).every((k) => codeFacts[k] === true);

const peerLow = preDeployPeers1.filter((p) => Math.abs(p.rt - PEER_BASELINE_RT) <= PEER_TOL);
const everyPeer1Elevated = plateau.concat(preDeployPeers1).every((p) => p.rt >= PEER_BASELINE_RT + 0.5 * DELTA_REF);

const linkCanChangeSndPcmDelay = roundTripLink.length > 0 || alsaParamLink.length > 0;
const h2Supported = Math.abs(dTrim) > TRIM_TOL || linkCanChangeSndPcmDelay;
const h3Supported = everyPeer1Elevated && peerLow.length === 0;

const ranked = [
  { id: 'H1_DISCRETE_ALSA_QUANTUM', verdict: quantumHits.length > 0 ? 'SUPPORTED' : 'REFUTED', number: 'dRt=' + dRt.toFixed(3) + ' not within 10pct of {32,64,128,256}', evidence: 'audio_thread.cpp:558-560,1485' },
  { id: 'H2_LINK_PHASE_TRIM_CAUSE', verdict: h2Supported ? 'SUPPORTED' : 'REFUTED', number: 'dTrim=' + dTrim.toFixed(3) + ' roundTripLinkHits=' + roundTripLink.length, evidence: 'audio_thread.cpp:1485-1503,540-608,837-1082' },
  { id: 'H3_PEER_PRESENCE_SUFFICIENT', verdict: h3Supported ? 'SUPPORTED' : 'REFUTED', number: 'peers=1 LOW controls=' + peerLow.length, evidence: 'esp window3 witness window2/3 BEFORE' },
  { id: 'H4_BUILD_OR_REVERT', verdict: 'REFUTED', number: 'referenced 69e47f66, corroborated by diff', evidence: 'git diff 77bd050c..6abaacee -- src/ dsp/ effects/' },
  { id: 'H5_RESTART_ALSA_BUFFER_STATE', verdict: 'NOT_MEASURABLE_OFFLINE', number: 'needs device restart control', evidence: 'audio_thread.cpp:577,578,648,1472,1485-1495' }
];

const structural = { claim: 'Link phase-trim / varispeed CAN change snd_pcm_delay', verdict: linkCanChangeSndPcmDelay ? 'SUPPORTED' : 'REFUTED', roundTripLinkHits: roundTripLink, alsaParamLinkHits: alsaParamLink };

const pass = Math.abs(dBias - dRt) < TRIM_TOL && quantumHits.length === 0 && !linkCanChangeSndPcmDelay && peerLow.length >= 1 && factsPass;

const out = {
  preregSha: '54f179e94a20c8a89428645a234386038b485169',
  identity: 'audio_thread.cpp:1503 bias = N + roundTripEst + trim; :1501 rt = roundTripEst',
  baseline: baseline,
  plateauBias: +plateauBias.toFixed(4),
  plateauRt: +plateauRt.toFixed(4),
  dBias: +dBias.toFixed(4),
  dRt: +dRt.toFixed(4),
  dTrim: +dTrim.toFixed(4),
  shiftMs: +shiftMs.toFixed(4),
  fracPeriod: +fracPeriod.toFixed(4),
  fracBuffer: +fracBuffer.toFixed(4),
  fracN: +fracN.toFixed(4),
  quantaTest: quantaTest,
  quantumHits: quantumHits,
  codeFacts: codeFacts,
  codeFactsAllHold: factsPass,
  roundTripLinkHits: roundTripLink,
  alsaParamLinkHits: alsaParamLink,
  peerLowControls: peerLow,
  everyPeers1Elevated: everyPeer1Elevated,
  postDeployPeerless: postDeployPeerless,
  structural: structural,
  ranked: ranked,
  compositeClaimC: pass ? 'PASS' : 'FAIL'
};
console.log(JSON.stringify(out, null, 2));
