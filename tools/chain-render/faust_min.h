#ifndef CHAIN_RENDER_FAUST_MIN_H
#define CHAIN_RENDER_FAUST_MIN_H

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>

#ifndef FAUSTFLOAT
#define FAUSTFLOAT float
#endif

class UI {
 public:
    UI() {}
    virtual ~UI() {}
    virtual void openTabBox(const char* label) {}
    virtual void openHorizontalBox(const char* label) {}
    virtual void openVerticalBox(const char* label) {}
    virtual void openFrameBox(const char* label) {}
    virtual void closeBox() {}
    virtual void addButton(const char* label, FAUSTFLOAT* zone) {}
    virtual void addCheckButton(const char* label, FAUSTFLOAT* zone) {}
    virtual void addVerticalSlider(const char* label, FAUSTFLOAT* zone, FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) {}
    virtual void addHorizontalSlider(const char* label, FAUSTFLOAT* zone, FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) {}
    virtual void addNumEntry(const char* label, FAUSTFLOAT* zone, FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) {}
    virtual void addHorizontalBargraph(const char* label, FAUSTFLOAT* zone, FAUSTFLOAT min, FAUSTFLOAT max) {}
    virtual void addVerticalBargraph(const char* label, FAUSTFLOAT* zone, FAUSTFLOAT min, FAUSTFLOAT max) {}
    virtual void declare(FAUSTFLOAT* zone, const char* key, const char* value) {}
};

class Meta {
 public:
    Meta() {}
    virtual ~Meta() {}
    virtual void declare(const char* key, const char* value) {}
};

class dsp {
 public:
    virtual ~dsp() {}
    virtual int getNumInputs() = 0;
    virtual int getNumOutputs() = 0;
    virtual void buildUserInterface(UI* ui_interface) = 0;
    virtual void init(int sample_rate) = 0;
    virtual void compute(int count, FAUSTFLOAT** inputs, FAUSTFLOAT** outputs) = 0;
};

class ZoneUI : public UI {
 public:
    std::map<std::string, FAUSTFLOAT*> zone;
    std::map<std::string, FAUSTFLOAT> init;
    std::map<std::string, std::string> kind;

    virtual void addButton(const char* label, FAUSTFLOAT* z)
    {
        zone[label] = z;
        init[label] = 0.0f;
        kind[label] = "button";
    }

    virtual void addCheckButton(const char* label, FAUSTFLOAT* z)
    {
        zone[label] = z;
        init[label] = 0.0f;
        kind[label] = "checkbox";
    }

    virtual void addVerticalSlider(const char* label, FAUSTFLOAT* z, FAUSTFLOAT i, FAUSTFLOAT mn, FAUSTFLOAT mx, FAUSTFLOAT st)
    {
        zone[label] = z;
        init[label] = i;
        kind[label] = "vslider";
    }

    virtual void addHorizontalSlider(const char* label, FAUSTFLOAT* z, FAUSTFLOAT i, FAUSTFLOAT mn, FAUSTFLOAT mx, FAUSTFLOAT st)
    {
        zone[label] = z;
        init[label] = i;
        kind[label] = "hslider";
    }

    virtual void addNumEntry(const char* label, FAUSTFLOAT* z, FAUSTFLOAT i, FAUSTFLOAT mn, FAUSTFLOAT mx, FAUSTFLOAT st)
    {
        zone[label] = z;
        init[label] = i;
        kind[label] = "nentry";
    }

    virtual void addHorizontalBargraph(const char* label, FAUSTFLOAT* z, FAUSTFLOAT mn, FAUSTFLOAT mx)
    {
        kind[label] = "hbargraph";
    }

    virtual void addVerticalBargraph(const char* label, FAUSTFLOAT* z, FAUSTFLOAT mn, FAUSTFLOAT mx)
    {
        kind[label] = "vbargraph";
    }

    bool set(const std::string& label, float v)
    {
        std::map<std::string, FAUSTFLOAT*>::iterator it = zone.find(label);
        if (it == zone.end()) return false;
        *(it->second) = v;
        return true;
    }
};

#endif
