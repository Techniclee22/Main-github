(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ReadToMeFollowPeek = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SCROLL_UNRELATED_SAD = 35;

  function scrollFraction(a, b) {
    if (!a?.length || !b?.length || a.length !== b.length) return 1;
    const h = a.length;
    let bestShift = 0;
    let bestSad = Infinity;
    const maxShift = Math.floor(h * 0.7);
    for (let shift = -maxShift; shift <= maxShift; shift += 1) {
      let sad = 0;
      let n = 0;
      for (let y = 0; y < h; y += 1) {
        const y2 = y - shift;
        if (y2 < 0 || y2 >= h) continue;
        sad += Math.abs(a[y2] - b[y]);
        n += 1;
      }
      if (n < h * 0.35) continue;
      const avg = sad / n;
      if (avg < bestSad) {
        bestSad = avg;
        bestShift = Math.abs(shift);
      }
    }
    let raw = 0;
    for (let i = 0; i < h; i += 1) raw += Math.abs(a[i] - b[i]);
    raw /= h;
    // A cursor blink can look like a large shift if the matcher slides the
    // changed rows out of the overlap. Low unshifted SAD means the page is still.
    if (raw <= 12) return 0;
    if (bestSad > SCROLL_UNRELATED_SAD && raw > SCROLL_UNRELATED_SAD) return 0;
    return bestShift / h;
  }

  return { scrollFraction, SCROLL_UNRELATED_SAD };
});
