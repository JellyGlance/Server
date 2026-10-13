// Background timers for the API.
//
// Every repeating timer is registered here so it can be stopped on shutdown, and
// is unref'd so it never keeps the process alive on its own. In the server the
// HTTP listener keeps the process running; in tests and scripts it means the
// process exits as soon as the work is done.
const handles = new Set();

function track(handle) {
  if (handle && typeof handle.unref === "function") handle.unref();
  if (handle) handles.add(handle);
  return handle;
}

function every(fn, ms) {
  return track(setInterval(fn, ms));
}

function after(fn, ms) {
  const handle = setTimeout(() => {
    handles.delete(handle);
    fn();
  }, ms);
  return track(handle);
}

function clear(handle) {
  if (!handle) return;
  clearInterval(handle);
  handles.delete(handle);
}

function stopAll() {
  for (const handle of handles) clearInterval(handle);
  handles.clear();
}

function activeCount() {
  return handles.size;
}

module.exports = { track, every, after, clear, stopAll, activeCount };
