// <sr-avatar> (spec avatar-reach, design "Embed"): a character from a .srpack on any page. The
// standalone bundle /embed/sr-avatar.js is this file (entry.ts), so it imports only @sr/pack,
// @sr/avatar/core (no React) and @sr/rig: never React, never an apps/web module.
//
// Decisions the spec leaves open:
// - The class is built inside `defineSrAvatar`, so importing this module never touches
//   `HTMLElement` (safe in node and in tests that define it into their own registry).
// - Removing the element disposes everything (player, microphone, audio context, pending fetch);
//   putting it back loads again. A new `src` cancels the load in flight.
// - `mood`, `setLevel` and `attachAudio` set before the pack has loaded are kept and applied when
//   the player starts. Unknown moods and gestures are ignored.
// - Pack failures are the creator's import sentences (creator/library/packing.ts), restated here
//   because the bundle may not import app modules.
// - The shadow style has no colours of its own: it inherits the host page's text colour and font,
//   and the stage background is the `background` attribute (default transparent).
import { createAvatarPlayer, type AttachAudioOptions, type AvatarPlayer, type PlayerAudio } from "@sr/avatar/core";
import { decodePackImages, loadPack, type PackError, type PackErrorCode } from "@sr/pack";
import { isLookEmotion, isLookGesture, type Emotion, type Gesture } from "@sr/rig";

export const SR_AVATAR_TAG = "sr-avatar";

export const LOADING = "Loading character...";
export const NO_SOURCE = "No pack: set the src attribute.";
export const UNDECODABLE = "That pack's images could not be read.";
export const MIC_REFUSED = "The microphone was not allowed.";
export const MIC_UNAVAILABLE = "This browser cannot listen to a microphone here.";
export const LISTEN = "Click to listen";

const SENTENCES: Readonly<Record<PackErrorCode, (detail: string) => string>> = {
  not_a_pack: () => "That file is not a Shadowrunner pack.",
  newer_version: () => "That pack was made by a newer Shadowrunner.",
  bad_manifest: () => "That pack's details are damaged.",
  bad_rig: () => "That pack's character is damaged.",
  bad_look: () => "That pack's saved look is damaged.",
  missing_file: (detail) => `That pack is missing ${detail === "" ? "an image" : detail}.`,
  too_large: () => "That pack is over 50 MB.",
  fetch_failed: () => "That pack could not be fetched.",
};

/** The sentence a failed pack load shows (and `sr-error` carries). */
export function packErrorSentence(error: PackError): string {
  return SENTENCES[error.code](error.detail);
}

/** The element's JS API, on top of HTMLElement. */
export interface SrAvatarElement extends HTMLElement {
  /** Sets the `mood` attribute; an unknown emotion is ignored. */
  setMood(emotion: Emotion): void;
  gesture(gesture: Gesture): void;
  /** 0..1 wins over the audio; `undefined` returns to the audio (or 0). */
  setLevel(level: number | undefined): void;
  /** `undefined` detaches. */
  attachAudio(source: PlayerAudio | undefined, options?: AttachAudioOptions): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "sr-avatar": SrAvatarElement;
  }
}

const STYLE = `
:host { display: inline-block; position: relative; inline-size: 300px; block-size: 300px; contain: content; }
:host([hidden]) { display: none; }
.stage { position: absolute; inset: 0; background: transparent; }
canvas { display: block; inline-size: 100%; block-size: 100%; }
.status { position: absolute; inset: auto 0 0; margin: 0; padding: 0.5em; font: inherit; font-size: 0.875em; text-align: center; }
.status:empty { display: none; }
.listen { position: absolute; inset-block-start: 0.5em; inset-inline-start: 50%; transform: translateX(-50%); font: inherit; font-size: 0.875em; cursor: pointer; }
`;

type Phase = "idle" | "loading" | "ready" | "failed";

function elementClass(): CustomElementConstructor {
  return class SrAvatar extends HTMLElement implements SrAvatarElement {
    static observedAttributes = ["src", "mood", "mic", "background"];

    readonly #stage: HTMLDivElement;
    readonly #canvas: HTMLCanvasElement;
    readonly #status: HTMLParagraphElement;
    readonly #listen: HTMLButtonElement;
    #phase: Phase = "idle";
    #player: AvatarPlayer | undefined;
    #abort: AbortController | undefined;
    #level: number | undefined;
    #audio: { source: PlayerAudio; options?: AttachAudioOptions } | undefined;
    #mic: { stream: MediaStream; context: AudioContext } | undefined;
    #motion: MutationObserver | undefined;

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      const doc = this.ownerDocument;
      const style = doc.createElement("style");
      style.textContent = STYLE;
      this.#stage = doc.createElement("div");
      this.#stage.className = "stage";
      this.#stage.setAttribute("part", "stage");
      this.#canvas = doc.createElement("canvas");
      this.#stage.append(this.#canvas);
      this.#status = doc.createElement("p");
      this.#status.className = "status";
      this.#status.setAttribute("part", "status");
      this.#status.setAttribute("role", "status");
      this.#listen = doc.createElement("button");
      this.#listen.type = "button";
      this.#listen.className = "listen";
      this.#listen.setAttribute("part", "listen");
      this.#listen.textContent = LISTEN;
      this.#listen.hidden = true;
      this.#listen.addEventListener("click", () => void this.#startMic());
      root.append(style, this.#stage, this.#status, this.#listen);
    }

    connectedCallback(): void {
      this.#paintBackground();
      void this.#load();
    }

    disconnectedCallback(): void {
      this.#teardown();
      this.#phase = "idle";
    }

    attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
      if (previous === next) return;
      if (name === "background") this.#paintBackground();
      else if (name === "mood") this.#applyMood();
      else if (name === "mic") this.#syncMic();
      else if (name === "src" && this.isConnected) {
        this.#teardown();
        void this.#load();
      }
    }

    setMood(emotion: Emotion): void {
      if (isLookEmotion(emotion)) this.setAttribute("mood", emotion);
    }

    gesture(gesture: Gesture): void {
      if (isLookGesture(gesture)) this.#player?.gesture(gesture);
    }

    setLevel(level: number | undefined): void {
      this.#level = level;
      this.#player?.setLevel(level);
    }

    attachAudio(source: PlayerAudio | undefined, options?: AttachAudioOptions): void {
      this.#stopMic();
      this.#audio = source === undefined ? undefined : { source, ...(options === undefined ? {} : { options }) };
      this.#player?.attachAudio(source, options);
    }

    #say(text: string): void {
      this.#status.textContent = text;
    }

    #paintBackground(): void {
      const value = this.getAttribute("background");
      this.#stage.style.background = value === null || value.trim() === "" ? "transparent" : value;
    }

    #mood(): Emotion | undefined {
      const mood = this.getAttribute("mood");
      return isLookEmotion(mood) ? mood : undefined;
    }

    #applyMood(): void {
      const mood = this.#mood();
      if (mood !== undefined) this.#player?.setEmotion(mood);
    }

    async #load(): Promise<void> {
      const src = this.getAttribute("src");
      if (src === null || src.trim() === "") {
        this.#phase = "idle";
        this.#say(NO_SOURCE);
        return;
      }
      const abort = new AbortController();
      this.#abort = abort;
      this.#phase = "loading";
      this.#say(LOADING);
      let url: URL;
      try {
        url = new URL(src, this.ownerDocument.baseURI);
      } catch {
        return this.#fail(packErrorSentence({ code: "fetch_failed", detail: src }));
      }
      const result = await loadPack(url, { signal: abort.signal });
      if (abort.signal.aborted) return;
      if (!result.ok) return this.#fail(packErrorSentence(result.error));
      let assets: Awaited<ReturnType<typeof decodePackImages>>;
      try {
        assets = await decodePackImages(result.pack.files);
      } catch {
        if (!abort.signal.aborted) this.#fail(UNDECODABLE);
        return;
      }
      if (abort.signal.aborted) return;
      this.#abort = undefined;
      this.#followMotion();
      const mood = this.#mood();
      const { rig, look } = result.pack;
      const player = createAvatarPlayer(this.#canvas, { rig, look: mood === undefined ? look : { ...look, emotion: mood }, assets, backdrop: this.hasAttribute("backdrop") });
      this.#player = player;
      if (this.#audio !== undefined) player.attachAudio(this.#audio.source, this.#audio.options);
      if (this.#level !== undefined) player.setLevel(this.#level);
      player.start();
      this.#phase = "ready";
      this.#say("");
      this.#syncMic();
      this.dispatchEvent(new CustomEvent("sr-ready", { bubbles: true, composed: true }));
    }

    #fail(sentence: string): void {
      this.#abort = undefined;
      this.#phase = "failed";
      this.#say(sentence);
      this.dispatchEvent(new CustomEvent<string>("sr-error", { detail: sentence, bubbles: true, composed: true }));
    }

    /** The listen button shows while `mic` is set, the player runs and the microphone is off. */
    #syncMic(): void {
      const wanted = this.hasAttribute("mic");
      if (!wanted) this.#stopMic();
      this.#listen.hidden = !wanted || this.#phase !== "ready" || this.#mic !== undefined;
    }

    async #startMic(): Promise<void> {
      const media = this.ownerDocument.defaultView?.navigator.mediaDevices;
      const Context = this.ownerDocument.defaultView?.AudioContext;
      if (media?.getUserMedia === undefined || Context === undefined) return this.#say(MIC_UNAVAILABLE);
      // The context is made on the click, so the browser lets it run.
      const context = new Context();
      let stream: MediaStream;
      try {
        stream = await media.getUserMedia({ audio: true });
      } catch (error) {
        void context.close();
        return this.#say(error instanceof DOMException && error.name === "NotAllowedError" ? MIC_REFUSED : MIC_UNAVAILABLE);
      }
      if (this.#player === undefined || !this.hasAttribute("mic")) {
        for (const track of stream.getTracks()) track.stop();
        void context.close();
        return;
      }
      this.#audio = undefined;
      this.#player.attachAudio(stream, { context });
      this.#mic = { stream, context };
      this.#say("");
      this.#syncMic();
    }

    #stopMic(): void {
      const mic = this.#mic;
      if (mic === undefined) return;
      this.#mic = undefined;
      this.#player?.attachAudio(undefined);
      for (const track of mic.stream.getTracks()) track.stop();
      void mic.context.close();
    }

    /**
     * The player reads `data-motion` from the canvas's ancestors, which stop at the shadow root:
     * mirror the host page's nearest `data-motion` (the shell's) onto the stage and follow it.
     */
    #followMotion(): void {
      const source = this.closest("[data-motion]");
      const copy = (): void => {
        const motion = source?.getAttribute("data-motion");
        if (motion === null || motion === undefined) this.#stage.removeAttribute("data-motion");
        else this.#stage.setAttribute("data-motion", motion);
      };
      copy();
      const Observer = this.ownerDocument.defaultView?.MutationObserver;
      if (source === null || Observer === undefined) return;
      this.#motion = new Observer(copy);
      this.#motion.observe(source, { attributes: true, attributeFilter: ["data-motion"] });
    }

    #teardown(): void {
      this.#motion?.disconnect();
      this.#motion = undefined;
      this.#abort?.abort();
      this.#abort = undefined;
      this.#stopMic();
      this.#player?.dispose();
      this.#player = undefined;
      this.#listen.hidden = true;
    }
  };
}

/** Registers `<sr-avatar>` in `registry` (once; a second call is a no-op). */
export function defineSrAvatar(registry: CustomElementRegistry = customElements): void {
  if (registry.get(SR_AVATAR_TAG) !== undefined) return;
  registry.define(SR_AVATAR_TAG, elementClass());
}
