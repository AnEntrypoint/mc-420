'use strict';

const LINK_QUANTUM = 16.0;
const LINK_PHASE_QUANTUM = 128.0;

let g_phaseQuantum = LINK_PHASE_QUANTUM;

function setPhaseQuantum(q) { g_phaseQuantum = q; }
function phaseQuantum() { return g_phaseQuantum; }

function createLinkSession(initialBpm) {
  return {
    tempo: initialBpm,
    beatOriginTimeMs: 0,
    beatOriginBeat: 0,
    isPlaying: false,
  };
}

function beatAtTime(session, timeMs) {
  const elapsedMin = (timeMs - session.beatOriginTimeMs) / 60000;
  return session.beatOriginBeat + elapsedMin * session.tempo;
}

function phaseAtTime(session, timeMs, quantum) {
  const b = beatAtTime(session, timeMs);
  let p = b % quantum;
  if (p < 0) p += quantum;
  return p;
}

function setTempoContinuous(session, bpm, atTimeMs) {
  const beatNow = beatAtTime(session, atTimeMs);
  session.tempo = bpm;
  session.beatOriginTimeMs = atTimeMs;
  session.beatOriginBeat = beatNow;
}

function setIsPlaying(session, playing, atTimeMs) {
  session.isPlaying = playing;
}

function setIsPlayingAndRequestBeatAtTime(session, playing, atTimeMs, beat, quantum, peerCount) {
  session.isPlaying = playing;
  if (peerCount > 0) {
    const beatNow = beatAtTime(session, atTimeMs);
    let targetBeat = Math.ceil((beatNow - beat) / quantum) * quantum + beat;
    if (targetBeat <= beatNow) targetBeat += quantum;
    session.beatOriginBeat = beat;
    session.beatOriginTimeMs = atTimeMs + ((targetBeat - beatNow) / session.tempo) * 60000;
  } else {
    session.beatOriginTimeMs = atTimeMs;
    session.beatOriginBeat = beat;
  }
}

function createLinkPeer(name, session) {
  return {
    name,
    session,
    connected: true,
    weOwnTempo: false,
    audioRead(timeMs) {
      if (!this.connected) return { synced: false, bpm: 120, peers: 0, playing: false, phaseValid: false, beatPhaseMicroBeats: 0, quantumMicroBeats: 0 };
      const peers = countOtherConnected(this);
      return {
        synced: peers > 0,
        bpm: session.tempo,
        peers,
        playing: session.isPlaying,
        phaseValid: true,
        beatPhaseMicroBeats: Math.round(phaseAtTime(session, timeMs, g_phaseQuantum) * 1e6),
        quantumMicroBeats: Math.round(g_phaseQuantum * 1e6),
      };
    },
    proposeTempo(bpm, atTimeMs) {
      if (!this.connected) return;
      const peers = countOtherConnected(this);
      const sessionIdle = !session.isPlaying;
      if (peers > 0 && !this.weOwnTempo && !sessionIdle) return;
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
