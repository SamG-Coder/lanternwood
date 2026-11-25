// Decodes RTPack sprites off the main thread: init with the pack, then one sprite per request.
importScripts("rtpack.js");
let pack = null;
onmessage = e => {
  const m = e.data;
  if (m.init) { pack = RTPack.openFile(new Uint8Array(m.init)); return; }
  try {
    const s = pack.sprite(m.file);
    postMessage({ id: m.id, w: s.w, h: s.h, strip: s.strip }, [s.strip.buffer]);
  } catch (err) { postMessage({ id: m.id, error: String(err) }); }
};
