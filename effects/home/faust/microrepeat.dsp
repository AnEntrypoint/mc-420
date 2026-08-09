import("stdfaust.lib");

SR   = 48000.0;
BS   = 64;
STEP = 1.0/16.0;

DIV = 0;
MLB = 0;

MR_MAX = 48000;

divSafe     = max(1, DIV);
beatBlocks  = int(MLB / 16);
sliceBlocks = max(1, int(beatBlocks / divSafe)) * 2;
sliceLenRaw = sliceBlocks * BS;
sliceLen    = min(MR_MAX, sliceLenRaw);

active = (DIV != 0) & (MLB >= 16);

activePrev = active : mem;
engageEdge = active & (activePrev < 0.5);
sampleIdxSinceEngage = counter ~ _
with {
    counter(prev) = ba.if(engageEdge, 0, prev + 1);
};

capturingFreshContent = active & (sampleIdxSinceEngage < sliceLen);

captureThenReplayRing(live) = replayedSignal
with {
    parkedWritePos = int(ba.if(capturingFreshContent, sampleIdxSinceEngage, MR_MAX - 1));
    wrappedReadPos = int(ba.if(sliceLen > 0, sampleIdxSinceEngage % max(1, sliceLen), 0));
    ringStoredSample = rwtable(MR_MAX, 0.0, parkedWritePos, live, wrappedReadPos);
    replayedSignal = ba.if(capturingFreshContent, live, ringStoredSample);
};

blockIdx    = int(sampleIdxSinceEngage / BS);
sampInBlock = sampleIdxSinceEngage - blockIdx*BS;
wetStartOfBlock = min(1.0, blockIdx * STEP);
wetEndOfBlock   = min(1.0, (blockIdx + 1) * STEP);
blockRateWetRamp = ba.if(active, wetStartOfBlock + (wetEndOfBlock - wetStartOfBlock) * (sampInBlock / BS), 0.0);

microrepeatCrossfade(live) = live*(1.0 - blockRateWetRamp) + repeatedSignal*blockRateWetRamp
with {
    repeatedSignal = captureThenReplayRing(live);
};

process = microrepeatCrossfade;
