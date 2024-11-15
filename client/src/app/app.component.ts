import {
  Component,
  ElementRef,
  viewChild,
  AfterViewInit,
  Renderer2,
  computed,
  HostListener,
  signal,
  effect,
  Signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  imports: [FormsModule],
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements AfterViewInit {
  @HostListener('window:resize')
  onResize() {
    this.resizeCanvas();
  }

  title = 'ng-19-ws-demo';

  private socket = new WebSocket('ws://127.0.0.1:8080/room');
  private eventListeners: (() => void)[] = [];

  brushSize = 16;
  brushColor = signal<string>('black');
  curX = 0;
  curY = 0;
  isDrawing = false;

  isSaveModalOpen = false;
  fileSaveName = signal<string>('');

  message = signal<WsMessage | null>(null);

  canvas = viewChild('drawingCanvas', { read: ElementRef });

  nativeCanvas = computed(
    () => this.canvas()?.nativeElement ?? null
  ) as Signal<HTMLCanvasElement | null>;

  canvasBounds = computed(
    () => this.nativeCanvas()?.getBoundingClientRect() ?? null
  );

  context = computed(() => this.nativeCanvas()?.getContext('2d') ?? null);

  constructor(private renderer: Renderer2) {
    this.initSocket();
    this.observeCanvasEvents();
    this.handleSocketMessages();
  }

  ngAfterViewInit() {
    this.resizeCanvas();
    this.initBackground();
  }

  ngOnDestroy() {
    this.cleanupEventListeners();
    this.socket.close();
  }

  private initBackground() {
    const context = this.context();
    const nativeCanvas = this.nativeCanvas();
    if (!context || !nativeCanvas) return;
    context.fillStyle = 'white';
    context.fillRect(0, 0, nativeCanvas.width, nativeCanvas.height);
  }

  private initSocket() {
    this.socket.onerror = console.error;
    this.socket.onmessage = (event) => this.message.set(JSON.parse(event.data));
  }

  private observeCanvasEvents() {
    effect(() => {
      const canvas = this.nativeCanvas();
      if (!canvas) return;

      this.cleanupEventListeners();

      this.eventListeners.push(
        this.renderer.listen(canvas, 'mousedown', (e) => this.onMouseDown(e)),
        this.renderer.listen(canvas, 'mousemove', (e) => this.onMouseMove(e)),
        this.renderer.listen(canvas, 'mouseup', () => this.onMouseUp())
      );
    });
  }

  private handleSocketMessages() {
    effect(() => {
      const command = this.message();
      if (!command) return;

      switch (command.type) {
        case 'Draw':
          this.draw(command.data as DrawCommand);
          break;
        case 'Erase':
          this.draw({ ...command.data, color: 'white' } as DrawCommand);
          break;
        case 'Clear':
          this.clearCanvas();
          break;
      }
    });
  }

  private cleanupEventListeners() {
    this.eventListeners.forEach((remove) => remove());
    this.eventListeners = [];
  }

  openSaveModal() {
    this.isSaveModalOpen = true;
  }

  save(filename: string) {
    const canvas = this.nativeCanvas();

    let downloadLink = document.createElement('a');

    const data = canvas?.toDataURL() ?? '';

    downloadLink.href = data;

    downloadLink.download = filename;

    downloadLink.click();

    this.isSaveModalOpen = false;
  }

  private resizeCanvas() {
    const canvas = this.nativeCanvas();
    const bounds = this.canvasBounds();
    if (!canvas || !bounds) return;

    canvas.width = bounds.width;
    canvas.height = bounds.height;
  }

  private updatePosition(event: MouseEvent) {
    const bounds = this.canvasBounds();
    if (!bounds) return;

    this.curX = event.clientX - bounds.left;
    this.curY = event.clientY - bounds.top;
  }

  private sendMessage(message: WsMessage) {
    this.socket.send(JSON.stringify(message));
  }

  private onMouseDown(event: MouseEvent) {
    this.isDrawing = true;
    this.updatePosition(event);
  }

  private onMouseMove(event: MouseEvent) {
    if (!this.isDrawing) return;

    const command: DrawCommand = {
      prev: [this.curX, this.curY],
      cur: [0, 0],
      brush_size: this.brushSize,
      color: this.brushColor(),
    };

    this.updatePosition(event);
    command.cur = [this.curX, this.curY];
    this.draw(command);

    this.sendMessage({ type: 'Draw', data: command });
  }

  private onMouseUp() {
    this.isDrawing = false;
  }

  private draw({ prev, brush_size, cur, color }: DrawCommand) {
    const ctx = this.context();
    if (!ctx) return;

    ctx.beginPath();
    ctx.lineWidth = brush_size;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.moveTo(prev[0], prev[1]);
    ctx.lineTo(cur[0], cur[1]);
    ctx.stroke();
  }

  public clear() {
    this.clearCanvas();
    this.sendMessage({ type: 'Clear' });
  }

  private clearCanvas() {
    const canvas = this.nativeCanvas();
    if (!canvas) return;

    const ctx = this.context();
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export interface DrawCommand {
  prev: [number, number];
  cur: [number, number];
  brush_size: number;
  color: string;
}

export interface WsMessage {
  type: 'Draw' | 'Erase' | 'Clear';
  data?: DrawCommand | null;
}
