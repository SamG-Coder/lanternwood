// Decodes RTPack sprites off the main thread: init with the pack, then one sprite per request.
// the codec version comes in on this worker's own URL (?rt=...), so it always matches the page
const rt = new URLSearchParams(self.location.search).get("rt");
importScripts(rt ? `rtpack.js?v=${rt}` : "rtpack.js");
let pack = null;
onmessage = e => {
  const m = e.data;
  if (m.init) { pack = RTPack.openFile(new Uint8Array(m.init)); return; }
  try {
    const s = pack.sprite(m.file);
    postMessage({ id: m.id, w: s.w, h: s.h, strip: s.strip }, [s.strip.buffer]);
  } catch (err) { postMessage({ id: m.id, error: String(err) }); }
};
