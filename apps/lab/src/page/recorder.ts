// O0's page half: the composited stage canvas + the stage audio -> MediaRecorder WebM. On stop the
// blob is posted to the director (POST /lab/upload/<runId>), which writes run.webm.

const TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
export const RECORD_FPS = 30;

export interface StageRecorder {
  /** Ends the recording and uploads it; resolves once the director has the file. */
  stopAndUpload(): Promise<void>;
}

export function startRecorder(canvas: HTMLCanvasElement, audio: MediaStream, runId: string): StageRecorder {
  const stream = canvas.captureStream(RECORD_FPS);
  for (const track of audio.getAudioTracks()) stream.addTrack(track);
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, { ...(mimeType === undefined ? {} : { mimeType }), videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(1000);
  return {
    async stopAndUpload() {
      if (recorder.state !== "inactive") {
        const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
        recorder.stop();
        await stopped;
      }
      const blob = new Blob(chunks, { type: mimeType ?? "video/webm" });
      const res = await fetch(`/lab/upload/${encodeURIComponent(runId)}`, { method: "POST", body: blob });
      if (!res.ok) throw new Error(`Uploading the recording answered HTTP ${res.status}.`);
    },
  };
}
