#define _POSIX_C_SOURCE 200809L
#include <alsa/asoundlib.h>
#include <errno.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static const char kMinConf[] =
    "pcm.hw {\n"
    "\t@args [ CARD DEV SUBDEV ]\n"
    "\t@args.CARD {\n\t\ttype string\n\t\tdefault \"\"\n\t}\n"
    "\t@args.DEV {\n\t\ttype integer\n\t\tdefault 0\n\t}\n"
    "\t@args.SUBDEV {\n\t\ttype integer\n\t\tdefault -1\n\t}\n"
    "\ttype hw\n"
    "\tcard $CARD\n"
    "\tdevice $DEV\n"
    "\tsubdevice $SUBDEV\n"
    "}\n"
    "pcm.!default {\n"
    "\ttype hw\n"
    "\tcard 2\n"
    "\tdevice 1\n"
    "\tsubdevice 0\n"
    "}\n";

static volatile sig_atomic_t g_stop = 0;

static void onSignal(int sig) {
  (void)sig;
  g_stop = 1;
}

static int writeConfFile(const char *path) {
  FILE *f = fopen(path, "w");
  if (!f) return -1;
  if (fputs(kMinConf, f) == EOF) {
    fclose(f);
    return -1;
  }
  return fclose(f) == 0 ? 0 : -1;
}

static double nowSeconds(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

static void usage(const char *name) {
  fprintf(stderr,
          "usage: %s [--device hw:2,1,0] [--file x.raw] [--rate 48000] [--channels 2]\n"
          "       [--period 256] [--buffer 2048] [--secs 0] [--gain 1.0] [--loop 1|0]\n"
          "       [--conf /tmp/alsa-min.conf] [--chunk-frames N]\n"
          "raw input is interleaved S32_LE at --rate with --channels channels\n",
          name);
}

int main(int argc, char **argv) {
  const char *device = "hw:2,1,0";
  const char *file = NULL;
  const char *conf = "/tmp/audio-injector-alsa.conf";
  unsigned int rate = 48000;
  unsigned int channels = 2;
  unsigned int period = 256;
  unsigned int buffer = 2048;
  unsigned int chunkFrames = 0;
  double secs = 0.0;
  double gain = 1.0;
  int loop = 1;

  for (int i = 1; i < argc; i++) {
    const char *a = argv[i];
    if (strcmp(a, "--help") == 0 || strcmp(a, "-h") == 0) {
      usage(argv[0]);
      return 0;
    }
    if (i + 1 >= argc) {
      fprintf(stderr, "missing value for %s\n", a);
      return 2;
    }
    const char *v = argv[++i];
    if (strcmp(a, "--device") == 0) device = v;
    else if (strcmp(a, "--file") == 0) file = v;
    else if (strcmp(a, "--conf") == 0) conf = v;
    else if (strcmp(a, "--rate") == 0) rate = (unsigned int)strtoul(v, NULL, 10);
    else if (strcmp(a, "--channels") == 0) channels = (unsigned int)strtoul(v, NULL, 10);
    else if (strcmp(a, "--period") == 0) period = (unsigned int)strtoul(v, NULL, 10);
    else if (strcmp(a, "--buffer") == 0) buffer = (unsigned int)strtoul(v, NULL, 10);
    else if (strcmp(a, "--chunk-frames") == 0) chunkFrames = (unsigned int)strtoul(v, NULL, 10);
    else if (strcmp(a, "--secs") == 0) secs = strtod(v, NULL);
    else if (strcmp(a, "--gain") == 0) gain = strtod(v, NULL);
    else if (strcmp(a, "--loop") == 0) loop = atoi(v) != 0;
    else {
      fprintf(stderr, "unknown arg %s\n", a);
      return 2;
    }
  }

  if (writeConfFile(conf) != 0) {
    fprintf(stderr, "cannot write alsa config %s\n", conf);
    return 1;
  }
  setenv("ALSA_CONFIG_PATH", conf, 1);

  signal(SIGINT, onSignal);
  signal(SIGTERM, onSignal);

  snd_pcm_t *pcm = NULL;
  int err = snd_pcm_open(&pcm, device, SND_PCM_STREAM_PLAYBACK, 0);
  if (err < 0) {
    fprintf(stderr, "snd_pcm_open(%s) failed: %s\n", device, snd_strerror(err));
    return 1;
  }

  snd_pcm_hw_params_t *hw = NULL;
  snd_pcm_hw_params_alloca(&hw);
  err = snd_pcm_hw_params_any(pcm, hw);
  if (err < 0) {
    fprintf(stderr, "hw_params_any failed: %s\n", snd_strerror(err));
    snd_pcm_close(pcm);
    return 1;
  }
  err = snd_pcm_hw_params_set_access(pcm, hw, SND_PCM_ACCESS_RW_INTERLEAVED);
  if (err < 0) {
    fprintf(stderr, "set_access failed: %s\n", snd_strerror(err));
    snd_pcm_close(pcm);
    return 1;
  }
  err = snd_pcm_hw_params_set_format(pcm, hw, SND_PCM_FORMAT_S32_LE);
  if (err < 0) {
    fprintf(stderr, "set_format S32_LE failed: %s\n", snd_strerror(err));
    snd_pcm_close(pcm);
    return 1;
  }
  err = snd_pcm_hw_params_set_channels(pcm, hw, channels);
  if (err < 0) {
    fprintf(stderr, "set_channels %u failed: %s\n", channels, snd_strerror(err));
    snd_pcm_close(pcm);
    return 1;
  }
  err = snd_pcm_hw_params_set_rate(pcm, hw, rate, 0);
  if (err < 0) {
    fprintf(stderr, "set_rate %u failed: %s\n", rate, snd_strerror(err));
    snd_pcm_close(pcm);
    return 1;
  }
  if (buffer < period * 4) buffer = period * 4;
  err = snd_pcm_hw_params_set_buffer_size_near(pcm, hw, &buffer);
  if (err < 0) {
    fprintf(stderr, "set_buffer_size %u failed: %s\n", buffer, snd_strerror(err));
    snd_pcm_close(pcm);
    return 1;
  }
  err = snd_pcm_hw_params_set_period_size_near(pcm, hw, &period, NULL);
  if (err < 0) {
    fprintf(stderr, "set_period_size %u failed: %s\n", period, snd_strerror(err));
    snd_pcm_close(pcm);
    return 1;
  }
  err = snd_pcm_hw_params(pcm, hw);
  if (err < 0) {
    fprintf(stderr, "hw_params failed: %s\n", snd_strerror(err));
    snd_pcm_close(pcm);
    return 1;
  }

  unsigned int gotRate = 0;
  snd_pcm_uframes_t gotPeriod = 0;
  snd_pcm_uframes_t gotBuffer = 0;
  snd_pcm_hw_params_get_rate(hw, &gotRate, NULL);
  snd_pcm_hw_params_get_period_size(hw, &gotPeriod, NULL);
  snd_pcm_hw_params_get_buffer_size(hw, &gotBuffer);
  printf("[injector] device=%s rate=%u channels=%u format=S32_LE period=%lu buffer=%lu\n",
         device, gotRate, channels, (unsigned long)gotPeriod, (unsigned long)gotBuffer);
  fflush(stdout);

  snd_pcm_sw_params_t *sw = NULL;
  snd_pcm_sw_params_alloca(&sw);
  snd_pcm_sw_params_current(pcm, sw);
  snd_pcm_sw_params_set_start_threshold(pcm, sw, gotPeriod);
  snd_pcm_sw_params_set_avail_min(pcm, sw, gotPeriod);
  snd_pcm_sw_params(pcm, sw);

  if (!file) {
    printf("[injector] probe only, no --file given\n");
    snd_pcm_close(pcm);
    return 0;
  }

  FILE *f = fopen(file, "rb");
  if (!f) {
    fprintf(stderr, "cannot open %s\n", file);
    snd_pcm_close(pcm);
    return 1;
  }
  if (fseek(f, 0, SEEK_END) != 0) {
    fclose(f);
    snd_pcm_close(pcm);
    return 1;
  }
  long fileBytes = ftell(f);
  rewind(f);
  if (fileBytes <= 0) {
    fprintf(stderr, "empty file %s\n", file);
    fclose(f);
    snd_pcm_close(pcm);
    return 1;
  }
  const size_t frameBytes = (size_t)channels * sizeof(int32_t);
  const size_t srcFrames = (size_t)fileBytes / frameBytes;
  if (srcFrames == 0) {
    fprintf(stderr, "file too short for %u channels\n", channels);
    fclose(f);
    snd_pcm_close(pcm);
    return 1;
  }
  int32_t *src = (int32_t *)malloc((size_t)srcFrames * frameBytes);
  if (!src) {
    fprintf(stderr, "out of memory\n");
    fclose(f);
    snd_pcm_close(pcm);
    return 1;
  }
  size_t got = fread(src, 1, (size_t)srcFrames * frameBytes, f);
  fclose(f);
  if (got < frameBytes) {
    fprintf(stderr, "short read %zu bytes\n", got);
    free(src);
    snd_pcm_close(pcm);
    return 1;
  }

  if (chunkFrames == 0 || chunkFrames > gotPeriod) chunkFrames = (unsigned int)gotPeriod;
  int32_t *scratch = (int32_t *)malloc((size_t)chunkFrames * frameBytes);
  if (!scratch) {
    fprintf(stderr, "out of memory\n");
    free(src);
    snd_pcm_close(pcm);
    return 1;
  }

  const long long targetFrames = secs > 0 ? (long long)(secs * (double)gotRate) : -1;
  long long written = 0;
  long long xruns = 0;
  size_t pos = 0;
  double t0 = nowSeconds();
  double tNext = t0 + 1.0;
  printf("[injector] playing %s %zu frames (%.3fs) loop=%d gain=%.3f\n", file, srcFrames,
         (double)srcFrames / (double)gotRate, loop, gain);
  fflush(stdout);

  while (!g_stop && (targetFrames < 0 || written < targetFrames)) {
    unsigned int n = chunkFrames;
    if (targetFrames > 0 && (long long)(targetFrames - written) < (long long)n) {
      n = (unsigned int)(targetFrames - written);
    }
    for (unsigned int i = 0; i < n; i++) {
      const int32_t *s = src + ((pos + i) % srcFrames) * channels;
      for (unsigned int c = 0; c < channels; c++) {
        double v = (double)s[c] * gain;
        if (v > 2147483647.0) v = 2147483647.0;
        if (v < -2147483648.0) v = -2147483648.0;
        scratch[i * channels + c] = (int32_t)v;
      }
    }
    snd_pcm_sframes_t r = snd_pcm_writei(pcm, scratch, n);
    if (r == -EPIPE) {
      xruns++;
      snd_pcm_prepare(pcm);
      continue;
    }
    if (r == -EAGAIN || r == -EINTR) {
      snd_pcm_wait(pcm, 100);
      continue;
    }
    if (r < 0) {
      fprintf(stderr, "writei error %s\n", snd_strerror((int)r));
      snd_pcm_prepare(pcm);
      continue;
    }
    written += (long long)r;
    pos = (pos + (size_t)r) % srcFrames;
    if (!loop && pos == 0 && written >= (long long)srcFrames) break;

    double t = nowSeconds();
    if (t >= tNext) {
      fprintf(stderr, "[injector] t=%.1f frames=%lld (%.1fs audio) xruns=%lld\n", t - t0, written,
              (double)written / (double)gotRate, xruns);
      tNext = t + 1.0;
    }
  }

  double dt = nowSeconds() - t0;
  printf("[injector] done frames=%lld xruns=%lld wall=%.2fs effective_rate=%.1f\n", written, xruns,
         dt, dt > 0 ? (double)written / dt : 0.0);
  snd_pcm_drain(pcm);
  snd_pcm_close(pcm);
  free(scratch);
  free(src);
  return 0;
}
