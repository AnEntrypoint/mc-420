/* ------------------------------------------------------------
author: "aloop"
license: "GPLv3"
name: "MultiKeyTranspose"
Code generated with Faust 2.85.9 (https://faust.grame.fr)
Compilation options: -lang cpp -fpga-mem-th 4 -ct 1 -cn AloopEffectDsp -es 1 -mcd 16 -mdd 1024 -mdy 33 -single -ftz 0
------------------------------------------------------------ */

#ifndef  __AloopEffectDsp_H__
#define  __AloopEffectDsp_H__

#ifndef FAUSTFLOAT
#define FAUSTFLOAT float
#endif 

/* link with : "" */
#include "pitch_poly_ffi.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <math.h>

#ifndef FAUSTCLASS 
#define FAUSTCLASS AloopEffectDsp
#endif

#ifdef __APPLE__ 
#define exp10f __exp10f
#define exp10 __exp10
#endif

#if defined(_WIN32)
#define RESTRICT __restrict
#else
#define RESTRICT __restrict__
#endif

static float AloopEffectDsp_faustpower2_f(float value) {
	return value * value;
}

class AloopEffectDsp : public dsp {
	
 private:
	
	float fVec0[2];
	int iRec0[2];
	int fSampleRate;
	float fConst0;
	float fConst1;
	float fRec1[2];
	float fConst2;
	float fConst3;
	float fConst4;
	FAUSTFLOAT fHbargraph0;
	float fRec2[2];
	float fVec1[2];
	FAUSTFLOAT fHbargraph1;
	FAUSTFLOAT fHbargraph2;
	float fConst5;
	float fConst6;
	float fConst7;
	float fConst8;
	float fConst9;
	float fConst10;
	float fRec13[2];
	float fRec12[2];
	float fRec11[2];
	float fConst11;
	float fRec14[2];
	float fConst12;
	float fConst13;
	float fRec16[3];
	float fRec15[3];
	float fRec10[2];
	float fConst14;
	float fRec9[2];
	float fConst15;
	float fRec8[2];
	float fConst16;
	int iRec17[2];
	float fRec6[2];
	float fRec7[2];
	FAUSTFLOAT fHbargraph3;
	float fConst17;
	float fConst18;
	float fRec19[2];
	float fRec18[2];
	float fRec5[2];
	float fRec4[2];
	float fRec3[2];
	float fConst19;
	float fRec20[2];
	float fVec2[2];
	int iRec21[2];
	float fRec22[2];
	float fRec27[2];
	float fRec26[2];
	float fRec25[2];
	float fRec24[2];
	float fRec23[2];
	float fRec28[2];
	float fVec3[2];
	int iRec29[2];
	float fRec30[2];
	float fRec35[2];
	float fRec34[2];
	float fRec33[2];
	float fRec32[2];
	float fRec31[2];
	float fRec36[2];
	float fVec4[2];
	int iRec37[2];
	float fRec38[2];
	float fRec43[2];
	float fRec42[2];
	float fRec41[2];
	float fRec40[2];
	float fRec39[2];
	float fRec44[2];
	float fVec5[2];
	int iRec45[2];
	float fRec46[2];
	float fRec51[2];
	float fRec50[2];
	float fRec49[2];
	float fRec48[2];
	float fRec47[2];
	float fRec52[2];
	float fVec6[2];
	int iRec53[2];
	float fRec54[2];
	float fRec59[2];
	float fRec58[2];
	float fRec57[2];
	float fRec56[2];
	float fRec55[2];
	float fRec60[2];
	float fConst20;
	float fRec61[2];
	
 public:
	AloopEffectDsp() {
	}
	
	AloopEffectDsp(const AloopEffectDsp&) = default;
	
	virtual ~AloopEffectDsp() = default;
	
	AloopEffectDsp& operator=(const AloopEffectDsp&) = default;
	
	void metadata(Meta* m) { 
		m->declare("analyzers.lib/name", "Faust Analyzer Library");
		m->declare("analyzers.lib/version", "1.3.0");
		m->declare("analyzers.lib/zcr:author", "Dario Sanfilippo");
		m->declare("analyzers.lib/zcr:copyright", "Copyright (C) 2020 Dario Sanfilippo       <sanfilippo.dario@gmail.com>");
		m->declare("analyzers.lib/zcr:license", "MIT-style STK-4.3 license");
		m->declare("author", "aloop");
		m->declare("basics.lib/name", "Faust Basic Element Library");
		m->declare("basics.lib/sAndH:author", "Romain Michon");
		m->declare("basics.lib/version", "1.22.0");
		m->declare("compile_options", "-lang cpp -fpga-mem-th 4 -ct 1 -cn AloopEffectDsp -es 1 -mcd 16 -mdd 1024 -mdy 33 -single -ftz 0");
		m->declare("description", "Polyphonic pitch-lock: each held voice's shift is derived from (targetNote - the live-tracked input pitch), continuously re-tracked for the whole sustain whenever the external autocorrelation tracker (fx/extfreqdet/pitchtracker.lv2) is trusted. The lock/attack/glide state machine (smoothedDetNote/heldDetNote/shiftAmount) is unchanged from the prior xpose()-based design -- what changed is the shifter itself: each of the 6 voices now runs its own EngineSoladSnac instance (pitch_poly.dsp/pitch_poly_ffi.h), the same SNAC-tracked splice-based PSOLA engine already proven on the mono free-transpose effect (pitch.dsp), instead of a two-tap delay-line interval shifter whose correctness depended on an externally-computed window matching the true input period. shiftAmount (semitones) converts to a ratio and drives the per-voice engine's own pitch tracking, transient-safe resplicing, and GrainFormant-based real formant preservation directly -- no separate window/crossfade computation or spectral-tilt formant hack needed in this file anymore.");
		m->declare("envelopes.lib/adsr:author", "Yann Orlarey and Andrey Bundin");
		m->declare("envelopes.lib/author", "GRAME");
		m->declare("envelopes.lib/copyright", "GRAME");
		m->declare("envelopes.lib/license", "LGPL with exception");
		m->declare("envelopes.lib/name", "Faust Envelope Library");
		m->declare("envelopes.lib/version", "1.3.0");
		m->declare("filename", "multitranspose.dsp");
		m->declare("filters.lib/fir:author", "Julius O. Smith III");
		m->declare("filters.lib/fir:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/fir:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/highpass:author", "Julius O. Smith III");
		m->declare("filters.lib/highpass:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/iir:author", "Julius O. Smith III");
		m->declare("filters.lib/iir:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/iir:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/lowpass0_highpass1", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/lowpass0_highpass1:author", "Julius O. Smith III");
		m->declare("filters.lib/lowpass:author", "Julius O. Smith III");
		m->declare("filters.lib/lowpass:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/lowpass:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/lptN:author", "Julius O. Smith III");
		m->declare("filters.lib/lptN:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/lptN:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/name", "Faust Filters Library");
		m->declare("filters.lib/tf1:author", "Julius O. Smith III");
		m->declare("filters.lib/tf1:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/tf1:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/tf1s:author", "Julius O. Smith III");
		m->declare("filters.lib/tf1s:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/tf1s:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/tf2:author", "Julius O. Smith III");
		m->declare("filters.lib/tf2:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/tf2:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/tf2s:author", "Julius O. Smith III");
		m->declare("filters.lib/tf2s:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/tf2s:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/version", "1.7.1");
		m->declare("license", "GPLv3");
		m->declare("maths.lib/author", "GRAME");
		m->declare("maths.lib/copyright", "GRAME");
		m->declare("maths.lib/license", "LGPL with exception");
		m->declare("maths.lib/name", "Faust Math Library");
		m->declare("maths.lib/version", "2.9.0");
		m->declare("name", "MultiKeyTranspose");
		m->declare("pitch_poly.dsp/author", "aloop");
		m->declare("pitch_poly.dsp/description", "Polyphonic PSOLA/formant-preserving pitch-shift bridge for multitranspose.dsp's 6 key-lock voices -- extracted into its own compile unit (never inline inside multitranspose.dsp) to keep the ffunction declaration away from that file's own compile-time-cliff risk. Each voice gets its own EngineSoladSnac instance (SNAC pitch tracking, splice-based PSOLA resplicing, real GrainFormant formant preservation) via a shared voice-indexed C++ array, mirroring pitch.dsp's existing mono free-transpose bridge exactly, just made polyphonic.");
		m->declare("pitch_poly.dsp/license", "GPLv3");
		m->declare("pitch_poly.dsp/name", "PitchPoly");
		m->declare("platform.lib/name", "Generic Platform Library");
		m->declare("platform.lib/version", "1.3.0");
		m->declare("signals.lib/name", "Faust Routing Library");
		m->declare("signals.lib/version", "1.6.0");
	}

	virtual int getNumInputs() {
		return 17;
	}
	virtual int getNumOutputs() {
		return 2;
	}
	
	static void classInit(int sample_rate) {
	}
	
	virtual void instanceConstants(int sample_rate) {
		fSampleRate = sample_rate;
		fConst0 = std::min<float>(1.92e+05f, std::max<float>(1.0f, static_cast<float>(fSampleRate)));
		fConst1 = 1.0f / std::max<float>(1.0f, 0.05f * fConst0);
		fConst2 = 1.0f / std::max<float>(1.0f, 0.003f * fConst0);
		fConst3 = 44.1f / fConst0;
		fConst4 = 1.0f - fConst3;
		fConst5 = std::exp(-(125.0f / fConst0));
		fConst6 = std::exp(-(5e+01f / fConst0));
		fConst7 = 1.0f / fConst0;
		fConst8 = 1.0f / std::tan(62.831852f / fConst0);
		fConst9 = 1.0f - fConst8;
		fConst10 = 1.0f / (fConst8 + 1.0f);
		fConst11 = 0.25f * fConst0;
		fConst12 = 0.4f * fConst0;
		fConst13 = 3.1415927f / fConst0;
		fConst14 = 1.0f - fConst6;
		fConst15 = 0.5f * fConst0;
		fConst16 = 0.025f * fConst0;
		fConst17 = 1.0f - fConst5;
		fConst18 = 0.08f * fConst0;
		fConst19 = 16.666666f / fConst0;
		fConst20 = 1e+01f / fConst0;
	}
	
	virtual void instanceResetUserInterface() {
	}
	
	virtual void instanceClear() {
		for (int l0 = 0; l0 < 2; l0 = l0 + 1) {
			fVec0[l0] = 0.0f;
		}
		for (int l1 = 0; l1 < 2; l1 = l1 + 1) {
			iRec0[l1] = 0;
		}
		for (int l2 = 0; l2 < 2; l2 = l2 + 1) {
			fRec1[l2] = 0.0f;
		}
		for (int l3 = 0; l3 < 2; l3 = l3 + 1) {
			fRec2[l3] = 0.0f;
		}
		for (int l4 = 0; l4 < 2; l4 = l4 + 1) {
			fVec1[l4] = 0.0f;
		}
		for (int l5 = 0; l5 < 2; l5 = l5 + 1) {
			fRec13[l5] = 0.0f;
		}
		for (int l6 = 0; l6 < 2; l6 = l6 + 1) {
			fRec12[l6] = 0.0f;
		}
		for (int l7 = 0; l7 < 2; l7 = l7 + 1) {
			fRec11[l7] = 0.0f;
		}
		for (int l8 = 0; l8 < 2; l8 = l8 + 1) {
			fRec14[l8] = 0.0f;
		}
		for (int l9 = 0; l9 < 3; l9 = l9 + 1) {
			fRec16[l9] = 0.0f;
		}
		for (int l10 = 0; l10 < 3; l10 = l10 + 1) {
			fRec15[l10] = 0.0f;
		}
		for (int l11 = 0; l11 < 2; l11 = l11 + 1) {
			fRec10[l11] = 0.0f;
		}
		for (int l12 = 0; l12 < 2; l12 = l12 + 1) {
			fRec9[l12] = 0.0f;
		}
		for (int l13 = 0; l13 < 2; l13 = l13 + 1) {
			fRec8[l13] = 0.0f;
		}
		for (int l14 = 0; l14 < 2; l14 = l14 + 1) {
			iRec17[l14] = 0;
		}
		for (int l15 = 0; l15 < 2; l15 = l15 + 1) {
			fRec6[l15] = 0.0f;
		}
		for (int l16 = 0; l16 < 2; l16 = l16 + 1) {
			fRec7[l16] = 0.0f;
		}
		for (int l17 = 0; l17 < 2; l17 = l17 + 1) {
			fRec19[l17] = 0.0f;
		}
		for (int l18 = 0; l18 < 2; l18 = l18 + 1) {
			fRec18[l18] = 0.0f;
		}
		for (int l19 = 0; l19 < 2; l19 = l19 + 1) {
			fRec5[l19] = 0.0f;
		}
		for (int l20 = 0; l20 < 2; l20 = l20 + 1) {
			fRec4[l20] = 0.0f;
		}
		for (int l21 = 0; l21 < 2; l21 = l21 + 1) {
			fRec3[l21] = 0.0f;
		}
		for (int l22 = 0; l22 < 2; l22 = l22 + 1) {
			fRec20[l22] = 0.0f;
		}
		for (int l23 = 0; l23 < 2; l23 = l23 + 1) {
			fVec2[l23] = 0.0f;
		}
		for (int l24 = 0; l24 < 2; l24 = l24 + 1) {
			iRec21[l24] = 0;
		}
		for (int l25 = 0; l25 < 2; l25 = l25 + 1) {
			fRec22[l25] = 0.0f;
		}
		for (int l26 = 0; l26 < 2; l26 = l26 + 1) {
			fRec27[l26] = 0.0f;
		}
		for (int l27 = 0; l27 < 2; l27 = l27 + 1) {
			fRec26[l27] = 0.0f;
		}
		for (int l28 = 0; l28 < 2; l28 = l28 + 1) {
			fRec25[l28] = 0.0f;
		}
		for (int l29 = 0; l29 < 2; l29 = l29 + 1) {
			fRec24[l29] = 0.0f;
		}
		for (int l30 = 0; l30 < 2; l30 = l30 + 1) {
			fRec23[l30] = 0.0f;
		}
		for (int l31 = 0; l31 < 2; l31 = l31 + 1) {
			fRec28[l31] = 0.0f;
		}
		for (int l32 = 0; l32 < 2; l32 = l32 + 1) {
			fVec3[l32] = 0.0f;
		}
		for (int l33 = 0; l33 < 2; l33 = l33 + 1) {
			iRec29[l33] = 0;
		}
		for (int l34 = 0; l34 < 2; l34 = l34 + 1) {
			fRec30[l34] = 0.0f;
		}
		for (int l35 = 0; l35 < 2; l35 = l35 + 1) {
			fRec35[l35] = 0.0f;
		}
		for (int l36 = 0; l36 < 2; l36 = l36 + 1) {
			fRec34[l36] = 0.0f;
		}
		for (int l37 = 0; l37 < 2; l37 = l37 + 1) {
			fRec33[l37] = 0.0f;
		}
		for (int l38 = 0; l38 < 2; l38 = l38 + 1) {
			fRec32[l38] = 0.0f;
		}
		for (int l39 = 0; l39 < 2; l39 = l39 + 1) {
			fRec31[l39] = 0.0f;
		}
		for (int l40 = 0; l40 < 2; l40 = l40 + 1) {
			fRec36[l40] = 0.0f;
		}
		for (int l41 = 0; l41 < 2; l41 = l41 + 1) {
			fVec4[l41] = 0.0f;
		}
		for (int l42 = 0; l42 < 2; l42 = l42 + 1) {
			iRec37[l42] = 0;
		}
		for (int l43 = 0; l43 < 2; l43 = l43 + 1) {
			fRec38[l43] = 0.0f;
		}
		for (int l44 = 0; l44 < 2; l44 = l44 + 1) {
			fRec43[l44] = 0.0f;
		}
		for (int l45 = 0; l45 < 2; l45 = l45 + 1) {
			fRec42[l45] = 0.0f;
		}
		for (int l46 = 0; l46 < 2; l46 = l46 + 1) {
			fRec41[l46] = 0.0f;
		}
		for (int l47 = 0; l47 < 2; l47 = l47 + 1) {
			fRec40[l47] = 0.0f;
		}
		for (int l48 = 0; l48 < 2; l48 = l48 + 1) {
			fRec39[l48] = 0.0f;
		}
		for (int l49 = 0; l49 < 2; l49 = l49 + 1) {
			fRec44[l49] = 0.0f;
		}
		for (int l50 = 0; l50 < 2; l50 = l50 + 1) {
			fVec5[l50] = 0.0f;
		}
		for (int l51 = 0; l51 < 2; l51 = l51 + 1) {
			iRec45[l51] = 0;
		}
		for (int l52 = 0; l52 < 2; l52 = l52 + 1) {
			fRec46[l52] = 0.0f;
		}
		for (int l53 = 0; l53 < 2; l53 = l53 + 1) {
			fRec51[l53] = 0.0f;
		}
		for (int l54 = 0; l54 < 2; l54 = l54 + 1) {
			fRec50[l54] = 0.0f;
		}
		for (int l55 = 0; l55 < 2; l55 = l55 + 1) {
			fRec49[l55] = 0.0f;
		}
		for (int l56 = 0; l56 < 2; l56 = l56 + 1) {
			fRec48[l56] = 0.0f;
		}
		for (int l57 = 0; l57 < 2; l57 = l57 + 1) {
			fRec47[l57] = 0.0f;
		}
		for (int l58 = 0; l58 < 2; l58 = l58 + 1) {
			fRec52[l58] = 0.0f;
		}
		for (int l59 = 0; l59 < 2; l59 = l59 + 1) {
			fVec6[l59] = 0.0f;
		}
		for (int l60 = 0; l60 < 2; l60 = l60 + 1) {
			iRec53[l60] = 0;
		}
		for (int l61 = 0; l61 < 2; l61 = l61 + 1) {
			fRec54[l61] = 0.0f;
		}
		for (int l62 = 0; l62 < 2; l62 = l62 + 1) {
			fRec59[l62] = 0.0f;
		}
		for (int l63 = 0; l63 < 2; l63 = l63 + 1) {
			fRec58[l63] = 0.0f;
		}
		for (int l64 = 0; l64 < 2; l64 = l64 + 1) {
			fRec57[l64] = 0.0f;
		}
		for (int l65 = 0; l65 < 2; l65 = l65 + 1) {
			fRec56[l65] = 0.0f;
		}
		for (int l66 = 0; l66 < 2; l66 = l66 + 1) {
			fRec55[l66] = 0.0f;
		}
		for (int l67 = 0; l67 < 2; l67 = l67 + 1) {
			fRec60[l67] = 0.0f;
		}
		for (int l68 = 0; l68 < 2; l68 = l68 + 1) {
			fRec61[l68] = 0.0f;
		}
	}
	
	virtual void init(int sample_rate) {
		classInit(sample_rate);
		instanceInit(sample_rate);
	}
	
	virtual void instanceInit(int sample_rate) {
		instanceConstants(sample_rate);
		instanceResetUserInterface();
		instanceClear();
	}
	
	virtual AloopEffectDsp* clone() {
		return new AloopEffectDsp(*this);
	}
	
	virtual int getSampleRate() {
		return fSampleRate;
	}
	
	virtual void buildUserInterface(UI* ui_interface) {
		ui_interface->openVerticalBox("MultiKeyTranspose");
		ui_interface->addHorizontalBargraph("freediag", &fHbargraph0, FAUSTFLOAT(0.0f), FAUSTFLOAT(1.0f));
		ui_interface->addHorizontalBargraph("freqdetdiag", &fHbargraph3, FAUSTFLOAT(0.0f), FAUSTFLOAT(2e+03f));
		ui_interface->addHorizontalBargraph("rawextfreqdetdiag", &fHbargraph1, FAUSTFLOAT(0.0f), FAUSTFLOAT(2e+03f));
		ui_interface->addHorizontalBargraph("trustedtrackerdiag", &fHbargraph2, FAUSTFLOAT(0.0f), FAUSTFLOAT(1.0f));
		ui_interface->closeBox();
	}
	
	virtual void compute(int count, FAUSTFLOAT** RESTRICT inputs, FAUSTFLOAT** RESTRICT outputs) {
		FAUSTFLOAT* input0 = inputs[0];
		FAUSTFLOAT* input1 = inputs[1];
		FAUSTFLOAT* input2 = inputs[2];
		FAUSTFLOAT* input3 = inputs[3];
		FAUSTFLOAT* input4 = inputs[4];
		FAUSTFLOAT* input5 = inputs[5];
		FAUSTFLOAT* input6 = inputs[6];
		FAUSTFLOAT* input7 = inputs[7];
		FAUSTFLOAT* input8 = inputs[8];
		FAUSTFLOAT* input9 = inputs[9];
		FAUSTFLOAT* input10 = inputs[10];
		FAUSTFLOAT* input11 = inputs[11];
		FAUSTFLOAT* input12 = inputs[12];
		FAUSTFLOAT* input13 = inputs[13];
		FAUSTFLOAT* input14 = inputs[14];
		FAUSTFLOAT* input15 = inputs[15];
		FAUSTFLOAT* input16 = inputs[16];
		FAUSTFLOAT* output0 = outputs[0];
		FAUSTFLOAT* output1 = outputs[1];
		for (int i0 = 0; i0 < count; i0 = i0 + 1) {
			float fTemp0 = static_cast<float>(input16[i0]);
			fVec0[0] = fTemp0;
			iRec0[0] = (fTemp0 == 0.0f) * (iRec0[1] + 1);
			fRec1[0] = fTemp0 + fRec1[1] * static_cast<float>(fVec0[1] >= fTemp0);
			float fTemp1 = static_cast<float>(input2[i0]);
			fHbargraph0 = static_cast<FAUSTFLOAT>(fTemp1);
			fRec2[0] = fConst3 * fTemp1 + fConst4 * fRec2[1];
			float fTemp2 = 1.0f - fRec2[0];
			float fTemp3 = static_cast<float>(input0[i0]) * fTemp2 + static_cast<float>(input1[i0]) * fRec2[0];
			fVec1[0] = fTemp3;
			int iTemp4 = fTemp0 > fVec0[1];
			float fTemp5 = static_cast<float>(input4[i0]);
			fHbargraph1 = static_cast<FAUSTFLOAT>(fTemp5);
			float fTemp6 = fTemp5;
			int iTemp7 = fTemp6 > 61.0f;
			fHbargraph2 = static_cast<FAUSTFLOAT>(static_cast<float>(iTemp7));
			int iTemp8 = static_cast<float>(iTemp7) > 0.5f;
			float fTemp9 = std::max<float>(6e+01f, fRec8[1]);
			float fTemp10 = 0.18f / fTemp9;
			int iTemp11 = std::fabs(fTemp10) < 1.1920929e-07f;
			float fTemp12 = ((iTemp11) ? 0.0f : std::exp(-(fConst7 / ((iTemp11) ? 1.0f : fTemp10))));
			fRec13[0] = -(fConst10 * (fConst9 * fRec13[1] - fConst8 * (fTemp3 - fVec1[1])));
			fRec12[0] = ((fRec13[0] != 0.0f) ? fRec13[0] : fRec12[1]);
			float fTemp13 = static_cast<float>((fRec12[0] * fRec12[1]) < 0.0f);
			fRec11[0] = fTemp13 * (1.0f - fTemp12) + fTemp12 * fRec11[1];
			float fTemp14 = 0.09f / fTemp9;
			int iTemp15 = std::fabs(fTemp14) < 1.1920929e-07f;
			float fTemp16 = ((iTemp15) ? 0.0f : std::exp(-(fConst7 / ((iTemp15) ? 1.0f : fTemp14))));
			fRec14[0] = fTemp13 * (1.0f - fTemp16) + fTemp16 * fRec14[1];
			float fTemp17 = std::tan(fConst13 * std::max<float>(6e+01f, std::max<float>(fRec8[1], std::max<float>(fConst11 * fRec11[0], fConst12 * fRec14[0]))));
			float fTemp18 = 1.0f / fTemp17;
			float fTemp19 = (fTemp18 + 0.76536685f) / fTemp17 + 1.0f;
			float fTemp20 = 1.0f - 1.0f / AloopEffectDsp_faustpower2_f(fTemp17);
			float fTemp21 = (fTemp18 + 1.847759f) / fTemp17 + 1.0f;
			fRec16[0] = fRec13[0] - (fRec16[2] * ((fTemp18 + -1.847759f) / fTemp17 + 1.0f) + 2.0f * fRec16[1] * fTemp20) / fTemp21;
			fRec15[0] = (fRec16[2] + fRec16[0] + 2.0f * fRec16[1]) / fTemp21 - (fRec15[2] * ((fTemp18 + -0.76536685f) / fTemp17 + 1.0f) + 2.0f * fTemp20 * fRec15[1]) / fTemp19;
			float fTemp22 = (fRec15[2] + fRec15[0] + 2.0f * fRec15[1]) / fTemp19;
			fRec10[0] = ((fTemp22 != 0.0f) ? fTemp22 : fRec10[1]);
			fRec9[0] = fConst14 * static_cast<float>((fRec10[0] * fRec10[1]) < 0.0f) + fConst6 * fRec9[1];
			fRec8[0] = fConst15 * fRec9[0];
			float fTemp23 = std::min<float>(1.5e+03f, std::max<float>(6e+01f, fRec8[0]));
			iRec17[0] = iRec17[1] + 1;
			int iTemp24 = iRec17[1] == 0;
			int iTemp25 = (iTemp24 | (fRec7[1] >= fConst16)) | ((fTemp23 < (1.6817929f * fRec6[1])) & (fTemp23 > (0.59460354f * fRec6[1])));
			fRec6[0] = ((iTemp25) ? fTemp23 : fRec6[1]);
			fRec7[0] = ((iTemp25) ? 0.0f : fRec7[1] + 1.0f);
			float fTemp26 = std::max<float>(6e+01f, ((iTemp7) ? fTemp6 : fRec6[0]));
			fHbargraph3 = static_cast<FAUSTFLOAT>(fTemp26);
			float fTemp27 = 17.31234f * std::log(0.0022727272f * std::max<float>(2e+01f, fTemp26)) + 69.0f;
			float fTemp28 = fConst17 * fTemp27;
			fRec19[0] = ((iTemp4) ? 0.0f : fRec19[1] + 1.0f);
			fRec18[0] = ((fRec19[0] < fConst18) ? fRec18[1] : fTemp27);
			float fTemp29 = static_cast<float>(input15[i0]);
			fRec5[0] = ((iTemp4) ? ((iTemp24) ? fTemp29 : fRec18[0]) : ((iTemp8) ? fTemp28 + fConst5 * fRec5[1] : fRec5[1]));
			fRec4[0] = ((iTemp8) ? fRec5[0] : fRec4[1]);
			float fTemp30 = fTemp29 - fRec4[0];
			fRec3[0] = ((iTemp4) ? fTemp30 : fConst5 * fRec3[1] + fConst17 * fTemp30);
			float fTemp31 = static_cast<float>(input3[i0]);
			int iTemp32 = fTemp0 > 0.5f;
			fRec20[0] = ((iTemp32) ? 1.0f : std::max<float>(0.0f, fRec20[1] - fConst19));
			float fTemp33 = static_cast<float>(input14[i0]);
			fVec2[0] = fTemp33;
			iRec21[0] = (fTemp33 == 0.0f) * (iRec21[1] + 1);
			fRec22[0] = fTemp33 + fRec22[1] * static_cast<float>(fVec2[1] >= fTemp33);
			int iTemp34 = fTemp33 > fVec2[1];
			fRec27[0] = ((iTemp34) ? 0.0f : fRec27[1] + 1.0f);
			fRec26[0] = ((fRec27[0] < fConst18) ? fRec26[1] : fTemp27);
			float fTemp35 = static_cast<float>(input13[i0]);
			fRec25[0] = ((iTemp34) ? ((iTemp24) ? fTemp35 : fRec26[0]) : ((iTemp8) ? fTemp28 + fConst5 * fRec25[1] : fRec25[1]));
			fRec24[0] = ((iTemp8) ? fRec25[0] : fRec24[1]);
			float fTemp36 = fTemp35 - fRec24[0];
			fRec23[0] = ((iTemp34) ? fTemp36 : fConst5 * fRec23[1] + fConst17 * fTemp36);
			int iTemp37 = fTemp33 > 0.5f;
			fRec28[0] = ((iTemp37) ? 1.0f : std::max<float>(0.0f, fRec28[1] - fConst19));
			float fTemp38 = static_cast<float>(input12[i0]);
			fVec3[0] = fTemp38;
			iRec29[0] = (fTemp38 == 0.0f) * (iRec29[1] + 1);
			fRec30[0] = fTemp38 + fRec30[1] * static_cast<float>(fVec3[1] >= fTemp38);
			int iTemp39 = fTemp38 > fVec3[1];
			fRec35[0] = ((iTemp39) ? 0.0f : fRec35[1] + 1.0f);
			fRec34[0] = ((fRec35[0] < fConst18) ? fRec34[1] : fTemp27);
			float fTemp40 = static_cast<float>(input11[i0]);
			fRec33[0] = ((iTemp39) ? ((iTemp24) ? fTemp40 : fRec34[0]) : ((iTemp8) ? fTemp28 + fConst5 * fRec33[1] : fRec33[1]));
			fRec32[0] = ((iTemp8) ? fRec33[0] : fRec32[1]);
			float fTemp41 = fTemp40 - fRec32[0];
			fRec31[0] = ((iTemp39) ? fTemp41 : fConst5 * fRec31[1] + fConst17 * fTemp41);
			int iTemp42 = fTemp38 > 0.5f;
			fRec36[0] = ((iTemp42) ? 1.0f : std::max<float>(0.0f, fRec36[1] - fConst19));
			float fTemp43 = static_cast<float>(input10[i0]);
			fVec4[0] = fTemp43;
			iRec37[0] = (fTemp43 == 0.0f) * (iRec37[1] + 1);
			fRec38[0] = fTemp43 + fRec38[1] * static_cast<float>(fVec4[1] >= fTemp43);
			int iTemp44 = fTemp43 > fVec4[1];
			fRec43[0] = ((iTemp44) ? 0.0f : fRec43[1] + 1.0f);
			fRec42[0] = ((fRec43[0] < fConst18) ? fRec42[1] : fTemp27);
			float fTemp45 = static_cast<float>(input9[i0]);
			fRec41[0] = ((iTemp44) ? ((iTemp24) ? fTemp45 : fRec42[0]) : ((iTemp8) ? fTemp28 + fConst5 * fRec41[1] : fRec41[1]));
			fRec40[0] = ((iTemp8) ? fRec41[0] : fRec40[1]);
			float fTemp46 = fTemp45 - fRec40[0];
			fRec39[0] = ((iTemp44) ? fTemp46 : fConst5 * fRec39[1] + fConst17 * fTemp46);
			int iTemp47 = fTemp43 > 0.5f;
			fRec44[0] = ((iTemp47) ? 1.0f : std::max<float>(0.0f, fRec44[1] - fConst19));
			float fTemp48 = static_cast<float>(input8[i0]);
			fVec5[0] = fTemp48;
			iRec45[0] = (fTemp48 == 0.0f) * (iRec45[1] + 1);
			fRec46[0] = fTemp48 + fRec46[1] * static_cast<float>(fVec5[1] >= fTemp48);
			int iTemp49 = fTemp48 > fVec5[1];
			fRec51[0] = ((iTemp49) ? 0.0f : fRec51[1] + 1.0f);
			fRec50[0] = ((fRec51[0] < fConst18) ? fRec50[1] : fTemp27);
			float fTemp50 = static_cast<float>(input7[i0]);
			fRec49[0] = ((iTemp49) ? ((iTemp24) ? fTemp50 : fRec50[0]) : ((iTemp8) ? fTemp28 + fConst5 * fRec49[1] : fRec49[1]));
			fRec48[0] = ((iTemp8) ? fRec49[0] : fRec48[1]);
			float fTemp51 = fTemp50 - fRec48[0];
			fRec47[0] = ((iTemp49) ? fTemp51 : fConst5 * fRec47[1] + fConst17 * fTemp51);
			int iTemp52 = fTemp48 > 0.5f;
			fRec52[0] = ((iTemp52) ? 1.0f : std::max<float>(0.0f, fRec52[1] - fConst19));
			float fTemp53 = static_cast<float>(input6[i0]);
			fVec6[0] = fTemp53;
			iRec53[0] = (fTemp53 == 0.0f) * (iRec53[1] + 1);
			fRec54[0] = fTemp53 + fRec54[1] * static_cast<float>(fVec6[1] >= fTemp53);
			int iTemp54 = fTemp53 > fVec6[1];
			fRec59[0] = ((iTemp54) ? 0.0f : fRec59[1] + 1.0f);
			fRec58[0] = ((fRec59[0] < fConst18) ? fRec58[1] : fTemp27);
			float fTemp55 = static_cast<float>(input5[i0]);
			fRec57[0] = ((iTemp54) ? ((iTemp24) ? fTemp55 : fRec58[0]) : ((iTemp8) ? fConst5 * fRec57[1] + fTemp28 : fRec57[1]));
			fRec56[0] = ((iTemp8) ? fRec57[0] : fRec56[1]);
			float fTemp56 = fTemp55 - fRec56[0];
			fRec55[0] = ((iTemp54) ? fTemp56 : fConst5 * fRec55[1] + fConst17 * fTemp56);
			int iTemp57 = fTemp53 > 0.5f;
			fRec60[0] = ((iTemp57) ? 1.0f : std::max<float>(0.0f, fRec60[1] - fConst19));
			float fTemp58 = tanhf(0.6f * (dubfx_pitch_tick_poly(fTemp3, 0.0f, std::pow(2.0f, 0.083333336f * fRec55[0]), fTemp31, static_cast<float>(fRec60[0] > 0.0f)) * std::max<float>(0.0f, std::min<float>(fConst2 * fRec54[0], 1.0f) * (1.0f - fConst1 * static_cast<float>(iRec53[0]))) + dubfx_pitch_tick_poly(fTemp3, 1.0f, std::pow(2.0f, 0.083333336f * fRec47[0]), fTemp31, static_cast<float>(fRec52[0] > 0.0f)) * std::max<float>(0.0f, std::min<float>(fConst2 * fRec46[0], 1.0f) * (1.0f - fConst1 * static_cast<float>(iRec45[0]))) + dubfx_pitch_tick_poly(fTemp3, 2.0f, std::pow(2.0f, 0.083333336f * fRec39[0]), fTemp31, static_cast<float>(fRec44[0] > 0.0f)) * std::max<float>(0.0f, std::min<float>(fConst2 * fRec38[0], 1.0f) * (1.0f - fConst1 * static_cast<float>(iRec37[0]))) + dubfx_pitch_tick_poly(fTemp3, 3.0f, std::pow(2.0f, 0.083333336f * fRec31[0]), fTemp31, static_cast<float>(fRec36[0] > 0.0f)) * std::max<float>(0.0f, std::min<float>(fConst2 * fRec30[0], 1.0f) * (1.0f - fConst1 * static_cast<float>(iRec29[0]))) + dubfx_pitch_tick_poly(fTemp3, 4.0f, std::pow(2.0f, 0.083333336f * fRec23[0]), fTemp31, static_cast<float>(fRec28[0] > 0.0f)) * std::max<float>(0.0f, std::min<float>(fConst2 * fRec22[0], 1.0f) * (1.0f - fConst1 * static_cast<float>(iRec21[0]))) + dubfx_pitch_tick_poly(fTemp3, 5.0f, std::pow(2.0f, 0.083333336f * fRec3[0]), fTemp31, static_cast<float>(fRec20[0] > 0.0f)) * std::max<float>(0.0f, std::min<float>(fConst2 * fRec1[0], 1.0f) * (1.0f - fConst1 * static_cast<float>(iRec0[0])))));
			fRec61[0] = ((((((iTemp57 | iTemp52) | iTemp47) | iTemp42) | iTemp37) | iTemp32) ? 1.0f : std::max<float>(0.0f, fRec61[1] - fConst20));
			output0[i0] = static_cast<FAUSTFLOAT>(fTemp2 * fRec61[0] * fTemp58);
			output1[i0] = static_cast<FAUSTFLOAT>(fRec2[0] * fRec61[0] * fTemp58);
			fVec0[1] = fVec0[0];
			iRec0[1] = iRec0[0];
			fRec1[1] = fRec1[0];
			fRec2[1] = fRec2[0];
			fVec1[1] = fVec1[0];
			fRec13[1] = fRec13[0];
			fRec12[1] = fRec12[0];
			fRec11[1] = fRec11[0];
			fRec14[1] = fRec14[0];
			fRec16[2] = fRec16[1];
			fRec16[1] = fRec16[0];
			fRec15[2] = fRec15[1];
			fRec15[1] = fRec15[0];
			fRec10[1] = fRec10[0];
			fRec9[1] = fRec9[0];
			fRec8[1] = fRec8[0];
			iRec17[1] = iRec17[0];
			fRec6[1] = fRec6[0];
			fRec7[1] = fRec7[0];
			fRec19[1] = fRec19[0];
			fRec18[1] = fRec18[0];
			fRec5[1] = fRec5[0];
			fRec4[1] = fRec4[0];
			fRec3[1] = fRec3[0];
			fRec20[1] = fRec20[0];
			fVec2[1] = fVec2[0];
			iRec21[1] = iRec21[0];
			fRec22[1] = fRec22[0];
			fRec27[1] = fRec27[0];
			fRec26[1] = fRec26[0];
			fRec25[1] = fRec25[0];
			fRec24[1] = fRec24[0];
			fRec23[1] = fRec23[0];
			fRec28[1] = fRec28[0];
			fVec3[1] = fVec3[0];
			iRec29[1] = iRec29[0];
			fRec30[1] = fRec30[0];
			fRec35[1] = fRec35[0];
			fRec34[1] = fRec34[0];
			fRec33[1] = fRec33[0];
			fRec32[1] = fRec32[0];
			fRec31[1] = fRec31[0];
			fRec36[1] = fRec36[0];
			fVec4[1] = fVec4[0];
			iRec37[1] = iRec37[0];
			fRec38[1] = fRec38[0];
			fRec43[1] = fRec43[0];
			fRec42[1] = fRec42[0];
			fRec41[1] = fRec41[0];
			fRec40[1] = fRec40[0];
			fRec39[1] = fRec39[0];
			fRec44[1] = fRec44[0];
			fVec5[1] = fVec5[0];
			iRec45[1] = iRec45[0];
			fRec46[1] = fRec46[0];
			fRec51[1] = fRec51[0];
			fRec50[1] = fRec50[0];
			fRec49[1] = fRec49[0];
			fRec48[1] = fRec48[0];
			fRec47[1] = fRec47[0];
			fRec52[1] = fRec52[0];
			fVec6[1] = fVec6[0];
			iRec53[1] = iRec53[0];
			fRec54[1] = fRec54[0];
			fRec59[1] = fRec59[0];
			fRec58[1] = fRec58[0];
			fRec57[1] = fRec57[0];
			fRec56[1] = fRec56[0];
			fRec55[1] = fRec55[0];
			fRec60[1] = fRec60[0];
			fRec61[1] = fRec61[0];
		}
	}

};

#endif
