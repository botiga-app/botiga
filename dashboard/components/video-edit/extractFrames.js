// Pull N evenly-spaced frames out of a video URL via canvas. Used to feed
// the AI auto-tag flow. Returns an array of data: URL strings (JPEG, q=0.75).
// Resolves to [] on any error so the caller can fall back to a thumbnail.
//
// Shared between the grid page (/dashboard/videos) and the vertical
// scroll editor (/dashboard/videos/preview) — both should always run
// identical frame extraction so the AI sees the same input.
export async function extractFrames(videoSrc, count = 4) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';
    video.onerror = () => resolve([]);
    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext('2d');
      const frames = [];
      const times = Array.from({ length: count }, (_, i) => (video.duration / (count + 1)) * (i + 1));
      let idx = 0;
      function next() {
        if (idx >= times.length) { resolve(frames); return; }
        video.currentTime = times[idx];
      }
      video.onseeked = () => {
        try { ctx.drawImage(video, 0, 0, 512, 512); frames.push(canvas.toDataURL('image/jpeg', 0.75)); } catch (_) {}
        idx++; next();
      };
      next();
    };
    video.src = videoSrc;
  });
}
