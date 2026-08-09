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

flangerStage    = component("flanger.dsp")[ FLANGEAMT=FLANGEAMT; ];
tremoloStage    = component("tremolo.dsp")[ TREMOLOAMT=TREMOLOAMT; BANKSPEED=BANKSPEED; ];
phaserStage     = component("phaser.dsp")[ PHASERAMT=PHASERAMT; BANKSPEED=BANKSPEED; ];
compressorStage = component("compressor.dsp")[ COMPRESSAMT=COMPRESSAMT; ];
bitcrushStage   = component("bitcrush.dsp")[ BITCRUSHAMT=BITCRUSHAMT; ];
vinylStage      = component("vinyl.dsp")[ VINYLAMT=VINYLAMT; ];
flutterStage    = component("flutter.dsp")[ FLUTTERAMT=FLUTTERAMT; ];
samplerateStage = component("samplerate.dsp")[ SRRAMT=SRRAMT; ];

process = _ : flangerStage : tremoloStage : phaserStage : compressorStage
            : bitcrushStage : vinylStage : flutterStage : samplerateStage;
