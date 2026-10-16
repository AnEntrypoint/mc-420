#include <stdio.h>
#include <math.h>
#define FAUSTFLOAT float
typedef struct { void* metaInterface; void (*declare)(void*, const char*, const char*); } MetaGlue;
typedef struct { void* uiInterface; void (*openTabBox)(void*, const char*); void (*openHorizontalBox)(void*, const char*); void (*openVerticalBox)(void*, const char*); void (*closeBox)(void*); void (*addButton)(void*, const char*, float*); void (*addCheckButton)(void*, const char*, float*); void (*addVerticalSlider)(void*, const char*, float*, float, float, float, float); void (*addHorizontalSlider)(void*, const char*, float*, float, float, float, float); void (*addNumEntry)(void*, const char*, float*, float, float, float, float); void (*addHorizontalBargraph)(void*, const char*, float*, float, float); void (*addVerticalBargraph)(void*, const char*, float*, float, float); void (*addSoundfile)(void*, const char*, const char*, void*); void (*declare)(void*, float*, const char*, const char*); } UIGlue;
#include "pt_probe3.c"
int main(void) {
    static float in[4800], o0[4800], o1[4800], o2[4800];
    float *ins[1] = { in }; float *outs[3] = { o0, o1, o2 };
    ptp3 *d = newptp3();
    initptp3(d, 48000);
    double ph = 0.0, w = 2.0 * 3.14159265358979323846 * 2093 / 48000.0;
    for (int blk = 0; blk < 30; blk++) {
        for (int i = 0; i < 4800; i++) { in[i] = (float)(0.3 * sin(ph)); ph += w; }
        computeptp3(d, 4800, ins, outs);
        printf("%.2f %.3f %.3f %.3f\n", (blk + 1) * 0.1, o0[4799], o1[4799], o2[4799]);
    }
    return 0;
}
