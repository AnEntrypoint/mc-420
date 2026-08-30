#ifndef ALOOP_LV2_HOST_H
#define ALOOP_LV2_HOST_H

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>

namespace aloop {

struct Lv2Plugin {
    std::string bundlePath;
    std::string uri;
    std::string soPath;
    void*       soHandle = nullptr;
    void*       instance = nullptr;
    void*       lilvPlugin = nullptr;
    const void* cachedDescriptor = nullptr;

    struct PortInfo {
        uint32_t index = 0;
        std::string symbol;
        bool isAudio = false;
        bool isInput = false;
        float defaultValue = 0.0f;
    };
    std::vector<PortInfo> ports;
    std::vector<float*>   audioIn;
    std::vector<float*>   audioOut;
    std::vector<float>    controlValues;
    std::vector<size_t>   controlPortIdx;

    bool enabled = true;
    uint64_t faultCount = 0;

    int coreAffinity = -1;
};

class Lv2Host {
public:
    int loadDir(const std::string& dir, int coreAffinity = 3);

    bool loadBundle(const std::string& bundlePath, int coreAffinity);

    void connect(int blockSize, int numChannels);

    void runBlock(int nframes);

    void process(float* buf, int nframes);

    void setControl(const std::string& symbol, float value);

    struct ControlHandle {
        std::vector<float*> cells;
    };
    ControlHandle resolveControl(const std::string& symbol) const;
    static void setControlFast(const ControlHandle& h, float value) {
        for (float* cell : h.cells) *cell = value;
    }

    void rescanUser(const std::string& userDir);

    enum class Topology { SERIAL, FORK_JOIN };
    void setTopology(Topology t) { topology_ = t; }

    bool hasPlugins() const { return !plugins_.empty(); }

    void disablePlugin(Lv2Plugin* p);

private:
    std::vector<Lv2Plugin> plugins_;
    Topology topology_ = Topology::SERIAL;

    std::vector<float> ioBuffer_;
    void* lilvWorld_ = nullptr;

    bool readTtl(const std::string& bundlePath, Lv2Plugin& out);
    bool dlopenPlugin(Lv2Plugin& p);
    void instantiate(Lv2Plugin& p, double sampleRate);
    void connectPorts(Lv2Plugin& p, int blockSize);
    void runOne(Lv2Plugin& p, int nframes);
};

}

#endif
