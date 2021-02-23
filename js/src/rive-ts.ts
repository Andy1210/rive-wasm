const Rive = require('../../wasm/publish/rive');

// #region Type declarations

// // Loop types
// enum Loop {
//   OneShot,
//   Loop,
//   PingPong,
// }

// // Playback states
// enum Playback {
//   Play,
//   Pause,
//   Stop,
// }

// // Loop event
// type LoopEvent = [name: string, loop: Loop];

// // Fit types
// enum Fit {
//   Cover,
//   Contain,
//   Fill,
//   FitWidth,
//   FitHeight,
//   ScaleDown,
//   None,
// };

// // Alignments
// enum Alignment {
//   TopLeft,
//   TopCenter,
//   TopRight,
//   CenterLeft,
//   Center,
//   CenterRight,
//   BottomLeft,
//   BottomCenter,
//   BottomRight,
// };

// // Fit string values
// const fitValues: string[] = ['cover', 'contain', 'fill', 'fitWidth', 'fitHeight', 'none',
//                                    'scaleDown'];

// // Canvas string values
// const alignmentValues: string[] = ['topLeft', 'topCenter', 'topRight', 'centerLeft', 'center',
//                                          'centerRight', 'bottomLeft', 'bottomCenter', 'bottomRight'];

// // Alignment of Rive animations in a canvas
// class CanvasAlignment {
//   fit: Fit;
//   alignment: Alignment;
//   minX: bigint;
//   minY: bigint;
//   maxX: bigint | undefined;
//   maxY: bigint | undefined;

//   constructor(fit: Fit.None, alignment: Alignment.Center, minX: 0n, minY: 0n,
//               maxX?: bigint, maxY?: bigint) {
//     this.fit = fit;
//     this.alignment = alignment;
//     this.minX = minX;
//     this.minY = minY;
//     this.maxX = maxX;
//     this.maxY = maxY;
//   }
// };

// #endregion

// #region Wasm loading

// Holds a reference to the Rive runtime
let _runtime: typeof Rive;

// Is the Wasm bundle loaded?
const _isWasmLoaded = () : boolean => _runtime !== undefined;

// Is the Wasm bundle loading; prevents multiple concurrent Wasm loads
let _isWasmLoading: boolean = false;

// type definitions
type OnWasmLoadedCallback = (runtime: typeof Rive) => void;

// Queue of callbacks called when Wasm is loaded
const _wasmLoadQueue: Array<(cb: OnWasmLoadedCallback) => void> = [];

// Loads the runtime Wasm bundle
export const _loadWasm = async () : Promise<void> => {
  await Rive({
    // fetches the Wasm bundle
    locateFile: (file: string) => 'file://../../wasm/publish/' + file
  }).then((r: typeof Rive) => {
    _runtime = r;
    // Fire all the callbacks
    while (_wasmLoadQueue.length > 0) {
      _wasmLoadQueue.shift()?.(_runtime);
    }
  }).catch(e => {
    console.error('Unable to load Wasm module');
    throw e;
  });
};

// Adds a listener for Wasm load
const _onWasmLoaded = (cb: OnWasmLoadedCallback) : void => {
  if (!_isWasmLoading) {
    // Start loading Wasm
    _isWasmLoading = true;
    _loadWasm();
  }
  if (_runtime !== undefined) {
    // Wasm already loaded, fire immediately
    cb(_runtime);
  } else {
    // Add to the callback queue
    _wasmLoadQueue.push(cb);
  }
};

// Unloads the Wasm bundle; used in testing
const _unloadWasm = () : void => {
  _runtime = undefined;
  _isWasmLoading = false;
};

// #endregion

// #region RiveAnimation

type Event = (message: string) => void;

interface Events {
  onload: Array<Event>;
}

interface Artboard {
  animationCount: () => number;
  advance: (number) => void;
  draw: (CanvasRenderer) => void;
}

interface CanvasRenderer {
  animationCount: () => number;
}

interface RiveFile {
  defaultArtboard: () => Artboard;
}

interface RiveAnimationOptions {
  canvas: HTMLCanvasElement,
  src?: string,
  buffer?: ArrayBuffer,
  autoplay?: boolean,
  onload?: Event
}

export class RiveAnimation {
  #canvas: HTMLCanvasElement;
  #src?: string;
  #buffer?: ArrayBuffer;
  #autoplay: boolean;
  #events: Events = { onload: [] };

  #artboard: Artboard;
  #ctx: CanvasRenderingContext2D | null;
  #renderer: CanvasRenderer;

  constructor (
    canvas: HTMLCanvasElement,
    buffer?: ArrayBuffer,
    src?: string,
    onload?: Event,
    autoplay = false
  ) {
    this.#canvas = canvas;
    this.#buffer = buffer;
    this.#src = src;
    this.#autoplay = autoplay;

    // Initialize canvas
    this.#ctx = canvas.getContext('2d');

    // Set up events
    if (onload) {
      this.#events.onload = [onload];
    }

    // When the Wasm bundle is ready, load the file or buffer
    _onWasmLoaded(
      (runtime: typeof Rive): void => {
        if (this.#src) {
          this.loadSource(this.#src);
        } else if (this.#buffer) {
          this.loadData(this.#buffer);
        } else {
          throw new Error('Either src or buffer required');
        }
      }
    );
  }

  // Getter for autoplay
  get autoplay (): boolean {
    return this.#autoplay;
  }

  public static fromOptions (options: RiveAnimationOptions) : RiveAnimation {
    return new RiveAnimation(
      options.canvas,
      options.buffer,
      options.src,
      options.onload,
      options.autoplay
    );
  }

  // Loads a Rive file
  private async loadSource (src: string) : Promise<void> {
    const req: Request = new Request(src);
    const res: Response = await fetch(req);
    this.#buffer = await res.arrayBuffer();
    this.loadData(this.#buffer);
  }

  // Loads data from the buffer
  private loadData (buffer: ArrayBuffer) : void {
    const riveFile = _runtime.load(new Uint8Array(this.#buffer!));
    if (riveFile) {
      this.emit('load', `${this.#src ? this.#src : ''}`);
      this.initialize(riveFile);
    } else {
      throw new Error('Bad Rive data');
    }
  }

  // Initializes for playback
  private initialize (riveFile: RiveFile) : void {
    this.#artboard = riveFile.defaultArtboard();
    this.#renderer = new _runtime.CanvasRenderer(this.#ctx);
    this.drawFrame();
  }

  // Draws a single frame of the artboard
  private drawFrame () : void {
    this.#ctx?.save();
    this.#artboard.advance(0);
    this.#artboard.draw(this.#renderer);
    this.#ctx?.restore();
  }

  // Emits a new event
  private emit (eventName: string, message: string) {
    const events = this.#events['on' + eventName];
    events.forEach(event => {
      event(message);
    });
  }
}

// #endregion

// Exports for testing purposes only
export const testables = {
  loadWasm: _loadWasm,
  isWasmLoaded: _isWasmLoaded,
  onWasmLoaded: _onWasmLoaded,
  unloadWasm: _unloadWasm
};
