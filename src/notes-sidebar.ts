import { ItemView, WorkspaceLeaf, Menu } from "obsidian";
import type PdfEditorPlugin from "./main";
import { PdfEditorView, Annotation } from "./pdf-view";

export const VIEW_TYPE_PDF_NOTES = "pdf-editor-notes-view";

export class PdfNotesSidebarView extends ItemView {
  plugin: PdfEditorPlugin;
  listEl!: HTMLElement;
  private activeNoteId: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PdfEditorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_PDF_NOTES;
  }

  getDisplayText(): string {
    return "PDF 备注";
  }

  getIcon(): string {
    return "sticky-note";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pdf-notes-sidebar");

    contentEl.createEl("div", {
      cls: "pdf-notes-sidebar-header",
      text: "PDF 备注",
    });

    this.listEl = contentEl.createEl("div", {
      cls: "pdf-notes-sidebar-list",
    });

    // Refresh whenever notes change in the active editor
    this.registerEvent(
      this.app.workspace.on("pdf-editor:notes-changed" as any, () => {
        this.render();
      })
    );

    // Re-render when the active leaf changes (different PDF opened).
    // Skip when the sidebar itself becomes active to avoid clearing its
    // own content (e.g. when revealLeaf is called by toggleNotesSidebar).
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view?.getViewType() === VIEW_TYPE_PDF_NOTES) return;
        this.render();
      })
    );

    // Listen for focus-note event from PDF view (when clicking a note icon)
    this.registerEvent(
      this.app.workspace.on("pdf-editor:focus-note" as any, (...args: any[]) => {
        const detail = args[0] as { noteId: string; pageNum: number };
        this.render();
        setTimeout(() => {
          this.focusNote(detail.noteId);
        }, 50);
      })
    );

    this.render();
  }

  private getActiveEditor(): PdfEditorView | null {
    return this.app.workspace.getActiveViewOfType(PdfEditorView);
  }

  render(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const editor = this.getActiveEditor();
    if (!editor || !editor.file) {
      this.listEl.createEl("div", {
        text: "请先打开一个 PDF 文件",
        cls: "pdf-notes-sidebar-empty",
      });
      return;
    }

    const notes = editor.getAllNotes();
    if (notes.length === 0) {
      this.listEl.createEl("div", {
        text: "暂无备注",
        cls: "pdf-notes-sidebar-empty",
      });
      return;
    }

    for (const { ann, pageNum } of notes) {
      const item = this.listEl.createEl("div", {
        cls: "pdf-notes-sidebar-item",
        attr: { "data-annotation-id": ann.id },
      });

      // Header: click to navigate to PDF page
      const header = item.createEl("div", {
        cls: "pdf-notes-sidebar-item-header",
      });
      header.createEl("span", {
        text: `第 ${pageNum} 页`,
        cls: "pdf-notes-sidebar-item-page",
      });

      // Body: displays note content, clickable for inline editing
      const body = item.createEl("div", {
        cls: "pdf-notes-sidebar-item-body",
      });
      body.textContent = ann.content || "(空备注)";

      // Click header: jump to the page and highlight the note icon
      header.addEventListener("click", () => {
        this.flashItem(item);
        editor.goToPage(pageNum);
        setTimeout(() => {
          editor.highlightNoteById(ann.id, pageNum);
        }, 100);
      });

      // Click body: start inline editing
      body.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startInlineEdit(item, ann, pageNum, editor);
      });

      // Right-click: context menu (edit / delete)
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((mi) => {
          mi.setTitle("编辑备注").setIcon("pencil").onClick(() => {
            this.startInlineEdit(item, ann, pageNum, editor);
          });
        });
        menu.addItem((mi) => {
          mi.setTitle("删除备注").setIcon("trash").onClick(() => {
            editor.deleteNote(ann.id, pageNum);
            this.render();
          });
        });
        menu.showAtMouseEvent(e);
      });
    }
  }

  /**
   * Briefly flash-highlight a sidebar item to give visual feedback.
   */
  private flashItem(item: HTMLElement): void {
    // Remove any existing highlight first
    this.listEl?.querySelectorAll(".pdf-notes-sidebar-item.active").forEach((el) => {
      (el as HTMLElement).removeClass("active");
    });
    item.addClass("active");
    setTimeout(() => {
      item.removeClass("active");
    }, 1500);
  }

  /**
   * Focus a specific note in the sidebar: highlight, scroll into view,
   * and activate inline editing.
   */
  focusNote(noteId: string): void {
    if (!this.listEl) return;

    // Remove previous active highlight
    this.listEl.querySelectorAll(".pdf-notes-sidebar-item.active").forEach((el) => {
      (el as HTMLElement).removeClass("active");
    });

    const item = this.listEl.querySelector<HTMLElement>(
      `[data-annotation-id="${noteId}"]`
    );
    if (!item) return;

    item.addClass("active");
    item.scrollIntoView({ behavior: "smooth", block: "nearest" });
    this.activeNoteId = noteId;

    // Auto-remove the highlight after a short delay
    setTimeout(() => {
      item.removeClass("active");
    }, 1500);

    // Start inline editing on the body
    const editor = this.getActiveEditor();
    if (editor) {
      const notes = editor.getAllNotes();
      const note = notes.find((n) => n.ann.id === noteId);
      if (note) {
        this.startInlineEdit(item, note.ann, note.pageNum, editor);
      }
    }
  }

  /**
   * Replace the body text with an inline textarea for editing.
   */
  private startInlineEdit(
    item: HTMLElement,
    ann: Annotation,
    pageNum: number,
    editor: PdfEditorView
  ): void {
    const body = item.querySelector(".pdf-notes-sidebar-item-body") as HTMLElement;
    if (!body || body.querySelector("textarea")) return; // Already editing

    const textarea = document.createElement("textarea");
    textarea.value = ann.content || "";
    textarea.className = "pdf-notes-sidebar-item-textarea";
    textarea.rows = 3;
    textarea.placeholder = "在此输入备注...";

    body.textContent = "";
    body.appendChild(textarea);
    textarea.focus();
    // Place cursor at the end
    textarea.selectionStart = textarea.value.length;

    const save = () => {
      const content = textarea.value.trim();
      ann.content = content;
      // Update the note icon aria-label directly (avoid full re-render
      // during blur, which would remove the textarea from DOM prematurely)
      const wrapper = editor.viewerEl.querySelector<HTMLElement>(
        `.pdf-editor-page-wrapper:nth-child(${pageNum})`
      );
      const icon = wrapper?.querySelector<HTMLElement>(
        `[data-annotation-id="${ann.id}"]`
      );
      if (icon && content) {
        icon.setAttribute("aria-label", content.substring(0, 50));
      }
      editor.saveAnnotations();
      body.textContent = content || "(空备注)";
    };

    textarea.addEventListener("blur", save);
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        textarea.blur(); // Triggers save via blur
      }
      if (e.key === "Escape") {
        // Cancel editing, restore original content
        textarea.removeEventListener("blur", save);
        body.textContent = ann.content || "(空备注)";
      }
    });
  }

  async onClose(): Promise<void> {
    // Nothing special to clean up
  }
}
