declare name "Resonode";
declare author "aloop";
declare license "GPLv3";
declare description "4-voice, 6-mode-per-voice modal-resonator instrument, packaged as its own standalone LV2 bundle (resonode.lv2) rather than living inside the always-on home Faust stack. Excited only by the live mic/dry input -- there is no synthetic strike or self-contained exciter anywhere in the signal path. Architecture (a shared exciter driving a coupled mode-filter bank per voice) ported from DawDreamer's examples/resonaut/resonaut.py, then extended per findings from Gabriel Soule's Resonarium thesis and Reason Studios' Objekt manual. note/gate/vel per voice are LV2 control ports (hslider), matching guitar_lofi_fx.dsp's own control-port convention for this codebase's LV2 bundles. The per-voice exciter was previously pre-filtered through a note-locked Q=15 bandpass BEFORE reaching the 6-mode bank -- measured via DawDreamer to attenuate modes 2-6 by 30-190x relative to mode 1, so the bank was functionally a single resonant filter regardless of position/stretch/damping. The exciter is now broadband (a shared highpass/lowpass only) so each mode's own resonance performs frequency selection, matching both reference instruments' documented architecture. The exciter envelope was an ASR with sustain=1.0 (fully open for the whole key-hold), which continuously re-fed live mic content into a high-Q resonator bank -- exactly the structure that produces audio-feedback-like ringing; it is now a percussive strike envelope (fast attack, decay to a low sustain floor) so a keypress reads as a struck-object transient rather than a sustained reactive filter. couple adds nearest-neighbor energy exchange between adjacent modes (Resonarium 'interlinked' / Objekt 'Coupling' topology, cost-bounded to O(modes) rather than a full O(modes^2) matrix), the dominant lever both reference documents identify for timbral distinctiveness beyond a purely parallel bank. position gets a small live per-voice drift from a slower decaying envelope (bright-attack-to-darker-sustain spectral evolution, reusing the same attack-edge envelope idiom as pitch-mod) and stretch gets a small per-note sample-and-hold random offset, so a single patch audibly evolves within a note and varies note-to-note rather than sounding static. collision is a per-patch bounded soft-clip/waveshape amount applied to each voice's own resonator output (0 = exact passthrough); pitch-mod is a small, velocity- and dispersion-scaled onset frequency deviation that decays back to the true pitch over ~40ms, modeling impact deformation without any synthetic exciter to carry it.";

import("stdfaust.lib");

morphGlidePole = ba.tau2pole(0.015);
morphIsFirstSample = ba.time == 0;
morphGlide(x) = y
letrec {
    'y = ba.if(morphIsFirstSample, x, y + (x - y)*(1.0 - morphGlidePole));
};

position  = hslider("fx/resonode/position", 0.35, 0.0, 1.0, 0.001) : morphGlide;
tone      = hslider("fx/resonode/tone", 6000.0, 200.0, 18000.0, 1.0) : morphGlide;
decayTime = hslider("fx/resonode/decay", 1.2, 0.05, 8.0, 0.001) : morphGlide;
damping   = hslider("fx/resonode/damping", 0.85, 0.05, 1.0, 0.001) : morphGlide;
stretch   = hslider("fx/resonode/stretch", 0.0, -0.5, 1.5, 0.001) : morphGlide;
collision = hslider("fx/resonode/collision", 0.0, 0.0, 1.0, 0.001) : morphGlide;
outLevel  = hslider("fx/resonode/level", 25.0, 0.0, 60.0, 0.001) : morphGlide;
couple    = hslider("fx/resonode/couple", 0.15, 0.0, 1.0, 0.001) : morphGlide;

note0 = hslider("fx/resonodevoice0/note", -1.0, -1.0, 127.0, 1.0);
gate0 = hslider("fx/resonodevoice0/gate", 0.0, 0.0, 1.0, 1.0);
vel0  = hslider("fx/resonodevoice0/vel",  1.0, 0.0, 1.0, 0.001);
note1 = hslider("fx/resonodevoice1/note", -1.0, -1.0, 127.0, 1.0);
gate1 = hslider("fx/resonodevoice1/gate", 0.0, 0.0, 1.0, 1.0);
vel1  = hslider("fx/resonodevoice1/vel",  1.0, 0.0, 1.0, 0.001);
note2 = hslider("fx/resonodevoice2/note", -1.0, -1.0, 127.0, 1.0);
gate2 = hslider("fx/resonodevoice2/gate", 0.0, 0.0, 1.0, 1.0);
vel2  = hslider("fx/resonodevoice2/vel",  1.0, 0.0, 1.0, 0.001);
note3 = hslider("fx/resonodevoice3/note", -1.0, -1.0, 127.0, 1.0);
gate3 = hslider("fx/resonodevoice3/gate", 0.0, 0.0, 1.0, 1.0);
vel3  = hslider("fx/resonodevoice3/vel",  1.0, 0.0, 1.0, 0.001);

voiceGain = 0.5;
retuneGlide = 0.01;
pitchModDepth = 0.04;
pitchModDecayS = 0.04;
pitchModPole = pow(0.001, 1.0/(pitchModDecayS*ma.SR));

positionDriftAmt = 0.16;
positionDriftDecayS = 0.35;
positionDriftPole = pow(0.001, 1.0/(positionDriftDecayS*ma.SR));

stretchJitterAmt = 0.02;

excAttackS = 0.004;
excDecayS = 0.11;
excSustainFloor = 0.09;
excReleaseS = 0.25;

coupleScale = 8.0;

stealEvent(note, gate) = (note != note') * (gate <= gate');
retriggerGate(note, gate) = gate * (1.0 - stealEvent(note, gate));
attackEdge(note, gate) = (gate > gate') + stealEvent(note, gate);

velGain(vel) = max(0.0, min(1.0, vel));
flexibility = max(0.0, min(1.0, (0.5 - stretch)));

pitchEnv(note, gate) = e
letrec {
    'e = ba.if(attackEdge(note, gate) > 0.5, 1.0, e * pitchModPole);
};

positionDriftEnv(note, gate) = e
letrec {
    'e = ba.if(attackEdge(note, gate) > 0.5, 1.0, e * positionDriftPole);
};

noteJitter(note, gate) = ba.sAndH(attackEdge(note, gate) > 0.5, no.noise);

sharedExciteIn(exciteIn) = exciteIn : fi.highpass(2, 60.0) : fi.lowpass(2, tone);

exciteFor(sharedIn, note, gate, vel) = sharedIn * (strikeEnv * velGain(vel))
with {
    xgate = retriggerGate(note, gate);
    strikeEnv = en.adsr(excAttackS, excDecayS, excSustainFloor, excReleaseS, xgate);
};

freqGlide(note, gate, vel) = f
letrec {
    'f = ba.if(gate > gate', target, f + (target - f)*retuneGlide)
    with { target = ba.midikey2hz(note) * (1.0 + pitchModDepth*velGain(vel)*flexibility*pitchEnv(note, gate)); };
};

driveAmt = 1.0 + collision*6.0;
driveNorm = 1.0 / ma.tanh(driveAmt);
collisionDrive(x) = x*(1.0 - collision) + ma.tanh(x*driveAmt)*driveNorm*collision;

aliasGuard(f) = min(1.0, max(0.0, (ma.SR*0.5 - f) / (ma.SR*0.05)));

bassBoostAmt = 0.35;
bassCornerHz = 220.0;
bassSpanHz = 160.0;
bassBoost(freqHz) = 1.0 + bassBoostAmt*max(0.0, min(1.0, (bassCornerHz - freqHz)/bassSpanHz));

dampSq   = damping*damping;
dampCube = dampSq*damping;
dampQuad = dampCube*damping;
dampQuin = dampQuad*damping;

modeT60Ceiling = 8.5;
modeR(t60) = pow(0.001, 1.0/(min(t60, modeT60Ceiling)*ma.SR));
r1 = modeR(decayTime);
r2 = modeR(decayTime*damping);
r3 = modeR(decayTime*dampSq);
r4 = modeR(decayTime*dampCube);
r5 = modeR(decayTime*dampQuad);
r6 = modeR(decayTime*dampQuin);

burstGainRefT60 = 0.15;
burstGainRefR = modeR(burstGainRefT60);
burstGainRefFactor = (1.0 - burstGainRefR) / (1.0 + burstGainRefR);

modeFilterR(r, freq, gain, x) = fi.tf2(b0, 0.0, -b0, a1, a2, x) * gain
with {
    a1 = -2.0*r*cos(2.0*ma.PI*freq/ma.SR);
    a2 = r*r;
    b0 = sqrt(burstGainRefFactor * (1.0 - r*r));
};

bank(freqHz, exc, positionLive, stretchLive) = mode1Out+mode2Out+mode3Out+mode4Out+mode5Out+mode6Out
letrec {
    'mode1Out = modeFilterR(r1, freqHz, modeGain1*aliasGuard(freqHz)*bassBoost(freqHz), exc + coupleAmt*mode2Out);
    'mode2Out = modeFilterR(r2, f2,     modeGain2*aliasGuard(f2),                       exc + coupleAmt*(mode1Out + mode3Out));
    'mode3Out = modeFilterR(r3, f3,     modeGain3*aliasGuard(f3),                       exc + coupleAmt*(mode2Out + mode4Out));
    'mode4Out = modeFilterR(r4, f4,     modeGain4*aliasGuard(f4),                       exc + coupleAmt*(mode3Out + mode5Out));
    'mode5Out = modeFilterR(r5, f5,     modeGain5*aliasGuard(f5),                       exc + coupleAmt*(mode4Out + mode6Out));
    'mode6Out = modeFilterR(r6, f6,     modeGain6*aliasGuard(f6),                       exc + coupleAmt*mode5Out);
}
with {
    stretchRatio2 = pow(2.0, 1.0+stretchLive);
    stretchRatio3 = pow(3.0, 1.0+stretchLive);
    stretchRatio4 = pow(4.0, 1.0+stretchLive);
    stretchRatio5 = pow(5.0, 1.0+stretchLive);
    stretchRatio6 = pow(6.0, 1.0+stretchLive);

    modeGain1 = 1.00*sin(ma.PI*positionLive*1);
    modeGain2 = 0.60*sin(ma.PI*positionLive*2);
    modeGain3 = 0.40*sin(ma.PI*positionLive*3);
    modeGain4 = 0.30*sin(ma.PI*positionLive*4);
    modeGain5 = 0.22*sin(ma.PI*positionLive*5);
    modeGain6 = 0.55*sin(ma.PI*positionLive*6);

    f2 = freqHz*stretchRatio2;
    f3 = freqHz*stretchRatio3;
    f4 = freqHz*stretchRatio4;
    f5 = freqHz*stretchRatio5;
    f6 = freqHz*stretchRatio6;

    coupleAmt = couple*coupleScale;
};

voice(sharedIn, note, gate, vel) = collisionDrive(bank(freqGlide(note, gate, vel), exciteFor(sharedIn, note, gate, vel), positionLive, stretchLive)) * voiceGain
with {
    positionLive = max(0.0, min(1.2, position + positionDriftAmt*positionDriftEnv(note, gate)));
    stretchLive = stretch + stretchJitterAmt*noteJitter(note, gate);
};

process(exciteIn) =
    (voice(sharedIn,note0,gate0,vel0) + voice(sharedIn,note1,gate1,vel1) + voice(sharedIn,note2,gate2,vel2) + voice(sharedIn,note3,gate3,vel3)) : *(outLevel) : ma.tanh
with {
    sharedIn = sharedExciteIn(exciteIn);
};
