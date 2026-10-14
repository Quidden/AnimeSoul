import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Buffer } from "node:buffer";
import { setImmediate } from "node:timers/promises";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/anime4k-renderer.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { Anime4KRenderer } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(
  t,
  {
    videoFrameCallback = true,
    playbackQuality = true,
    paused = false,
    profile = "light",
    width = 1280,
    height = 720,
  } = {},
) {
  const globals = new Map();
  const replace = (name, value) => {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const state = {
    submissions: 0,
    copies: [],
    work: [],
    errors: [],
    firstFrames: 0,
    deviceDestroyed: 0,
    textureDestroyed: 0,
    unconfigured: 0,
    canceledFrames: [],
    canceledRafs: [],
    copyError: null,
    copyTimes: [],
    models: [],
    modelPasses: 0,
  };
  const frames = new Map();
  const rafs = new Map();
  let nextCallback = 1;
  const video = Object.assign(new globalThis.EventTarget(), {
    paused,
    ended: false,
    readyState: 4,
    videoWidth: 640,
    videoHeight: 360,
    currentTime: 0,
  });
  const quality = { totalVideoFrames: 1, droppedVideoFrames: 0 };
  if (playbackQuality) video.getVideoPlaybackQuality = () => ({ ...quality });
  if (videoFrameCallback) {
    video.requestVideoFrameCallback = (callback) => {
      const id = nextCallback++;
      frames.set(id, callback);
      return id;
    };
    video.cancelVideoFrameCallback = (id) => {
      state.canceledFrames.push(id);
      frames.delete(id);
    };
  }
  const document = Object.assign(new globalThis.EventTarget(), { hidden: false });
  const lost = deferred();
  const texture = {
    width: 640,
    height: 360,
    createView: () => ({}),
    destroy: () => state.textureDestroyed++,
  };
  const queue = {
    copyExternalImageToTexture: ({ source }) => {
      if (state.copyError && source === video) throw state.copyError;
      state.copies.push(source);
      state.copyTimes.push(video.currentTime);
    },
    submit: () => state.submissions++,
    onSubmittedWorkDone: () => {
      const work = deferred();
      state.work.push(work);
      return work.promise;
    },
  };
  const device = Object.assign(new globalThis.EventTarget(), {
    queue,
    lost: lost.promise,
    createTexture: () => texture,
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createBindGroup: () => ({}),
    createSampler: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline() {},
        setBindGroup() {},
        draw() {},
        end() {},
      }),
      finish: () => ({}),
    }),
    destroy: () => state.deviceDestroyed++,
  });
  const context = {
    configure() {},
    unconfigure: () => state.unconfigured++,
    getCurrentTexture: () => texture,
  };
  const canvas = { dataset: {}, getContext: () => context };
  class Preset {
    pass() {
      state.modelPasses++;
    }
    getOutputTexture() {
      return texture;
    }
  }
  class LightPreset extends Preset {
    constructor(options) {
      super();
      state.models.push({ profile: "light", options });
    }
  }
  class AdvancedPreset extends Preset {
    constructor(options) {
      super();
      state.models.push({ profile: "advanced", options });
    }
  }
  replace("navigator", {
    gpu: {
      requestAdapter: async () => ({ requestDevice: async () => device }),
      getPreferredCanvasFormat: () => "bgra8unorm",
    },
  });
  replace("document", document);
  replace("GPUTextureUsage", { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
  replace("GPUShaderStage", { FRAGMENT: 1 });
  replace("requestAnimationFrame", (callback) => {
    const id = nextCallback++;
    rafs.set(id, callback);
    return id;
  });
  replace("cancelAnimationFrame", (id) => {
    state.canceledRafs.push(id);
    rafs.delete(id);
  });
  replace("createImageBitmap", async () => ({ close() {} }));
  let renderer;
  t.after(() => {
    renderer?.dispose();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const invokeNext = (callbacks, mediaTime = video.currentTime) => {
    assert.equal(callbacks.size, 1, "one callback must remain subscribed");
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    callback(0, { mediaTime, presentedFrames: quality.totalVideoFrames });
  };
  return {
    state,
    video,
    quality,
    document,
    device,
    lost,
    frames,
    rafs,
    create: async () => {
      renderer = await Anime4KRenderer.create({
        signal: new globalThis.AbortController().signal,
        video,
        canvas,
        width,
        height,
        profile,
        anime4k: { CNNx2M: LightPreset, ModeC: AdvancedPreset },
        onError: (error) => state.errors.push(error),
        onFrame: () => state.firstFrames++,
      });
      await setImmediate();
      return renderer;
    },
    fireFrame: () => {
      video.currentTime += 1 / 24;
      quality.totalVideoFrames++;
      invokeNext(frames);
    },
    fireFrameAt: (mediaTime) => invokeNext(frames, mediaTime),
    fireRaf: () => invokeNext(rafs),
    completeWork: async () => {
      state.work.forEach((work) => work.resolve());
      await setImmediate();
    },
  };
}

test("slow GPU work keeps video callbacks subscribed and bounds queued frames", async (t) => {
  const env = setup(t);
  await env.create();
  assert.equal(env.state.submissions, 1);
  assert.equal(env.frames.size, 1, "initial GPU work must not delay video subscription");

  env.fireFrame();
  await setImmediate();
  assert.equal(
    env.state.submissions,
    2,
    "the next decoded frame can be submitted before completion",
  );
  for (let frame = 0; frame < 8; frame++) {
    env.fireFrame();
    await setImmediate();
  }
  assert.equal(env.state.submissions, 2, "slow GPU work must not accumulate a stale frame backlog");
  assert.equal(env.frames.size, 1);

  await env.completeWork();
  env.fireFrame();
  await setImmediate();
  assert.equal(
    env.state.submissions,
    3,
    "rendering resumes with a fresh frame when GPU capacity returns",
  );
  await env.completeWork();
  assert.equal(env.state.firstFrames, 1);
  assert.deepEqual(env.state.errors, []);
});

test("video callbacks use decoded media time when aggregate frame counters are stale", async (t) => {
  const env = setup(t);
  await env.create();
  await env.completeWork();
  env.fireFrameAt(1 / 24);
  await setImmediate();
  assert.equal(env.state.submissions, 2);
  await env.completeWork();
  env.fireFrameAt(2 / 24);
  await setImmediate();
  assert.equal(
    env.state.submissions,
    3,
    "distinct callback media times identify fresh decoded frames",
  );
  await env.completeWork();
  env.fireFrameAt(2 / 24);
  await setImmediate();
  assert.equal(env.state.submissions, 3, "repeated callback media time must not render twice");
  assert.equal(env.quality.totalVideoFrames, 1);
  assert.equal(env.video.currentTime, 0);
  assert.equal(env.frames.size, 1);
});

for (const profile of ["light", "advanced"]) {
  test(`${profile} profile runs its selected Anime4K model`, async (t) => {
    const env = setup(t, { profile });
    await env.create();
    assert.deepEqual(
      env.state.models.map((model) => model.profile),
      [profile],
    );
    assert.equal(env.state.modelPasses, 1);
    assert.equal(env.state.submissions, 1);
    if (profile === "advanced") {
      assert.deepEqual(env.state.models[0].options.targetDimensions, { width: 1280, height: 720 });
    }
  });
}

test("light profile presents a source already at target size without extra upscaling", async (t) => {
  const env = setup(t, { width: 640, height: 360 });
  await env.create();
  assert.deepEqual(env.state.models, []);
  assert.equal(env.state.modelPasses, 0);
  assert.equal(env.state.submissions, 1);
  await env.completeWork();
  assert.equal(env.state.firstFrames, 1);
});

test("seeking while GPU capacity is full redraws the latest paused frame when capacity returns", async (t) => {
  const env = setup(t);
  await env.create();
  env.fireFrame();
  await setImmediate();
  env.video.paused = true;
  env.video.dispatchEvent(new globalThis.Event("pause"));
  env.video.currentTime = 5;
  env.video.dispatchEvent(new globalThis.Event("seeked"));
  env.video.currentTime = 9;
  env.video.dispatchEvent(new globalThis.Event("seeked"));
  await setImmediate();
  assert.equal(env.state.submissions, 2);
  assert.equal(env.frames.size, 0);

  env.state.work[0].resolve();
  await setImmediate();
  assert.equal(env.state.submissions, 3);
  assert.equal(env.state.copyTimes.at(-1), 9);
  await env.completeWork();
  assert.equal(env.state.submissions, 3, "multiple seeks coalesce into the latest still frame");
  assert.equal(env.frames.size, 0);
});

test("GPU completion failures stop playback callbacks and report one error", async (t) => {
  const env = setup(t);
  await env.create();
  env.fireFrame();
  await setImmediate();
  const failure = new Error("GPU queue failed");
  env.state.work.forEach((work) => work.reject(failure));
  await setImmediate();
  assert.equal(env.frames.size, 0);
  assert.equal(env.state.errors.length, 1);
  env.video.dispatchEvent(new globalThis.Event("play"));
  await setImmediate();
  assert.equal(env.frames.size, 0, "a failed renderer must not restart on play");
  assert.equal(env.state.submissions, 2);
});

for (const kind of ["uncapturederror", "device lost"]) {
  test(`${kind} stops frame callbacks`, async (t) => {
    const env = setup(t);
    await env.create();
    if (kind === "device lost") env.lost.resolve({ reason: "unknown" });
    else env.device.dispatchEvent(new globalThis.Event(kind));
    await setImmediate();
    assert.equal(env.frames.size, 0);
    assert.equal(env.state.errors.length, 1);
    await env.completeWork();
    assert.equal(env.frames.size, 0);
  });
}

test("dispose cancels callbacks, releases resources once and ignores late GPU failures", async (t) => {
  const env = setup(t);
  const renderer = await env.create();
  renderer.dispose();
  renderer.dispose();
  assert.equal(env.frames.size, 0);
  assert.equal(env.state.canceledFrames.length, 1);
  assert.equal(env.state.unconfigured, 1);
  assert.equal(env.state.textureDestroyed, 1);
  assert.equal(env.state.deviceDestroyed, 1);
  env.state.work.forEach((work) => work.reject(new Error("late failure")));
  env.lost.resolve({ reason: "destroyed" });
  env.video.dispatchEvent(new globalThis.Event("play"));
  env.device.dispatchEvent(new globalThis.Event("uncapturederror"));
  await setImmediate();
  assert.deepEqual(env.state.errors, []);
  assert.equal(env.state.submissions, 1);
  assert.equal(env.frames.size, 0);
});

test("video import failures cancel the next callback instead of restarting the render loop", async (t) => {
  const env = setup(t);
  const failure = new Error("video texture import failed");
  env.state.copyError = failure;
  await env.create();
  assert.equal(env.state.submissions, 0);
  assert.equal(env.frames.size, 0);
  assert.deepEqual(env.state.errors, [failure]);
});

test("bitmap fallback keeps callbacks subscribed and closes a late bitmap after disposal", async (t) => {
  const env = setup(t);
  const bitmapReady = deferred();
  let closed = 0;
  globalThis.createImageBitmap = () => bitmapReady.promise;
  env.state.copyError = new TypeError("video imports are unsupported");
  const renderer = await env.create();
  assert.equal(env.state.submissions, 0);
  assert.equal(env.frames.size, 1, "asynchronous bitmap creation must not delay the subscription");
  env.fireFrame();
  await setImmediate();
  assert.equal(env.frames.size, 1);
  renderer.dispose();
  bitmapReady.resolve({ close: () => closed++ });
  await setImmediate();
  assert.equal(closed, 1);
  assert.equal(env.state.submissions, 0);
  assert.deepEqual(env.state.errors, []);
});

test("seeking during bitmap capture discards the old capture and renders the latest paused frame", async (t) => {
  const env = setup(t, { paused: true });
  const captures = [];
  globalThis.createImageBitmap = () => {
    const capture = { ...deferred(), time: env.video.currentTime, closes: 0 };
    capture.bitmap = { close: () => capture.closes++ };
    captures.push(capture);
    return capture.promise;
  };
  env.state.copyError = new TypeError("video imports are unsupported");
  const renderer = await env.create();
  assert.equal(captures.length, 1);
  assert.equal(captures[0].time, 0);
  env.video.currentTime = 7;
  env.video.dispatchEvent(new globalThis.Event("seeked"));
  env.video.currentTime = 9;
  env.video.dispatchEvent(new globalThis.Event("seeked"));
  assert.equal(captures.length, 1, "seek must wait for the current capture to release");

  captures[0].resolve(captures[0].bitmap);
  await setImmediate();
  assert.equal(captures[0].closes, 1);
  assert.equal(env.state.submissions, 0, "the pre-seek bitmap must never be presented");
  assert.equal(captures.length, 2);
  assert.equal(captures[1].time, 9);
  captures[1].resolve(captures[1].bitmap);
  await setImmediate();
  assert.equal(env.state.submissions, 1);
  assert.deepEqual(env.state.copies, [captures[1].bitmap]);
  assert.deepEqual(env.state.copyTimes, [9]);
  await env.completeWork();
  renderer.dispose();
  assert.deepEqual(
    captures.map((capture) => capture.closes),
    [1, 1],
  );
  assert.equal(env.frames.size, 0);
  assert.deepEqual(env.state.errors, []);
});

test("RAF fallback draws each decoded frame once and redraws pause and seek explicitly", async (t) => {
  const env = setup(t, { videoFrameCallback: false });
  await env.create();
  await env.completeWork();
  for (let tick = 0; tick < 4; tick++) {
    env.video.currentTime += 1 / 120;
    env.fireRaf();
    await setImmediate();
  }
  assert.equal(
    env.state.submissions,
    1,
    "clock movement alone does not indicate a newly decoded frame",
  );

  env.quality.totalVideoFrames++;
  env.fireRaf();
  await setImmediate();
  assert.equal(env.state.submissions, 2);
  await env.completeWork();
  env.quality.totalVideoFrames++;
  env.quality.droppedVideoFrames++;
  env.fireRaf();
  await setImmediate();
  assert.equal(env.state.submissions, 2, "dropped frames do not require another render");

  env.video.paused = true;
  env.video.dispatchEvent(new globalThis.Event("pause"));
  await setImmediate();
  assert.equal(env.state.submissions, 3);
  await env.completeWork();
  env.video.dispatchEvent(new globalThis.Event("seeked"));
  await setImmediate();
  assert.equal(
    env.state.submissions,
    4,
    "seek redraws even when decoded frame counters are unchanged",
  );
});

test("RAF fallback uses media time when playback quality is unavailable and cancels on dispose", async (t) => {
  const env = setup(t, { videoFrameCallback: false, playbackQuality: false });
  const renderer = await env.create();
  await env.completeWork();
  env.fireRaf();
  await setImmediate();
  assert.equal(env.state.submissions, 1);
  env.video.currentTime += 1 / 24;
  env.fireRaf();
  await setImmediate();
  assert.equal(env.state.submissions, 2);
  renderer.dispose();
  assert.equal(env.rafs.size, 0);
  assert.equal(env.state.canceledRafs.length, 1);
});
