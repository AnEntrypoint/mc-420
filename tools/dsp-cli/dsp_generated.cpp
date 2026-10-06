/* ------------------------------------------------------------
author: "aloop"
license: "GPLv3"
name: "MultiKeyTranspose"
Code generated with Faust 2.85.9 (https://faust.grame.fr)
Compilation options: -lang cpp -fpga-mem-th 4 -nvi -ct 0 -cn AloopEffectDsp -es 1 -mcd 16 -mdd 1024 -mdy 33 -single -ftz 0 -vec -lv 0 -vs 32 -fun -dfs
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

class AloopEffectDsp final : public dsp {
	
 private:
	
	int fSampleRate;
	float fConst0;
	float fConst1;
	float fConst2;
	FAUSTFLOAT fHbargraph0;
	float fRec0_perm[4];
	float fYec0_perm[4];
	float fYec1_perm[4];
	float fYec2_perm[4];
	float fYec3_perm[4];
	float fYec4_perm[4];
	float fYec5_perm[4];
	float fConst3;
	float fRec1_perm[4];
	FAUSTFLOAT fHbargraph1;
	FAUSTFLOAT fHbargraph2;
	int iRec4_perm[4];
	float fConst4;
	float fRec6_perm[4];
	int iRec9_perm[4];
	float fYec6_perm[4];
	float fConst5;
	float fConst6;
	float fConst7;
	float fRec15_perm[4];
	float fRec17_perm[4];
	float fConst8;
	float fRec16_perm[4];
	float fRec18_perm[4];
	float fConst9;
	float fConst10;
	float fConst11;
	float fRec14_perm[4];
	float fRec13_perm[4];
	float fRec12_perm[4];
	float fConst12;
	float fConst13;
	float fRec11_perm[4];
	float fConst14;
	float fRec10_perm[4];
	float fConst15;
	float fRec7_perm[4];
	float fRec8_perm[4];
	float fRec20_perm[4];
	float fConst16;
	FAUSTFLOAT fHbargraph3;
	float fRec19_perm[4];
	float fConst17;
	float fConst18;
	float fRec5_perm[4];
	float fRec3_perm[4];
	float fRec2_perm[4];
	float fRec21_perm[4];
	int iRec22_perm[4];
	float fRec26_perm[4];
	float fRec28_perm[4];
	float fRec27_perm[4];
	float fRec25_perm[4];
	float fRec24_perm[4];
	float fRec23_perm[4];
	float fRec29_perm[4];
	int iRec30_perm[4];
	float fRec34_perm[4];
	float fRec36_perm[4];
	float fRec35_perm[4];
	float fRec33_perm[4];
	float fRec32_perm[4];
	float fRec31_perm[4];
	float fRec37_perm[4];
	int iRec38_perm[4];
	float fRec42_perm[4];
	float fRec44_perm[4];
	float fRec43_perm[4];
	float fRec41_perm[4];
	float fRec40_perm[4];
	float fRec39_perm[4];
	float fRec45_perm[4];
	int iRec46_perm[4];
	float fRec50_perm[4];
	float fRec52_perm[4];
	float fRec51_perm[4];
	float fRec49_perm[4];
	float fRec48_perm[4];
	float fRec47_perm[4];
	float fRec53_perm[4];
	int iRec54_perm[4];
	float fRec58_perm[4];
	float fRec60_perm[4];
	float fRec59_perm[4];
	float fRec57_perm[4];
	float fRec56_perm[4];
	float fRec55_perm[4];
	float fRec61_perm[4];
	int iRec62_perm[4];
	float fConst19;
	float fConst20;
	FAUSTFLOAT fHbargraph4;
	FAUSTFLOAT fHbargraph5;
	
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
		m->declare("compile_options", "-lang cpp -fpga-mem-th 4 -nvi -ct 0 -cn AloopEffectDsp -es 1 -mcd 16 -mdd 1024 -mdy 33 -single -ftz 0 -vec -lv 0 -vs 32 -fun -dfs");
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

	static constexpr int getStaticNumInputs() {
		return 17;
	}
	static constexpr int getStaticNumOutputs() {
		return 2;
	}
	int getNumInputs() {
		return 17;
	}
	int getNumOutputs() {
		return 2;
	}
	
	static void classInit(int sample_rate) {
	}
	
	void instanceConstants(int sample_rate) {
		fSampleRate = sample_rate;
		fConst0 = std::min<float>(1.92e+05f, std::max<float>(1.0f, static_cast<float>(fSampleRate)));
		fConst1 = 44.1f / fConst0;
		fConst2 = 1.0f - fConst1;
		fConst3 = 1e+01f / fConst0;
		fConst4 = 16.666666f / fConst0;
		fConst5 = 1.0f / std::tan(62.831852f / fConst0);
		fConst6 = 1.0f - fConst5;
		fConst7 = 1.0f / (fConst5 + 1.0f);
		fConst8 = 1.0f / fConst0;
		fConst9 = 0.25f * fConst0;
		fConst10 = 0.4f * fConst0;
		fConst11 = 3.1415927f / fConst0;
		fConst12 = std::exp(-(5e+01f / fConst0));
		fConst13 = 1.0f - fConst12;
		fConst14 = 0.5f * fConst0;
		fConst15 = 0.025f * fConst0;
		fConst16 = 0.08f * fConst0;
		fConst17 = std::exp(-(125.0f / fConst0));
		fConst18 = 1.0f - fConst17;
		fConst19 = 1.0f / std::max<float>(1.0f, 0.05f * fConst0);
		fConst20 = 1.0f / std::max<float>(1.0f, 0.003f * fConst0);
	}
	
	void instanceResetUserInterface() {
	}
	
	void instanceClear() {
		for (int l0 = 0; l0 < 4; l0 = l0 + 1) {
			fRec0_perm[l0] = 0.0f;
		}
		for (int l1 = 0; l1 < 4; l1 = l1 + 1) {
			fYec0_perm[l1] = 0.0f;
		}
		for (int l2 = 0; l2 < 4; l2 = l2 + 1) {
			fYec1_perm[l2] = 0.0f;
		}
		for (int l3 = 0; l3 < 4; l3 = l3 + 1) {
			fYec2_perm[l3] = 0.0f;
		}
		for (int l4 = 0; l4 < 4; l4 = l4 + 1) {
			fYec3_perm[l4] = 0.0f;
		}
		for (int l5 = 0; l5 < 4; l5 = l5 + 1) {
			fYec4_perm[l5] = 0.0f;
		}
		for (int l6 = 0; l6 < 4; l6 = l6 + 1) {
			fYec5_perm[l6] = 0.0f;
		}
		for (int l7 = 0; l7 < 4; l7 = l7 + 1) {
			fRec1_perm[l7] = 0.0f;
		}
		for (int l8 = 0; l8 < 4; l8 = l8 + 1) {
			iRec4_perm[l8] = 0;
		}
		for (int l9 = 0; l9 < 4; l9 = l9 + 1) {
			fRec6_perm[l9] = 0.0f;
		}
		for (int l10 = 0; l10 < 4; l10 = l10 + 1) {
			iRec9_perm[l10] = 0;
		}
		for (int l11 = 0; l11 < 4; l11 = l11 + 1) {
			fYec6_perm[l11] = 0.0f;
		}
		for (int l12 = 0; l12 < 4; l12 = l12 + 1) {
			fRec15_perm[l12] = 0.0f;
		}
		for (int l13 = 0; l13 < 4; l13 = l13 + 1) {
			fRec17_perm[l13] = 0.0f;
		}
		for (int l14 = 0; l14 < 4; l14 = l14 + 1) {
			fRec16_perm[l14] = 0.0f;
		}
		for (int l15 = 0; l15 < 4; l15 = l15 + 1) {
			fRec18_perm[l15] = 0.0f;
		}
		for (int l16 = 0; l16 < 4; l16 = l16 + 1) {
			fRec14_perm[l16] = 0.0f;
		}
		for (int l17 = 0; l17 < 4; l17 = l17 + 1) {
			fRec13_perm[l17] = 0.0f;
		}
		for (int l18 = 0; l18 < 4; l18 = l18 + 1) {
			fRec12_perm[l18] = 0.0f;
		}
		for (int l19 = 0; l19 < 4; l19 = l19 + 1) {
			fRec11_perm[l19] = 0.0f;
		}
		for (int l20 = 0; l20 < 4; l20 = l20 + 1) {
			fRec10_perm[l20] = 0.0f;
		}
		for (int l21 = 0; l21 < 4; l21 = l21 + 1) {
			fRec7_perm[l21] = 0.0f;
		}
		for (int l22 = 0; l22 < 4; l22 = l22 + 1) {
			fRec8_perm[l22] = 0.0f;
		}
		for (int l23 = 0; l23 < 4; l23 = l23 + 1) {
			fRec20_perm[l23] = 0.0f;
		}
		for (int l24 = 0; l24 < 4; l24 = l24 + 1) {
			fRec19_perm[l24] = 0.0f;
		}
		for (int l25 = 0; l25 < 4; l25 = l25 + 1) {
			fRec5_perm[l25] = 0.0f;
		}
		for (int l26 = 0; l26 < 4; l26 = l26 + 1) {
			fRec3_perm[l26] = 0.0f;
		}
		for (int l27 = 0; l27 < 4; l27 = l27 + 1) {
			fRec2_perm[l27] = 0.0f;
		}
		for (int l28 = 0; l28 < 4; l28 = l28 + 1) {
			fRec21_perm[l28] = 0.0f;
		}
		for (int l29 = 0; l29 < 4; l29 = l29 + 1) {
			iRec22_perm[l29] = 0;
		}
		for (int l30 = 0; l30 < 4; l30 = l30 + 1) {
			fRec26_perm[l30] = 0.0f;
		}
		for (int l31 = 0; l31 < 4; l31 = l31 + 1) {
			fRec28_perm[l31] = 0.0f;
		}
		for (int l32 = 0; l32 < 4; l32 = l32 + 1) {
			fRec27_perm[l32] = 0.0f;
		}
		for (int l33 = 0; l33 < 4; l33 = l33 + 1) {
			fRec25_perm[l33] = 0.0f;
		}
		for (int l34 = 0; l34 < 4; l34 = l34 + 1) {
			fRec24_perm[l34] = 0.0f;
		}
		for (int l35 = 0; l35 < 4; l35 = l35 + 1) {
			fRec23_perm[l35] = 0.0f;
		}
		for (int l36 = 0; l36 < 4; l36 = l36 + 1) {
			fRec29_perm[l36] = 0.0f;
		}
		for (int l37 = 0; l37 < 4; l37 = l37 + 1) {
			iRec30_perm[l37] = 0;
		}
		for (int l38 = 0; l38 < 4; l38 = l38 + 1) {
			fRec34_perm[l38] = 0.0f;
		}
		for (int l39 = 0; l39 < 4; l39 = l39 + 1) {
			fRec36_perm[l39] = 0.0f;
		}
		for (int l40 = 0; l40 < 4; l40 = l40 + 1) {
			fRec35_perm[l40] = 0.0f;
		}
		for (int l41 = 0; l41 < 4; l41 = l41 + 1) {
			fRec33_perm[l41] = 0.0f;
		}
		for (int l42 = 0; l42 < 4; l42 = l42 + 1) {
			fRec32_perm[l42] = 0.0f;
		}
		for (int l43 = 0; l43 < 4; l43 = l43 + 1) {
			fRec31_perm[l43] = 0.0f;
		}
		for (int l44 = 0; l44 < 4; l44 = l44 + 1) {
			fRec37_perm[l44] = 0.0f;
		}
		for (int l45 = 0; l45 < 4; l45 = l45 + 1) {
			iRec38_perm[l45] = 0;
		}
		for (int l46 = 0; l46 < 4; l46 = l46 + 1) {
			fRec42_perm[l46] = 0.0f;
		}
		for (int l47 = 0; l47 < 4; l47 = l47 + 1) {
			fRec44_perm[l47] = 0.0f;
		}
		for (int l48 = 0; l48 < 4; l48 = l48 + 1) {
			fRec43_perm[l48] = 0.0f;
		}
		for (int l49 = 0; l49 < 4; l49 = l49 + 1) {
			fRec41_perm[l49] = 0.0f;
		}
		for (int l50 = 0; l50 < 4; l50 = l50 + 1) {
			fRec40_perm[l50] = 0.0f;
		}
		for (int l51 = 0; l51 < 4; l51 = l51 + 1) {
			fRec39_perm[l51] = 0.0f;
		}
		for (int l52 = 0; l52 < 4; l52 = l52 + 1) {
			fRec45_perm[l52] = 0.0f;
		}
		for (int l53 = 0; l53 < 4; l53 = l53 + 1) {
			iRec46_perm[l53] = 0;
		}
		for (int l54 = 0; l54 < 4; l54 = l54 + 1) {
			fRec50_perm[l54] = 0.0f;
		}
		for (int l55 = 0; l55 < 4; l55 = l55 + 1) {
			fRec52_perm[l55] = 0.0f;
		}
		for (int l56 = 0; l56 < 4; l56 = l56 + 1) {
			fRec51_perm[l56] = 0.0f;
		}
		for (int l57 = 0; l57 < 4; l57 = l57 + 1) {
			fRec49_perm[l57] = 0.0f;
		}
		for (int l58 = 0; l58 < 4; l58 = l58 + 1) {
			fRec48_perm[l58] = 0.0f;
		}
		for (int l59 = 0; l59 < 4; l59 = l59 + 1) {
			fRec47_perm[l59] = 0.0f;
		}
		for (int l60 = 0; l60 < 4; l60 = l60 + 1) {
			fRec53_perm[l60] = 0.0f;
		}
		for (int l61 = 0; l61 < 4; l61 = l61 + 1) {
			iRec54_perm[l61] = 0;
		}
		for (int l62 = 0; l62 < 4; l62 = l62 + 1) {
			fRec58_perm[l62] = 0.0f;
		}
		for (int l63 = 0; l63 < 4; l63 = l63 + 1) {
			fRec60_perm[l63] = 0.0f;
		}
		for (int l64 = 0; l64 < 4; l64 = l64 + 1) {
			fRec59_perm[l64] = 0.0f;
		}
		for (int l65 = 0; l65 < 4; l65 = l65 + 1) {
			fRec57_perm[l65] = 0.0f;
		}
		for (int l66 = 0; l66 < 4; l66 = l66 + 1) {
			fRec56_perm[l66] = 0.0f;
		}
		for (int l67 = 0; l67 < 4; l67 = l67 + 1) {
			fRec55_perm[l67] = 0.0f;
		}
		for (int l68 = 0; l68 < 4; l68 = l68 + 1) {
			fRec61_perm[l68] = 0.0f;
		}
		for (int l69 = 0; l69 < 4; l69 = l69 + 1) {
			iRec62_perm[l69] = 0;
		}
	}
	
	void init(int sample_rate) {
		classInit(sample_rate);
		instanceInit(sample_rate);
	}
	
	void instanceInit(int sample_rate) {
		instanceConstants(sample_rate);
		instanceResetUserInterface();
		instanceClear();
	}
	
	AloopEffectDsp* clone() {
		return new AloopEffectDsp(*this);
	}
	
	int getSampleRate() {
		return fSampleRate;
	}
	
	void buildUserInterface(UI* ui_interface) {
		ui_interface->openVerticalBox("MultiKeyTranspose");
		ui_interface->addHorizontalBargraph("freediag", &fHbargraph0, FAUSTFLOAT(0.0f), FAUSTFLOAT(1.0f));
		ui_interface->addHorizontalBargraph("freqdetdiag", &fHbargraph3, FAUSTFLOAT(0.0f), FAUSTFLOAT(2e+03f));
		ui_interface->addHorizontalBargraph("helddetnotediag", &fHbargraph4, FAUSTFLOAT(0.0f), FAUSTFLOAT(127.0f));
		ui_interface->addHorizontalBargraph("rawextfreqdetdiag", &fHbargraph1, FAUSTFLOAT(0.0f), FAUSTFLOAT(2e+03f));
		ui_interface->addHorizontalBargraph("shiftamountdiag", &fHbargraph5, FAUSTFLOAT(-6e+01f), FAUSTFLOAT(6e+01f));
		ui_interface->addHorizontalBargraph("trustedtrackerdiag", &fHbargraph2, FAUSTFLOAT(0.0f), FAUSTFLOAT(1.0f));
		ui_interface->closeBox();
	}
	void fun0AloopEffectDsp(float* fYec0_tmp, int vsize, FAUSTFLOAT* RESTRICT input16, float* fYec0) {
		/* Pre code */
		for (int j2 = 0; j2 < 4; j2 = j2 + 1) {
			fYec0_tmp[j2] = fYec0_perm[j2];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fYec0[i] = static_cast<float>(input16[i]);
		}
		/* Post code */
		for (int j3 = 0; j3 < 4; j3 = j3 + 1) {
			fYec0_perm[j3] = fYec0_tmp[vsize + j3];
		}
	}
	void fun1AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input16, int* RESTRICT iZec0) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec0[i] = static_cast<float>(input16[i]) > 0.5f;
		}
	}
	void fun2AloopEffectDsp(float* fYec1_tmp, int vsize, FAUSTFLOAT* RESTRICT input14, float* fYec1) {
		/* Pre code */
		for (int j4 = 0; j4 < 4; j4 = j4 + 1) {
			fYec1_tmp[j4] = fYec1_perm[j4];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fYec1[i] = static_cast<float>(input14[i]);
		}
		/* Post code */
		for (int j5 = 0; j5 < 4; j5 = j5 + 1) {
			fYec1_perm[j5] = fYec1_tmp[vsize + j5];
		}
	}
	void fun3AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input14, int* RESTRICT iZec1) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec1[i] = static_cast<float>(input14[i]) > 0.5f;
		}
	}
	void fun4AloopEffectDsp(float* fYec4_tmp, int vsize, FAUSTFLOAT* RESTRICT input8, float* fYec4) {
		/* Pre code */
		for (int j10 = 0; j10 < 4; j10 = j10 + 1) {
			fYec4_tmp[j10] = fYec4_perm[j10];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fYec4[i] = static_cast<float>(input8[i]);
		}
		/* Post code */
		for (int j11 = 0; j11 < 4; j11 = j11 + 1) {
			fYec4_perm[j11] = fYec4_tmp[vsize + j11];
		}
	}
	void fun5AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input8, int* RESTRICT iZec4) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec4[i] = static_cast<float>(input8[i]) > 0.5f;
		}
	}
	void fun6AloopEffectDsp(float* fYec5_tmp, int vsize, FAUSTFLOAT* RESTRICT input6, float* fYec5) {
		/* Pre code */
		for (int j12 = 0; j12 < 4; j12 = j12 + 1) {
			fYec5_tmp[j12] = fYec5_perm[j12];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fYec5[i] = static_cast<float>(input6[i]);
		}
		/* Post code */
		for (int j13 = 0; j13 < 4; j13 = j13 + 1) {
			fYec5_perm[j13] = fYec5_tmp[vsize + j13];
		}
	}
	void fun7AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input6, int* RESTRICT iZec5) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec5[i] = static_cast<float>(input6[i]) > 0.5f;
		}
	}
	void fun8AloopEffectDsp(float* fYec2_tmp, int vsize, FAUSTFLOAT* RESTRICT input12, float* fYec2) {
		/* Pre code */
		for (int j6 = 0; j6 < 4; j6 = j6 + 1) {
			fYec2_tmp[j6] = fYec2_perm[j6];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fYec2[i] = static_cast<float>(input12[i]);
		}
		/* Post code */
		for (int j7 = 0; j7 < 4; j7 = j7 + 1) {
			fYec2_perm[j7] = fYec2_tmp[vsize + j7];
		}
	}
	void fun9AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input12, int* RESTRICT iZec2) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec2[i] = static_cast<float>(input12[i]) > 0.5f;
		}
	}
	void fun10AloopEffectDsp(float* fYec3_tmp, int vsize, FAUSTFLOAT* RESTRICT input10, float* fYec3) {
		/* Pre code */
		for (int j8 = 0; j8 < 4; j8 = j8 + 1) {
			fYec3_tmp[j8] = fYec3_perm[j8];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fYec3[i] = static_cast<float>(input10[i]);
		}
		/* Post code */
		for (int j9 = 0; j9 < 4; j9 = j9 + 1) {
			fYec3_perm[j9] = fYec3_tmp[vsize + j9];
		}
	}
	void fun11AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input10, int* RESTRICT iZec3) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec3[i] = static_cast<float>(input10[i]) > 0.5f;
		}
	}
	void fun12AloopEffectDsp(float* fRec1_tmp, int vsize, int* RESTRICT iZec5, int* RESTRICT iZec4, int* RESTRICT iZec3, int* RESTRICT iZec2, int* RESTRICT iZec1, int* RESTRICT iZec0, float* fRec1) {
		/* Pre code */
		for (int j14 = 0; j14 < 4; j14 = j14 + 1) {
			fRec1_tmp[j14] = fRec1_perm[j14];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec1[i] = ((((((iZec5[i] | iZec4[i]) | iZec3[i]) | iZec2[i]) | iZec1[i]) | iZec0[i]) ? 1.0f : std::max<float>(0.0f, fRec1[i - 1] - fConst3));
		}
		/* Post code */
		for (int j15 = 0; j15 < 4; j15 = j15 + 1) {
			fRec1_perm[j15] = fRec1_tmp[vsize + j15];
		}
	}
	void fun13AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input6, float* RESTRICT fYec5, int* RESTRICT iZec27) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec27[i] = static_cast<float>(input6[i]) > fYec5[i - 1];
		}
	}
	void fun14AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input4, float* RESTRICT fZec6) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fHbargraph1 = static_cast<FAUSTFLOAT>(static_cast<float>(input4[i]));
			fZec6[i] = static_cast<float>(input4[i]);
		}
	}
	void fun15AloopEffectDsp(int vsize, float* RESTRICT fZec6, int* RESTRICT iZec7) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec7[i] = fZec6[i] > 61.0f;
		}
	}
	void fun16AloopEffectDsp(int vsize, int* RESTRICT iZec7, int* RESTRICT iZec8) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fHbargraph2 = static_cast<FAUSTFLOAT>(static_cast<float>(iZec7[i]));
			iZec8[i] = static_cast<float>(iZec7[i]) > 0.5f;
		}
	}
	void fun17AloopEffectDsp(int* iRec4_tmp, int vsize, int* iRec4, int* RESTRICT iZec8) {
		/* Pre code */
		for (int j16 = 0; j16 < 4; j16 = j16 + 1) {
			iRec4_tmp[j16] = iRec4_perm[j16];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iRec4[i] = std::max<int>(iRec4[i - 1], iZec8[i]);
		}
		/* Post code */
		for (int j17 = 0; j17 < 4; j17 = j17 + 1) {
			iRec4_perm[j17] = iRec4_tmp[vsize + j17];
		}
	}
	void fun18AloopEffectDsp(int vsize, int* RESTRICT iRec4, int* RESTRICT iZec32) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec32[i] = static_cast<float>(iRec4[i]) < 0.5f;
		}
	}
	void fun19AloopEffectDsp(float* fRec6_tmp, int vsize, int* RESTRICT iZec5, float* fRec6) {
		/* Pre code */
		for (int j18 = 0; j18 < 4; j18 = j18 + 1) {
			fRec6_tmp[j18] = fRec6_perm[j18];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec6[i] = ((iZec5[i]) ? 1.0f : std::max<float>(0.0f, fRec6[i - 1] - fConst4));
		}
		/* Post code */
		for (int j19 = 0; j19 < 4; j19 = j19 + 1) {
			fRec6_perm[j19] = fRec6_tmp[vsize + j19];
		}
	}
	void fun20AloopEffectDsp(int vsize, float* RESTRICT fRec6, float* RESTRICT fZec30) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec30[i] = static_cast<float>(fRec6[i] > 0.0f);
		}
	}
	void fun21AloopEffectDsp(float* fRec20_tmp, int vsize, int* RESTRICT iZec27, float* fRec20) {
		/* Pre code */
		for (int j46 = 0; j46 < 4; j46 = j46 + 1) {
			fRec20_tmp[j46] = fRec20_perm[j46];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec20[i] = ((iZec27[i]) ? 0.0f : fRec20[i - 1] + 1.0f);
		}
		/* Post code */
		for (int j47 = 0; j47 < 4; j47 = j47 + 1) {
			fRec20_perm[j47] = fRec20_tmp[vsize + j47];
		}
	}
	void fun22AloopEffectDsp(float* fRec0_tmp, int vsize, FAUSTFLOAT* RESTRICT input2, float* fRec0) {
		/* Pre code */
		for (int j0 = 0; j0 < 4; j0 = j0 + 1) {
			fRec0_tmp[j0] = fRec0_perm[j0];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fHbargraph0 = static_cast<FAUSTFLOAT>(static_cast<float>(input2[i]));
			fRec0[i] = fConst1 * static_cast<float>(input2[i]) + fConst2 * fRec0[i - 1];
		}
		/* Post code */
		for (int j1 = 0; j1 < 4; j1 = j1 + 1) {
			fRec0_perm[j1] = fRec0_tmp[vsize + j1];
		}
	}
	void fun23AloopEffectDsp(int vsize, float* RESTRICT fRec0, float* RESTRICT fZec9) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec9[i] = 1.0f - fRec0[i];
		}
	}
	void fun24AloopEffectDsp(float* fYec6_tmp, int vsize, FAUSTFLOAT* RESTRICT input0, float* RESTRICT fZec9, FAUSTFLOAT* RESTRICT input1, float* RESTRICT fRec0, float* fYec6) {
		/* Pre code */
		for (int j22 = 0; j22 < 4; j22 = j22 + 1) {
			fYec6_tmp[j22] = fYec6_perm[j22];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fYec6[i] = static_cast<float>(input0[i]) * fZec9[i] + static_cast<float>(input1[i]) * fRec0[i];
		}
		/* Post code */
		for (int j23 = 0; j23 < 4; j23 = j23 + 1) {
			fYec6_perm[j23] = fYec6_tmp[vsize + j23];
		}
	}
	void fun25AloopEffectDsp(float* fRec15_tmp, int vsize, float* fRec15, float* RESTRICT fYec6) {
		/* Pre code */
		for (int j24 = 0; j24 < 4; j24 = j24 + 1) {
			fRec15_tmp[j24] = fRec15_perm[j24];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec15[i] = -(fConst7 * (fConst6 * fRec15[i - 1] - fConst5 * (fYec6[i] - fYec6[i - 1])));
		}
		/* Post code */
		for (int j25 = 0; j25 < 4; j25 = j25 + 1) {
			fRec15_perm[j25] = fRec15_tmp[vsize + j25];
		}
	}
	void fun26AloopEffectDsp(float* fRec17_tmp, int vsize, float* RESTRICT fRec15, float* fRec17) {
		/* Pre code */
		for (int j26 = 0; j26 < 4; j26 = j26 + 1) {
			fRec17_tmp[j26] = fRec17_perm[j26];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec17[i] = ((fRec15[i] != 0.0f) ? fRec15[i] : fRec17[i - 1]);
		}
		/* Post code */
		for (int j27 = 0; j27 < 4; j27 = j27 + 1) {
			fRec17_perm[j27] = fRec17_tmp[vsize + j27];
		}
	}
	void fun27AloopEffectDsp(int vsize, float* RESTRICT fRec17, float* RESTRICT fZec14) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec14[i] = static_cast<float>((fRec17[i] * fRec17[i - 1]) < 0.0f);
		}
	}
	void fun28AloopEffectDsp(float* fRec16_tmp, float* fRec18_tmp, float* fRec14_tmp, float* fRec13_tmp, float* fRec12_tmp, float* fRec11_tmp, float* fRec10_tmp, int vsize, float* fRec10, float* RESTRICT fZec10, float* RESTRICT fZec11, int* RESTRICT iZec12, float* RESTRICT fZec13, float* RESTRICT fZec14, float* fRec16, float* RESTRICT fZec15, int* RESTRICT iZec16, float* RESTRICT fZec17, float* fRec18, float* RESTRICT fZec18, float* RESTRICT fZec19, float* RESTRICT fZec20, float* RESTRICT fZec21, float* RESTRICT fRec15, float* fRec14, float* RESTRICT fZec22, float* fRec13, float* RESTRICT fZec23, float* fRec12, float* fRec11) {
		/* Pre code */
		for (int j28 = 0; j28 < 4; j28 = j28 + 1) {
			fRec16_tmp[j28] = fRec16_perm[j28];
		}
		for (int j30 = 0; j30 < 4; j30 = j30 + 1) {
			fRec18_tmp[j30] = fRec18_perm[j30];
		}
		for (int j32 = 0; j32 < 4; j32 = j32 + 1) {
			fRec14_tmp[j32] = fRec14_perm[j32];
		}
		for (int j34 = 0; j34 < 4; j34 = j34 + 1) {
			fRec13_tmp[j34] = fRec13_perm[j34];
		}
		for (int j36 = 0; j36 < 4; j36 = j36 + 1) {
			fRec12_tmp[j36] = fRec12_perm[j36];
		}
		for (int j38 = 0; j38 < 4; j38 = j38 + 1) {
			fRec11_tmp[j38] = fRec11_perm[j38];
		}
		for (int j40 = 0; j40 < 4; j40 = j40 + 1) {
			fRec10_tmp[j40] = fRec10_perm[j40];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec10[i] = std::max<float>(6e+01f, fRec10[i - 1]);
			fZec11[i] = 0.18f / fZec10[i];
			iZec12[i] = std::fabs(fZec11[i]) < 1.1920929e-07f;
			fZec13[i] = ((iZec12[i]) ? 0.0f : std::exp(-(fConst8 / ((iZec12[i]) ? 1.0f : fZec11[i]))));
			fRec16[i] = fZec14[i] * (1.0f - fZec13[i]) + fZec13[i] * fRec16[i - 1];
			fZec15[i] = 0.09f / fZec10[i];
			iZec16[i] = std::fabs(fZec15[i]) < 1.1920929e-07f;
			fZec17[i] = ((iZec16[i]) ? 0.0f : std::exp(-(fConst8 / ((iZec16[i]) ? 1.0f : fZec15[i]))));
			fRec18[i] = fZec14[i] * (1.0f - fZec17[i]) + fZec17[i] * fRec18[i - 1];
			fZec18[i] = std::tan(fConst11 * std::max<float>(6e+01f, std::max<float>(fRec10[i - 1], std::max<float>(fConst9 * fRec16[i], fConst10 * fRec18[i]))));
			fZec19[i] = 1.0f / fZec18[i];
			fZec20[i] = (fZec19[i] + 1.847759f) / fZec18[i] + 1.0f;
			fZec21[i] = 1.0f - 1.0f / AloopEffectDsp_faustpower2_f(fZec18[i]);
			fRec14[i] = fRec15[i] - (fRec14[i - 2] * ((fZec19[i] + -1.847759f) / fZec18[i] + 1.0f) + 2.0f * fRec14[i - 1] * fZec21[i]) / fZec20[i];
			fZec22[i] = (fZec19[i] + 0.76536685f) / fZec18[i] + 1.0f;
			fRec13[i] = (fRec14[i - 2] + fRec14[i] + 2.0f * fRec14[i - 1]) / fZec20[i] - (fRec13[i - 2] * ((fZec19[i] + -0.76536685f) / fZec18[i] + 1.0f) + 2.0f * fZec21[i] * fRec13[i - 1]) / fZec22[i];
			fZec23[i] = (fRec13[i - 2] + fRec13[i] + 2.0f * fRec13[i - 1]) / fZec22[i];
			fRec12[i] = ((fZec23[i] != 0.0f) ? fZec23[i] : fRec12[i - 1]);
			fRec11[i] = fConst13 * static_cast<float>((fRec12[i] * fRec12[i - 1]) < 0.0f) + fConst12 * fRec11[i - 1];
			fRec10[i] = fConst14 * fRec11[i];
		}
		/* Post code */
		for (int j31 = 0; j31 < 4; j31 = j31 + 1) {
			fRec18_perm[j31] = fRec18_tmp[vsize + j31];
		}
		for (int j29 = 0; j29 < 4; j29 = j29 + 1) {
			fRec16_perm[j29] = fRec16_tmp[vsize + j29];
		}
		for (int j33 = 0; j33 < 4; j33 = j33 + 1) {
			fRec14_perm[j33] = fRec14_tmp[vsize + j33];
		}
		for (int j35 = 0; j35 < 4; j35 = j35 + 1) {
			fRec13_perm[j35] = fRec13_tmp[vsize + j35];
		}
		for (int j37 = 0; j37 < 4; j37 = j37 + 1) {
			fRec12_perm[j37] = fRec12_tmp[vsize + j37];
		}
		for (int j39 = 0; j39 < 4; j39 = j39 + 1) {
			fRec11_perm[j39] = fRec11_tmp[vsize + j39];
		}
		for (int j41 = 0; j41 < 4; j41 = j41 + 1) {
			fRec10_perm[j41] = fRec10_tmp[vsize + j41];
		}
	}
	void fun29AloopEffectDsp(int vsize, float* RESTRICT fRec10, float* RESTRICT fZec24) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec24[i] = std::min<float>(1.5e+03f, std::max<float>(6e+01f, fRec10[i]));
		}
	}
	void fun30AloopEffectDsp(int* iRec9_tmp, int vsize, int* iRec9) {
		/* Pre code */
		for (int j20 = 0; j20 < 4; j20 = j20 + 1) {
			iRec9_tmp[j20] = iRec9_perm[j20];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iRec9[i] = iRec9[i - 1] + 1;
		}
		/* Post code */
		for (int j21 = 0; j21 < 4; j21 = j21 + 1) {
			iRec9_perm[j21] = iRec9_tmp[vsize + j21];
		}
	}
	void fun31AloopEffectDsp(int vsize, int* RESTRICT iRec9, int* RESTRICT iZec25) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec25[i] = iRec9[i - 1] == 0;
		}
	}
	void fun32AloopEffectDsp(float* fRec7_tmp, float* fRec8_tmp, int vsize, int* RESTRICT iZec25, float* fRec8, float* RESTRICT fZec24, float* fRec7, int* RESTRICT iZec26) {
		/* Pre code */
		for (int j42 = 0; j42 < 4; j42 = j42 + 1) {
			fRec7_tmp[j42] = fRec7_perm[j42];
		}
		for (int j44 = 0; j44 < 4; j44 = j44 + 1) {
			fRec8_tmp[j44] = fRec8_perm[j44];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec26[i] = (iZec25[i] | (fRec8[i - 1] >= fConst15)) | ((fZec24[i] < (1.6817929f * fRec7[i - 1])) & (fZec24[i] > (0.59460354f * fRec7[i - 1])));
			fRec7[i] = ((iZec26[i]) ? fZec24[i] : fRec7[i - 1]);
			fRec8[i] = ((iZec26[i]) ? 0.0f : fRec8[i - 1] + 1.0f);
		}
		/* Post code */
		for (int j43 = 0; j43 < 4; j43 = j43 + 1) {
			fRec7_perm[j43] = fRec7_tmp[vsize + j43];
		}
		for (int j45 = 0; j45 < 4; j45 = j45 + 1) {
			fRec8_perm[j45] = fRec8_tmp[vsize + j45];
		}
	}
	void fun33AloopEffectDsp(int vsize, int* RESTRICT iZec7, float* RESTRICT fZec6, float* RESTRICT fRec7, float* RESTRICT fZec28) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec28[i] = std::max<float>(6e+01f, ((iZec7[i]) ? fZec6[i] : fRec7[i]));
		}
	}
	void fun34AloopEffectDsp(int vsize, float* RESTRICT fZec28, float* RESTRICT fZec29) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fHbargraph3 = static_cast<FAUSTFLOAT>(fZec28[i]);
			fZec29[i] = 17.31234f * std::log(0.0022727272f * std::max<float>(2e+01f, fZec28[i])) + 69.0f;
		}
	}
	void fun35AloopEffectDsp(float* fRec19_tmp, int vsize, float* RESTRICT fRec20, float* fRec19, float* RESTRICT fZec29) {
		/* Pre code */
		for (int j48 = 0; j48 < 4; j48 = j48 + 1) {
			fRec19_tmp[j48] = fRec19_perm[j48];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec19[i] = ((fRec20[i] < fConst16) ? fRec19[i - 1] : fZec29[i]);
		}
		/* Post code */
		for (int j49 = 0; j49 < 4; j49 = j49 + 1) {
			fRec19_perm[j49] = fRec19_tmp[vsize + j49];
		}
	}
	void fun36AloopEffectDsp(int vsize, float* RESTRICT fZec29, float* RESTRICT fZec31) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec31[i] = fConst18 * fZec29[i];
		}
	}
	void fun37AloopEffectDsp(float* fRec5_tmp, int vsize, int* RESTRICT iZec27, int* RESTRICT iZec25, FAUSTFLOAT* RESTRICT input5, float* RESTRICT fRec19, int* RESTRICT iZec8, float* RESTRICT fZec30, float* fRec5, float* RESTRICT fZec31) {
		/* Pre code */
		for (int j50 = 0; j50 < 4; j50 = j50 + 1) {
			fRec5_tmp[j50] = fRec5_perm[j50];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec5[i] = ((iZec27[i]) ? ((iZec25[i]) ? static_cast<float>(input5[i]) : fRec19[i]) : ((iZec8[i] & (dubfx_pitch_confidence_poly(0.0f, fZec30[i]) >= 0.85f)) ? fConst17 * fRec5[i - 1] + fZec31[i] : fRec5[i - 1]));
		}
		/* Post code */
		for (int j51 = 0; j51 < 4; j51 = j51 + 1) {
			fRec5_perm[j51] = fRec5_tmp[vsize + j51];
		}
	}
	void fun38AloopEffectDsp(float* fRec3_tmp, int vsize, int* RESTRICT iZec8, float* RESTRICT fRec5, int* RESTRICT iZec27, int* RESTRICT iZec32, FAUSTFLOAT* RESTRICT input5, float* fRec3) {
		/* Pre code */
		for (int j52 = 0; j52 < 4; j52 = j52 + 1) {
			fRec3_tmp[j52] = fRec3_perm[j52];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec3[i] = ((iZec8[i]) ? fRec5[i] : ((iZec27[i] & iZec32[i]) ? static_cast<float>(input5[i]) : fRec3[i - 1]));
		}
		/* Post code */
		for (int j53 = 0; j53 < 4; j53 = j53 + 1) {
			fRec3_perm[j53] = fRec3_tmp[vsize + j53];
		}
	}
	void fun39AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input5, float* RESTRICT fRec3, float* RESTRICT fZec33) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec33[i] = static_cast<float>(input5[i]) - fRec3[i];
		}
	}
	void fun40AloopEffectDsp(float* fRec2_tmp, int vsize, int* RESTRICT iZec27, float* RESTRICT fZec33, float* fRec2) {
		/* Pre code */
		for (int j54 = 0; j54 < 4; j54 = j54 + 1) {
			fRec2_tmp[j54] = fRec2_perm[j54];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec2[i] = ((iZec27[i]) ? fZec33[i] : fConst17 * fRec2[i - 1] + fConst18 * fZec33[i]);
		}
		/* Post code */
		for (int j55 = 0; j55 < 4; j55 = j55 + 1) {
			fRec2_perm[j55] = fRec2_tmp[vsize + j55];
		}
	}
	void fun41AloopEffectDsp(float* fRec42_tmp, int vsize, int* RESTRICT iZec2, float* fRec42) {
		/* Pre code */
		for (int j92 = 0; j92 < 4; j92 = j92 + 1) {
			fRec42_tmp[j92] = fRec42_perm[j92];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec42[i] = ((iZec2[i]) ? 1.0f : std::max<float>(0.0f, fRec42[i - 1] - fConst4));
		}
		/* Post code */
		for (int j93 = 0; j93 < 4; j93 = j93 + 1) {
			fRec42_perm[j93] = fRec42_tmp[vsize + j93];
		}
	}
	void fun42AloopEffectDsp(int vsize, float* RESTRICT fRec42, float* RESTRICT fZec41) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec41[i] = static_cast<float>(fRec42[i] > 0.0f);
		}
	}
	void fun43AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input12, float* RESTRICT fYec2, int* RESTRICT iZec40) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec40[i] = static_cast<float>(input12[i]) > fYec2[i - 1];
		}
	}
	void fun44AloopEffectDsp(float* fRec44_tmp, int vsize, int* RESTRICT iZec40, float* fRec44) {
		/* Pre code */
		for (int j94 = 0; j94 < 4; j94 = j94 + 1) {
			fRec44_tmp[j94] = fRec44_perm[j94];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec44[i] = ((iZec40[i]) ? 0.0f : fRec44[i - 1] + 1.0f);
		}
		/* Post code */
		for (int j95 = 0; j95 < 4; j95 = j95 + 1) {
			fRec44_perm[j95] = fRec44_tmp[vsize + j95];
		}
	}
	void fun45AloopEffectDsp(float* fRec43_tmp, int vsize, float* RESTRICT fRec44, float* fRec43, float* RESTRICT fZec29) {
		/* Pre code */
		for (int j96 = 0; j96 < 4; j96 = j96 + 1) {
			fRec43_tmp[j96] = fRec43_perm[j96];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec43[i] = ((fRec44[i] < fConst16) ? fRec43[i - 1] : fZec29[i]);
		}
		/* Post code */
		for (int j97 = 0; j97 < 4; j97 = j97 + 1) {
			fRec43_perm[j97] = fRec43_tmp[vsize + j97];
		}
	}
	void fun46AloopEffectDsp(float* fRec41_tmp, int vsize, int* RESTRICT iZec40, int* RESTRICT iZec25, FAUSTFLOAT* RESTRICT input11, float* RESTRICT fRec43, int* RESTRICT iZec8, float* RESTRICT fZec41, float* RESTRICT fZec31, float* fRec41) {
		/* Pre code */
		for (int j98 = 0; j98 < 4; j98 = j98 + 1) {
			fRec41_tmp[j98] = fRec41_perm[j98];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec41[i] = ((iZec40[i]) ? ((iZec25[i]) ? static_cast<float>(input11[i]) : fRec43[i]) : ((iZec8[i] & (dubfx_pitch_confidence_poly(3.0f, fZec41[i]) >= 0.85f)) ? fZec31[i] + fConst17 * fRec41[i - 1] : fRec41[i - 1]));
		}
		/* Post code */
		for (int j99 = 0; j99 < 4; j99 = j99 + 1) {
			fRec41_perm[j99] = fRec41_tmp[vsize + j99];
		}
	}
	void fun47AloopEffectDsp(float* fRec40_tmp, int vsize, int* RESTRICT iZec8, float* RESTRICT fRec41, int* RESTRICT iZec40, int* RESTRICT iZec32, FAUSTFLOAT* RESTRICT input11, float* fRec40) {
		/* Pre code */
		for (int j100 = 0; j100 < 4; j100 = j100 + 1) {
			fRec40_tmp[j100] = fRec40_perm[j100];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec40[i] = ((iZec8[i]) ? fRec41[i] : ((iZec40[i] & iZec32[i]) ? static_cast<float>(input11[i]) : fRec40[i - 1]));
		}
		/* Post code */
		for (int j101 = 0; j101 < 4; j101 = j101 + 1) {
			fRec40_perm[j101] = fRec40_tmp[vsize + j101];
		}
	}
	void fun48AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input11, float* RESTRICT fRec40, float* RESTRICT fZec42) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec42[i] = static_cast<float>(input11[i]) - fRec40[i];
		}
	}
	void fun49AloopEffectDsp(float* fRec39_tmp, int vsize, int* RESTRICT iZec40, float* RESTRICT fZec42, float* fRec39) {
		/* Pre code */
		for (int j102 = 0; j102 < 4; j102 = j102 + 1) {
			fRec39_tmp[j102] = fRec39_perm[j102];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec39[i] = ((iZec40[i]) ? fZec42[i] : fConst17 * fRec39[i - 1] + fConst18 * fZec42[i]);
		}
		/* Post code */
		for (int j103 = 0; j103 < 4; j103 = j103 + 1) {
			fRec39_perm[j103] = fRec39_tmp[vsize + j103];
		}
	}
	void fun50AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input10, float* RESTRICT fYec3, int* RESTRICT iZec37) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec37[i] = static_cast<float>(input10[i]) > fYec3[i - 1];
		}
	}
	void fun51AloopEffectDsp(float* fRec34_tmp, int vsize, int* RESTRICT iZec3, float* fRec34) {
		/* Pre code */
		for (int j76 = 0; j76 < 4; j76 = j76 + 1) {
			fRec34_tmp[j76] = fRec34_perm[j76];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec34[i] = ((iZec3[i]) ? 1.0f : std::max<float>(0.0f, fRec34[i - 1] - fConst4));
		}
		/* Post code */
		for (int j77 = 0; j77 < 4; j77 = j77 + 1) {
			fRec34_perm[j77] = fRec34_tmp[vsize + j77];
		}
	}
	void fun52AloopEffectDsp(float* fRec36_tmp, int vsize, int* RESTRICT iZec37, float* fRec36) {
		/* Pre code */
		for (int j78 = 0; j78 < 4; j78 = j78 + 1) {
			fRec36_tmp[j78] = fRec36_perm[j78];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec36[i] = ((iZec37[i]) ? 0.0f : fRec36[i - 1] + 1.0f);
		}
		/* Post code */
		for (int j79 = 0; j79 < 4; j79 = j79 + 1) {
			fRec36_perm[j79] = fRec36_tmp[vsize + j79];
		}
	}
	void fun53AloopEffectDsp(float* fRec35_tmp, int vsize, float* RESTRICT fRec36, float* fRec35, float* RESTRICT fZec29) {
		/* Pre code */
		for (int j80 = 0; j80 < 4; j80 = j80 + 1) {
			fRec35_tmp[j80] = fRec35_perm[j80];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec35[i] = ((fRec36[i] < fConst16) ? fRec35[i - 1] : fZec29[i]);
		}
		/* Post code */
		for (int j81 = 0; j81 < 4; j81 = j81 + 1) {
			fRec35_perm[j81] = fRec35_tmp[vsize + j81];
		}
	}
	void fun54AloopEffectDsp(int vsize, float* RESTRICT fRec34, float* RESTRICT fZec38) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec38[i] = static_cast<float>(fRec34[i] > 0.0f);
		}
	}
	void fun55AloopEffectDsp(float* fRec33_tmp, int vsize, int* RESTRICT iZec37, int* RESTRICT iZec25, FAUSTFLOAT* RESTRICT input9, float* RESTRICT fRec35, int* RESTRICT iZec8, float* RESTRICT fZec38, float* RESTRICT fZec31, float* fRec33) {
		/* Pre code */
		for (int j82 = 0; j82 < 4; j82 = j82 + 1) {
			fRec33_tmp[j82] = fRec33_perm[j82];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec33[i] = ((iZec37[i]) ? ((iZec25[i]) ? static_cast<float>(input9[i]) : fRec35[i]) : ((iZec8[i] & (dubfx_pitch_confidence_poly(2.0f, fZec38[i]) >= 0.85f)) ? fZec31[i] + fConst17 * fRec33[i - 1] : fRec33[i - 1]));
		}
		/* Post code */
		for (int j83 = 0; j83 < 4; j83 = j83 + 1) {
			fRec33_perm[j83] = fRec33_tmp[vsize + j83];
		}
	}
	void fun56AloopEffectDsp(float* fRec32_tmp, int vsize, int* RESTRICT iZec8, float* RESTRICT fRec33, int* RESTRICT iZec37, int* RESTRICT iZec32, FAUSTFLOAT* RESTRICT input9, float* fRec32) {
		/* Pre code */
		for (int j84 = 0; j84 < 4; j84 = j84 + 1) {
			fRec32_tmp[j84] = fRec32_perm[j84];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec32[i] = ((iZec8[i]) ? fRec33[i] : ((iZec37[i] & iZec32[i]) ? static_cast<float>(input9[i]) : fRec32[i - 1]));
		}
		/* Post code */
		for (int j85 = 0; j85 < 4; j85 = j85 + 1) {
			fRec32_perm[j85] = fRec32_tmp[vsize + j85];
		}
	}
	void fun57AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input9, float* RESTRICT fRec32, float* RESTRICT fZec39) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec39[i] = static_cast<float>(input9[i]) - fRec32[i];
		}
	}
	void fun58AloopEffectDsp(float* fRec31_tmp, int vsize, int* RESTRICT iZec37, float* RESTRICT fZec39, float* fRec31) {
		/* Pre code */
		for (int j86 = 0; j86 < 4; j86 = j86 + 1) {
			fRec31_tmp[j86] = fRec31_perm[j86];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec31[i] = ((iZec37[i]) ? fZec39[i] : fConst17 * fRec31[i - 1] + fConst18 * fZec39[i]);
		}
		/* Post code */
		for (int j87 = 0; j87 < 4; j87 = j87 + 1) {
			fRec31_perm[j87] = fRec31_tmp[vsize + j87];
		}
	}
	void fun59AloopEffectDsp(float* fRec45_tmp, int vsize, FAUSTFLOAT* RESTRICT input12, float* fRec45, float* RESTRICT fYec2) {
		/* Pre code */
		for (int j104 = 0; j104 < 4; j104 = j104 + 1) {
			fRec45_tmp[j104] = fRec45_perm[j104];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec45[i] = static_cast<float>(input12[i]) + fRec45[i - 1] * static_cast<float>(fYec2[i - 1] >= static_cast<float>(input12[i]));
		}
		/* Post code */
		for (int j105 = 0; j105 < 4; j105 = j105 + 1) {
			fRec45_perm[j105] = fRec45_tmp[vsize + j105];
		}
	}
	void fun60AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input14, float* RESTRICT fYec1, int* RESTRICT iZec43) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec43[i] = static_cast<float>(input14[i]) > fYec1[i - 1];
		}
	}
	void fun61AloopEffectDsp(float* fRec52_tmp, int vsize, int* RESTRICT iZec43, float* fRec52) {
		/* Pre code */
		for (int j110 = 0; j110 < 4; j110 = j110 + 1) {
			fRec52_tmp[j110] = fRec52_perm[j110];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec52[i] = ((iZec43[i]) ? 0.0f : fRec52[i - 1] + 1.0f);
		}
		/* Post code */
		for (int j111 = 0; j111 < 4; j111 = j111 + 1) {
			fRec52_perm[j111] = fRec52_tmp[vsize + j111];
		}
	}
	void fun62AloopEffectDsp(float* fRec51_tmp, int vsize, float* RESTRICT fRec52, float* fRec51, float* RESTRICT fZec29) {
		/* Pre code */
		for (int j112 = 0; j112 < 4; j112 = j112 + 1) {
			fRec51_tmp[j112] = fRec51_perm[j112];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec51[i] = ((fRec52[i] < fConst16) ? fRec51[i - 1] : fZec29[i]);
		}
		/* Post code */
		for (int j113 = 0; j113 < 4; j113 = j113 + 1) {
			fRec51_perm[j113] = fRec51_tmp[vsize + j113];
		}
	}
	void fun63AloopEffectDsp(float* fRec50_tmp, int vsize, int* RESTRICT iZec1, float* fRec50) {
		/* Pre code */
		for (int j108 = 0; j108 < 4; j108 = j108 + 1) {
			fRec50_tmp[j108] = fRec50_perm[j108];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec50[i] = ((iZec1[i]) ? 1.0f : std::max<float>(0.0f, fRec50[i - 1] - fConst4));
		}
		/* Post code */
		for (int j109 = 0; j109 < 4; j109 = j109 + 1) {
			fRec50_perm[j109] = fRec50_tmp[vsize + j109];
		}
	}
	void fun64AloopEffectDsp(int vsize, float* RESTRICT fRec50, float* RESTRICT fZec44) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec44[i] = static_cast<float>(fRec50[i] > 0.0f);
		}
	}
	void fun65AloopEffectDsp(float* fRec49_tmp, int vsize, int* RESTRICT iZec43, int* RESTRICT iZec25, FAUSTFLOAT* RESTRICT input13, float* RESTRICT fRec51, int* RESTRICT iZec8, float* RESTRICT fZec44, float* RESTRICT fZec31, float* fRec49) {
		/* Pre code */
		for (int j114 = 0; j114 < 4; j114 = j114 + 1) {
			fRec49_tmp[j114] = fRec49_perm[j114];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec49[i] = ((iZec43[i]) ? ((iZec25[i]) ? static_cast<float>(input13[i]) : fRec51[i]) : ((iZec8[i] & (dubfx_pitch_confidence_poly(4.0f, fZec44[i]) >= 0.85f)) ? fZec31[i] + fConst17 * fRec49[i - 1] : fRec49[i - 1]));
		}
		/* Post code */
		for (int j115 = 0; j115 < 4; j115 = j115 + 1) {
			fRec49_perm[j115] = fRec49_tmp[vsize + j115];
		}
	}
	void fun66AloopEffectDsp(float* fRec48_tmp, int vsize, int* RESTRICT iZec8, float* RESTRICT fRec49, int* RESTRICT iZec43, int* RESTRICT iZec32, FAUSTFLOAT* RESTRICT input13, float* fRec48) {
		/* Pre code */
		for (int j116 = 0; j116 < 4; j116 = j116 + 1) {
			fRec48_tmp[j116] = fRec48_perm[j116];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec48[i] = ((iZec8[i]) ? fRec49[i] : ((iZec43[i] & iZec32[i]) ? static_cast<float>(input13[i]) : fRec48[i - 1]));
		}
		/* Post code */
		for (int j117 = 0; j117 < 4; j117 = j117 + 1) {
			fRec48_perm[j117] = fRec48_tmp[vsize + j117];
		}
	}
	void fun67AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input13, float* RESTRICT fRec48, float* RESTRICT fZec45) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec45[i] = static_cast<float>(input13[i]) - fRec48[i];
		}
	}
	void fun68AloopEffectDsp(float* fRec47_tmp, int vsize, int* RESTRICT iZec43, float* RESTRICT fZec45, float* fRec47) {
		/* Pre code */
		for (int j118 = 0; j118 < 4; j118 = j118 + 1) {
			fRec47_tmp[j118] = fRec47_perm[j118];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec47[i] = ((iZec43[i]) ? fZec45[i] : fConst17 * fRec47[i - 1] + fConst18 * fZec45[i]);
		}
		/* Post code */
		for (int j119 = 0; j119 < 4; j119 = j119 + 1) {
			fRec47_perm[j119] = fRec47_tmp[vsize + j119];
		}
	}
	void fun69AloopEffectDsp(int* iRec46_tmp, int vsize, FAUSTFLOAT* RESTRICT input12, int* iRec46) {
		/* Pre code */
		for (int j106 = 0; j106 < 4; j106 = j106 + 1) {
			iRec46_tmp[j106] = iRec46_perm[j106];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iRec46[i] = (static_cast<float>(input12[i]) == 0.0f) * (iRec46[i - 1] + 1);
		}
		/* Post code */
		for (int j107 = 0; j107 < 4; j107 = j107 + 1) {
			iRec46_perm[j107] = iRec46_tmp[vsize + j107];
		}
	}
	void fun70AloopEffectDsp(int* iRec30_tmp, int vsize, FAUSTFLOAT* RESTRICT input8, int* iRec30) {
		/* Pre code */
		for (int j74 = 0; j74 < 4; j74 = j74 + 1) {
			iRec30_tmp[j74] = iRec30_perm[j74];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iRec30[i] = (static_cast<float>(input8[i]) == 0.0f) * (iRec30[i - 1] + 1);
		}
		/* Post code */
		for (int j75 = 0; j75 < 4; j75 = j75 + 1) {
			iRec30_perm[j75] = iRec30_tmp[vsize + j75];
		}
	}
	void fun71AloopEffectDsp(int* iRec38_tmp, int vsize, FAUSTFLOAT* RESTRICT input10, int* iRec38) {
		/* Pre code */
		for (int j90 = 0; j90 < 4; j90 = j90 + 1) {
			iRec38_tmp[j90] = iRec38_perm[j90];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iRec38[i] = (static_cast<float>(input10[i]) == 0.0f) * (iRec38[i - 1] + 1);
		}
		/* Post code */
		for (int j91 = 0; j91 < 4; j91 = j91 + 1) {
			iRec38_perm[j91] = iRec38_tmp[vsize + j91];
		}
	}
	void fun72AloopEffectDsp(float* fRec53_tmp, int vsize, FAUSTFLOAT* RESTRICT input14, float* fRec53, float* RESTRICT fYec1) {
		/* Pre code */
		for (int j120 = 0; j120 < 4; j120 = j120 + 1) {
			fRec53_tmp[j120] = fRec53_perm[j120];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec53[i] = static_cast<float>(input14[i]) + fRec53[i - 1] * static_cast<float>(fYec1[i - 1] >= static_cast<float>(input14[i]));
		}
		/* Post code */
		for (int j121 = 0; j121 < 4; j121 = j121 + 1) {
			fRec53_perm[j121] = fRec53_tmp[vsize + j121];
		}
	}
	void fun73AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input16, float* RESTRICT fYec0, int* RESTRICT iZec46) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec46[i] = static_cast<float>(input16[i]) > fYec0[i - 1];
		}
	}
	void fun74AloopEffectDsp(float* fRec60_tmp, int vsize, int* RESTRICT iZec46, float* fRec60) {
		/* Pre code */
		for (int j126 = 0; j126 < 4; j126 = j126 + 1) {
			fRec60_tmp[j126] = fRec60_perm[j126];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec60[i] = ((iZec46[i]) ? 0.0f : fRec60[i - 1] + 1.0f);
		}
		/* Post code */
		for (int j127 = 0; j127 < 4; j127 = j127 + 1) {
			fRec60_perm[j127] = fRec60_tmp[vsize + j127];
		}
	}
	void fun75AloopEffectDsp(float* fRec59_tmp, int vsize, float* RESTRICT fRec60, float* fRec59, float* RESTRICT fZec29) {
		/* Pre code */
		for (int j128 = 0; j128 < 4; j128 = j128 + 1) {
			fRec59_tmp[j128] = fRec59_perm[j128];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec59[i] = ((fRec60[i] < fConst16) ? fRec59[i - 1] : fZec29[i]);
		}
		/* Post code */
		for (int j129 = 0; j129 < 4; j129 = j129 + 1) {
			fRec59_perm[j129] = fRec59_tmp[vsize + j129];
		}
	}
	void fun76AloopEffectDsp(float* fRec58_tmp, int vsize, int* RESTRICT iZec0, float* fRec58) {
		/* Pre code */
		for (int j124 = 0; j124 < 4; j124 = j124 + 1) {
			fRec58_tmp[j124] = fRec58_perm[j124];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec58[i] = ((iZec0[i]) ? 1.0f : std::max<float>(0.0f, fRec58[i - 1] - fConst4));
		}
		/* Post code */
		for (int j125 = 0; j125 < 4; j125 = j125 + 1) {
			fRec58_perm[j125] = fRec58_tmp[vsize + j125];
		}
	}
	void fun77AloopEffectDsp(int vsize, float* RESTRICT fRec58, float* RESTRICT fZec47) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec47[i] = static_cast<float>(fRec58[i] > 0.0f);
		}
	}
	void fun78AloopEffectDsp(float* fRec57_tmp, int vsize, int* RESTRICT iZec46, int* RESTRICT iZec25, FAUSTFLOAT* RESTRICT input15, float* RESTRICT fRec59, int* RESTRICT iZec8, float* RESTRICT fZec47, float* RESTRICT fZec31, float* fRec57) {
		/* Pre code */
		for (int j130 = 0; j130 < 4; j130 = j130 + 1) {
			fRec57_tmp[j130] = fRec57_perm[j130];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec57[i] = ((iZec46[i]) ? ((iZec25[i]) ? static_cast<float>(input15[i]) : fRec59[i]) : ((iZec8[i] & (dubfx_pitch_confidence_poly(5.0f, fZec47[i]) >= 0.85f)) ? fZec31[i] + fConst17 * fRec57[i - 1] : fRec57[i - 1]));
		}
		/* Post code */
		for (int j131 = 0; j131 < 4; j131 = j131 + 1) {
			fRec57_perm[j131] = fRec57_tmp[vsize + j131];
		}
	}
	void fun79AloopEffectDsp(float* fRec56_tmp, int vsize, int* RESTRICT iZec8, float* RESTRICT fRec57, int* RESTRICT iZec46, int* RESTRICT iZec32, FAUSTFLOAT* RESTRICT input15, float* fRec56) {
		/* Pre code */
		for (int j132 = 0; j132 < 4; j132 = j132 + 1) {
			fRec56_tmp[j132] = fRec56_perm[j132];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec56[i] = ((iZec8[i]) ? fRec57[i] : ((iZec46[i] & iZec32[i]) ? static_cast<float>(input15[i]) : fRec56[i - 1]));
		}
		/* Post code */
		for (int j133 = 0; j133 < 4; j133 = j133 + 1) {
			fRec56_perm[j133] = fRec56_tmp[vsize + j133];
		}
	}
	void fun80AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input15, float* RESTRICT fRec56, float* RESTRICT fZec48) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec48[i] = static_cast<float>(input15[i]) - fRec56[i];
		}
	}
	void fun81AloopEffectDsp(float* fRec55_tmp, int vsize, int* RESTRICT iZec46, float* RESTRICT fZec48, float* fRec55) {
		/* Pre code */
		for (int j134 = 0; j134 < 4; j134 = j134 + 1) {
			fRec55_tmp[j134] = fRec55_perm[j134];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec55[i] = ((iZec46[i]) ? fZec48[i] : fConst17 * fRec55[i - 1] + fConst18 * fZec48[i]);
		}
		/* Post code */
		for (int j135 = 0; j135 < 4; j135 = j135 + 1) {
			fRec55_perm[j135] = fRec55_tmp[vsize + j135];
		}
	}
	void fun82AloopEffectDsp(float* fRec37_tmp, int vsize, FAUSTFLOAT* RESTRICT input10, float* fRec37, float* RESTRICT fYec3) {
		/* Pre code */
		for (int j88 = 0; j88 < 4; j88 = j88 + 1) {
			fRec37_tmp[j88] = fRec37_perm[j88];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec37[i] = static_cast<float>(input10[i]) + fRec37[i - 1] * static_cast<float>(fYec3[i - 1] >= static_cast<float>(input10[i]));
		}
		/* Post code */
		for (int j89 = 0; j89 < 4; j89 = j89 + 1) {
			fRec37_perm[j89] = fRec37_tmp[vsize + j89];
		}
	}
	void fun83AloopEffectDsp(int* iRec54_tmp, int vsize, FAUSTFLOAT* RESTRICT input14, int* iRec54) {
		/* Pre code */
		for (int j122 = 0; j122 < 4; j122 = j122 + 1) {
			iRec54_tmp[j122] = iRec54_perm[j122];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iRec54[i] = (static_cast<float>(input14[i]) == 0.0f) * (iRec54[i - 1] + 1);
		}
		/* Post code */
		for (int j123 = 0; j123 < 4; j123 = j123 + 1) {
			iRec54_perm[j123] = iRec54_tmp[vsize + j123];
		}
	}
	void fun84AloopEffectDsp(float* fRec21_tmp, int vsize, FAUSTFLOAT* RESTRICT input6, float* fRec21, float* RESTRICT fYec5) {
		/* Pre code */
		for (int j56 = 0; j56 < 4; j56 = j56 + 1) {
			fRec21_tmp[j56] = fRec21_perm[j56];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec21[i] = static_cast<float>(input6[i]) + fRec21[i - 1] * static_cast<float>(fYec5[i - 1] >= static_cast<float>(input6[i]));
		}
		/* Post code */
		for (int j57 = 0; j57 < 4; j57 = j57 + 1) {
			fRec21_perm[j57] = fRec21_tmp[vsize + j57];
		}
	}
	void fun85AloopEffectDsp(int* iRec22_tmp, int vsize, FAUSTFLOAT* RESTRICT input6, int* iRec22) {
		/* Pre code */
		for (int j58 = 0; j58 < 4; j58 = j58 + 1) {
			iRec22_tmp[j58] = iRec22_perm[j58];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iRec22[i] = (static_cast<float>(input6[i]) == 0.0f) * (iRec22[i - 1] + 1);
		}
		/* Post code */
		for (int j59 = 0; j59 < 4; j59 = j59 + 1) {
			iRec22_perm[j59] = iRec22_tmp[vsize + j59];
		}
	}
	void fun86AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input8, float* RESTRICT fYec4, int* RESTRICT iZec34) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iZec34[i] = static_cast<float>(input8[i]) > fYec4[i - 1];
		}
	}
	void fun87AloopEffectDsp(float* fRec26_tmp, int vsize, int* RESTRICT iZec4, float* fRec26) {
		/* Pre code */
		for (int j60 = 0; j60 < 4; j60 = j60 + 1) {
			fRec26_tmp[j60] = fRec26_perm[j60];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec26[i] = ((iZec4[i]) ? 1.0f : std::max<float>(0.0f, fRec26[i - 1] - fConst4));
		}
		/* Post code */
		for (int j61 = 0; j61 < 4; j61 = j61 + 1) {
			fRec26_perm[j61] = fRec26_tmp[vsize + j61];
		}
	}
	void fun88AloopEffectDsp(float* fRec28_tmp, int vsize, int* RESTRICT iZec34, float* fRec28) {
		/* Pre code */
		for (int j62 = 0; j62 < 4; j62 = j62 + 1) {
			fRec28_tmp[j62] = fRec28_perm[j62];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec28[i] = ((iZec34[i]) ? 0.0f : fRec28[i - 1] + 1.0f);
		}
		/* Post code */
		for (int j63 = 0; j63 < 4; j63 = j63 + 1) {
			fRec28_perm[j63] = fRec28_tmp[vsize + j63];
		}
	}
	void fun89AloopEffectDsp(float* fRec27_tmp, int vsize, float* RESTRICT fRec28, float* fRec27, float* RESTRICT fZec29) {
		/* Pre code */
		for (int j64 = 0; j64 < 4; j64 = j64 + 1) {
			fRec27_tmp[j64] = fRec27_perm[j64];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec27[i] = ((fRec28[i] < fConst16) ? fRec27[i - 1] : fZec29[i]);
		}
		/* Post code */
		for (int j65 = 0; j65 < 4; j65 = j65 + 1) {
			fRec27_perm[j65] = fRec27_tmp[vsize + j65];
		}
	}
	void fun90AloopEffectDsp(int vsize, float* RESTRICT fRec26, float* RESTRICT fZec35) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec35[i] = static_cast<float>(fRec26[i] > 0.0f);
		}
	}
	void fun91AloopEffectDsp(float* fRec25_tmp, int vsize, int* RESTRICT iZec34, int* RESTRICT iZec25, FAUSTFLOAT* RESTRICT input7, float* RESTRICT fRec27, int* RESTRICT iZec8, float* RESTRICT fZec35, float* RESTRICT fZec31, float* fRec25) {
		/* Pre code */
		for (int j66 = 0; j66 < 4; j66 = j66 + 1) {
			fRec25_tmp[j66] = fRec25_perm[j66];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec25[i] = ((iZec34[i]) ? ((iZec25[i]) ? static_cast<float>(input7[i]) : fRec27[i]) : ((iZec8[i] & (dubfx_pitch_confidence_poly(1.0f, fZec35[i]) >= 0.85f)) ? fZec31[i] + fConst17 * fRec25[i - 1] : fRec25[i - 1]));
		}
		/* Post code */
		for (int j67 = 0; j67 < 4; j67 = j67 + 1) {
			fRec25_perm[j67] = fRec25_tmp[vsize + j67];
		}
	}
	void fun92AloopEffectDsp(float* fRec24_tmp, int vsize, int* RESTRICT iZec8, float* RESTRICT fRec25, int* RESTRICT iZec34, int* RESTRICT iZec32, FAUSTFLOAT* RESTRICT input7, float* fRec24) {
		/* Pre code */
		for (int j68 = 0; j68 < 4; j68 = j68 + 1) {
			fRec24_tmp[j68] = fRec24_perm[j68];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec24[i] = ((iZec8[i]) ? fRec25[i] : ((iZec34[i] & iZec32[i]) ? static_cast<float>(input7[i]) : fRec24[i - 1]));
		}
		/* Post code */
		for (int j69 = 0; j69 < 4; j69 = j69 + 1) {
			fRec24_perm[j69] = fRec24_tmp[vsize + j69];
		}
	}
	void fun93AloopEffectDsp(int vsize, FAUSTFLOAT* RESTRICT input7, float* RESTRICT fRec24, float* RESTRICT fZec36) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fZec36[i] = static_cast<float>(input7[i]) - fRec24[i];
		}
	}
	void fun94AloopEffectDsp(float* fRec23_tmp, int vsize, int* RESTRICT iZec34, float* RESTRICT fZec36, float* fRec23) {
		/* Pre code */
		for (int j70 = 0; j70 < 4; j70 = j70 + 1) {
			fRec23_tmp[j70] = fRec23_perm[j70];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec23[i] = ((iZec34[i]) ? fZec36[i] : fConst17 * fRec23[i - 1] + fConst18 * fZec36[i]);
		}
		/* Post code */
		for (int j71 = 0; j71 < 4; j71 = j71 + 1) {
			fRec23_perm[j71] = fRec23_tmp[vsize + j71];
		}
	}
	void fun95AloopEffectDsp(float* fRec29_tmp, int vsize, FAUSTFLOAT* RESTRICT input8, float* fRec29, float* RESTRICT fYec4) {
		/* Pre code */
		for (int j72 = 0; j72 < 4; j72 = j72 + 1) {
			fRec29_tmp[j72] = fRec29_perm[j72];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec29[i] = static_cast<float>(input8[i]) + fRec29[i - 1] * static_cast<float>(fYec4[i - 1] >= static_cast<float>(input8[i]));
		}
		/* Post code */
		for (int j73 = 0; j73 < 4; j73 = j73 + 1) {
			fRec29_perm[j73] = fRec29_tmp[vsize + j73];
		}
	}
	void fun96AloopEffectDsp(float* fRec61_tmp, int vsize, FAUSTFLOAT* RESTRICT input16, float* fRec61, float* RESTRICT fYec0) {
		/* Pre code */
		for (int j136 = 0; j136 < 4; j136 = j136 + 1) {
			fRec61_tmp[j136] = fRec61_perm[j136];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fRec61[i] = static_cast<float>(input16[i]) + fRec61[i - 1] * static_cast<float>(fYec0[i - 1] >= static_cast<float>(input16[i]));
		}
		/* Post code */
		for (int j137 = 0; j137 < 4; j137 = j137 + 1) {
			fRec61_perm[j137] = fRec61_tmp[vsize + j137];
		}
	}
	void fun97AloopEffectDsp(int* iRec62_tmp, int vsize, FAUSTFLOAT* RESTRICT input16, int* iRec62) {
		/* Pre code */
		for (int j138 = 0; j138 < 4; j138 = j138 + 1) {
			iRec62_tmp[j138] = iRec62_perm[j138];
		}
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			iRec62[i] = (static_cast<float>(input16[i]) == 0.0f) * (iRec62[i - 1] + 1);
		}
		/* Post code */
		for (int j139 = 0; j139 < 4; j139 = j139 + 1) {
			iRec62_perm[j139] = iRec62_tmp[vsize + j139];
		}
	}
	void fun98AloopEffectDsp(int vsize, float* fRec3, float* fRec2, float* RESTRICT fYec6, FAUSTFLOAT* RESTRICT input3, float* RESTRICT fZec30, float* fRec21, int* RESTRICT iRec22, float* fRec23, float* RESTRICT fZec35, float* fRec29, int* RESTRICT iRec30, float* fRec31, float* RESTRICT fZec38, float* fRec37, int* RESTRICT iRec38, float* fRec39, float* RESTRICT fZec41, float* RESTRICT fRec45, int* RESTRICT iRec46, float* RESTRICT fRec47, float* RESTRICT fZec44, float* RESTRICT fRec53, int* RESTRICT iRec54, float* RESTRICT fRec55, float* RESTRICT fZec47, float* RESTRICT fRec61, int* RESTRICT iRec62, float* RESTRICT fZec49) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			fHbargraph4 = static_cast<FAUSTFLOAT>(fRec3[i]);
			fHbargraph5 = static_cast<FAUSTFLOAT>(fRec2[i]);
			fZec49[i] = tanhf(0.6f * dubfx_pitch_tick_poly(fYec6[i], 0.0f, std::pow(2.0f, 0.083333336f * fRec2[i]), static_cast<float>(input3[i]), fZec30[i]) * std::max<float>(0.0f, std::min<float>(fConst20 * fRec21[i], 1.0f) * (1.0f - fConst19 * static_cast<float>(iRec22[i]))) + 0.6f * (dubfx_pitch_tick_poly(fYec6[i], 1.0f, std::pow(2.0f, 0.083333336f * fRec23[i]), static_cast<float>(input3[i]), fZec35[i]) * std::max<float>(0.0f, std::min<float>(fConst20 * fRec29[i], 1.0f) * (1.0f - fConst19 * static_cast<float>(iRec30[i]))) + dubfx_pitch_tick_poly(fYec6[i], 2.0f, std::pow(2.0f, 0.083333336f * fRec31[i]), static_cast<float>(input3[i]), fZec38[i]) * std::max<float>(0.0f, std::min<float>(fConst20 * fRec37[i], 1.0f) * (1.0f - fConst19 * static_cast<float>(iRec38[i]))) + dubfx_pitch_tick_poly(fYec6[i], 3.0f, std::pow(2.0f, 0.083333336f * fRec39[i]), static_cast<float>(input3[i]), fZec41[i]) * std::max<float>(0.0f, std::min<float>(fConst20 * fRec45[i], 1.0f) * (1.0f - fConst19 * static_cast<float>(iRec46[i]))) + dubfx_pitch_tick_poly(fYec6[i], 4.0f, std::pow(2.0f, 0.083333336f * fRec47[i]), static_cast<float>(input3[i]), fZec44[i]) * std::max<float>(0.0f, std::min<float>(fConst20 * fRec53[i], 1.0f) * (1.0f - fConst19 * static_cast<float>(iRec54[i]))) + dubfx_pitch_tick_poly(fYec6[i], 5.0f, std::pow(2.0f, 0.083333336f * fRec55[i]), static_cast<float>(input3[i]), fZec47[i]) * std::max<float>(0.0f, std::min<float>(fConst20 * fRec61[i], 1.0f) * (1.0f - fConst19 * static_cast<float>(iRec62[i])))));
		}
	}
	void fun99AloopEffectDsp(int vsize, float* RESTRICT fZec9, float* RESTRICT fRec1, float* RESTRICT fZec49, FAUSTFLOAT* RESTRICT output0) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			output0[i] = static_cast<FAUSTFLOAT>(fZec9[i] * fRec1[i] * fZec49[i]);
		}
	}
	void fun100AloopEffectDsp(int vsize, float* RESTRICT fRec0, float* RESTRICT fRec1, float* RESTRICT fZec49, FAUSTFLOAT* RESTRICT output1) {
		/* Compute code */
		for (int i = 0; i < vsize; i = i + 1) {
			output1[i] = static_cast<FAUSTFLOAT>(fRec0[i] * fRec1[i] * fZec49[i]);
		}
	}
	
	void compute(int count, FAUSTFLOAT** RESTRICT inputs, FAUSTFLOAT** RESTRICT outputs) {
		FAUSTFLOAT* input0_ptr = inputs[0];
		FAUSTFLOAT* input1_ptr = inputs[1];
		FAUSTFLOAT* input2_ptr = inputs[2];
		FAUSTFLOAT* input3_ptr = inputs[3];
		FAUSTFLOAT* input4_ptr = inputs[4];
		FAUSTFLOAT* input5_ptr = inputs[5];
		FAUSTFLOAT* input6_ptr = inputs[6];
		FAUSTFLOAT* input7_ptr = inputs[7];
		FAUSTFLOAT* input8_ptr = inputs[8];
		FAUSTFLOAT* input9_ptr = inputs[9];
		FAUSTFLOAT* input10_ptr = inputs[10];
		FAUSTFLOAT* input11_ptr = inputs[11];
		FAUSTFLOAT* input12_ptr = inputs[12];
		FAUSTFLOAT* input13_ptr = inputs[13];
		FAUSTFLOAT* input14_ptr = inputs[14];
		FAUSTFLOAT* input15_ptr = inputs[15];
		FAUSTFLOAT* input16_ptr = inputs[16];
		FAUSTFLOAT* output0_ptr = outputs[0];
		FAUSTFLOAT* output1_ptr = outputs[1];
		float fRec0_tmp[36];
		float* fRec0 = &fRec0_tmp[4];
		float fYec0_tmp[36];
		float* fYec0 = &fYec0_tmp[4];
		int iZec0[32];
		float fYec1_tmp[36];
		float* fYec1 = &fYec1_tmp[4];
		int iZec1[32];
		float fYec2_tmp[36];
		float* fYec2 = &fYec2_tmp[4];
		int iZec2[32];
		float fYec3_tmp[36];
		float* fYec3 = &fYec3_tmp[4];
		int iZec3[32];
		float fYec4_tmp[36];
		float* fYec4 = &fYec4_tmp[4];
		int iZec4[32];
		float fYec5_tmp[36];
		float* fYec5 = &fYec5_tmp[4];
		int iZec5[32];
		float fRec1_tmp[36];
		float* fRec1 = &fRec1_tmp[4];
		float fZec6[32];
		int iZec7[32];
		int iZec8[32];
		int iRec4_tmp[36];
		int* iRec4 = &iRec4_tmp[4];
		float fRec6_tmp[36];
		float* fRec6 = &fRec6_tmp[4];
		int iRec9_tmp[36];
		int* iRec9 = &iRec9_tmp[4];
		float fZec9[32];
		float fYec6_tmp[36];
		float* fYec6 = &fYec6_tmp[4];
		float fRec15_tmp[36];
		float* fRec15 = &fRec15_tmp[4];
		float fRec17_tmp[36];
		float* fRec17 = &fRec17_tmp[4];
		float fZec10[32];
		float fZec11[32];
		int iZec12[32];
		float fZec13[32];
		float fZec14[32];
		float fRec16_tmp[36];
		float* fRec16 = &fRec16_tmp[4];
		float fZec15[32];
		int iZec16[32];
		float fZec17[32];
		float fRec18_tmp[36];
		float* fRec18 = &fRec18_tmp[4];
		float fZec18[32];
		float fZec19[32];
		float fZec20[32];
		float fZec21[32];
		float fRec14_tmp[36];
		float* fRec14 = &fRec14_tmp[4];
		float fZec22[32];
		float fRec13_tmp[36];
		float* fRec13 = &fRec13_tmp[4];
		float fZec23[32];
		float fRec12_tmp[36];
		float* fRec12 = &fRec12_tmp[4];
		float fRec11_tmp[36];
		float* fRec11 = &fRec11_tmp[4];
		float fRec10_tmp[36];
		float* fRec10 = &fRec10_tmp[4];
		float fZec24[32];
		int iZec25[32];
		int iZec26[32];
		float fRec7_tmp[36];
		float* fRec7 = &fRec7_tmp[4];
		float fRec8_tmp[36];
		float* fRec8 = &fRec8_tmp[4];
		int iZec27[32];
		float fRec20_tmp[36];
		float* fRec20 = &fRec20_tmp[4];
		float fZec28[32];
		float fZec29[32];
		float fRec19_tmp[36];
		float* fRec19 = &fRec19_tmp[4];
		float fZec30[32];
		float fZec31[32];
		float fRec5_tmp[36];
		float* fRec5 = &fRec5_tmp[4];
		int iZec32[32];
		float fRec3_tmp[36];
		float* fRec3 = &fRec3_tmp[4];
		float fZec33[32];
		float fRec2_tmp[36];
		float* fRec2 = &fRec2_tmp[4];
		float fRec21_tmp[36];
		float* fRec21 = &fRec21_tmp[4];
		int iRec22_tmp[36];
		int* iRec22 = &iRec22_tmp[4];
		float fRec26_tmp[36];
		float* fRec26 = &fRec26_tmp[4];
		int iZec34[32];
		float fRec28_tmp[36];
		float* fRec28 = &fRec28_tmp[4];
		float fRec27_tmp[36];
		float* fRec27 = &fRec27_tmp[4];
		float fZec35[32];
		float fRec25_tmp[36];
		float* fRec25 = &fRec25_tmp[4];
		float fRec24_tmp[36];
		float* fRec24 = &fRec24_tmp[4];
		float fZec36[32];
		float fRec23_tmp[36];
		float* fRec23 = &fRec23_tmp[4];
		float fRec29_tmp[36];
		float* fRec29 = &fRec29_tmp[4];
		int iRec30_tmp[36];
		int* iRec30 = &iRec30_tmp[4];
		float fRec34_tmp[36];
		float* fRec34 = &fRec34_tmp[4];
		int iZec37[32];
		float fRec36_tmp[36];
		float* fRec36 = &fRec36_tmp[4];
		float fRec35_tmp[36];
		float* fRec35 = &fRec35_tmp[4];
		float fZec38[32];
		float fRec33_tmp[36];
		float* fRec33 = &fRec33_tmp[4];
		float fRec32_tmp[36];
		float* fRec32 = &fRec32_tmp[4];
		float fZec39[32];
		float fRec31_tmp[36];
		float* fRec31 = &fRec31_tmp[4];
		float fRec37_tmp[36];
		float* fRec37 = &fRec37_tmp[4];
		int iRec38_tmp[36];
		int* iRec38 = &iRec38_tmp[4];
		float fRec42_tmp[36];
		float* fRec42 = &fRec42_tmp[4];
		int iZec40[32];
		float fRec44_tmp[36];
		float* fRec44 = &fRec44_tmp[4];
		float fRec43_tmp[36];
		float* fRec43 = &fRec43_tmp[4];
		float fZec41[32];
		float fRec41_tmp[36];
		float* fRec41 = &fRec41_tmp[4];
		float fRec40_tmp[36];
		float* fRec40 = &fRec40_tmp[4];
		float fZec42[32];
		float fRec39_tmp[36];
		float* fRec39 = &fRec39_tmp[4];
		float fRec45_tmp[36];
		float* fRec45 = &fRec45_tmp[4];
		int iRec46_tmp[36];
		int* iRec46 = &iRec46_tmp[4];
		float fRec50_tmp[36];
		float* fRec50 = &fRec50_tmp[4];
		int iZec43[32];
		float fRec52_tmp[36];
		float* fRec52 = &fRec52_tmp[4];
		float fRec51_tmp[36];
		float* fRec51 = &fRec51_tmp[4];
		float fZec44[32];
		float fRec49_tmp[36];
		float* fRec49 = &fRec49_tmp[4];
		float fRec48_tmp[36];
		float* fRec48 = &fRec48_tmp[4];
		float fZec45[32];
		float fRec47_tmp[36];
		float* fRec47 = &fRec47_tmp[4];
		float fRec53_tmp[36];
		float* fRec53 = &fRec53_tmp[4];
		int iRec54_tmp[36];
		int* iRec54 = &iRec54_tmp[4];
		float fRec58_tmp[36];
		float* fRec58 = &fRec58_tmp[4];
		int iZec46[32];
		float fRec60_tmp[36];
		float* fRec60 = &fRec60_tmp[4];
		float fRec59_tmp[36];
		float* fRec59 = &fRec59_tmp[4];
		float fZec47[32];
		float fRec57_tmp[36];
		float* fRec57 = &fRec57_tmp[4];
		float fRec56_tmp[36];
		float* fRec56 = &fRec56_tmp[4];
		float fZec48[32];
		float fRec55_tmp[36];
		float* fRec55 = &fRec55_tmp[4];
		float fRec61_tmp[36];
		float* fRec61 = &fRec61_tmp[4];
		int iRec62_tmp[36];
		int* iRec62 = &iRec62_tmp[4];
		float fZec49[32];
		int vindex = 0;
		/* Main loop */
		for (vindex = 0; vindex <= (count - 32); vindex = vindex + 32) {
			FAUSTFLOAT* input0 = &input0_ptr[vindex];
			FAUSTFLOAT* input1 = &input1_ptr[vindex];
			FAUSTFLOAT* input2 = &input2_ptr[vindex];
			FAUSTFLOAT* input3 = &input3_ptr[vindex];
			FAUSTFLOAT* input4 = &input4_ptr[vindex];
			FAUSTFLOAT* input5 = &input5_ptr[vindex];
			FAUSTFLOAT* input6 = &input6_ptr[vindex];
			FAUSTFLOAT* input7 = &input7_ptr[vindex];
			FAUSTFLOAT* input8 = &input8_ptr[vindex];
			FAUSTFLOAT* input9 = &input9_ptr[vindex];
			FAUSTFLOAT* input10 = &input10_ptr[vindex];
			FAUSTFLOAT* input11 = &input11_ptr[vindex];
			FAUSTFLOAT* input12 = &input12_ptr[vindex];
			FAUSTFLOAT* input13 = &input13_ptr[vindex];
			FAUSTFLOAT* input14 = &input14_ptr[vindex];
			FAUSTFLOAT* input15 = &input15_ptr[vindex];
			FAUSTFLOAT* input16 = &input16_ptr[vindex];
			FAUSTFLOAT* output0 = &output0_ptr[vindex];
			FAUSTFLOAT* output1 = &output1_ptr[vindex];
			int vsize = 32;
			/* Vectorizable function 0 */
			fun0AloopEffectDsp(fYec0_tmp, vsize, input16, fYec0);
			/* Vectorizable function 1 */
			fun1AloopEffectDsp(vsize, input16, iZec0);
			/* Vectorizable function 2 */
			fun2AloopEffectDsp(fYec1_tmp, vsize, input14, fYec1);
			/* Vectorizable function 3 */
			fun3AloopEffectDsp(vsize, input14, iZec1);
			/* Vectorizable function 4 */
			fun4AloopEffectDsp(fYec4_tmp, vsize, input8, fYec4);
			/* Vectorizable function 5 */
			fun5AloopEffectDsp(vsize, input8, iZec4);
			/* Vectorizable function 6 */
			fun6AloopEffectDsp(fYec5_tmp, vsize, input6, fYec5);
			/* Vectorizable function 7 */
			fun7AloopEffectDsp(vsize, input6, iZec5);
			/* Vectorizable function 8 */
			fun8AloopEffectDsp(fYec2_tmp, vsize, input12, fYec2);
			/* Vectorizable function 9 */
			fun9AloopEffectDsp(vsize, input12, iZec2);
			/* Vectorizable function 10 */
			fun10AloopEffectDsp(fYec3_tmp, vsize, input10, fYec3);
			/* Vectorizable function 11 */
			fun11AloopEffectDsp(vsize, input10, iZec3);
			/* Recursive function 12 */
			fun12AloopEffectDsp(fRec1_tmp, vsize, iZec5, iZec4, iZec3, iZec2, iZec1, iZec0, fRec1);
			/* Vectorizable function 13 */
			fun13AloopEffectDsp(vsize, input6, fYec5, iZec27);
			/* Vectorizable function 14 */
			fun14AloopEffectDsp(vsize, input4, fZec6);
			/* Vectorizable function 15 */
			fun15AloopEffectDsp(vsize, fZec6, iZec7);
			/* Vectorizable function 16 */
			fun16AloopEffectDsp(vsize, iZec7, iZec8);
			/* Recursive function 17 */
			fun17AloopEffectDsp(iRec4_tmp, vsize, iRec4, iZec8);
			/* Vectorizable function 18 */
			fun18AloopEffectDsp(vsize, iRec4, iZec32);
			/* Recursive function 19 */
			fun19AloopEffectDsp(fRec6_tmp, vsize, iZec5, fRec6);
			/* Vectorizable function 20 */
			fun20AloopEffectDsp(vsize, fRec6, fZec30);
			/* Recursive function 21 */
			fun21AloopEffectDsp(fRec20_tmp, vsize, iZec27, fRec20);
			/* Recursive function 22 */
			fun22AloopEffectDsp(fRec0_tmp, vsize, input2, fRec0);
			/* Vectorizable function 23 */
			fun23AloopEffectDsp(vsize, fRec0, fZec9);
			/* Vectorizable function 24 */
			fun24AloopEffectDsp(fYec6_tmp, vsize, input0, fZec9, input1, fRec0, fYec6);
			/* Recursive function 25 */
			fun25AloopEffectDsp(fRec15_tmp, vsize, fRec15, fYec6);
			/* Recursive function 26 */
			fun26AloopEffectDsp(fRec17_tmp, vsize, fRec15, fRec17);
			/* Vectorizable function 27 */
			fun27AloopEffectDsp(vsize, fRec17, fZec14);
			/* Recursive function 28 */
			fun28AloopEffectDsp(fRec16_tmp, fRec18_tmp, fRec14_tmp, fRec13_tmp, fRec12_tmp, fRec11_tmp, fRec10_tmp, vsize, fRec10, fZec10, fZec11, iZec12, fZec13, fZec14, fRec16, fZec15, iZec16, fZec17, fRec18, fZec18, fZec19, fZec20, fZec21, fRec15, fRec14, fZec22, fRec13, fZec23, fRec12, fRec11);
			/* Vectorizable function 29 */
			fun29AloopEffectDsp(vsize, fRec10, fZec24);
			/* Recursive function 30 */
			fun30AloopEffectDsp(iRec9_tmp, vsize, iRec9);
			/* Vectorizable function 31 */
			fun31AloopEffectDsp(vsize, iRec9, iZec25);
			/* Recursive function 32 */
			fun32AloopEffectDsp(fRec7_tmp, fRec8_tmp, vsize, iZec25, fRec8, fZec24, fRec7, iZec26);
			/* Vectorizable function 33 */
			fun33AloopEffectDsp(vsize, iZec7, fZec6, fRec7, fZec28);
			/* Vectorizable function 34 */
			fun34AloopEffectDsp(vsize, fZec28, fZec29);
			/* Recursive function 35 */
			fun35AloopEffectDsp(fRec19_tmp, vsize, fRec20, fRec19, fZec29);
			/* Vectorizable function 36 */
			fun36AloopEffectDsp(vsize, fZec29, fZec31);
			/* Recursive function 37 */
			fun37AloopEffectDsp(fRec5_tmp, vsize, iZec27, iZec25, input5, fRec19, iZec8, fZec30, fRec5, fZec31);
			/* Recursive function 38 */
			fun38AloopEffectDsp(fRec3_tmp, vsize, iZec8, fRec5, iZec27, iZec32, input5, fRec3);
			/* Vectorizable function 39 */
			fun39AloopEffectDsp(vsize, input5, fRec3, fZec33);
			/* Recursive function 40 */
			fun40AloopEffectDsp(fRec2_tmp, vsize, iZec27, fZec33, fRec2);
			/* Recursive function 41 */
			fun41AloopEffectDsp(fRec42_tmp, vsize, iZec2, fRec42);
			/* Vectorizable function 42 */
			fun42AloopEffectDsp(vsize, fRec42, fZec41);
			/* Vectorizable function 43 */
			fun43AloopEffectDsp(vsize, input12, fYec2, iZec40);
			/* Recursive function 44 */
			fun44AloopEffectDsp(fRec44_tmp, vsize, iZec40, fRec44);
			/* Recursive function 45 */
			fun45AloopEffectDsp(fRec43_tmp, vsize, fRec44, fRec43, fZec29);
			/* Recursive function 46 */
			fun46AloopEffectDsp(fRec41_tmp, vsize, iZec40, iZec25, input11, fRec43, iZec8, fZec41, fZec31, fRec41);
			/* Recursive function 47 */
			fun47AloopEffectDsp(fRec40_tmp, vsize, iZec8, fRec41, iZec40, iZec32, input11, fRec40);
			/* Vectorizable function 48 */
			fun48AloopEffectDsp(vsize, input11, fRec40, fZec42);
			/* Recursive function 49 */
			fun49AloopEffectDsp(fRec39_tmp, vsize, iZec40, fZec42, fRec39);
			/* Vectorizable function 50 */
			fun50AloopEffectDsp(vsize, input10, fYec3, iZec37);
			/* Recursive function 51 */
			fun51AloopEffectDsp(fRec34_tmp, vsize, iZec3, fRec34);
			/* Recursive function 52 */
			fun52AloopEffectDsp(fRec36_tmp, vsize, iZec37, fRec36);
			/* Recursive function 53 */
			fun53AloopEffectDsp(fRec35_tmp, vsize, fRec36, fRec35, fZec29);
			/* Vectorizable function 54 */
			fun54AloopEffectDsp(vsize, fRec34, fZec38);
			/* Recursive function 55 */
			fun55AloopEffectDsp(fRec33_tmp, vsize, iZec37, iZec25, input9, fRec35, iZec8, fZec38, fZec31, fRec33);
			/* Recursive function 56 */
			fun56AloopEffectDsp(fRec32_tmp, vsize, iZec8, fRec33, iZec37, iZec32, input9, fRec32);
			/* Vectorizable function 57 */
			fun57AloopEffectDsp(vsize, input9, fRec32, fZec39);
			/* Recursive function 58 */
			fun58AloopEffectDsp(fRec31_tmp, vsize, iZec37, fZec39, fRec31);
			/* Recursive function 59 */
			fun59AloopEffectDsp(fRec45_tmp, vsize, input12, fRec45, fYec2);
			/* Vectorizable function 60 */
			fun60AloopEffectDsp(vsize, input14, fYec1, iZec43);
			/* Recursive function 61 */
			fun61AloopEffectDsp(fRec52_tmp, vsize, iZec43, fRec52);
			/* Recursive function 62 */
			fun62AloopEffectDsp(fRec51_tmp, vsize, fRec52, fRec51, fZec29);
			/* Recursive function 63 */
			fun63AloopEffectDsp(fRec50_tmp, vsize, iZec1, fRec50);
			/* Vectorizable function 64 */
			fun64AloopEffectDsp(vsize, fRec50, fZec44);
			/* Recursive function 65 */
			fun65AloopEffectDsp(fRec49_tmp, vsize, iZec43, iZec25, input13, fRec51, iZec8, fZec44, fZec31, fRec49);
			/* Recursive function 66 */
			fun66AloopEffectDsp(fRec48_tmp, vsize, iZec8, fRec49, iZec43, iZec32, input13, fRec48);
			/* Vectorizable function 67 */
			fun67AloopEffectDsp(vsize, input13, fRec48, fZec45);
			/* Recursive function 68 */
			fun68AloopEffectDsp(fRec47_tmp, vsize, iZec43, fZec45, fRec47);
			/* Recursive function 69 */
			fun69AloopEffectDsp(iRec46_tmp, vsize, input12, iRec46);
			/* Recursive function 70 */
			fun70AloopEffectDsp(iRec30_tmp, vsize, input8, iRec30);
			/* Recursive function 71 */
			fun71AloopEffectDsp(iRec38_tmp, vsize, input10, iRec38);
			/* Recursive function 72 */
			fun72AloopEffectDsp(fRec53_tmp, vsize, input14, fRec53, fYec1);
			/* Vectorizable function 73 */
			fun73AloopEffectDsp(vsize, input16, fYec0, iZec46);
			/* Recursive function 74 */
			fun74AloopEffectDsp(fRec60_tmp, vsize, iZec46, fRec60);
			/* Recursive function 75 */
			fun75AloopEffectDsp(fRec59_tmp, vsize, fRec60, fRec59, fZec29);
			/* Recursive function 76 */
			fun76AloopEffectDsp(fRec58_tmp, vsize, iZec0, fRec58);
			/* Vectorizable function 77 */
			fun77AloopEffectDsp(vsize, fRec58, fZec47);
			/* Recursive function 78 */
			fun78AloopEffectDsp(fRec57_tmp, vsize, iZec46, iZec25, input15, fRec59, iZec8, fZec47, fZec31, fRec57);
			/* Recursive function 79 */
			fun79AloopEffectDsp(fRec56_tmp, vsize, iZec8, fRec57, iZec46, iZec32, input15, fRec56);
			/* Vectorizable function 80 */
			fun80AloopEffectDsp(vsize, input15, fRec56, fZec48);
			/* Recursive function 81 */
			fun81AloopEffectDsp(fRec55_tmp, vsize, iZec46, fZec48, fRec55);
			/* Recursive function 82 */
			fun82AloopEffectDsp(fRec37_tmp, vsize, input10, fRec37, fYec3);
			/* Recursive function 83 */
			fun83AloopEffectDsp(iRec54_tmp, vsize, input14, iRec54);
			/* Recursive function 84 */
			fun84AloopEffectDsp(fRec21_tmp, vsize, input6, fRec21, fYec5);
			/* Recursive function 85 */
			fun85AloopEffectDsp(iRec22_tmp, vsize, input6, iRec22);
			/* Vectorizable function 86 */
			fun86AloopEffectDsp(vsize, input8, fYec4, iZec34);
			/* Recursive function 87 */
			fun87AloopEffectDsp(fRec26_tmp, vsize, iZec4, fRec26);
			/* Recursive function 88 */
			fun88AloopEffectDsp(fRec28_tmp, vsize, iZec34, fRec28);
			/* Recursive function 89 */
			fun89AloopEffectDsp(fRec27_tmp, vsize, fRec28, fRec27, fZec29);
			/* Vectorizable function 90 */
			fun90AloopEffectDsp(vsize, fRec26, fZec35);
			/* Recursive function 91 */
			fun91AloopEffectDsp(fRec25_tmp, vsize, iZec34, iZec25, input7, fRec27, iZec8, fZec35, fZec31, fRec25);
			/* Recursive function 92 */
			fun92AloopEffectDsp(fRec24_tmp, vsize, iZec8, fRec25, iZec34, iZec32, input7, fRec24);
			/* Vectorizable function 93 */
			fun93AloopEffectDsp(vsize, input7, fRec24, fZec36);
			/* Recursive function 94 */
			fun94AloopEffectDsp(fRec23_tmp, vsize, iZec34, fZec36, fRec23);
			/* Recursive function 95 */
			fun95AloopEffectDsp(fRec29_tmp, vsize, input8, fRec29, fYec4);
			/* Recursive function 96 */
			fun96AloopEffectDsp(fRec61_tmp, vsize, input16, fRec61, fYec0);
			/* Recursive function 97 */
			fun97AloopEffectDsp(iRec62_tmp, vsize, input16, iRec62);
			/* Vectorizable function 98 */
			fun98AloopEffectDsp(vsize, fRec3, fRec2, fYec6, input3, fZec30, fRec21, iRec22, fRec23, fZec35, fRec29, iRec30, fRec31, fZec38, fRec37, iRec38, fRec39, fZec41, fRec45, iRec46, fRec47, fZec44, fRec53, iRec54, fRec55, fZec47, fRec61, iRec62, fZec49);
			/* Vectorizable function 99 */
			fun99AloopEffectDsp(vsize, fZec9, fRec1, fZec49, output0);
			/* Vectorizable function 100 */
			fun100AloopEffectDsp(vsize, fRec0, fRec1, fZec49, output1);
		}
		/* Remaining frames */
		if (vindex < count) {
			FAUSTFLOAT* input0 = &input0_ptr[vindex];
			FAUSTFLOAT* input1 = &input1_ptr[vindex];
			FAUSTFLOAT* input2 = &input2_ptr[vindex];
			FAUSTFLOAT* input3 = &input3_ptr[vindex];
			FAUSTFLOAT* input4 = &input4_ptr[vindex];
			FAUSTFLOAT* input5 = &input5_ptr[vindex];
			FAUSTFLOAT* input6 = &input6_ptr[vindex];
			FAUSTFLOAT* input7 = &input7_ptr[vindex];
			FAUSTFLOAT* input8 = &input8_ptr[vindex];
			FAUSTFLOAT* input9 = &input9_ptr[vindex];
			FAUSTFLOAT* input10 = &input10_ptr[vindex];
			FAUSTFLOAT* input11 = &input11_ptr[vindex];
			FAUSTFLOAT* input12 = &input12_ptr[vindex];
			FAUSTFLOAT* input13 = &input13_ptr[vindex];
			FAUSTFLOAT* input14 = &input14_ptr[vindex];
			FAUSTFLOAT* input15 = &input15_ptr[vindex];
			FAUSTFLOAT* input16 = &input16_ptr[vindex];
			FAUSTFLOAT* output0 = &output0_ptr[vindex];
			FAUSTFLOAT* output1 = &output1_ptr[vindex];
			int vsize = count - vindex;
			/* Vectorizable function 0 */
			fun0AloopEffectDsp(fYec0_tmp, vsize, input16, fYec0);
			/* Vectorizable function 1 */
			fun1AloopEffectDsp(vsize, input16, iZec0);
			/* Vectorizable function 2 */
			fun2AloopEffectDsp(fYec1_tmp, vsize, input14, fYec1);
			/* Vectorizable function 3 */
			fun3AloopEffectDsp(vsize, input14, iZec1);
			/* Vectorizable function 4 */
			fun4AloopEffectDsp(fYec4_tmp, vsize, input8, fYec4);
			/* Vectorizable function 5 */
			fun5AloopEffectDsp(vsize, input8, iZec4);
			/* Vectorizable function 6 */
			fun6AloopEffectDsp(fYec5_tmp, vsize, input6, fYec5);
			/* Vectorizable function 7 */
			fun7AloopEffectDsp(vsize, input6, iZec5);
			/* Vectorizable function 8 */
			fun8AloopEffectDsp(fYec2_tmp, vsize, input12, fYec2);
			/* Vectorizable function 9 */
			fun9AloopEffectDsp(vsize, input12, iZec2);
			/* Vectorizable function 10 */
			fun10AloopEffectDsp(fYec3_tmp, vsize, input10, fYec3);
			/* Vectorizable function 11 */
			fun11AloopEffectDsp(vsize, input10, iZec3);
			/* Recursive function 12 */
			fun12AloopEffectDsp(fRec1_tmp, vsize, iZec5, iZec4, iZec3, iZec2, iZec1, iZec0, fRec1);
			/* Vectorizable function 13 */
			fun13AloopEffectDsp(vsize, input6, fYec5, iZec27);
			/* Vectorizable function 14 */
			fun14AloopEffectDsp(vsize, input4, fZec6);
			/* Vectorizable function 15 */
			fun15AloopEffectDsp(vsize, fZec6, iZec7);
			/* Vectorizable function 16 */
			fun16AloopEffectDsp(vsize, iZec7, iZec8);
			/* Recursive function 17 */
			fun17AloopEffectDsp(iRec4_tmp, vsize, iRec4, iZec8);
			/* Vectorizable function 18 */
			fun18AloopEffectDsp(vsize, iRec4, iZec32);
			/* Recursive function 19 */
			fun19AloopEffectDsp(fRec6_tmp, vsize, iZec5, fRec6);
			/* Vectorizable function 20 */
			fun20AloopEffectDsp(vsize, fRec6, fZec30);
			/* Recursive function 21 */
			fun21AloopEffectDsp(fRec20_tmp, vsize, iZec27, fRec20);
			/* Recursive function 22 */
			fun22AloopEffectDsp(fRec0_tmp, vsize, input2, fRec0);
			/* Vectorizable function 23 */
			fun23AloopEffectDsp(vsize, fRec0, fZec9);
			/* Vectorizable function 24 */
			fun24AloopEffectDsp(fYec6_tmp, vsize, input0, fZec9, input1, fRec0, fYec6);
			/* Recursive function 25 */
			fun25AloopEffectDsp(fRec15_tmp, vsize, fRec15, fYec6);
			/* Recursive function 26 */
			fun26AloopEffectDsp(fRec17_tmp, vsize, fRec15, fRec17);
			/* Vectorizable function 27 */
			fun27AloopEffectDsp(vsize, fRec17, fZec14);
			/* Recursive function 28 */
			fun28AloopEffectDsp(fRec16_tmp, fRec18_tmp, fRec14_tmp, fRec13_tmp, fRec12_tmp, fRec11_tmp, fRec10_tmp, vsize, fRec10, fZec10, fZec11, iZec12, fZec13, fZec14, fRec16, fZec15, iZec16, fZec17, fRec18, fZec18, fZec19, fZec20, fZec21, fRec15, fRec14, fZec22, fRec13, fZec23, fRec12, fRec11);
			/* Vectorizable function 29 */
			fun29AloopEffectDsp(vsize, fRec10, fZec24);
			/* Recursive function 30 */
			fun30AloopEffectDsp(iRec9_tmp, vsize, iRec9);
			/* Vectorizable function 31 */
			fun31AloopEffectDsp(vsize, iRec9, iZec25);
			/* Recursive function 32 */
			fun32AloopEffectDsp(fRec7_tmp, fRec8_tmp, vsize, iZec25, fRec8, fZec24, fRec7, iZec26);
			/* Vectorizable function 33 */
			fun33AloopEffectDsp(vsize, iZec7, fZec6, fRec7, fZec28);
			/* Vectorizable function 34 */
			fun34AloopEffectDsp(vsize, fZec28, fZec29);
			/* Recursive function 35 */
			fun35AloopEffectDsp(fRec19_tmp, vsize, fRec20, fRec19, fZec29);
			/* Vectorizable function 36 */
			fun36AloopEffectDsp(vsize, fZec29, fZec31);
			/* Recursive function 37 */
			fun37AloopEffectDsp(fRec5_tmp, vsize, iZec27, iZec25, input5, fRec19, iZec8, fZec30, fRec5, fZec31);
			/* Recursive function 38 */
			fun38AloopEffectDsp(fRec3_tmp, vsize, iZec8, fRec5, iZec27, iZec32, input5, fRec3);
			/* Vectorizable function 39 */
			fun39AloopEffectDsp(vsize, input5, fRec3, fZec33);
			/* Recursive function 40 */
			fun40AloopEffectDsp(fRec2_tmp, vsize, iZec27, fZec33, fRec2);
			/* Recursive function 41 */
			fun41AloopEffectDsp(fRec42_tmp, vsize, iZec2, fRec42);
			/* Vectorizable function 42 */
			fun42AloopEffectDsp(vsize, fRec42, fZec41);
			/* Vectorizable function 43 */
			fun43AloopEffectDsp(vsize, input12, fYec2, iZec40);
			/* Recursive function 44 */
			fun44AloopEffectDsp(fRec44_tmp, vsize, iZec40, fRec44);
			/* Recursive function 45 */
			fun45AloopEffectDsp(fRec43_tmp, vsize, fRec44, fRec43, fZec29);
			/* Recursive function 46 */
			fun46AloopEffectDsp(fRec41_tmp, vsize, iZec40, iZec25, input11, fRec43, iZec8, fZec41, fZec31, fRec41);
			/* Recursive function 47 */
			fun47AloopEffectDsp(fRec40_tmp, vsize, iZec8, fRec41, iZec40, iZec32, input11, fRec40);
			/* Vectorizable function 48 */
			fun48AloopEffectDsp(vsize, input11, fRec40, fZec42);
			/* Recursive function 49 */
			fun49AloopEffectDsp(fRec39_tmp, vsize, iZec40, fZec42, fRec39);
			/* Vectorizable function 50 */
			fun50AloopEffectDsp(vsize, input10, fYec3, iZec37);
			/* Recursive function 51 */
			fun51AloopEffectDsp(fRec34_tmp, vsize, iZec3, fRec34);
			/* Recursive function 52 */
			fun52AloopEffectDsp(fRec36_tmp, vsize, iZec37, fRec36);
			/* Recursive function 53 */
			fun53AloopEffectDsp(fRec35_tmp, vsize, fRec36, fRec35, fZec29);
			/* Vectorizable function 54 */
			fun54AloopEffectDsp(vsize, fRec34, fZec38);
			/* Recursive function 55 */
			fun55AloopEffectDsp(fRec33_tmp, vsize, iZec37, iZec25, input9, fRec35, iZec8, fZec38, fZec31, fRec33);
			/* Recursive function 56 */
			fun56AloopEffectDsp(fRec32_tmp, vsize, iZec8, fRec33, iZec37, iZec32, input9, fRec32);
			/* Vectorizable function 57 */
			fun57AloopEffectDsp(vsize, input9, fRec32, fZec39);
			/* Recursive function 58 */
			fun58AloopEffectDsp(fRec31_tmp, vsize, iZec37, fZec39, fRec31);
			/* Recursive function 59 */
			fun59AloopEffectDsp(fRec45_tmp, vsize, input12, fRec45, fYec2);
			/* Vectorizable function 60 */
			fun60AloopEffectDsp(vsize, input14, fYec1, iZec43);
			/* Recursive function 61 */
			fun61AloopEffectDsp(fRec52_tmp, vsize, iZec43, fRec52);
			/* Recursive function 62 */
			fun62AloopEffectDsp(fRec51_tmp, vsize, fRec52, fRec51, fZec29);
			/* Recursive function 63 */
			fun63AloopEffectDsp(fRec50_tmp, vsize, iZec1, fRec50);
			/* Vectorizable function 64 */
			fun64AloopEffectDsp(vsize, fRec50, fZec44);
			/* Recursive function 65 */
			fun65AloopEffectDsp(fRec49_tmp, vsize, iZec43, iZec25, input13, fRec51, iZec8, fZec44, fZec31, fRec49);
			/* Recursive function 66 */
			fun66AloopEffectDsp(fRec48_tmp, vsize, iZec8, fRec49, iZec43, iZec32, input13, fRec48);
			/* Vectorizable function 67 */
			fun67AloopEffectDsp(vsize, input13, fRec48, fZec45);
			/* Recursive function 68 */
			fun68AloopEffectDsp(fRec47_tmp, vsize, iZec43, fZec45, fRec47);
			/* Recursive function 69 */
			fun69AloopEffectDsp(iRec46_tmp, vsize, input12, iRec46);
			/* Recursive function 70 */
			fun70AloopEffectDsp(iRec30_tmp, vsize, input8, iRec30);
			/* Recursive function 71 */
			fun71AloopEffectDsp(iRec38_tmp, vsize, input10, iRec38);
			/* Recursive function 72 */
			fun72AloopEffectDsp(fRec53_tmp, vsize, input14, fRec53, fYec1);
			/* Vectorizable function 73 */
			fun73AloopEffectDsp(vsize, input16, fYec0, iZec46);
			/* Recursive function 74 */
			fun74AloopEffectDsp(fRec60_tmp, vsize, iZec46, fRec60);
			/* Recursive function 75 */
			fun75AloopEffectDsp(fRec59_tmp, vsize, fRec60, fRec59, fZec29);
			/* Recursive function 76 */
			fun76AloopEffectDsp(fRec58_tmp, vsize, iZec0, fRec58);
			/* Vectorizable function 77 */
			fun77AloopEffectDsp(vsize, fRec58, fZec47);
			/* Recursive function 78 */
			fun78AloopEffectDsp(fRec57_tmp, vsize, iZec46, iZec25, input15, fRec59, iZec8, fZec47, fZec31, fRec57);
			/* Recursive function 79 */
			fun79AloopEffectDsp(fRec56_tmp, vsize, iZec8, fRec57, iZec46, iZec32, input15, fRec56);
			/* Vectorizable function 80 */
			fun80AloopEffectDsp(vsize, input15, fRec56, fZec48);
			/* Recursive function 81 */
			fun81AloopEffectDsp(fRec55_tmp, vsize, iZec46, fZec48, fRec55);
			/* Recursive function 82 */
			fun82AloopEffectDsp(fRec37_tmp, vsize, input10, fRec37, fYec3);
			/* Recursive function 83 */
			fun83AloopEffectDsp(iRec54_tmp, vsize, input14, iRec54);
			/* Recursive function 84 */
			fun84AloopEffectDsp(fRec21_tmp, vsize, input6, fRec21, fYec5);
			/* Recursive function 85 */
			fun85AloopEffectDsp(iRec22_tmp, vsize, input6, iRec22);
			/* Vectorizable function 86 */
			fun86AloopEffectDsp(vsize, input8, fYec4, iZec34);
			/* Recursive function 87 */
			fun87AloopEffectDsp(fRec26_tmp, vsize, iZec4, fRec26);
			/* Recursive function 88 */
			fun88AloopEffectDsp(fRec28_tmp, vsize, iZec34, fRec28);
			/* Recursive function 89 */
			fun89AloopEffectDsp(fRec27_tmp, vsize, fRec28, fRec27, fZec29);
			/* Vectorizable function 90 */
			fun90AloopEffectDsp(vsize, fRec26, fZec35);
			/* Recursive function 91 */
			fun91AloopEffectDsp(fRec25_tmp, vsize, iZec34, iZec25, input7, fRec27, iZec8, fZec35, fZec31, fRec25);
			/* Recursive function 92 */
			fun92AloopEffectDsp(fRec24_tmp, vsize, iZec8, fRec25, iZec34, iZec32, input7, fRec24);
			/* Vectorizable function 93 */
			fun93AloopEffectDsp(vsize, input7, fRec24, fZec36);
			/* Recursive function 94 */
			fun94AloopEffectDsp(fRec23_tmp, vsize, iZec34, fZec36, fRec23);
			/* Recursive function 95 */
			fun95AloopEffectDsp(fRec29_tmp, vsize, input8, fRec29, fYec4);
			/* Recursive function 96 */
			fun96AloopEffectDsp(fRec61_tmp, vsize, input16, fRec61, fYec0);
			/* Recursive function 97 */
			fun97AloopEffectDsp(iRec62_tmp, vsize, input16, iRec62);
			/* Vectorizable function 98 */
			fun98AloopEffectDsp(vsize, fRec3, fRec2, fYec6, input3, fZec30, fRec21, iRec22, fRec23, fZec35, fRec29, iRec30, fRec31, fZec38, fRec37, iRec38, fRec39, fZec41, fRec45, iRec46, fRec47, fZec44, fRec53, iRec54, fRec55, fZec47, fRec61, iRec62, fZec49);
			/* Vectorizable function 99 */
			fun99AloopEffectDsp(vsize, fZec9, fRec1, fZec49, output0);
			/* Vectorizable function 100 */
			fun100AloopEffectDsp(vsize, fRec0, fRec1, fZec49, output1);
		}
	}

};

#endif
