#include <ableton/Link.hpp>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <thread>

int main(int argc, char** argv) {
  const double bpm = argc > 1 ? atof(argv[1]) : 120.0;
  const double quantum = argc > 2 ? atof(argv[2]) : 16.0;
  const bool playMetronome = argc > 3 && atoi(argv[3]) != 0;

  ableton::Link link(bpm);
  link.enable(true);
  link.enableStartStopSync(false);

  link.setNumPeersCallback([](std::size_t peers) {
    printf("[peer] numPeers now %zu\n", peers);
    fflush(stdout);
  });
  link.setTempoCallback([](double t) {
    printf("[peer] session tempo now %.3f\n", t);
    fflush(stdout);
  });
  link.setStartStopCallback([](bool playing) {
    printf("[peer] session isPlaying now %d\n", playing ? 1 : 0);
    fflush(stdout);
  });

  double lastPrintedBeat = -1.0;
  while (true) {
    const auto state = link.captureAppSessionState();
    const auto now = link.clock().micros();
    const double beat = state.beatAtTime(now, quantum);
    const int64_t hostMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                               std::chrono::system_clock::now().time_since_epoch()).count();
    if (playMetronome) {
      const double whole = std::floor(beat);
      if (whole != lastPrintedBeat) {
        lastPrintedBeat = whole;
        printf("[peer] CLICK beat %.3f bpm %.3f\n", whole, state.tempo());
        fflush(stdout);
      }
    }
    printf("[peer] peers=%zu bpm=%.3f beat=%.4f phase=%.5f ms=%lld\n", link.numPeers(),
           state.tempo(), beat, state.phaseAtTime(now, quantum), (long long)hostMs);
    fflush(stdout);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
}
