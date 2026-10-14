/// <reference types="@webgpu/types" />

type Pipeline = {
  pass(encoder: GPUCommandEncoder): void;
  getOutputTexture(): GPUTexture;
};

type Anime4KModule = {
  CNNx2M: new (options: { device: GPUDevice; inputTexture: GPUTexture }) => Pipeline;
  ModeC: new (options: {
    device: GPUDevice;
    inputTexture: GPUTexture;
    nativeDimensions: { width: number; height: number };
    targetDimensions: { width: number; height: number };
  }) => Pipeline;
};

const outputShader = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var result: VertexOutput;
  result.position = vec4f(positions[index], 0.0, 1.0);
  result.uv = uvs[index];
  return result;
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(sourceTexture, sourceSampler, input.uv);
}
`;

type RendererOptions = {
  signal: AbortSignal;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  profile: "light" | "advanced";
  anime4k: Anime4KModule;
  onError: (error: unknown) => void;
  onFrame: () => void;
};

export class Anime4KRenderer {
  private frame = 0;
  private raf = 0;
  private disposed = false;
  private failed = false;
  private pendingFrames = 0;
  private lastVideoFrame: string | undefined;
  private redrawRequested = false;
  private generation = 0;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly inputTexture: GPUTexture;
  private readonly pipelines: Pipeline[];
  private readonly renderPipeline: GPURenderPipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly video: HTMLVideoElement;
  private readonly onError: (error: unknown) => void;
  private drawing = false;
  private readonly onFrame: () => void;
  private framed = false;
  private bitmapFallback = false;
  private readonly canvas: HTMLCanvasElement;

  private constructor(options: {
    video: HTMLVideoElement;
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    inputTexture: GPUTexture;
    pipelines: Pipeline[];
    renderPipeline: GPURenderPipeline;
    bindGroup: GPUBindGroup;
    onError: (error: unknown) => void;
    onFrame: () => void;
  }) {
    this.video = options.video;
    this.canvas = options.canvas;
    this.canvas.dataset.renderedFrames = "0";
    this.device = options.device;
    this.context = options.context;
    this.inputTexture = options.inputTexture;
    this.pipelines = options.pipelines;
    this.renderPipeline = options.renderPipeline;
    this.bindGroup = options.bindGroup;
    this.onError = options.onError;
    this.onFrame = options.onFrame;
    this.video.addEventListener("play", this.wake);
    this.video.addEventListener("pause", this.wake);
    this.video.addEventListener("seeked", this.wake);
    this.video.addEventListener("ended", this.stop);
    document.addEventListener("visibilitychange", this.visibility);
    void this.device.lost.then(() => {
      this.fail(new Error("WebGPU device lost"));
    });
    this.device.addEventListener("uncapturederror", this.gpuError);
  }

  static async create(options: RendererOptions) {
    const adapter = await navigator.gpu?.requestAdapter();
    options.signal.throwIfAborted();
    if (!adapter) throw new Error("WebGPU-адаптер не найден");
    const device = await adapter.requestDevice();
    try {
      options.signal.throwIfAborted();
      const context = options.canvas.getContext("webgpu");
      if (!context) throw new Error("WebGPU canvas недоступен");
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });
      const inputTexture = device.createTexture({
        size: [options.video.videoWidth, options.video.videoHeight, 1],
        format: "rgba16float",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      // Mode A includes expensive restoration and VL models. Keep the light
      // profile to one medium x2 model; the output pass fits the chosen target.
      // A source already at the target size needs no extra x2 processing.
      const pipelines =
        options.profile === "advanced"
          ? [
              new options.anime4k.ModeC({
                device,
                inputTexture,
                nativeDimensions: {
                  width: options.video.videoWidth,
                  height: options.video.videoHeight,
                },
                targetDimensions: { width: options.width, height: options.height },
              }),
            ]
          : options.width > options.video.videoWidth || options.height > options.video.videoHeight
            ? [new options.anime4k.CNNx2M({ device, inputTexture })]
            : [];
      const shader = device.createShaderModule({ code: outputShader });
      const layout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        ],
      });
      const renderPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module: shader, entryPoint: "vertexMain" },
        fragment: { module: shader, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      const bindGroup = device.createBindGroup({
        layout,
        entries: [
          {
            binding: 0,
            resource: (pipelines.at(-1)?.getOutputTexture() ?? inputTexture).createView(),
          },
          {
            binding: 1,
            resource: device.createSampler({ magFilter: "linear", minFilter: "linear" }),
          },
        ],
      });
      const renderer = new Anime4KRenderer({
        ...options,
        device,
        context,
        inputTexture,
        pipelines,
        renderPipeline,
        bindGroup,
      });
      renderer.start();
      return renderer;
    } catch (error) {
      device.destroy();
      throw error;
    }
  }
  private readonly fail = (error: unknown) => {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.stop();
    this.onError(error);
  };

  private readonly gpuError = () => {
    this.fail(new Error("WebGPU render failed"));
  };
  private readonly visibility = () => {
    if (document.hidden) this.stop();
    else this.wake();
  };

  private start() {
    queueMicrotask(() => {
      if (!this.disposed && !this.failed) this.wake();
    });
  }

  private readonly wake = () => {
    this.stop();
    this.generation++;
    this.redrawRequested = true;
    this.schedule();
    void this.draw();
  };

  private readonly stop = () => {
    if (this.frame && this.video.cancelVideoFrameCallback)
      this.video.cancelVideoFrameCallback(this.frame);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.frame = 0;
    this.raf = 0;
  };

  private readonly schedule = () => {
    if (
      this.disposed ||
      this.failed ||
      document.hidden ||
      this.video.paused ||
      this.video.ended ||
      this.frame ||
      this.raf
    )
      return;
    if (this.video.requestVideoFrameCallback) {
      this.frame = this.video.requestVideoFrameCallback((_now, metadata) => {
        this.frame = 0;
        // Subscribe before drawing: GPU completion must not delay the next
        // decoded frame callback and turn a 60 fps source into 30 fps output.
        this.schedule();
        void this.draw(`time:${metadata.mediaTime}`);
      });
    } else {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.schedule();
        void this.draw();
      });
    }
  };

  private readonly draw = async (videoFrame?: string) => {
    if (
      this.disposed ||
      this.failed ||
      this.drawing ||
      document.hidden ||
      this.video.readyState < 2 ||
      this.pendingFrames >= 2
    )
      return;
    const quality = videoFrame ? undefined : this.video.getVideoPlaybackQuality?.();
    const presented = quality ? quality.totalVideoFrames - quality.droppedVideoFrames : 0;
    const frameKey =
      videoFrame ?? (presented > 0 ? `frame:${presented}` : `time:${this.video.currentTime}`);
    // The RAF fallback follows the display refresh rate, which can be much
    // higher than the video's frame rate. Process each decoded frame once.
    if (!this.redrawRequested && frameKey === this.lastVideoFrame) return;
    const generation = this.generation;
    this.redrawRequested = false;
    this.drawing = true;
    let bitmap: ImageBitmap | undefined;
    try {
      if (
        this.video.videoWidth !== this.inputTexture.width ||
        this.video.videoHeight !== this.inputTexture.height
      )
        return;
      // Import decoded frames directly when supported, avoiding a CPU bitmap
      // copy on every frame. Older browsers retain the ImageBitmap path.
      if (!this.bitmapFallback) {
        try {
          this.device.queue.copyExternalImageToTexture(
            { source: this.video },
            { texture: this.inputTexture },
            [this.video.videoWidth, this.video.videoHeight],
          );
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          this.bitmapFallback = true;
        }
      }
      if (this.bitmapFallback) {
        bitmap = await createImageBitmap(this.video);
        if (this.disposed || this.failed || document.hidden || generation !== this.generation)
          return;
        this.device.queue.copyExternalImageToTexture(
          { source: bitmap },
          { texture: this.inputTexture },
          [this.video.videoWidth, this.video.videoHeight],
        );
      }
      const encoder = this.device.createCommandEncoder();
      this.pipelines.forEach((pipeline) => pipeline.pass(encoder));
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(this.renderPipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(6);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      this.lastVideoFrame = frameKey;
      this.pendingFrames++;
      // Track completion without blocking frame delivery. Two submissions
      // allow CPU/GPU overlap while bounding latency on an overloaded GPU.
      void this.device.queue
        .onSubmittedWorkDone()
        .then(() => {
          this.pendingFrames--;
          if (this.disposed || this.failed) return;
          this.canvas.dataset.renderedFrames = String(
            Number(this.canvas.dataset.renderedFrames ?? 0) + 1,
          );
          if (!this.framed) {
            this.framed = true;
            this.onFrame();
          }
          if (this.redrawRequested) void this.draw();
        })
        .catch(this.fail);
    } catch (error) {
      this.fail(error);
    } finally {
      bitmap?.close();
      this.drawing = false;
      if (this.redrawRequested) void this.draw();
    }
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.video.removeEventListener("play", this.wake);
    this.video.removeEventListener("pause", this.wake);
    this.video.removeEventListener("seeked", this.wake);
    this.video.removeEventListener("ended", this.stop);
    document.removeEventListener("visibilitychange", this.visibility);
    this.device.removeEventListener("uncapturederror", this.gpuError);
    this.context.unconfigure();
    this.inputTexture.destroy();
    this.device.destroy();
  }
}
