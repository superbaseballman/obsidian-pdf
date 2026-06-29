import { ItemView, WorkspaceLeaf, TFile, Notice, App, Modal, Setting } from "obsidian";
import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import type PdfEditorPlugin from "./main";
import { PdfEditorSettings } from "./settings";

export const VIEW_TYPE_PDF_EDITOR = "pdf-editor-view";

// Note input modal
export class NoteModal extends Modal {
  private noteContent: string = "";
  private onSubmit: (content: string) => void;

  constructor(app: App, initialContent: string, onSubmit: (content: string) => void) {
    super(app);
    this.noteContent = initialContent;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "输入备注内容" });

    const textarea = contentEl.createEl("textarea", {
      cls: "pdf-editor-text-annotation",
      attr: {
        style: "width: 100%; min-height: 100px; resize: vertical;",
        placeholder: "在此输入备注...",
      },
    });
    textarea.value = this.noteContent;

    textarea.addEventListener("input", () => {
      this.noteContent = textarea.value;
    });

    const buttonDiv = contentEl.createEl("div", {
      attr: { style: "display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;" },
    });

    const cancelBtn = buttonDiv.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = buttonDiv.createEl("button", {
      text: "确定",
      cls: "mod-cta",
    });
    submitBtn.addEventListener("click", () => {
      this.onSubmit(this.noteContent);
      this.close();
    });

    // Focus textarea
    textarea.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// Tool types
type ToolType = "select" | "text" | "highlight" | "pen" | "eraser" | "note";

// Drawing point with pressure data
interface DrawingPoint {
  x: number;
  y: number;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
  timestamp: number;
}

// Annotation interface
export interface Annotation {
  id: string;
  type: ToolType;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  color?: string;
  points?: DrawingPoint[];
  lineWidth?: number;
}

export class PdfEditorView extends ItemView {
  plugin: PdfEditorPlugin;
  file: TFile | null = null;
  pdfDocument: PDFDocumentProxy | null = null;
  currentPage: number = 1;
  totalPages: number = 0;
  scale: number = 1.0;
  currentTool: ToolType = "select";
  annotations: Map<number, Annotation[]> = new Map();

  // DOM elements
  containerEl!: HTMLElement;
  toolbarEl!: HTMLElement;
  viewerEl!: HTMLElement;
  sidebarEl!: HTMLElement;
  statusbarEl!: HTMLElement;
  thumbContentEl!: HTMLElement;
  outlineContentEl!: HTMLElement;

  // Size controls
  penSizeContainer!: HTMLElement;
  eraserSizeContainer!: HTMLElement;
  penSizeValue!: HTMLElement;
  eraserSizeValue!: HTMLElement;

  // Canvas contexts
  pageCanvases: Map<number, HTMLCanvasElement> = new Map();
  renderTasks: Map<number, RenderTask> = new Map();

  // Drawing state
  isDrawing: boolean = false;
  drawingCanvas: HTMLCanvasElement | null = null;
  drawingCtx: CanvasRenderingContext2D | null = null;
  currentDrawingPoints: DrawingPoint[] = [];
  lastDrawnPoint: DrawingPoint | null = null;
  activePointerType: string = "";
  penButton1Pressed: boolean = false;
  penButton2Pressed: boolean = false;
  previousTool: ToolType = "select";

  // Auto-save timer
  autoSaveTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PdfEditorPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.scale = plugin.settings.defaultScale;
  }

  getViewType(): string {
    return VIEW_TYPE_PDF_EDITOR;
  }

  getDisplayText(): string {
    return this.file ? `PDF: ${this.file.basename}` : "PDF Editor";
  }

  getIcon(): string {
    return "file-text";
  }

  async onOpen(): Promise<void> {
    this.containerEl = this.contentEl;
    this.containerEl.empty();
    this.containerEl.addClass("pdf-editor-container");
    // Make the container focusable so it can receive keyboard events.
    this.containerEl.setAttribute("tabindex", "0");

    this.createToolbar();
    this.createMainContent();
    this.createStatusbar();

    // Register keyboard shortcuts (page navigation + zoom)
    this.containerEl.addEventListener("keydown", this.handleKeydown);

    if (this.plugin.settings.autoSave) {
      this.startAutoSave();
    }
  }

  // Keyboard handler bound as an arrow function so it can be added/removed
  // with the same reference.
  private handleKeydown = (e: KeyboardEvent): void => {
    // Don't interfere with typing in inputs/textareas
    const target = e.target as HTMLElement;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }

    switch (e.key) {
      case "ArrowLeft":
      case "PageUp":
        this.goToPage(this.currentPage - 1);
        e.preventDefault();
        break;
      case "ArrowRight":
      case "PageDown":
        this.goToPage(this.currentPage + 1);
        e.preventDefault();
        break;
      case "Home":
        this.goToPage(1);
        e.preventDefault();
        break;
      case "End":
        this.goToPage(this.totalPages);
        e.preventDefault();
        break;
      case "+":
      case "=":
        this.setZoom(this.scale + 0.1);
        e.preventDefault();
        break;
      case "-":
        this.setZoom(this.scale - 0.1);
        e.preventDefault();
        break;
      case "0":
        this.setZoom(this.plugin.settings.defaultScale);
        e.preventDefault();
        break;
    }
  };

  async onClose(): Promise<void> {
    this.stopAutoSave();
    this.containerEl.removeEventListener("keydown", this.handleKeydown);
    // Persist any unsaved annotations before closing
    try {
      await this.saveAnnotations();
    } catch (e) {
      console.error("Failed to save annotations on close:", e);
    }
    await this.cleanup();
  }

  private createToolbar(): void {
    this.toolbarEl = this.containerEl.createEl("div", {
      cls: "pdf-editor-toolbar",
    });

    // Navigation group
    const navGroup = this.toolbarEl.createEl("div", {
      cls: "pdf-editor-toolbar-group",
    });

    // Sidebar toggle
    this.createToolButton(navGroup, "panel-left", "侧边栏", () => {
      this.toggleSidebar();
    });

    // Previous page
    this.createToolButton(navGroup, "chevron-left", "上一页", () => {
      this.goToPage(this.currentPage - 1);
    });

    // Page input
    const pageInfo = navGroup.createEl("span", { cls: "page-info" });
    const pageInput = pageInfo.createEl("input", {
      type: "number",
      value: "1",
      attr: { min: "1" },
    });
    pageInfo.createSpan({ text: " / " });
    pageInfo.createSpan({ text: "0", cls: "total-pages" });

    // Jump to page when the user edits the input and presses Enter or blurs
    const jumpToInputPage = () => {
      const num = parseInt(pageInput.value);
      if (!isNaN(num)) {
        this.goToPage(num);
      } else {
        pageInput.value = String(this.currentPage);
      }
    };
    pageInput.addEventListener("change", jumpToInputPage);
    pageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        jumpToInputPage();
        pageInput.blur();
      }
    });

    // Next page
    this.createToolButton(navGroup, "chevron-right", "下一页", () => {
      this.goToPage(this.currentPage + 1);
    });

    // Zoom group
    const zoomGroup = this.toolbarEl.createEl("div", {
      cls: "pdf-editor-toolbar-group",
    });

    this.createToolButton(zoomGroup, "zoom-out", "缩小", () => {
      this.setZoom(this.scale - 0.1);
    });

    const zoomSelect = zoomGroup.createEl("select");
    ["50%", "75%", "100%", "125%", "150%", "200%", "300%"].forEach((v) => {
      zoomSelect.createEl("option", {
        text: v,
        value: String(parseInt(v) / 100),
      });
    });
    zoomSelect.value = String(this.scale);
    zoomSelect.addEventListener("change", () => {
      this.setZoom(parseFloat(zoomSelect.value));
    });

    this.createToolButton(zoomGroup, "zoom-in", "放大", () => {
      this.setZoom(this.scale + 0.1);
    });

    this.createToolButton(zoomGroup, "maximize", "适应宽度", () => {
      this.fitToWidth();
    });

    // Tool group
    const toolGroup = this.toolbarEl.createEl("div", {
      cls: "pdf-editor-toolbar-group",
    });

    this.createToolButton(toolGroup, "mouse-pointer", "选择", () => {
      this.setTool("select");
    }, true);

    this.createToolButton(toolGroup, "type", "文本", () => {
      this.setTool("text");
    });

    this.createToolButton(toolGroup, "highlight", "高亮", () => {
      this.setTool("highlight");
    });

    this.createToolButton(toolGroup, "pen-tool", "画笔", () => {
      this.setTool("pen");
    });

    this.createToolButton(toolGroup, "eraser", "橡皮擦", () => {
      this.setTool("eraser");
    });

    this.createToolButton(toolGroup, "message-square", "备注", () => {
      this.setTool("note");
    });

    // Color picker
    const colorGroup = this.toolbarEl.createEl("div", {
      cls: "pdf-editor-toolbar-group",
    });

    const colorInput = colorGroup.createEl("input", {
      type: "color",
      value: this.plugin.settings.penColor,
    });
    colorInput.style.width = "28px";
    colorInput.style.height = "28px";
    colorInput.style.padding = "0";
    colorInput.style.border = "none";
    colorInput.style.cursor = "pointer";
    colorInput.addEventListener("input", () => {
      this.plugin.settings.penColor = colorInput.value;
      this.plugin.saveSettings();
    });

    // Size control group - pen and eraser size sliders
    const sizeGroup = this.toolbarEl.createEl("div", {
      cls: "pdf-editor-toolbar-group pdf-editor-size-group",
    });

    // Pen size
    this.penSizeContainer = sizeGroup.createEl("div", {
      cls: "pdf-editor-size-control",
    });
    this.penSizeContainer.createEl("span", { text: "笔", cls: "pdf-editor-size-label" });
    const penSizeSlider = this.penSizeContainer.createEl("input", {
      attr: {
        type: "range",
        min: "1",
        max: "10",
        value: String(this.plugin.settings.penSize),
        title: "画笔粗细",
      },
    });
    this.penSizeValue = this.penSizeContainer.createEl("span", {
      text: String(this.plugin.settings.penSize),
      cls: "pdf-editor-size-value",
    });
    penSizeSlider.addEventListener("input", () => {
      const val = parseInt(penSizeSlider.value);
      this.plugin.settings.penSize = val;
      this.penSizeValue.setText(String(val));
      this.plugin.saveSettings();
    });

    // Eraser size
    this.eraserSizeContainer = sizeGroup.createEl("div", {
      cls: "pdf-editor-size-control",
    });
    this.eraserSizeContainer.createEl("span", { text: "擦", cls: "pdf-editor-size-label" });
    const eraserSizeSlider = this.eraserSizeContainer.createEl("input", {
      attr: {
        type: "range",
        min: "5",
        max: "50",
        value: String(this.plugin.settings.eraserSize),
        title: "橡皮擦大小",
      },
    });
    this.eraserSizeValue = this.eraserSizeContainer.createEl("span", {
      text: String(this.plugin.settings.eraserSize),
      cls: "pdf-editor-size-value",
    });
    eraserSizeSlider.addEventListener("input", () => {
      const val = parseInt(eraserSizeSlider.value);
      this.plugin.settings.eraserSize = val;
      this.eraserSizeValue.setText(String(val));
      this.plugin.saveSettings();
    });

    this.updateSizeControls();
  }

  private createToolButton(
    parent: HTMLElement,
    icon: string,
    tooltip: string,
    onClick: () => void,
    active: boolean = false
  ): HTMLButtonElement {
    const btn = parent.createEl("button", { attr: { "aria-label": tooltip } });
    btn.innerHTML = this.getIconSvg(icon);
    if (active) btn.addClass("active");
    btn.addEventListener("click", onClick);
    return btn;
  }

  private getIconSvg(name: string): string {
    // Simple SVG icons
    const icons: Record<string, string> = {
      "panel-left":
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
      "chevron-left":
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
      "chevron-right":
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
      "zoom-out":
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
      "zoom-in":
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
      maximize:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
      "mouse-pointer":
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>',
      type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
      highlight:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
      "pen-tool":
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
      eraser:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20H7L3 16l9-9 8 8-4 4z"/><path d="M6 11l4-4"/></svg>',
      "message-square":
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    };
    return icons[name] || "";
  }

  private createMainContent(): void {
    const mainArea = this.containerEl.createEl("div", {
      attr: { style: "display: flex; flex: 1; overflow: hidden;" },
    });

    // Sidebar
    this.sidebarEl = mainArea.createEl("div", {
      cls: "pdf-editor-sidebar" + (this.plugin.settings.sidebarVisible ? " visible" : ""),
    });
    this.createSidebar();

    // Viewer
    this.viewerEl = mainArea.createEl("div", { cls: "pdf-editor-viewer" });
  }

  private createSidebar(): void {
    const tabs = this.sidebarEl.createEl("div", {
      cls: "pdf-editor-sidebar-tabs",
    });

    const thumbTab = tabs.createEl("button", {
      text: "缩略图",
      cls: "pdf-editor-sidebar-tab active",
    });
    const outlineTab = tabs.createEl("button", {
      text: "大纲",
      cls: "pdf-editor-sidebar-tab",
    });

    this.thumbContentEl = this.sidebarEl.createEl("div", {
      cls: "pdf-editor-thumbnail-list",
    });
    this.outlineContentEl = this.sidebarEl.createEl("div", {
      cls: "pdf-editor-outline-list",
      attr: { style: "display: none;" },
    });

    const showTab = (active: HTMLElement) => {
      [thumbTab, outlineTab].forEach((t) => t.removeClass("active"));
      [this.thumbContentEl, this.outlineContentEl].forEach(
        (c) => (c.style.display = "none")
      );
      active.addClass("active");
      if (active === thumbTab) this.thumbContentEl.style.display = "";
      else if (active === outlineTab) this.outlineContentEl.style.display = "";
    };

    thumbTab.addEventListener("click", () => showTab(thumbTab));
    outlineTab.addEventListener("click", () => showTab(outlineTab));
  }

  // Render the list of notes in the sidebar
  // Public accessor for all notes (used by the sidebar view)
  getAllNotes(): { ann: Annotation; pageNum: number }[] {
    const notes: { ann: Annotation; pageNum: number }[] = [];
    const sortedPages = Array.from(this.annotations.keys()).sort((a, b) => a - b);
    for (const pageNum of sortedPages) {
      for (const ann of this.annotations.get(pageNum) || []) {
        if (ann.type === "note") notes.push({ ann, pageNum });
      }
    }
    return notes;
  }

  // Notify the notes sidebar (if open) to refresh
  notifyNotesChanged(): void {
    this.app.workspace.trigger("pdf-editor:notes-changed");
  }

  // Notes list rendering has been moved to PdfNotesSidebarView (notes-sidebar.ts).
  // This method is kept as a no-op for backward compatibility with any
  // remaining call sites; it simply notifies the sidebar to refresh.
  private renderNotesList(): void {
    this.notifyNotesChanged();
  }

  private createStatusbar(): void {
    this.statusbarEl = this.containerEl.createEl("div", {
      cls: "pdf-editor-statusbar",
    });
    this.statusbarEl.createSpan({ text: "就绪", cls: "pdf-editor-status-message" });
    this.statusbarEl.createSpan({
      text: `缩放: ${Math.round(this.scale * 100)}%`,
      cls: "pdf-editor-status-zoom",
    });
  }

  private async configurePdfWorker(): Promise<void> {
    // Already configured
    if (pdfjsLib.GlobalWorkerOptions.workerSrc) return;

    // Method 1: Load worker from plugin directory using Obsidian vault adapter
    try {
      const pluginDir = ".obsidian/plugins/obsidian-pdf";
      const workerPath = `${pluginDir}/pdf.worker.mjs`;
      const workerContent = await this.app.vault.adapter.read(workerPath);

      if (workerContent) {
        const blob = new Blob([workerContent], { type: "application/javascript" });
        pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
        return;
      }
    } catch (e) {
      console.warn("Failed to load worker from plugin directory:", e);
    }

    // Method 2: Try CDN fallback
    try {
      const cdnUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      const response = await fetch(cdnUrl, { mode: "cors" });
      if (response.ok) {
        const workerContent = await response.text();
        const blob = new Blob([workerContent], { type: "application/javascript" });
        pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
        return;
      }
    } catch (e) {
      console.warn("Failed to load worker from CDN:", e);
    }

    // Method 3: Must have a worker - throw error if all methods fail
    throw new Error(
      "无法加载 PDF Worker。请确保插件目录中存在 pdf.worker.mjs 文件，或检查网络连接。"
    );
  }

  async loadFile(file: TFile): Promise<void> {
    // Clean up any previously loaded document to avoid memory leaks
    await this.cleanup();

    this.file = file;
    // Reset zoom to the configured default for each new file
    this.scale = this.plugin.settings.defaultScale;
    this.currentPage = 1;
    this.totalPages = 0;
    this.annotations.clear();

    this.updatePageInfo();
    this.updateStatusbar();
    this.updateZoomControl();

    // Show loading indicator
    this.showLoading(true);

    try {
      const arrayBuffer = await this.app.vault.readBinary(file);

      // Configure pdf.js worker
      await this.configurePdfWorker();

      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
      });

      this.pdfDocument = await loadingTask.promise;
      this.totalPages = this.pdfDocument.numPages;
      this.currentPage = 1;

      this.updatePageInfo();

      // Load saved annotations before rendering so they appear immediately
      await this.loadAnnotations();

      await this.renderAllPages();
      await this.renderThumbnails();
      await this.loadOutline();

      this.showLoading(false);
      new Notice(`PDF 已加载: ${file.basename}`);
    } catch (error) {
      console.error("Failed to load PDF:", error);
      this.showLoading(false);
      new Notice("加载 PDF 失败: " + (error as Error).message);
    }
  }

  private async renderAllPages(): Promise<void> {
    // Cancel any in-flight render tasks to avoid race conditions
    this.renderTasks.forEach((task) => {
      try {
        task.cancel();
      } catch (e) {
        // Ignore cancellation errors
      }
    });
    this.renderTasks.clear();

    this.viewerEl.empty();
    this.pageCanvases.clear();

    for (let i = 1; i <= this.totalPages; i++) {
      await this.renderPage(i);
    }

    // Re-apply saved annotations onto the freshly rendered pages
    this.renderAllAnnotations();
    this.renderNotesList();
  }

  // Re-render all stored annotations onto the current page DOM. This is
  // called after every full re-render (e.g. zoom changes) so annotations
  // do not disappear when the page is re-rendered.
  private renderAllAnnotations(): void {
    const wrappers = this.viewerEl.querySelectorAll<HTMLElement>(
      ".pdf-editor-page-wrapper"
    );
    wrappers.forEach((wrapper, index) => {
      const pageNum = index + 1;
      const annotations = this.annotations.get(pageNum);
      if (!annotations) return;

      for (const ann of annotations) {
        // Skip if an element for this annotation already exists
        if (wrapper.querySelector(`[data-annotation-id="${ann.id}"]`)) continue;

        if (ann.type === "text") {
          this.renderTextAnnotation(wrapper, pageNum, ann);
        } else if (ann.type === "highlight") {
          this.renderHighlightAnnotation(wrapper, pageNum, ann);
        } else if (ann.type === "note") {
          this.renderNoteAnnotation(wrapper, pageNum, ann);
        } else if (ann.type === "pen" || ann.type === "eraser") {
          this.renderPenAnnotation(wrapper, ann);
        }
      }
    });
  }

  private renderTextAnnotation(
    wrapper: HTMLElement,
    pageNum: number,
    ann: Annotation
  ): void {
    const annotations = this.annotations.get(pageNum) || [];
    const textarea = wrapper.createEl("textarea", {
      cls: "pdf-editor-text-annotation pdf-editor-annotation",
      attr: {
        style: `left: ${ann.x * this.scale}px; top: ${ann.y * this.scale}px; width: ${ann.width}px; height: ${ann.height}px;`,
        placeholder: "输入文本...",
        "data-annotation-id": ann.id,
      },
    });
    textarea.value = ann.content || "";

    textarea.addEventListener("input", () => {
      const found = annotations.find((a) => a.id === ann.id);
      if (found) found.content = textarea.value;
    });

    textarea.addEventListener("blur", () => {
      if (!textarea.value) {
        const idx = annotations.findIndex((a) => a.id === ann.id);
        if (idx !== -1) annotations.splice(idx, 1);
        textarea.remove();
      }
    });
  }

  private renderHighlightAnnotation(
    wrapper: HTMLElement,
    pageNum: number,
    ann: Annotation
  ): void {
    const annotations = this.annotations.get(pageNum) || [];
    const highlight = wrapper.createEl("div", {
      cls: "pdf-editor-highlight pdf-editor-annotation",
      attr: {
        style: `
          left: ${ann.x * this.scale}px;
          top: ${ann.y * this.scale}px;
          width: ${ann.width * this.scale}px;
          height: ${ann.height * this.scale}px;
          background: ${this.hexToRgba(ann.color || this.plugin.settings.highlightColor, 0.3)};
        `,
        "data-annotation-id": ann.id,
      },
    });

    highlight.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const idx = annotations.findIndex((a) => a.id === ann.id);
      if (idx !== -1) {
        annotations.splice(idx, 1);
        highlight.remove();
      }
    });
  }

  private renderNoteAnnotation(
    wrapper: HTMLElement,
    pageNum: number,
    ann: Annotation
  ): void {
    const annotations = this.annotations.get(pageNum) || [];
    const customSvg = this.plugin.settings.noteIconSvg;
    const noteIcon = wrapper.createEl("div", {
      cls: "pdf-editor-note-icon pdf-editor-annotation" + (customSvg ? " custom-svg" : ""),
      attr: {
        style: `left: ${ann.x * this.scale}px; top: ${ann.y * this.scale}px;`,
        "data-annotation-id": ann.id,
      },
    });
    if (customSvg) {
      noteIcon.innerHTML = customSvg;
    }
    if (ann.content) {
      noteIcon.setAttribute("aria-label", ann.content.substring(0, 50));
    }

    noteIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      this.highlightNote(noteIcon);

      // Ensure notes sidebar is open, then focus and highlight the entry
      this.plugin.toggleNotesSidebar().then(() => {
        setTimeout(() => {
          this.app.workspace.trigger("pdf-editor:focus-note", {
            noteId: ann.id,
            pageNum: pageNum,
          });
        }, 150);
      });
    });

    noteIcon.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const idx = annotations.findIndex((a) => a.id === ann.id);
      if (idx !== -1) {
        annotations.splice(idx, 1);
        noteIcon.remove();
        this.renderNotesList();
        this.saveAnnotations();
      }
    });
  }

  private renderPenAnnotation(wrapper: HTMLElement, ann: Annotation): void {
    const drawingLayer = wrapper.querySelector<HTMLElement>(
      ".pdf-editor-drawing-layer"
    );
    if (!drawingLayer) return;
    const canvas = drawingLayer.querySelector("canvas");
    if (!canvas || !ann.points || ann.points.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    if (ann.type === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = ann.color || this.plugin.settings.penColor;
    }
    ctx.lineWidth = ann.lineWidth || this.plugin.settings.penSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const pts = ann.points;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * this.scale, pts[0].y * this.scale);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * this.scale, pts[i].y * this.scale);
    }
    ctx.stroke();
    ctx.restore();
  }

  private async renderThumbnails(): Promise<void> {
    if (!this.pdfDocument || !this.thumbContentEl) return;
    this.thumbContentEl.empty();

    const thumbnailScale = 0.2;

    for (let i = 1; i <= this.totalPages; i++) {
      const page = await this.pdfDocument.getPage(i);
      const viewport = page.getViewport({ scale: thumbnailScale });

      const thumbEl = this.thumbContentEl.createEl("div", {
        cls: "pdf-editor-thumbnail" + (i === this.currentPage ? " active" : ""),
      });

      const canvas = thumbEl.createEl("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext("2d")!;
      await page.render({
        canvasContext: ctx,
        viewport: viewport,
      }).promise;

      thumbEl.createEl("div", {
        cls: "page-number",
        text: String(i),
      });

      thumbEl.addEventListener("click", () => {
        this.goToPage(i);
      });
    }
  }

  private async renderPage(pageNum: number): Promise<void> {
    if (!this.pdfDocument) return;

    const page = await this.pdfDocument.getPage(pageNum);
    const viewport = page.getViewport({ scale: this.scale });

    // Create page wrapper
    const wrapper = this.viewerEl.createEl("div", {
      cls: "pdf-editor-page-wrapper",
      attr: {
        style: `width: ${viewport.width}px; height: ${viewport.height}px;`,
      },
    });

    // Create canvas
    const canvas = wrapper.createEl("canvas", { cls: "pdf-editor-page-canvas" });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    this.pageCanvases.set(pageNum, canvas);

    const ctx = canvas.getContext("2d")!;

    // Render PDF page
    const renderTask = page.render({
      canvasContext: ctx,
      viewport: viewport,
    });

    // Cancel any previous render task for this page before tracking the new one
    const prevTask = this.renderTasks.get(pageNum);
    if (prevTask) {
      try {
        prevTask.cancel();
      } catch (e) {
        // Ignore
      }
    }
    this.renderTasks.set(pageNum, renderTask);

    try {
      await renderTask.promise;
    } catch (e) {
      if ((e as Error).name !== "RenderingCancelledException") {
        throw e;
      }
      return; // Page was cancelled, do not continue building layers
    }

    // Create text layer. It must be interactive when the highlight tool is
    // active so the user can select text; otherwise it stays non-interactive.
    const textLayerEl = wrapper.createEl("div", {
      cls: "pdf-editor-text-layer",
    });
    if (this.currentTool === "highlight") {
      textLayerEl.addClass("selectable");
    }
    await this.renderTextLayer(page, viewport, textLayerEl);

    // Create annotation layer
    wrapper.createEl("div", { cls: "pdf-editor-annotation-layer" });

    // Create drawing layer for pen tool
    const drawingLayer = wrapper.createEl("div", {
      cls: "pdf-editor-drawing-layer",
    });
    const drawingCanvas = drawingLayer.createEl("canvas");
    drawingCanvas.width = viewport.width;
    drawingCanvas.height = viewport.height;
    drawingCanvas.style.width = `${viewport.width}px`;
    drawingCanvas.style.height = `${viewport.height}px`;

    this.setupDrawingEvents(drawingLayer, drawingCanvas, pageNum);

    // Click handler for adding annotations
    wrapper.addEventListener("click", (e) => {
      // Skip if clicking on an existing note icon
      if ((e.target as HTMLElement).closest(".pdf-editor-note-icon")) return;

      if (this.currentTool === "text") {
        this.addTextAnnotation(e, wrapper, pageNum);
      } else if (this.currentTool === "highlight") {
        this.addHighlight(e, wrapper, pageNum);
      } else if (this.currentTool === "note") {
        this.addNote(e, wrapper, pageNum);
      }
    });
  }

  private async renderTextLayer(
    page: PDFPageProxy,
    viewport: any,
    container: HTMLElement
  ): Promise<void> {
    const textContent: TextContent = await page.getTextContent();

    textContent.items.forEach((item) => {
      if (!("str" in item)) return;
      const textItem = item as TextItem;

      const span = container.createEl("span");
      span.textContent = textItem.str;

      const tx = pdfjsLib.Util.transform(
        viewport.transform,
        textItem.transform
      );

      const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
      span.style.left = `${tx[4]}px`;
      span.style.top = `${tx[5] - fontHeight}px`;
      span.style.fontSize = `${fontHeight}px`;
      span.style.fontFamily = textItem.fontName || "sans-serif";

      if (textItem.width > 0) {
        const scale = textItem.width * viewport.scale;
        span.style.transform = `scaleX(${scale / span.offsetWidth})`;
      }
    });
  }

  private setupDrawingEvents(
    layer: HTMLElement,
    canvas: HTMLCanvasElement,
    pageNum: number
  ): void {
    const ctx = canvas.getContext("2d")!;

    // Use Pointer Events for drawing tablet support
    layer.addEventListener("pointerdown", (e) => this.handlePointerDown(e, canvas, ctx, pageNum));
    layer.addEventListener("pointermove", (e) => this.handlePointerMove(e, canvas, ctx));
    layer.addEventListener("pointerup", (e) => this.handlePointerUp(e, canvas, pageNum));
    layer.addEventListener("pointercancel", (e) => this.handlePointerUp(e, canvas, pageNum));
    layer.addEventListener("pointerleave", (e) => this.handlePointerUp(e, canvas, pageNum));

    // Prevent default touch actions for better tablet support
    layer.style.touchAction = "none";

    // Handle pen buttons
    layer.addEventListener("pointerdown", (e) => this.handlePenButton(e, true));
    layer.addEventListener("pointerup", (e) => this.handlePenButton(e, false));

    // Context menu prevention for pen
    layer.addEventListener("contextmenu", (e) => {
      if (this.activePointerType === "pen") {
        e.preventDefault();
      }
    });
  }

  private handlePenButton(e: PointerEvent, isDown: boolean): void {
    if (e.pointerType !== "pen") return;

    // On pointerdown, e.button tells which button was pressed.
    // On pointerup, e.button tells which button was released, but e.buttons
    // (the mask of currently-held buttons) no longer includes it, so we must
    // rely on our tracked state rather than re-checking e.buttons.
    if (isDown) {
      // Button 2 (right / barrel button) -> pen button 1 shortcut
      if (e.button === 2) {
        this.penButton1Pressed = true;
        this.previousTool = this.currentTool;
        this.setTool(this.plugin.settings.penButton1Tool as ToolType);
        return;
      }
      // Button 5 (aux barrel button on some tablets) -> pen button 2 shortcut
      if (e.button === 5) {
        this.penButton2Pressed = true;
        this.previousTool = this.currentTool;
        this.setTool(this.plugin.settings.penButton2Tool as ToolType);
        return;
      }
    } else {
      // pointerup: restore the previous tool if a pen button was active.
      if (this.penButton1Pressed) {
        this.penButton1Pressed = false;
        this.setTool(this.previousTool);
        return;
      }
      if (this.penButton2Pressed) {
        this.penButton2Pressed = false;
        this.setTool(this.previousTool);
        return;
      }
    }
  }

  private handlePointerDown(
    e: PointerEvent,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    pageNum: number
  ): void {
    // Palm rejection: ignore touch when pen is active
    if (
      this.plugin.settings.enablePalmRejection &&
      e.pointerType === "touch" &&
      this.activePointerType === "pen"
    ) {
      return;
    }

    // Only handle pen and mouse for drawing tools
    if (this.currentTool !== "pen" && this.currentTool !== "eraser") return;

    // Update active pointer type
    this.activePointerType = e.pointerType;

    this.isDrawing = true;
    this.drawingCanvas = canvas;
    this.drawingCtx = ctx;
    this.currentDrawingPoints = [];

    // Capture pointer for reliable tracking
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.scale;
    const y = (e.clientY - rect.top) / this.scale;
    const pressure = this.getPressure(e);

    const point: DrawingPoint = {
      x,
      y,
      pressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      timestamp: e.timeStamp,
    };

    this.currentDrawingPoints.push(point);
    this.lastDrawnPoint = point;

    // Set up drawing style before the first stroke
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (this.currentTool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = this.plugin.settings.eraserSize;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = this.plugin.settings.penColor;
      ctx.lineWidth = this.getLineWidth(pressure);
    }

    // Draw a single dot so a tap/click leaves a visible mark instead of
    // only appearing once the pointer moves.
    ctx.beginPath();
    ctx.arc(x * this.scale, y * this.scale, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = this.plugin.settings.penColor;
    if (this.currentTool !== "eraser") {
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x * this.scale, y * this.scale);
  }

  private handlePointerMove(
    e: PointerEvent,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D
  ): void {
    if (!this.isDrawing) return;

    // Palm rejection: ignore touch when pen is active
    if (
      this.plugin.settings.enablePalmRejection &&
      e.pointerType === "touch" &&
      this.activePointerType === "pen"
    ) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.scale;
    const y = (e.clientY - rect.top) / this.scale;
    const pressure = this.getPressure(e);

    const point: DrawingPoint = {
      x,
      y,
      pressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      timestamp: e.timeStamp,
    };

    this.currentDrawingPoints.push(point);

    // Update line width based on pressure BEFORE drawing so the new segment
    // uses the correct width (previously the width update was applied too
    // late, causing the first segment of each move to use a stale width).
    if (this.currentTool !== "eraser") {
      ctx.lineWidth = this.getLineWidth(pressure);
    } else {
      ctx.lineWidth = this.plugin.settings.eraserSize;
    }

    // Apply line smoothing
    if (this.plugin.settings.enableLineSmoothing && this.currentDrawingPoints.length >= 3) {
      this.drawSmoothLine(ctx, canvas);
    } else {
      // Simple line drawing
      ctx.lineTo(x * this.scale, y * this.scale);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x * this.scale, y * this.scale);
    }

    this.lastDrawnPoint = point;
  }

  private handlePointerUp(
    e: PointerEvent,
    canvas: HTMLCanvasElement,
    pageNum: number
  ): void {
    if (!this.isDrawing) return;

    // Release pointer capture
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {
      // Ignore if capture was already released
    }

    this.isDrawing = false;
    this.activePointerType = "";

    // Draw final smooth line (only for the pen tool; the eraser uses
    // destination-out compositing and re-stroking would re-erase nothing
    // useful but could cause visual artifacts).
    if (
      this.currentTool === "pen" &&
      this.plugin.settings.enableLineSmoothing &&
      this.drawingCtx &&
      this.currentDrawingPoints.length >= 2
    ) {
      this.drawFinalSmoothLine(this.drawingCtx, canvas);
    }

    if (this.currentTool === "pen" && this.currentDrawingPoints.length > 0) {
      // Save pen annotation with pressure data
      const annotations = this.annotations.get(pageNum) || [];
      annotations.push({
        id: `pen-${Date.now()}`,
        type: "pen",
        pageIndex: pageNum,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        color: this.plugin.settings.penColor,
        points: [...this.currentDrawingPoints],
        lineWidth: this.plugin.settings.penSize,
      });
      this.annotations.set(pageNum, annotations);
    } else if (this.currentTool === "eraser" && this.currentDrawingPoints.length > 0) {
      // Persist the eraser stroke so it can be re-applied after re-render.
      const annotations = this.annotations.get(pageNum) || [];
      annotations.push({
        id: `eraser-${Date.now()}`,
        type: "eraser",
        pageIndex: pageNum,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        points: [...this.currentDrawingPoints],
        lineWidth: this.plugin.settings.eraserSize,
      });
      this.annotations.set(pageNum, annotations);
    }

    this.currentDrawingPoints = [];
    this.lastDrawnPoint = null;
  }

  private getPressure(e: PointerEvent): number {
    if (
      !this.plugin.settings.enablePressureSensitivity ||
      e.pointerType === "mouse"
    ) {
      return 0.5; // Default pressure for mouse
    }
    // Use pressure if available, otherwise default to 0.5
    return e.pressure > 0 ? e.pressure : 0.5;
  }

  private getLineWidth(pressure: number): number {
    if (!this.plugin.settings.enablePressureSensitivity) {
      return this.plugin.settings.penSize;
    }

    const minWidth = this.plugin.settings.pressureMinWidth;
    const maxWidth = this.plugin.settings.pressureMaxWidth;

    // Apply pressure curve (exponential for more natural feel)
    const curvedPressure = Math.pow(pressure, 1.5);
    return minWidth + (maxWidth - minWidth) * curvedPressure;
  }

  private drawSmoothLine(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const points = this.currentDrawingPoints;
    const len = points.length;
    if (len < 3) return;

    const smoothFactor = this.plugin.settings.smoothingFactor;

    // Get the last 3 points for smoothing
    const p0 = points[len - 3];
    const p1 = points[len - 2];
    const p2 = points[len - 1];

    // Calculate control point using Catmull-Rom spline
    const cp1x = p1.x + (p2.x - p0.x) * smoothFactor / 6;
    const cp1y = p1.y + (p2.y - p0.y) * smoothFactor / 6;

    // Scale for canvas
    const sx = p1.x * this.scale;
    const sy = p1.y * this.scale;
    const ex = p2.x * this.scale;
    const ey = p2.y * this.scale;
    const cpx = cp1x * this.scale;
    const cpy = cp1y * this.scale;

    // Draw with pressure-based width
    if (this.currentTool !== "eraser") {
      ctx.lineWidth = this.getLineWidth(p2.pressure);
    } else {
      ctx.lineWidth = this.plugin.settings.eraserSize;
    }

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cpx, cpy, ex, ey);
    ctx.stroke();
  }

  private drawFinalSmoothLine(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const points = this.currentDrawingPoints;
    if (points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x * this.scale, points[0].y * this.scale);

    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];

      const smoothFactor = this.plugin.settings.smoothingFactor;
      const cpx = (p1.x + (p2.x - p0.x) * smoothFactor / 6) * this.scale;
      const cpy = (p1.y + (p2.y - p0.y) * smoothFactor / 6) * this.scale;

      ctx.quadraticCurveTo(cpx, cpy, p2.x * this.scale, p2.y * this.scale);
    }

    // Draw last segment
    const last = points[points.length - 1];
    ctx.lineTo(last.x * this.scale, last.y * this.scale);
    ctx.stroke();
  }

  private addTextAnnotation(
    e: MouseEvent,
    wrapper: HTMLElement,
    pageNum: number
  ): void {
    const rect = wrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const annotationId = `text-${Date.now()}`;
    const annotation = wrapper.createEl("textarea", {
      cls: "pdf-editor-text-annotation pdf-editor-annotation",
      attr: {
        style: `left: ${x}px; top: ${y}px;`,
        placeholder: "输入文本...",
        "data-annotation-id": annotationId,
      },
    });

    annotation.focus();

    const annotations = this.annotations.get(pageNum) || [];
    annotations.push({
      id: annotationId,
      type: "text",
      pageIndex: pageNum,
      x: x / this.scale,
      y: y / this.scale,
      width: 150,
      height: 30,
      content: "",
    });
    this.annotations.set(pageNum, annotations);

    annotation.addEventListener("input", () => {
      const ann = annotations.find((a) => a.id === annotationId);
      if (ann) ann.content = annotation.value;
    });

    annotation.addEventListener("blur", () => {
      if (!annotation.value) {
        const idx = annotations.findIndex((a) => a.id === annotationId);
        if (idx !== -1) annotations.splice(idx, 1);
        annotation.remove();
      }
    });
  }

  private addHighlight(
    e: MouseEvent,
    wrapper: HTMLElement,
    pageNum: number
  ): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();

    // Skip zero-size selections (e.g. clicks without a real range)
    if (rect.width === 0 && rect.height === 0) {
      selection.empty();
      return;
    }

    const color = this.plugin.settings.highlightColor;
    const highlight = wrapper.createEl("div", {
      cls: "pdf-editor-highlight pdf-editor-annotation",
      attr: {
        style: `
          left: ${rect.left - wrapperRect.left}px;
          top: ${rect.top - wrapperRect.top}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          background: ${this.hexToRgba(color, 0.3)};
        `,
      },
    });

    const annotationId = `highlight-${Date.now()}`;
    highlight.setAttribute("data-annotation-id", annotationId);

    const annotations = this.annotations.get(pageNum) || [];
    annotations.push({
      id: annotationId,
      type: "highlight",
      pageIndex: pageNum,
      x: (rect.left - wrapperRect.left) / this.scale,
      y: (rect.top - wrapperRect.top) / this.scale,
      width: rect.width / this.scale,
      height: rect.height / this.scale,
      color,
    });
    this.annotations.set(pageNum, annotations);

    // Right-click to delete highlight
    highlight.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const idx = annotations.findIndex((a) => a.id === annotationId);
      if (idx !== -1) {
        annotations.splice(idx, 1);
        highlight.remove();
      }
    });

    selection.empty();
  }

  // Convert a hex color (#RGB, #RRGGBB) to an rgba() string with the given
  // alpha. Avoids the broken pattern of appending hex alpha digits to a
  // 3-digit hex value.
  private hexToRgba(hex: string, alpha: number): string {
    let h = hex.replace("#", "");
    if (h.length === 3) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (h.length !== 6) {
      // Fallback to a sensible default if the color is malformed
      return `rgba(255, 255, 0, ${alpha})`;
    }
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private addNote(
    e: MouseEvent,
    wrapper: HTMLElement,
    pageNum: number
  ): void {
    const rect = wrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const annotations = this.annotations.get(pageNum) || [];
    const noteId = `note-${Date.now()}`;
    const noteAnn = {
      id: noteId,
      type: "note" as const,
      pageIndex: pageNum,
      x: x / this.scale,
      y: y / this.scale,
      width: 24,
      height: 24,
      content: "",
    };
    annotations.push(noteAnn);
    this.annotations.set(pageNum, annotations);

    const customSvg = this.plugin.settings.noteIconSvg;
    const noteIcon = wrapper.createEl("div", {
      cls: "pdf-editor-note-icon pdf-editor-annotation" + (customSvg ? " custom-svg" : ""),
      attr: {
        style: `left: ${x}px; top: ${y}px;`,
        "data-annotation-id": noteId,
      },
    });
    if (customSvg) {
      noteIcon.innerHTML = customSvg;
    }

    noteIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      // Highlight this note and unhighlight others in the workspace-leaf
      this.highlightNote(noteIcon);

      const modal = new NoteModal(
        this.app,
        noteAnn.content || "",
        (content) => {
          if (content) {
            const found = annotations.find((a) => a.id === noteId);
            if (found) found.content = content;
            // Update icon tooltip with content preview
            noteIcon.setAttribute("aria-label", content.substring(0, 50));
            this.renderNotesList();
            this.saveAnnotations();
          }
        }
      );
      modal.open();
    });

    // Right-click to delete note
    noteIcon.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const idx = annotations.findIndex((a) => a.id === noteId);
      if (idx !== -1) {
        annotations.splice(idx, 1);
        noteIcon.remove();
        this.renderNotesList();
        this.saveAnnotations();
      }
    });
  }

  private highlightNote(targetNote: HTMLElement): void {
    // Remove highlight from ALL notes across ALL workspace-leaves
    const allNotes = document.querySelectorAll(".pdf-editor-note-icon");
    allNotes.forEach((note) => {
      note.removeClass("highlighted");
    });

    // Add highlight to the clicked note
    targetNote.addClass("highlighted");

    // Scroll the note into view
    targetNote.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Public helpers used by the notes sidebar view
  highlightNoteById(noteId: string, pageNum: number): void {
    const wrapper = this.viewerEl.querySelector<HTMLElement>(
      `.pdf-editor-page-wrapper:nth-child(${pageNum})`
    );
    const icon = wrapper?.querySelector<HTMLElement>(
      `[data-annotation-id="${noteId}"]`
    );
    if (icon) this.highlightNote(icon);
  }

  deleteNote(noteId: string, pageNum: number): void {
    const annotations = this.annotations.get(pageNum) || [];
    const idx = annotations.findIndex((a) => a.id === noteId);
    if (idx !== -1) {
      annotations.splice(idx, 1);
      const wrapper = this.viewerEl.querySelector<HTMLElement>(
        `.pdf-editor-page-wrapper:nth-child(${pageNum})`
      );
      const icon = wrapper?.querySelector<HTMLElement>(
        `[data-annotation-id="${noteId}"]`
      );
      icon?.remove();
      this.renderNotesList();
      this.saveAnnotations();
    }
  }

  // Navigation
  async goToPage(pageNum: number): Promise<void> {
    if (!this.pdfDocument || pageNum < 1 || pageNum > this.totalPages) return;
    this.currentPage = pageNum;
    this.updatePageInfo();

    // Scroll to page in viewer. Use the page wrapper element rather than
    // relying on child index, which can include non-page elements.
    const pageWrapper = this.viewerEl.querySelector<HTMLElement>(
      `.pdf-editor-page-wrapper:nth-child(${pageNum})`
    );
    if (pageWrapper) {
      pageWrapper.scrollIntoView({ behavior: "smooth" });
    }

    // Update active thumbnail
    if (this.thumbContentEl) {
      const thumbnails = this.thumbContentEl.querySelectorAll(".pdf-editor-thumbnail");
      thumbnails.forEach((thumb, index) => {
        if (index === pageNum - 1) {
          thumb.addClass("active");
          thumb.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
          thumb.removeClass("active");
        }
      });
    }
  }

  // Zoom
  async setZoom(newScale: number): Promise<void> {
    newScale = Math.max(0.25, Math.min(5, newScale));
    // Round to avoid floating point drift causing infinite re-render loops
    newScale = Math.round(newScale * 100) / 100;
    if (Math.abs(newScale - this.scale) < 0.001) return;

    // Preserve scroll position relative to the document so the view stays
    // roughly in place after re-rendering at the new scale.
    const prevScrollFraction =
      this.viewerEl.scrollHeight > 0
        ? this.viewerEl.scrollTop / this.viewerEl.scrollHeight
        : 0;

    this.scale = newScale;
    this.updateStatusbar();
    this.updateZoomControl();
    await this.renderAllPages();

    // Restore scroll position
    this.viewerEl.scrollTop = prevScrollFraction * this.viewerEl.scrollHeight;
  }

  fitToWidth(): void {
    if (!this.pdfDocument) return;
    const containerWidth = this.viewerEl.clientWidth - 40; // padding
    if (containerWidth <= 0) return;
    // Use the actual first page width at scale 1 instead of a hardcoded value
    this.pdfDocument
      .getPage(1)
      .then((page) => {
        const baseViewport = page.getViewport({ scale: 1 });
        const newScale = containerWidth / baseViewport.width;
        this.setZoom(newScale);
      })
      .catch((e) => {
        console.error("fitToWidth failed:", e);
      });
  }

  // Tool selection
  setTool(tool: ToolType): void {
    this.currentTool = tool;

    // Update toolbar button states
    const buttons = this.toolbarEl.querySelectorAll("button");
    buttons.forEach((btn) => {
      btn.removeClass("active");
      const label = btn.getAttribute("aria-label");
      if (
        (tool === "select" && label === "选择") ||
        (tool === "text" && label === "文本") ||
        (tool === "highlight" && label === "高亮") ||
        (tool === "pen" && label === "画笔") ||
        (tool === "eraser" && label === "橡皮擦") ||
        (tool === "note" && label === "备注")
      ) {
        btn.addClass("active");
      }
    });

    // Toggle drawing layer
    const drawingLayers = this.viewerEl.querySelectorAll(
      ".pdf-editor-drawing-layer"
    );
    drawingLayers.forEach((layer) => {
      if (tool === "pen" || tool === "eraser") {
        layer.addClass("active");
      } else {
        layer.removeClass("active");
      }
    });

    // Toggle text-layer selectability so the highlight tool can select text,
    // while other tools do not interfere with page interaction.
    const textLayers = this.viewerEl.querySelectorAll(".pdf-editor-text-layer");
    textLayers.forEach((layer) => {
      if (tool === "highlight") {
        layer.addClass("selectable");
      } else {
        layer.removeClass("selectable");
      }
    });

    // Show/hide size controls based on tool
    this.updateSizeControls();
  }

  private updateSizeControls(): void {
    if (this.penSizeContainer && this.eraserSizeContainer) {
      if (this.currentTool === "pen" || this.currentTool === "highlight") {
        this.penSizeContainer.style.display = "flex";
        this.eraserSizeContainer.style.display = "none";
      } else if (this.currentTool === "eraser") {
        this.penSizeContainer.style.display = "none";
        this.eraserSizeContainer.style.display = "flex";
      } else {
        this.penSizeContainer.style.display = "none";
        this.eraserSizeContainer.style.display = "none";
      }
    }
  }

  // Sidebar
  toggleSidebar(): void {
    const willShow = !this.sidebarEl.hasClass("visible");
    this.sidebarEl.toggleClass("visible", willShow);
    // Persist the sidebar visibility preference
    this.plugin.settings.sidebarVisible = willShow;
    this.plugin.saveSettings();
  }

  private async loadOutline(): Promise<void> {
    if (!this.pdfDocument || !this.outlineContentEl) return;

    const outline = await this.pdfDocument.getOutline();
    if (!outline || outline.length === 0) {
      this.outlineContentEl.createEl("div", {
        text: "此 PDF 没有大纲",
        attr: { style: "padding: 12px; color: var(--text-muted); font-size: 13px;" },
      });
      return;
    }

    this.outlineContentEl.empty();
    this.renderOutlineItems(outline, this.outlineContentEl, 1);
  }

  // Recursively render outline items, including nested children.
  private renderOutlineItems(
    items: any[],
    container: HTMLElement,
    level: number
  ): void {
    for (const item of items) {
      const el = container.createEl("div", {
        cls: `pdf-editor-outline-item level-${Math.min(level, 3)}`,
        text: item.title,
      });

      el.addEventListener("click", async () => {
        if (item.dest) {
          try {
            let dest: any[] = item.dest as any[];
            if (typeof dest === "string") {
              dest = (await this.pdfDocument!.getDestination(dest)) as any[];
            }
            if (dest && dest[0]) {
              const pageIndex = await this.pdfDocument!.getPageIndex(dest[0]);
              this.goToPage(pageIndex + 1);
            }
          } catch (e) {
            console.error("Failed to navigate to outline item:", e);
          }
        }
      });

      // Recurse into nested outline items
      if (item.items && item.items.length > 0) {
        this.renderOutlineItems(item.items, container, level + 1);
      }
    }
  }

  // UI updates
  private updatePageInfo(): void {
    const pageInput = this.toolbarEl.querySelector(
      "input[type='number']"
    ) as HTMLInputElement;
    const totalPagesEl = this.toolbarEl.querySelector(".total-pages");

    if (pageInput) pageInput.value = String(this.currentPage);
    if (totalPagesEl) totalPagesEl.textContent = String(this.totalPages);
  }

  private updateStatusbar(): void {
    const zoomEl = this.statusbarEl.querySelector(".pdf-editor-status-zoom");
    if (zoomEl) {
      zoomEl.textContent = `缩放: ${Math.round(this.scale * 100)}%`;
    }
  }

  // Keep the zoom dropdown in sync with the current scale (e.g. when zoom
  // changes via keyboard shortcuts or fit-to-width).
  private updateZoomControl(): void {
    const zoomSelect = this.toolbarEl.querySelector(
      "select"
    ) as HTMLSelectElement | null;
    if (!zoomSelect) return;
    const value = String(this.scale);
    // If the current scale matches a preset option, select it; otherwise
    // fall back to the first option and rely on the status bar for the value.
    let matched = false;
    for (const option of Array.from(zoomSelect.options)) {
      if (option.value === value) {
        option.selected = true;
        matched = true;
        break;
      }
    }
    if (!matched) {
      zoomSelect.selectedIndex = 0;
    }
  }

  // Show or hide a loading overlay on the viewer area.
  private showLoading(show: boolean): void {
    let overlay = this.viewerEl.querySelector(
      ".pdf-editor-loading"
    ) as HTMLElement | null;
    if (show) {
      if (!overlay) {
        overlay = this.viewerEl.createEl("div", {
          cls: "pdf-editor-loading",
          text: "正在加载 PDF...",
        });
      }
    } else if (overlay) {
      overlay.remove();
    }
  }

  // Auto-save
  private startAutoSave(): void {
    this.autoSaveTimer = window.setInterval(() => {
      this.saveAnnotations();
    }, this.plugin.settings.autoSaveInterval);
  }

  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      window.clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  async saveAnnotations(): Promise<void> {
    if (!this.file || this.annotations.size === 0) return;

    // Save annotations to a JSON sidecar file
    const annotationFile = `${this.file.path}.annotations.json`;
    const data: Record<string, Annotation[]> = {};

    this.annotations.forEach((annotations, pageNum) => {
      data[String(pageNum)] = annotations;
    });

    try {
      const content = JSON.stringify(data, null, 2);
      const existingFile = this.app.vault.getAbstractFileByPath(annotationFile);

      if (existingFile) {
        await this.app.vault.modify(existingFile as TFile, content);
      } else {
        await this.app.vault.create(annotationFile, content);
      }
    } catch (e) {
      console.error("Failed to save annotations:", e);
    }
  }

  async loadAnnotations(): Promise<void> {
    if (!this.file) return;

    const annotationFile = `${this.file.path}.annotations.json`;
    const file = this.app.vault.getAbstractFileByPath(annotationFile);

    if (file) {
      try {
        const content = await this.app.vault.read(file as TFile);
        const data = JSON.parse(content) as Record<string, Annotation[]>;

        Object.entries(data).forEach(([pageNum, annotations]: [string, Annotation[]]) => {
          this.annotations.set(parseInt(pageNum), annotations);
        });
      } catch (e) {
        console.error("Failed to load annotations:", e);
      }
    }
  }

  private async cleanup(): Promise<void> {
    // Cancel all render tasks
    this.renderTasks.forEach((task) => task.cancel());
    this.renderTasks.clear();

    // Clean up PDF document
    if (this.pdfDocument) {
      this.pdfDocument.destroy();
      this.pdfDocument = null;
    }

    this.pageCanvases.clear();
    this.annotations.clear();
  }
}
