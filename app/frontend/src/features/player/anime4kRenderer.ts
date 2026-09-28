/// <reference types="@webgpu/types" />

type Pipeline = {
  pass(encoder: GPUCommandEncoder): void;
  getOutputTexture(): GPUTexture;
};

type Anime4KModule = {
  ModeA: new (options: {
    device: GPUDevice;
    inputTexture: GPUTexture;
    nativeDimensions: { width: number; height: number };
    targetDimensions: { width: number; height: number };
  }) => Pipeline;
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
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  profile: "light" | "advanced";
  anime4k: Anime4KModule;
  onError: (error: unknown) => void;
};

export class Anime4KRenderer {
  private frame = 0;
  private raf = 0;
  private disposed = false;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly inputTexture: GPUTexture;
  private readonly pipelines: Pipeline[];
  private readonly renderPipeline: GPURenderPipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly video: HTMLVideoElement;
  private readonly onError: (error: unknown) => void;
  private drawing = false;

  private constructor(options: {
    video: HTMLVideoElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    inputTexture: GPUTexture;
    pipelines: Pipeline[];
    renderPipeline: GPURenderPipeline;
    bindGroup: GPUBindGroup;
    onError: (error: unknown) => void;
  }) {
    this.video = options.video;
    this.device = options.device;
    this.context = options.context;
    this.inputTexture = options.inputTexture;
    this.pipelines = options.pipelines;
    this.renderPipeline = options.renderPipeline;
    this.bindGroup = options.bindGroup;
    this.onError = options.onError;
    this.video.addEventListener("play", this.wake);
    this.video.addEventListener("pause", this.draw);
    this.video.addEventListener("seeked", this.draw);
    this.video.addEventListener("ended", this.stop);
  }

  static async create(options: RendererOptions) {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error("WebGPU-адаптер не найден");
    const device = await adapter.requestDevice();
    const context = options.canvas.getContext("webgpu");
    if (!context) throw new Error("WebGPU canvas недоступен");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    const inputTexture = device.createTexture({
      size: [options.video.videoWidth, options.video.videoHeight, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const Preset = options.profile === "advanced" ? options.anime4k.ModeC : options.anime4k.ModeA;
    const pipelines = [new Preset({
      device,
      inputTexture,
      nativeDimensions: { width: options.video.videoWidth, height: options.video.videoHeight },
      targetDimensions: { width: options.width, height: options.height },
    })];
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
        { binding: 0, resource: pipelines.at(-1)!.getOutputTexture().createView() },
        { binding: 1, resource: device.createSampler({ magFilter: "linear", minFilter: "linear" }) },
      ],
    });
    const renderer = new Anime4KRenderer({ ...options, device, context, inputTexture, pipelines, renderPipeline, bindGroup });
    renderer.start();
    return renderer;
  }

  private start() {
    queueMicrotask(() => {
      if (this.disposed) return;
      void this.draw().finally(() => this.schedule());
    });
  }

  private readonly wake = () => {
    this.stop();
    void this.draw().finally(() => this.schedule());
  };

  private readonly stop = () => {
    if (this.frame && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.frame);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.frame = 0;
    this.raf = 0;
  };

  private readonly schedule = () => {
    if (this.disposed || document.hidden || this.video.paused || this.video.ended || this.frame || this.raf) return;
    if (this.video.requestVideoFrameCallback) {
      this.frame = this.video.requestVideoFrameCallback(() => {
        this.frame = 0;
        void this.draw().finally(() => this.schedule());
      });
    } else {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        void this.draw().finally(() => this.schedule());
      });
    }
  };

  private readonly draw = async () => {
    if (this.disposed || this.drawing || document.hidden || this.video.readyState < 2) return;
    this.drawing = true;
    let bitmap: ImageBitmap | undefined;
    try {
      // Chromium's WebGPU implementation does not accept HTMLVideoElement as
      // GPUCopyExternalImageSource, while ImageBitmap is supported reliably.
      bitmap = await createImageBitmap(this.video);
      if (this.disposed) return;
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: this.inputTexture },
        [this.video.videoWidth, this.video.videoHeight],
      );
      const encoder = this.device.createCommandEncoder();
      this.pipelines.forEach(pipeline => pipeline.pass(encoder));
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(this.renderPipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(6);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    } catch (error) {
      this.stop();
      this.onError(error);
    } finally {
      bitmap?.close();
      this.drawing = false;
    }
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.video.removeEventListener("play", this.wake);
    this.video.removeEventListener("pause", this.draw);
    this.video.removeEventListener("seeked", this.draw);
    this.video.removeEventListener("ended", this.stop);
    this.inputTexture.destroy();
    this.device.destroy();
  }
}
