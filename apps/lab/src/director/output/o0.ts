// O0, the baseline output: Playwright Chromium opens the stage with `record=webm`; the page records
// its composited stage canvas plus the WebAudio mix (captureStream + MediaRecorder, page/recorder.ts)
// and, on stop, posts the WebM to the director, which writes var/lab/runs/<runId>/run.webm.
import type { Stage } from "../stage/browser.js";
import type { OutputArmFactory } from "./types.js";

export const RECORD_FILE = "run.webm";
const UPLOAD_TIMEOUT_MS = 120_000;

export const createO0: OutputArmFactory = (ctx) => {
  let stage: Stage | undefined;
  return {
    id: "O0",
    async start({ pageUrl }) {
      const url = new URL(pageUrl);
      url.searchParams.set("record", "webm");
      stage = await ctx.launch(url.toString());
      ctx.onStage(stage);
    },
    async stop() {
      if (stage === undefined) throw new Error("O0.stop() before start().");
      const uploaded = ctx.server.awaitUpload(ctx.runId, RECORD_FILE);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`O0: the page did not upload ${RECORD_FILE} within ${UPLOAD_TIMEOUT_MS / 1000} s.`)), UPLOAD_TIMEOUT_MS);
      });
      try {
        // The page's stop hook (page/recorder.ts) ends the recorder and posts the blob.
        await stage.page.evaluate("window.__labStopRecording()");
        const file = await Promise.race([uploaded, timeout]);
        return { file };
      } finally {
        clearTimeout(timer);
        await stage.close();
        stage = undefined;
      }
    },
  };
};
