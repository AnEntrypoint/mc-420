'use strict';

function wrap(x, len) {
  if (!(len > 0)) return NaN;
  return ((x % len) + len) % len;
}

function centre(x, len) {
  return wrap(x + len / 2, len) - len / 2;
}

function originMinusArm(audioSamples, masterPhaseSamples, masterLenSamples, armSamples) {
  return centre(audioSamples - masterPhaseSamples - armSamples, masterLenSamples);
}

module.exports = { wrap, centre, originMinusArm };
