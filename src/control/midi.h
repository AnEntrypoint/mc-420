#ifndef ALOOP_MIDI_H
#define ALOOP_MIDI_H

#include <atomic>
#include <array>
#include <string>
#include <unordered_map>
#include <mutex>

namespace aloop {

class AudioThread;
class LinkBridge;

struct ParamStore {
    static constexpr int MAX = 256;
    std::array<std::atomic<float>, MAX> value;
    std::unordered_map<std::string, int> slot;
    std::mutex startupBindMtx;
    int count = 0;

    ParamStore() { for (auto& v : value) v.store(0.0f); }

    void bind(const std::string& name, float defaultVal = 0.0f) {
        std::lock_guard<std::mutex> g(startupBindMtx);
        if (slot.find(name) == slot.end() && count < MAX) {
            int idx = count++;
            slot[name] = idx;
            value[idx].store(defaultVal, std::memory_order_relaxed);
        }
    }
    void setByName(const std::string& name, float v) {
        auto it = slot.find(name);
        if (it != slot.end()) value[it->second].store(v, std::memory_order_relaxed);
    }
    float get(const std::string& name, float def = 0.0f) const {
        auto it = slot.find(name);
        return it != slot.end() ? value[it->second].load(std::memory_order_relaxed) : def;
    }
    int getSlot(const std::string& name) const {
        auto it = slot.find(name);
        return it != slot.end() ? it->second : -1;
    }
    float getBySlot(int slotIdx, float def = 0.0f) const {
        return slotIdx >= 0 ? value[(size_t)slotIdx].load(std::memory_order_relaxed) : def;
    }
    template <typename F> void forEach(F&& f) const { for (auto& kv : slot) f(kv.first, kv.second); }
};

void runMidiLoop(ParamStore& ps, const char* device, class AudioThread* audioForLedLevels = nullptr, class LinkBridge* linkForTempoPropose = nullptr);

int controlSurfaceCard();

}
#endif
