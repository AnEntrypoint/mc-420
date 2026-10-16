#include <string.h>
static float *g_buf; static long g_n; static int g_sr = 48000;
static int loadwav(const char *path){
    FILE *f = fopen(path, "rb"); if (!f) return 0;
    fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
    unsigned char *b = malloc(sz); fread(b, 1, sz, f); fclose(f);
    int ch = 1, bits = 16; long dpos = -1, dlen = 0; long p = 12;
    while (p + 8 <= sz) {
        unsigned int cl = b[p+4] | (b[p+5]<<8) | (b[p+6]<<16) | ((unsigned)b[p+7]<<24);
        if (!memcmp(b+p, "fmt ", 4)) { ch = b[p+10] | (b[p+11]<<8); g_sr = b[p+12] | (b[p+13]<<8) | (b[p+14]<<16) | (b[p+15]<<24); bits = b[p+22] | (b[p+23]<<8); }
        if (!memcmp(b+p, "data", 4)) { dpos = p + 8; dlen = cl; if (dpos + dlen > sz) dlen = sz - dpos; break; }
        p += 8 + cl + (cl & 1);
    }
    if (dpos < 0 || bits != 16) return 0;
    long frames = dlen / (2L * ch);
    g_buf = malloc(sizeof(float) * (frames + 1));
    for (long i = 0; i < frames; i++) {
        short v = (short)(b[dpos + i*2*ch] | (b[dpos + i*2*ch + 1] << 8));
        g_buf[i] = v / 32768.0f;
    }
    g_n = frames; free(b); return 1;
}
int main(int argc, char **argv) {
    const char *a = argv[1];
    if (strncmp(a, "sine:", 5) == 0) {
        double hz = atof(a + 5); double secs = argc > 2 ? atof(argv[2]) : 3.0;
        g_sr = 48000; g_n = (long)(secs * g_sr); g_buf = malloc(sizeof(float) * g_n);
        double w = 2.0 * 3.14159265358979323846 * hz / g_sr, ph = 0.0;
        for (long i = 0; i < g_n; i++) { g_buf[i] = (float)(0.3 * sin(ph)); ph += w; }
    } else if (!loadwav(a)) { fprintf(stderr, "wav load failed %s\n", a); return 2; }
    ptac *d = newptac();
    initptac(d, g_sr);
    static float in[4800], out[4800];
    float *ins[1] = { in }; float *outs[1] = { out };
    long pos = 0; int blk = 0;
    while (pos < g_n) {
        long cnt = g_n - pos; if (cnt > 4800) cnt = 4800;
        memset(in, 0, sizeof(in));
        memcpy(in, g_buf + pos, sizeof(float) * cnt);
        computeptac(d, 4800, ins, outs);
        printf("%.4f %.4f\n", (double)(pos + cnt) / g_sr, out[cnt - 1]);
        pos += cnt; blk++;
    }
    return 0;
}
