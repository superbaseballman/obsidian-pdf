import { ItemView, WorkspaceLeaf, Menu } from "obsidian";
import type PdfEditorPlugin from "./main";
import { PdfEditorView, NoteModal, Annotation } from "./pdf-view";

export const VIEW_TYPE_PDF_NOTES = "pdf-editor-notes-view";

export class PdfNotesSidebarView extends ItemView {
  plugin: PdfEditorPlugin;
  listEl: HTMLElement;

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

    // Re-render when the active leaf changes (different PDF opened)
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.render();
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

      const header = item.createEl("div", {
        cls: "pdf-notes-sidebar-item-header",
      });
      header.createEl("span", {
        text: `第 ${pageNum} 页`,
        cls: "pdf-notes-sidebar-item-page",
      });

      const body = item.createEl("div", {
        text: ann.content || "(空备注)",
        cls: "pdf-notes-sidebar-item-body",
      });

      // Click: jump to the page and highlight the note icon
      item.addEventListener("click", () => {
        editor.goToPage(pageNum);
        setTimeout(() => {
          editor.highlightNoteById(ann.id, pageNum);
        }, 100);
      });

      // Right-click: context menu (edit / delete)
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((mi) => {
          mi.setTitle("编辑备注").setIcon("pencil").onClick(() => {
            const modal = new NoteModal(this.app, ann.content || "", (content) => {
              ann.content = content;
              editor.updateNoteIcon(ann.id, pageNum, content);
              editor.saveAnnotations();
              this.render();
            });
            modal.open();
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

  async onClose(): Promise<void> {
    // Nothing special to clean up
  }
}
