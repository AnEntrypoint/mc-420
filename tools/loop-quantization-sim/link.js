'use strict';

const LINK_QUANTUM = 16.0;
const LINK_PHASE_QUANTUM = 128.0;

let g_phaseQuantum = LINK_PHASE_QUANTUM;

function setPhaseQuantum(q) { g_phaseQuantum = q; }
function phaseQuantum() { return g_phaseQuantum; }

function createLinkSession(initialBpm) {
  return {
    tempo: initialBpm,
    gridOriginTimeMs: 0,
    beatOriginBeat: 0,
    isPlaying: false,
  };
}

function beatsSinceGrid(session, timeMs) {
  const elapsedMin = (timeMs - session.gridOriginTimeMs) / 60000;
  return elapsedMin * session.tempo;
}

function beatAtTime(session, timeMs) {
  return session.beatOriginBeat + beatsSinceGrid(session, timeMs);
}

function phaseAtTime(session, timeMs, quantum) {
  let p = beatAtTime(session, timeMs) % quantum;
  if (p < 0) p += quantum;
  return p;
}

function setTempoContinuous(session, bpm, atTimeMs) {
  const beatNow = beatAtTime(session, atTimeMs);
  const beatsAtGrid = beatsSinceGrid(session, atTimeMs);
  session.tempo = bpm;
  session.gridOriginTimeMs = atTimeMs - (beatsAtGrid / bpm) * 60000;
  session.beatOriginBeat = beatNow - beatsAtGrid;
}

function setIsPlaying(session, playing, atTimeMs) {
  session.isPlaying = playing;
}

function setIsPlayingAndRequestBeatAtTime(session, playing, atTimeMs, beat, quantum, peerCount) {
  session.isPlaying = playing;
  const beatsNow = beatsSinceGrid(session, atTimeMs);
  let beatsAtStart;
  if (peerCount > 0) {
    beatsAtStart = (Math.floor(beatsNow / quantum) + 1) * quantum;
  } else {
    const want = ((beat % quantum) + quantum) % quantum;
    const cur = ((beatsNow % quantum) + quantum) % quantum;
    let d = want - cur;
    if (d > quantum * 0.5) d -= quantum;
    if (d <= -quantum * 0.5) d += quantum;
    beatsAtStart = beatsNow + d;
    session.gridOriginTimeMs = atTimeMs - (beatsAtStart / session.tempo) * 60000;
  }
  session.beatOriginBeat = beat - beatsAtStart;
}

function createLinkPeer(name, session) {
  return {
    name,
    session,
    connected: true,
    weOwnTempo: false,
    foldBeats: 0,
    audioRead(timeMs) {
      if (!this.connected) return { synced: false, bpm: 120, peers: 0, playing: false, phaseValid: false, beatPhaseMicroBeats: 0, quantumMicroBeats: 0 };
      const peers = countOtherConnected(this);
      const foldBeats = this.foldBeats || 0;
      return {
        synced: peers > 0,
        bpm: session.tempo,
        peers,
        playing: session.isPlaying,
        phaseValid: true,
        beatPhaseMicroBeats: Math.round(phaseAtTime(session, timeMs, g_phaseQuantum) * 1e6),
        quantumMicroBeats: Math.round(g_phaseQuantum * 1e6),
        loopPhaseMicroBeats: foldBeats >= 1.0 ? Math.round(phaseAtTime(session, timeMs, foldBeats) * 1e6) : 0,
        loopQuantumBeats: foldBeats >= 1.0 ? foldBeats : 0,
      };
    },
    imposeTempo(bpm, atTimeMs) {
      if (!this.connected) return;
      setTempoContinuous(session, bpm, atTimeMs);
      this.weOwnTempo = true;
    },
    resetTempoAuthority() {
      this.weOwnTempo = false;
    },
    setTransportPlaying(playing, atTimeMs) {
      if (!this.connected) return;
      if (session.isPlaying === playing) return;
      if (playing) {
        setIsPlayingAndRequestBeatAtTime(session, true, atTimeMs, 0.0, LINK_QUANTUM, countOtherConnected(this));
      } else {
        setIsPlaying(session, false, atTimeMs);
      }
    },
  };
}

const g_allPeersBySession = new WeakMap();

function registerPeer(peer) {
  const list = g_allPeersBySession.get(peer.session) || [];
  list.push(peer);
  g_allPeersBySession.set(peer.session, list);
}

function countOtherConnected(peer) {
  const list = g_allPeersBySession.get(peer.session) || [];
  return list.filter((p) => p !== peer && p.connected).length;
}

function createLinkWorld(initialBpm) {
  const session = createLinkSession(initialBpm);
  const local = createLinkPeer('local', session);
  const remote = createLinkPeer('remote', session);
  registerPeer(local);
  registerPeer(remote);
  remote.connected = false;
  return { session, local, remote };
}

module.exports = {
  LINK_QUANTUM,
  LINK_PHASE_QUANTUM,
  setPhaseQuantum,
  phaseQuantum,
  createLinkWorld,
  createLinkSession,
  createLinkPeer,
  registerPeer,
  beatAtTime,
  phaseAtTime,
  setTempoContinuous,
};
