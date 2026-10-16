f="$1"
{
echo '#include <stdio.h>'
echo '#include <stdlib.h>'
echo '#include <string.h>'
echo '#include <math.h>'
echo '#define FAUSTFLOAT float'
echo 'typedef struct { void* metaInterface; void (*declare)(void*, const char*, const char*); } MetaGlue;'
echo 'typedef struct { void* uiInterface; void (*openTabBox)(void*, const char*); void (*openHorizontalBox)(void*, const char*); void (*openVerticalBox)(void*, const char*); void (*closeBox)(void*); void (*addButton)(void*, const char*, float*); void (*addCheckButton)(void*, const char*, float*); void (*addVerticalSlider)(void*, const char*, float*, float, float, float, float); void (*addHorizontalSlider)(void*, const char*, float*, float, float, float, float); void (*addNumEntry)(void*, const char*, float*, float, float, float, float); void (*addHorizontalBargraph)(void*, const char*, float*, float, float); void (*addVerticalBargraph)(void*, const char*, float*, float, float); void (*addSoundfile)(void*, const char*, const char*, void*); void (*declare)(void*, float*, const char*, const char*); } UIGlue;'
echo '#include "pt_ac.c"'
cat <<EOF2
int main(void) {
    static float in[4800], out[4800];
    float *ins[1] = { in }; float *outs[1] = { out };
    ptac *d = newptac();
    initptac(d, 48000);
    double ph = 0.0, w = 2.0 * 3.14159265358979323846 * $f / 48000.0;
    for (int blk = 0; blk < 30; blk++) {
        for (int i = 0; i < 4800; i++) { in[i] = (float)(0.3 * sin(ph)); ph += w; }
        computeptac(d, 4800, ins, outs);
        printf("%.2f %.3f\n", (blk + 1) * 0.1, out[4799]);
    }
    return 0;
}
EOF2
} > drv_pt_$f.c
