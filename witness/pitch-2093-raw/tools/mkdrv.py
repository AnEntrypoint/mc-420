import sys
name = sys.argv[1]
pre = '''#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#define FAUSTFLOAT float
typedef struct { void* metaInterface; void (*declare)(void*, const char*, const char*); } MetaGlue;
typedef struct { void* uiInterface; void (*openTabBox)(void*, const char*); void (*openHorizontalBox)(void*, const char*); void (*openVerticalBox)(void*, const char*); void (*closeBox)(void*); void (*addButton)(void*, const char*, float*); void (*addCheckButton)(void*, const char*, float*); void (*addVerticalSlider)(void*, const char*, float*, float, float, float, float); void (*addHorizontalSlider)(void*, const char*, float*, float, float, float, float); void (*addNumEntry)(void*, const char*, float*, float, float, float, float); void (*addHorizontalBargraph)(void*, const char*, float*, float, float); void (*addVerticalBargraph)(void*, const char*, float*, float, float); void (*addSoundfile)(void*, const char*, const char*, void*); void (*declare)(void*, float*, const char*, const char*); } UIGlue;
'''
S = '/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/pt'
open(f'{S}/out/drv_{name}.c', 'w').write(pre + f'#include "{S}/var/{name}.c"\n' + open(f'{S}/main.inc').read())
print('ok', name)
