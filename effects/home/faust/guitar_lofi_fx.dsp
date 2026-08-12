import("stdfaust.lib");

FLANGEAMT   = hslider("fx2/FLANGEAMT",   0.0, 0.0, 1.0, 0.01);
TREMOLOAMT  = hslider("fx2/TREMOLOAMT",  0.0, 0.0, 1.0, 0.01);
BANKSPEED   = hslider("fx2/BANKSPEED",   0.5, 0.0, 1.0, 0.01);
PHASERAMT   = hslider("fx2/PHASERAMT",   0.0, 0.0, 1.0, 0.01);
COMPRESSAMT = hslider("fx2/COMPRESSAMT", 0.0, 0.0, 1.0, 0.01);

BITCRUSHAMT = hslider("fx2/BITCRUSHAMT", 0.0, 0.0, 1.0, 0.01);
VINYLAMT    = hslider("fx2/VINYLAMT",    0.0, 0.0, 1.0, 0.01);
FLUTTERAMT  = hslider("fx2/FLUTTERAMT",  0.0, 0.0, 1.0, 0.01);
SRRAMT      = hslider("fx2/SRRAMT",      0.0, 0.0, 1.0, 0.01);

GATEAMT     = hslider("fx2/GATEAMT",     0.0, 0.0, 1.0, 0.01);
GATEPATTERN = hslider("fx2/GATEPATTERN", 0.0, 0.0, 1.0, 0.01);
GATEPHASE   = hslider("fx2/GATEPHASE",   0.0, 0.0, 1.0, 0.001);

flangerStage    = component("flanger.dsp")[ FLANGEAMT=FLANGEAMT; ];
tremoloStage    = component("tremolo.dsp")[ TREMOLOAMT=TREMOLOAMT; BANKSPEED=BANKSPEED; ];
phaserStage     = component("phaser.dsp")[ PHASERAMT=PHASERAMT; BANKSPEED=BANKSPEED; ];
compressorStage = component("compressor.dsp")[ COMPRESSAMT=COMPRESSAMT; ];
bitcrushStage   = component("bitcrush.dsp")[ BITCRUSHAMT=BITCRUSHAMT; ];
vinylStage      = component("vinyl.dsp")[ VINYLAMT=VINYLAMT; ];
flutterStage    = component("flutter.dsp")[ FLUTTERAMT=FLUTTERAMT; ];
samplerateStage = component("samplerate.dsp")[ SRRAMT=SRRAMT; ];

gatePat0 = pow(max(0.0, 0.5 + 0.5*cos(2.0*ma.PI*4.0*GATEPHASE)), 4.0);
gatePat1 = pow(max(0.0, 0.5 + 0.5*cos(2.0*ma.PI*4.0*(GATEPHASE-0.125))), 4.0);
gatePat2 = pow(max(0.0, 0.5 + 0.5*cos(2.0*ma.PI*16.0*GATEPHASE)), 6.0);
gateBump(center) = pow(max(0.0, 0.5 + 0.5*cos(2.0*ma.PI*(GATEPHASE-center))), 8.0);
gatePat3 = min(1.0, gateBump(0.0/8.0) + gateBump(3.0/8.0) + gateBump(6.0/8.0));

gatePatternIdx = int(min(3.0, max(0.0, GATEPATTERN*4.0)));
gateSelected = select2(gatePatternIdx==3,
                   select2(gatePatternIdx==2,
                       select2(gatePatternIdx==1, gatePat0, gatePat1),
                       gatePat2),
                   gatePat3);

gateEnv   = 1.0 - GATEAMT*(1.0 - gateSelected);
gateStage = _ * gateEnv;

process = _ : flangerStage : tremoloStage : phaserStage : compressorStage
            : bitcrushStage : vinylStage : flutterStage : samplerateStage
            : gateStage;
