function meanLuma(bgra) {
  let sum = 0;
  const pixels = Math.max(1, bgra.length / 4);
  for (let i = 0; i < bgra.length; i += 4) {
    sum += 0.114 * bgra[i] + 0.587 * bgra[i + 1] + 0.299 * bgra[i + 2];
  }
  return sum / pixels;
}

function shouldInvertBgra(bgra) {
  return meanLuma(bgra) < 110;
}

function invertBgra(bgra) {
  const out = Buffer.from(bgra);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - out[i];
    out[i + 1] = 255 - out[i + 1];
    out[i + 2] = 255 - out[i + 2];
  }
  return out;
}

module.exports = { meanLuma, shouldInvertBgra, invertBgra };
