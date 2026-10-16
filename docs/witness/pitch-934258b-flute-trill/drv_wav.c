#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <math.h>
#define FAUSTFLOAT float
typedef struct { void* metaInterface; void (*declare)(void*, const char*, const char*); } MetaGlue;
typedef struct { void* uiInterface; void (*openTabBox)(void*, const char*); void (*openHorizontalBox)(void*, const char*); void (*openVerticalBox)(void*, const char*); void (*closeBox)(void*); void (*addButton)(void*, const char*, float*); void (*addCheckButton)(void*, const char*, float*); void (*addVerticalSlider)(void*, const char*, float*, float, float, float, float); void (*addHorizontalSlider)(void*, const char*, float*, float, float, float, float); void (*addNumEntry)(void*, const char*, float*, float, float, float, float); void (*addHorizontalBargraph)(void*, const char*, float*, float, float); void (*addVerticalBargraph)(void*, const char*, float*, float, float); void (*addSoundfile)(void*, const char*, const char*, void*); void (*declare)(void*, float*, const char*, const char*); } UIGlue;
#include "pt_ac.c"

static float *g_x = NULL;
static long g_n = 0;

static int load_wav(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return 0;
    fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
    unsigned char *b = malloc(sz);
    if (fread(b, 1, sz, f) != (size_t)sz) { fclose(f); return 0; }
    fclose(f);
    int ch = 1, bits = 16; long pos = 12, dataOff = -1, dataLen = 0;
    while (pos + 8 <= sz) {
        uint32_t cl = b[pos+4] | (b[pos+5]<<8) | (b[pos+6]<<16) | ((uint32_t)b[pos+7]<<24);
        if (!memcmp(b + pos, "fmt ", 4)) { ch = b[pos+10] | (b[pos+11]<<8); bits = b[pos+22] | (b[pos+23]<<8); }
        if (!memcmp(b + pos, "data", 4)) { dataOff = pos + 8; dataLen = cl; break; }
        pos += 8 + cl + (cl & 1);
    }
    if (dataOff < 0 || bits != 16) { free(b); return 0; }
    if (dataOff + dataLen > sz) dataLen = sz - dataOff;
    long frames = dataLen / (2 * ch);
    g_x = malloc(sizeof(float) * frames);
    for (long i = 0; i < frames; i++) {
        int16_t s = (int16_t)(b[dataOff + i*2*ch] | (b[dataOff + i*2*ch + 1] << 8));
        g_x[i] = s / 32768.0f;
    }
    g_n = frames;
    free(b);
    return 1;
}

int main(int argc, char **argv) {
    if (argc < 2 || !load_wav(argv[1])) { fprintf(stderr, "wav load failed\n"); return 1; }
    static float in[4800], out[4800];
    float *ins[1] = { in }; float *outs[1] = { out };
    ptac *d = newptac();
    initptac(d, 48000);
    long blocks = g_n / 4800;
    for (long blk = 0; blk < blocks; blk++) {
        memcpy(in, g_x + blk * 4800, sizeof(in));
        computeptac(d, 4800, ins, outs);
        printf("%.2f %.4f\n", (blk + 1) * 0.1, out[4799]);
    }
    return 0;
}
