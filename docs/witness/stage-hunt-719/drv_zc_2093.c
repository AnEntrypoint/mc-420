#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#define FAUSTFLOAT float
typedef struct { void* metaInterface; void (*declare)(void*, const char*, const char*); } MetaGlue;
typedef struct { void* uiInterface; void (*openTabBox)(void*, const char*); void (*openHorizontalBox)(void*, const char*); void (*openVerticalBox)(void*, const char*); void (*closeBox)(void*); void (*addButton)(void*, const char*, float*); void (*addCheckButton)(void*, const char*, float*); void (*addVerticalSlider)(void*, const char*, float*, float, float, float, float); void (*addHorizontalSlider)(void*, const char*, float*, float, float, float, float); void (*addNumEntry)(void*, const char*, float*, float, float, float, float); void (*addHorizontalBargraph)(void*, const char*, float*, float, float); void (*addVerticalBargraph)(void*, const char*, float*, float, float); void (*addSoundfile)(void*, const char*, const char*, void*); void (*declare)(void*, float*, const char*, const char*); } UIGlue;
#include "zc_2093.c"
int main(void) {
    static float buf[4800];
    float *out[1] = { buf };
    zc2093 *d = newzc2093();
    initzc2093(d, 48000);
    for (int blk = 0; blk < 30; blk++) {
        computezc2093(d, 4800, NULL, out);
        printf("%.2f %.3f\n", (blk + 1) * 0.1, buf[4799]);
    }
    return 0;
}
