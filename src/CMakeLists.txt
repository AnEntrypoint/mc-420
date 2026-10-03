cmake_minimum_required(VERSION 3.16)
project(aloop CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
add_compile_options(-O3 -Wall)
add_compile_options(-mcpu=cortex-a72)

set(DSP_SOURCES
  dsp/audio_thread.cpp
  host/lv2_host.cpp
  link/link_bridge.cpp
  control/telemetry.cpp
  control/midi.cpp
  control/apc_grid.cpp
  control/apc_leds.cpp
  control/midi_clock.cpp
  control/remote_control.cpp
  storage/usb_recorder.cpp
  storage/clip_exporter.cpp
  main.cpp
)

if(NOT EXISTS ${CMAKE_BINARY_DIR}/loop_pre.cpp OR NOT EXISTS ${CMAKE_BINARY_DIR}/loop_post.cpp)
  find_program(FAUST_BIN faust)
  if(FAUST_BIN)
    add_custom_command(
      OUTPUT  ${CMAKE_BINARY_DIR}/loop_pre.cpp
      COMMAND ${FAUST_BIN} -lang cpp -cn AloopPreDsp -I ${CMAKE_SOURCE_DIR}/../dsp -I ${CMAKE_SOURCE_DIR}/../effects/home/faust ${CMAKE_SOURCE_DIR}/../dsp/aloop_pre.dsp -o ${CMAKE_BINARY_DIR}/loop_pre.cpp
      DEPENDS ${CMAKE_SOURCE_DIR}/../dsp/aloop_pre.dsp ${CMAKE_SOURCE_DIR}/../dsp/loop.dsp ${CMAKE_SOURCE_DIR}/../dsp/effects_runtime_pre.dsp
      COMMENT "Compiling the Faust home stack pre-delayverb half (dsp/aloop_pre.dsp) to C++")
    add_custom_command(
      OUTPUT  ${CMAKE_BINARY_DIR}/loop_post.cpp
      COMMAND ${FAUST_BIN} -lang cpp -cn AloopPostDsp -I ${CMAKE_SOURCE_DIR}/../dsp -I ${CMAKE_SOURCE_DIR}/../effects/home/faust ${CMAKE_SOURCE_DIR}/../dsp/aloop_post.dsp -o ${CMAKE_BINARY_DIR}/loop_post.cpp
      DEPENDS ${CMAKE_SOURCE_DIR}/../dsp/aloop_post.dsp ${CMAKE_SOURCE_DIR}/../dsp/effects_runtime_post.dsp
      COMMENT "Compiling the Faust home stack post-delayverb half (dsp/aloop_post.dsp) to C++")
    add_custom_target(faust_loop DEPENDS ${CMAKE_BINARY_DIR}/loop_pre.cpp ${CMAKE_BINARY_DIR}/loop_post.cpp)
  else()
    message(FATAL_ERROR "loop_pre.cpp/loop_post.cpp not pre-generated and faust not found — pre-generate them or install faust")
  endif()
else()
  add_custom_target(faust_loop)
endif()

find_package(PkgConfig REQUIRED)
pkg_check_modules(ALSA REQUIRED alsa)
pkg_check_modules(LILV lilv-0)

include(FetchContent)
FetchContent_Declare(abletonlink
  GIT_REPOSITORY https://github.com/Ableton/link.git
  GIT_TAG        Link-3.1.3
  GIT_SUBMODULES_RECURSE TRUE)
set(LINK_INCLUDE "")
FetchContent_GetProperties(abletonlink)
if(NOT abletonlink_POPULATED)
  FetchContent_Populate(abletonlink)
endif()
if(abletonlink_SOURCE_DIR)
  set(LINK_INCLUDE ${abletonlink_SOURCE_DIR}/include ${abletonlink_SOURCE_DIR}/modules/asio-standalone/asio/include)
endif()

add_executable(aloop ${DSP_SOURCES})
target_include_directories(aloop PRIVATE
  ${CMAKE_SOURCE_DIR}
  ${CMAKE_BINARY_DIR}
  ${CMAKE_SOURCE_DIR}/../effects/home/faust
  ${ALSA_INCLUDE_DIRS}
  ${LILV_INCLUDE_DIRS}
  ${LINK_INCLUDE}
)
if(LINK_INCLUDE)
  target_compile_definitions(aloop PRIVATE
    LINK_PLATFORM_LINUX=1
    ASIO_STANDALONE=1)
  target_compile_options(aloop PRIVATE -include ${CMAKE_SOURCE_DIR}/compat/musl_compat.h)
endif()
target_link_libraries(aloop PRIVATE ${ALSA_LIBRARIES} ${LILV_LIBRARIES} pthread dl z)
add_dependencies(aloop faust_loop)
