'use strict';

const { createWorld, advance, onPadPress, onPadRelease, msToSimSamples, snapshotWrapLen } = require('./world');

function line(...args) { console.log(...args); }

function basicTwoLoopers() {
  const w = createWorld({ looperCount: 4 });
  onPadPress(w, 0); onPadRelease(w, 0);
  advance(w, msToSimSamples(2000));
  onPadPress(w, 0); onPadRelease(w, 0);
  advance(w, msToSimSamples(500));
  line('after loop0 finish: masterLen=', w.masterLenSamples, 'recordedBeats=', w.recordedBeats, 'wrap0=', snapshotWrapLen(w, 0));

  onPadPress(w, 1); onPadRelease(w, 1);
  advance(w, msToSimSamples(1000));
  onPadPress(w, 1); onPadRelease(w, 1);
  advance(w, msToSimSamples(500));
  line('after loop1 finish: wrap1=', snapshotWrapLen(w, 1), 'ratio=', snapshotWrapLen(w, 1) / snapshotWrapLen(w, 0));

  onPadPress(w, 1); onPadRelease(w, 1);
  advance(w, msToSimSamples(200));
  line('loop1 paused: playing=', w.loopers[1].playing);
  const rposBefore = w.loopers[1].dsp.rpos;
  onPadPress(w, 1); onPadRelease(w, 1);
  const rposAfterResumePress = w.loopers[1].dsp.rpos;
  line('loop1 resumed: rpos before=', rposBefore, 'immediately after resume=', rposAfterResumePress, 'delta=', rposAfterResumePress - rposBefore);
}

function linkNonPow2Check() {
  const w = createWorld({ looperCount: 4, initialLinkBpm: 100 });
  w.link.remote.connected = true;
  w.link.session.tempo = 100;
  w.link.session.isPlaying = false;

  onPadPress(w, 0); onPadRelease(w, 0);
  advance(w, msToSimSamples(1800));
  onPadPress(w, 0); onPadRelease(w, 0);
  advance(w, msToSimSamples(500));
  line('[link] masterLen=', w.masterLenSamples, 'recordedBpm=', w.recordedBpm, 'recordedBeats=', w.recordedBeats, '(should be a power of 2)');
}

basicTwoLoopers();
linkNonPow2Check();
