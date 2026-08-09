import("stdfaust.lib");

SEMIS    = 0.0;
FORMANT  = 0.0;
ENGAGED  = 0.0;
DELAYAMT = 0.0;
REVAMT   = 0.0;
TIME     = 0.5;
DIV      = 0;
MLB      = 0;
HPCUT    = 0.0;
LPCUT    = 1.0;
LPRES    = 0.0;

pitchStage = component("pitch.dsp")[ SEMIS=SEMIS; FORMANT=FORMANT; ENGAGED=ENGAGED; ];
delayStage = component("delay.dsp")[ DELAYAMT=DELAYAMT; TIME=TIME; ];
reverbStage= component("reverb.dsp")[ REVAMT=REVAMT; TIME=TIME; ];
microStage = component("microrepeat.dsp")[ DIV=DIV; MLB=MLB; ];
filterStage= component("filters.dsp")[ HPCUT=HPCUT; LPCUT=LPCUT; LPRES=LPRES; ];

sends = delayStage : reverbStage;

process = pitchStage : sends : microStage : filterStage;
