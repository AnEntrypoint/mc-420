declare name "Resonode";
declare author "aloop";
declare license "GPLv3";
declare description "Playable modal resonator instrument, packaged as the standalone resonode.lv2 bundle. Four voices, sixteen coupled modes per voice, convex-blended string/bell/plate/membrane/bar partial-ratio tables, constant-Q mode bandwidth, and nearest-neighbour mode coupling bounded below unity loop gain by peak-gain normalisation. Excited by a blend of the live input signal and an internal mallet/bow source, so a held key sounds on its own and the input colours it.";

import("stdfaust.lib");

modeCount = 16;

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

inputAmt  = hslider("fx/resonode/input", 0.5, 0.0, 1.0, 0.001) : morphGlide;
malletAmt = hslider("fx/resonode/mallet", 0.65, 0.0, 1.0, 0.001) : morphGlide;
bowAmt    = hslider("fx/resonode/bow", 0.35, 0.0, 1.0, 0.001) : morphGlide;
hardness  = hslider("fx/resonode/hardness", 0.5, 0.0, 1.0, 0.001) : morphGlide;
body      = hslider("fx/resonode/body", 0.0, 0.0, 1.0, 0.001) : morphGlide;
polarity  = hslider("fx/resonode/polarity", 1.0, -1.0, 1.0, 0.001) : morphGlide;

shapeStringWeight   = hslider("fx/resonode/shape/string",   1.0, 0.0, 1.0, 0.001) : morphGlide;
shapeBellWeight     = hslider("fx/resonode/shape/bell",     0.0, 0.0, 1.0, 0.001) : morphGlide;
shapePlateWeight    = hslider("fx/resonode/shape/plate",    0.0, 0.0, 1.0, 0.001) : morphGlide;
shapeMembraneWeight = hslider("fx/resonode/shape/membrane", 0.0, 0.0, 1.0, 0.001) : morphGlide;
shapeBarWeight      = hslider("fx/resonode/shape/bar",      0.0, 0.0, 1.0, 0.001) : morphGlide;

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

stringRatios   = (1.000000, 2.000000, 3.000000, 4.000000, 5.000000, 6.000000, 7.000000, 8.000000, 9.000000, 10.000000, 11.000000, 12.000000, 13.000000, 14.000000, 15.000000, 16.000000, 17.000000, 18.000000, 19.000000, 20.000000, 21.000000, 22.000000, 23.000000, 24.000000);
bellRatios     = (1.000000, 1.183000, 1.506000, 2.000000, 2.514000, 2.662000, 3.011000, 4.166000, 5.433000, 6.796000, 8.215000, 9.522834, 10.897792, 12.337290, 13.839042, 15.401003, 17.021332, 18.698355, 20.430545, 22.216500, 24.054928, 25.944630, 27.884491, 29.873473);
plateRatios    = (1.000000, 2.500000, 4.000000, 5.000000, 6.500000, 8.500000, 9.000000, 10.000000, 12.500000, 13.000000, 14.500000, 16.000000, 17.000000, 18.500000, 20.000000, 20.500000, 22.500000, 25.000000, 26.000000, 26.500000, 29.000000, 30.500000, 32.500000, 34.000000);
membraneRatios = (1.000000, 1.593341, 2.135549, 2.295417, 2.653066, 2.917295, 3.155465, 3.500147, 3.598485, 3.647451, 4.058932, 4.131738, 4.230439, 4.601045, 4.610052, 4.831885, 4.903281, 5.083567, 5.130769, 5.412118, 5.540399, 5.553126, 5.650842, 5.976540);
barRatios      = (1.000000, 2.756539, 5.403918, 8.932950, 13.344287, 18.637888, 24.813756, 31.871891, 39.812293, 48.634962, 58.339898, 68.927100, 80.396570, 92.748306, 105.982309, 120.098579, 135.097116, 150.977920, 167.740991, 185.386329, 203.913933, 223.323805, 243.615943, 264.790348);

shapeWeightSum = shapeStringWeight + shapeBellWeight + shapePlateWeight + shapeMembraneWeight + shapeBarWeight;
shapeWeightFloor = 0.0001;
shapeFallbackToString = shapeWeightSum < shapeWeightFloor;
shapeStringEffective = shapeStringWeight + shapeFallbackToString;
shapeWeightNorm = 1.0 / (shapeWeightSum + shapeFallbackToString);

modeRatio(i) = (shapeStringEffective*ba.take(i+1, stringRatios)
              + shapeBellWeight*ba.take(i+1, bellRatios)
              + shapePlateWeight*ba.take(i+1, plateRatios)
              + shapeMembraneWeight*ba.take(i+1, membraneRatios)
              + shapeBarWeight*ba.take(i+1, barRatios)) * shapeWeightNorm;
modeLogRatio(i) = log(modeRatio(i));

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

bowAttackS = 0.02;
bowDecayS = 0.06;
bowReleaseS = 0.15;

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

inputHighpassHz = 25.0;
sharedExciteIn(exciteIn) = exciteIn : fi.highpass(2, inputHighpassHz) : fi.lowpass(2, tone);

malletToneHz = 300.0 + hardness*hardness*14000.0;
bowToneHz = 200.0 + hardness*4000.0;
malletSrc = no.noise : fi.lowpass(2, malletToneHz);
bowSrc = no.noise : fi.lowpass(2, bowToneHz);
internalExciterSum = malletSrc*malletAmt + bowSrc*bowAmt;
internalExciterNorm = 1.0 / max(0.0001, malletAmt + bowAmt);
internalExciter = internalExciterSum * internalExciterNorm;

exciteBus(exciteIn) = sharedExciteIn(exciteIn)*inputAmt + internalExciter*(1.0 - inputAmt);

exciteFor(busIn, note, gate, vel) = busIn * (excEnv * velGain(vel))
with {
    xgate = retriggerGate(note, gate);
    strikeEnv = en.adsr(excAttackS, excDecayS, excSustainFloor, excReleaseS, xgate);
    sustainEnv = en.adsr(bowAttackS, bowDecayS, 1.0, bowReleaseS, xgate);
    excEnv = strikeEnv*(1.0 - bowAmt) + sustainEnv*bowAmt;
};

freqGlide(note, gate, vel) = f
letrec {
    'f = ba.if(gate > gate', target, f + (target - f)*retuneGlide)
    with { target = ba.midikey2hz(note) * (1.0 + pitchModDepth*velGain(vel)*flexibility*pitchEnv(note, gate)); };
};

driveAmt = 1.0 + collision*6.0;
driveNorm = 1.0 / driveAmt;
collisionDrive(x) = x*(1.0 - collision) + ma.tanh(x*driveAmt)*driveNorm*collision;

aliasGuard(f) = min(1.0, max(0.0, (ma.SR*0.5 - f) / (ma.SR*0.05)));

voiceBassTiltCornerHz = 180.0;
voiceBassTiltSpanHz = 140.0;
voiceBassTiltMaxGain = 2.0;
voiceBassTilt(freqFund) = 1.0 + (voiceBassTiltMaxGain - 1.0)*max(0.0, min(1.0, (voiceBassTiltCornerHz - freqFund)/voiceBassTiltSpanHz));

constantQRefHz = 261.6255653;
invConstantQRefHz = 1.0/constantQRefHz;
poleFromInvT60 = 6.907755279/ma.SR;
modeT60Ceiling = 8.5;
modeT60Floor = 0.004;
invT60Floor = 1.0/modeT60Ceiling;
invT60Ceiling = 1.0/modeT60Floor;

highFreqDampExponentMax = 1.0;
highFreqDampExponent = highFreqDampExponentMax*(1.0 - max(0.05, min(1.0, damping)));
invDecayTime = 1.0/max(0.05, decayTime);
noteDampScale(freqFund) = max(20.0, freqFund)*invConstantQRefHz;
modeInvT60(freqFund, modeHfDampFactor) = max(invT60Floor, min(invT60Ceiling, invDecayTime*noteDampScale(freqFund)*modeHfDampFactor));
modePole(freqFund, modeHfDampFactor) = 1.0 - poleFromInvT60*modeInvT60(freqFund, modeHfDampFactor);

peakGainRefT60 = 0.15;
peakGainRefPole = 1.0 - poleFromInvT60/peakGainRefT60;
modeGainRefFactor = (1.0 - peakGainRefPole)/(1.0 + peakGainRefPole);

modePeakGain(r) = sqrt(modeGainRefFactor*(1.0 + r)/(1.0 - r));

modeResonator(r, freqHz, x) = fi.tf2(b0, 0.0, -b0, a1, a2, x)
with {
    a1 = -2.0*r*cos(2.0*ma.PI*freqHz/ma.SR);
    a2 = r*r;
    b0 = sqrt(modeGainRefFactor*(1.0 - r*r));
};

chebyshevU(k, x) = chebU(k)
with {
    chebU(0) = 1.0;
    chebU(1) = 2.0*x;
    chebU(m) = 2.0*x*chebU(m-1) - chebU(m-2);
};
modePositionSin(i, pos) = sin(ma.PI*pos)*chebyshevU(i, cos(ma.PI*pos));

modeAmpTilt = 0.85;
modeAmpBase(i) = pow(float(i+1), -modeAmpTilt);

coupleSmallGainMax = 0.45;
coupleCoef = couple*coupleSmallGainMax;
coupleGuardCeil = 8.0;
coupleGuard(x) = max(-coupleGuardCeil, min(coupleGuardCeil, x));

neighbourExchange(n) = route(n, 2*n, par(i, n-1, (i+2, 2*i+1)), par(i, n-1, (i+1, 2*i+2))) : par(i, n, -);
couplingNetwork(n) = par(i, n, coupleGuard) : neighbourExchange(n) : par(i, n, *(coupleCoef));

modeStage(i, coupledIn, exc, freqFund, ratioExponent, positionLive) = normalisedOut, weightedOut
with {
    modeLogRatioLive = ratioExponent*modeLogRatio(i);
    freqMode = freqFund*exp(modeLogRatioLive);
    poleRadius = modePole(freqFund, exp(highFreqDampExponent*modeLogRatioLive));
    modeAliasGuard = aliasGuard(freqMode);
    rawOut = modeResonator(poleRadius, freqMode, exc + coupledIn);
    normalisedOut = rawOut*modeAliasGuard/modePeakGain(poleRadius);
    weightedOut = rawOut
                * modeAmpBase(i)
                * modePositionSin(i, positionLive)
                * modeAliasGuard;
};

modeBankStep(n) = route(n+4, n*5,
        par(i, n, (i+1, i*5+1)),
        par(i, n, (n+1, i*5+2)),
        par(i, n, (n+2, i*5+3)),
        par(i, n, (n+3, i*5+4)),
        par(i, n, (n+4, i*5+5)))
    : par(i, n, modeStage(i))
    : route(2*n, n+1, par(i, n, (2*i+1, i+1)), par(i, n, (2*i+2, n+1)));

modeBank(n) = (modeBankStep(n) ~ couplingNetwork(n)) : (par(i, n, !), _);

objectMaxDelay = 4096;
objectMinFreqHz = 20.0;
objectFeedbackCeiling = 0.995;
objectDampFloorHz = 200.0;
objectDampSpanHz = 7800.0;
objectHighpassHz = 25.0;

objectFeedbackMagnitude(freqHz) = min(objectFeedbackCeiling,
    exp(0.0 - 6.907755279/(max(0.05, decayTime)*max(objectMinFreqHz, freqHz))));
objectDelayLen(freqHz) = ma.SR / max(objectMinFreqHz, freqHz);
objectTrim(freqHz) = 1.0 - objectFeedbackMagnitude(freqHz);

objectVoice(exc, freqHz) = y * objectTrim(freqHz) : fi.highpass(2, objectHighpassHz)
letrec {
    'y = exc + fb * (de.fdelay(objectMaxDelay, dl, y) : fi.lowpass(1, dampHz));
}
with {
    dl = objectDelayLen(freqHz);
    fb = polarity * objectFeedbackMagnitude(freqHz);
    dampHz = objectDampFloorHz + max(0.05, min(1.0, damping))*objectDampSpanHz;
};

voice(busIn, note, gate, vel) = collisionDrive(bankOut + objOut*body) * voiceGain * voiceBassTilt(fundHz)
with {
    fundHz = freqGlide(note, gate, vel);
    positionLive = max(0.0, min(1.2, position + positionDriftAmt*positionDriftEnv(note, gate)));
    ratioExponent = 1.0 + stretch + stretchJitterAmt*noteJitter(note, gate);
    exc = exciteFor(busIn, note, gate, vel);
    bankOut = (exc, fundHz, ratioExponent, positionLive) : modeBank(modeCount);
    objOut = objectVoice(exc, fundHz);
};

loudnessRefDecayS = 1.2;
loudnessNormExp = 0.17;
bankOutputTrim = 1.06;
decayLoudnessNorm = bankOutputTrim*pow(max(0.05, min(8.0, decayTime))/loudnessRefDecayS, loudnessNormExp);

process(exciteIn) =
    (voice(bus,note0,gate0,vel0) + voice(bus,note1,gate1,vel1) + voice(bus,note2,gate2,vel2) + voice(bus,note3,gate3,vel3))
    : *(outLevel*decayLoudnessNorm) : ma.tanh
with {
    bus = exciteBus(exciteIn);
};
