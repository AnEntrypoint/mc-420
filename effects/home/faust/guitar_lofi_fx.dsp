import("stdfaust.lib");

FLANGEAMT   = hslider("fx2/FLANGEAMT",   0.0, 0.0, 1.0, 0.01);
TREMOLOAMT  = hslider("fx2/TREMOLOAMT",  0.0, 0.0, 1.0, 0.01);
BANKSPEED   = hslider("fx2/BANKSPEED",   0.5, 0.0, 1.0, 0.01);
PHASERAMT   = hslider("fx2/PHASERAMT",   0.0, 0.0, 1.0, 0.01);
DISTAMT     = hslider("fx2/DISTAMT",     0.0, 0.0, 1.0, 0.01);

BITCRUSHAMT = hslider("fx2/BITCRUSHAMT", 0.0, 0.0, 1.0, 0.01);
VINYLAMT    = hslider("fx2/VINYLAMT",    0.0, 0.0, 1.0, 0.01);
FLUTTERAMT  = hslider("fx2/FLUTTERAMT",  0.0, 0.0, 1.0, 0.01);

GATEAMT     = hslider("fx2/GATEAMT",     0.0, 0.0, 1.0, 0.01);
GATEPHASE   = hslider("fx2/GATEPHASE",   0.0, 0.0, 1.0, 0.001);

flangerStage    = component("flanger.dsp")[ FLANGEAMT=FLANGEAMT; BANKSPEED=BANKSPEED; ];
tremoloStage    = component("tremolo.dsp")[ TREMOLOAMT=TREMOLOAMT; BANKSPEED=BANKSPEED; ];
phaserStage     = component("phaser.dsp")[ PHASERAMT=PHASERAMT; BANKSPEED=BANKSPEED; ];
distortionStage = component("distortion.dsp")[ DISTAMT=DISTAMT; ];
bitcrushStage   = component("bitcrush.dsp")[ BITCRUSHAMT=BITCRUSHAMT; ];
vinylStage      = component("vinyl.dsp")[ VINYLAMT=VINYLAMT; ];
flutterStage    = component("flutter.dsp")[ FLUTTERAMT=FLUTTERAMT; ];

gateSelected = pow(max(0.0, 0.5 + 0.5*cos(2.0*ma.PI*4.0*GATEPHASE)), 4.0);
gateEnv      = 1.0 - GATEAMT*(1.0 - gateSelected);
gateStage    = _ * gateEnv;

process = _ : flangerStage : tremoloStage : phaserStage : distortionStage
            : bitcrushStage : vinylStage : flutterStage
            : gateStage;
