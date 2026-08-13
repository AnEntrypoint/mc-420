#include "lv2_host.h"

#include <dlfcn.h>
#include <dirent.h>
#include <unistd.h>
#include <csetjmp>
#include <csignal>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#if __has_include(<lv2/lv2plug.in/ns/lv2core/lv2.h>)
#include <lv2/lv2plug.in/ns/lv2core/lv2.h>
#define ALOOP_HAVE_LV2 1
#elif __has_include(<lv2.h>)
#include <lv2.h>
#define ALOOP_HAVE_LV2 1
#endif

#if __has_include(<lilv/lilv.h>)
#include <lilv/lilv.h>
#define ALOOP_HAVE_LILV 1
#endif

namespace aloop {

namespace {
sigjmp_buf   g_jmp;
volatile sig_atomic_t g_inPlugin = 0;
void faultHandler(int sig, siginfo_t* info, void*) {
    if (g_inPlugin) siglongjmp(g_jmp, sig);
    char buf[128];
    int n = snprintf(buf, sizeof buf, "[fatal] signal=%d si_addr=%p outside-plugin\n",
                      sig, info ? info->si_addr : nullptr);
    if (n > 0) { ssize_t w = write(2, buf, (size_t)n); (void)w; }
    signal(sig, SIG_DFL);
    raise(sig);
}
void installWatchdog() {
    static char altStack[SIGSTKSZ * 4];
    stack_t ss{};
    ss.ss_sp = altStack;
    ss.ss_size = sizeof(altStack);
    ss.ss_flags = 0;
    sigaltstack(&ss, nullptr);

    struct sigaction sa{};
    sa.sa_sigaction = faultHandler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_NODEFER | SA_SIGINFO | SA_ONSTACK;
    sigaction(SIGSEGV, &sa, nullptr);
    sigaction(SIGFPE,  &sa, nullptr);
}
}

int Lv2Host::loadDir(const std::string& dir, int coreAffinity) {
    installWatchdog();
    int n = 0;
    DIR* d = opendir(dir.c_str());
    if (!d) { fprintf(stderr, "[host] no effects dir %s (ok — skipped)\n", dir.c_str()); return 0; }
    struct dirent* e;
    while ((e = readdir(d))) {
        std::string name = e->d_name;
        if (name.size() > 4 && name.substr(name.size() - 4) == ".lv2") {
            if (loadBundle(dir + "/" + name, coreAffinity)) n++;
        }
    }
    closedir(d);
    fprintf(stderr, "[host] loaded %d effect(s) from %s (core %d)\n", n, dir.c_str(), coreAffinity);
    return n;
}

bool Lv2Host::loadBundle(const std::string& bundlePath, int coreAffinity) {
    Lv2Plugin p;
    p.bundlePath = bundlePath;
    p.coreAffinity = coreAffinity;
    if (!readTtl(bundlePath, p)) {
        fprintf(stderr, "[host] skip %s (no readable .ttl)\n", bundlePath.c_str());
        return false;
    }
    if (!dlopenPlugin(p)) {
        fprintf(stderr, "[host] skip %s (dlopen failed: %s)\n", bundlePath.c_str(), dlerror());
        return false;
    }
    plugins_.push_back(std::move(p));
    fprintf(stderr, "[host] loaded %s on core %d\n", bundlePath.c_str(), coreAffinity);
    return true;
}

#ifdef ALOOP_HAVE_LILV
namespace {
LilvWorld* g_lilvWorldProcessLifetime = nullptr;
}
#endif

bool Lv2Host::readTtl(const std::string& bundlePath, Lv2Plugin& out) {
    DIR* d = opendir(bundlePath.c_str());
    if (!d) return false;
    struct dirent* e; std::string so;
    while ((e = readdir(d))) {
        std::string n = e->d_name;
        if (n.size() > 3 && n.substr(n.size() - 3) == ".so") so = bundlePath + "/" + n;
    }
    closedir(d);
    if (so.empty()) return false;
    out.soPath = so;
    out.uri = so;

#ifdef ALOOP_HAVE_LILV
    if (!g_lilvWorldProcessLifetime) { g_lilvWorldProcessLifetime = lilv_world_new(); lilv_world_load_all(g_lilvWorldProcessLifetime); }
    if (!lilvWorld_) lilvWorld_ = g_lilvWorldProcessLifetime;

    std::string uri = "file://" + bundlePath + "/";
    LilvNode* bundleUri = lilv_new_uri(g_lilvWorldProcessLifetime, uri.c_str());
    lilv_world_load_bundle(g_lilvWorldProcessLifetime, bundleUri);
    lilv_node_free(bundleUri);

    const LilvPlugins* plugins = lilv_world_get_all_plugins(g_lilvWorldProcessLifetime);
    const LilvPlugin* found = nullptr;
    auto stripTrailingSlash = [](std::string s) {
        while (!s.empty() && s.back() == '/') s.pop_back();
        return s;
    };
    std::string wantPath = stripTrailingSlash(bundlePath);
    LILV_FOREACH(plugins, i, plugins) {
        const LilvPlugin* pl = lilv_plugins_get(plugins, i);
        const LilvNode* bundle = lilv_plugin_get_bundle_uri(pl);
        const char* bpathC = lilv_uri_to_path(lilv_node_as_uri(bundle));
        std::string bpath = stripTrailingSlash(bpathC ? bpathC : "");
        if (!bpath.empty() && bpath == wantPath) { found = pl; break; }
    }
    if (found) {
        out.lilvPlugin = (void*)found;
        out.uri = lilv_node_as_uri(lilv_plugin_get_uri(found));

        LilvNode* audioClass   = lilv_new_uri(g_lilvWorldProcessLifetime, LILV_URI_AUDIO_PORT);
        LilvNode* controlClass = lilv_new_uri(g_lilvWorldProcessLifetime, LILV_URI_CONTROL_PORT);
        LilvNode* inputClass   = lilv_new_uri(g_lilvWorldProcessLifetime, LILV_URI_INPUT_PORT);

        uint32_t n = lilv_plugin_get_num_ports(found);
        for (uint32_t idx = 0; idx < n; idx++) {
            const LilvPort* port = lilv_plugin_get_port_by_index(found, idx);
            Lv2Plugin::PortInfo pi;
            pi.index    = idx;
            pi.isAudio  = lilv_port_is_a(found, port, audioClass);
            pi.isInput  = lilv_port_is_a(found, port, inputClass);
            const LilvNode* symNode = lilv_port_get_symbol(found, port);
            pi.symbol = symNode ? lilv_node_as_string(symNode) : ("port" + std::to_string(idx));
            if (!pi.isAudio && !lilv_port_is_a(found, port, controlClass)) continue;
            out.ports.push_back(pi);
        }
        lilv_node_free(inputClass);
        lilv_node_free(controlClass);
        lilv_node_free(audioClass);
    } else {
        fprintf(stderr, "[host] lilv found no plugin matching bundle %s — falling back to .so-only load (no port wiring)\n", bundlePath.c_str());
    }
#endif
    return true;
}

bool Lv2Host::dlopenPlugin(Lv2Plugin& p) {
    p.soHandle = dlopen(p.soPath.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!p.soHandle) return false;
#ifdef ALOOP_HAVE_LV2
    auto desc = (const LV2_Descriptor* (*)(uint32_t))dlsym(p.soHandle, "lv2_descriptor");
    if (!desc) return false;
#endif
    return true;
}

#ifdef ALOOP_HAVE_LV2
static const LV2_Descriptor* findDescriptorByUri(void* soHandle, const std::string& uri) {
    auto getDesc = (const LV2_Descriptor* (*)(uint32_t))dlsym(soHandle, "lv2_descriptor");
    if (!getDesc) return nullptr;
    for (uint32_t i = 0; ; i++) {
        const LV2_Descriptor* d = getDesc(i);
        if (!d) return nullptr;
        if (uri.empty() || uri == d->URI) return d;
    }
}
#endif

void Lv2Host::instantiate(Lv2Plugin& p, double sampleRate) {
#ifdef ALOOP_HAVE_LV2
    const LV2_Descriptor* d = findDescriptorByUri(p.soHandle, p.lilvPlugin ? p.uri : std::string());
    if (!d) { p.enabled = false; return; }
    p.cachedDescriptor = d;
    static const LV2_Feature* const kNoFeatures[] = { nullptr };
    Lv2Plugin* pp = &p;
    g_inPlugin = 1;
    if (sigsetjmp(g_jmp, 1) == 0) {
        p.instance = (void*)d->instantiate(d, sampleRate, p.bundlePath.c_str(), kNoFeatures);
        if (p.instance && d->activate) d->activate((LV2_Handle)p.instance);
    } else {
        g_inPlugin = 0;
        pp->instance = nullptr;
        pp->faultCount++;
        disablePlugin(pp);
        fprintf(stderr, "[host] plugin %s faulted during instantiate — disabled, continuing\n", pp->bundlePath.c_str());
        return;
    }
    g_inPlugin = 0;
    if (!p.instance) { p.enabled = false; return; }
#else
    (void)p; (void)sampleRate;
#endif
}

void Lv2Host::connectPorts(Lv2Plugin& p, int blockSize) {
#ifdef ALOOP_HAVE_LV2
    if (!p.instance || p.ports.empty()) return;
    const LV2_Descriptor* d = static_cast<const LV2_Descriptor*>(p.cachedDescriptor);
    if (!d || !d->connect_port) return;

    p.controlValues.assign(p.ports.size(), 0.0f);
    for (size_t i = 0; i < p.ports.size(); i++) {
        auto& pi = p.ports[i];
        if (pi.isAudio) {
            float* sharedMonoBuf = ioBuffer_.data();
            d->connect_port(p.instance, pi.index, sharedMonoBuf);
            (pi.isInput ? p.audioIn : p.audioOut).push_back(sharedMonoBuf);
        } else {
            d->connect_port(p.instance, pi.index, &p.controlValues[i]);
            p.controlPortIdx.push_back(i);
        }
    }
    (void)blockSize;
#else
    (void)p; (void)blockSize;
#endif
}

void Lv2Host::connect(int blockSize, int numChannels) {
    ioBuffer_.assign((size_t)blockSize * numChannels, 0.0f);
    for (auto& p : plugins_) {
        instantiate(p, 48000.0);
        connectPorts(p, blockSize);
    }
}

void Lv2Host::runOne(Lv2Plugin& p, int nframes) {
    if (!p.enabled || !p.instance) return;
#ifdef ALOOP_HAVE_LV2
    const LV2_Descriptor* d = static_cast<const LV2_Descriptor*>(p.cachedDescriptor);
    if (!d) { p.enabled = false; return; }
    g_inPlugin = 1;
    if (sigsetjmp(g_jmp, 1) == 0) {
        d->run((LV2_Handle)p.instance, (uint32_t)nframes);
    } else {
        g_inPlugin = 0;
        p.faultCount++;
        disablePlugin(&p);
        fprintf(stderr, "[host] plugin %s faulted — disabled, continuing\n", p.bundlePath.c_str());
    }
    g_inPlugin = 0;
#else
    (void)nframes;
#endif
}

void Lv2Host::runBlock(int nframes) {
    for (auto& p : plugins_) runOne(p, nframes);
}

void Lv2Host::process(float* buf, int nframes) {
    if (plugins_.empty()) return;
    int n = nframes;
    if ((int)ioBuffer_.size() < n) return;
    std::memcpy(ioBuffer_.data(), buf, (size_t)n * sizeof(float));
    runBlock(n);
    std::memcpy(buf, ioBuffer_.data(), (size_t)n * sizeof(float));
}

static std::string mangleFaustLabel(const std::string& s) {
    std::string t = s;
    for (size_t i = 0; i < t.size(); i++) {
        char c = t[i];
        bool ok = (i == 0) ? (isalpha((unsigned char)c) || c == '_')
                            : (isalnum((unsigned char)c) || c == '_');
        if (!ok) t[i] = '_';
    }
    return t;
}

void Lv2Host::setControl(const std::string& symbol, float value) {
    std::string prefix = mangleFaustLabel(symbol) + "_";
    for (auto& p : plugins_) {
        for (size_t i = 0; i < p.controlPortIdx.size(); i++) {
            size_t portIdx = p.controlPortIdx[i];
            if (portIdx >= p.ports.size()) continue;
            const std::string& sym = p.ports[portIdx].symbol;
            if (sym.size() > prefix.size() && sym.compare(0, prefix.size(), prefix) == 0) {
                p.controlValues[portIdx] = value;
            }
        }
    }
}

Lv2Host::ControlHandle Lv2Host::resolveControl(const std::string& symbol) const {
    ControlHandle h;
    std::string prefix = mangleFaustLabel(symbol) + "_";
    for (auto& p : plugins_) {
        for (size_t i = 0; i < p.controlPortIdx.size(); i++) {
            size_t portIdx = p.controlPortIdx[i];
            if (portIdx >= p.ports.size()) continue;
            const std::string& sym = p.ports[portIdx].symbol;
            if (sym.size() > prefix.size() && sym.compare(0, prefix.size(), prefix) == 0) {
                h.cells.push_back(const_cast<float*>(&p.controlValues[portIdx]));
            }
        }
    }
    return h;
}

void Lv2Host::rescanUser(const std::string& userDir) {
    loadDir(userDir);
}

void Lv2Host::disablePlugin(Lv2Plugin* p) { if (p) p->enabled = false; }

}
