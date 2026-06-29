import { Plugin, TFile, TAbstractFile, WorkspaceLeaf, Menu, Notice } from "obsidian";
import {
  PdfEditorView,
  VIEW_TYPE_PDF_EDITOR,
} from "./pdf-view";
import {
  PdfNotesSidebarView,
  VIEW_TYPE_PDF_NOTES,
} from "./notes-sidebar";
import {
  PdfEditorSettings,
  DEFAULT_SETTINGS,
  PdfEditorSettingTab,
} from "./settings";

export default class PdfEditorPlugin extends Plugin {
  settings: PdfEditorSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register the PDF editor view
    this.registerView(
      VIEW_TYPE_PDF_EDITOR,
      (leaf) => new PdfEditorView(leaf, this)
    );

    // Register the notes sidebar view (lives in Obsidian's side dock)
    this.registerView(
      VIEW_TYPE_PDF_NOTES,
      (leaf) => new PdfNotesSidebarView(leaf, this)
    );

    // Register settings tab
    this.addSettingTab(new PdfEditorSettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon("file-text", "Open PDF Editor", () => {
      this.activateView();
    });

    // Add command to open PDF
    this.addCommand({
      id: "open-pdf-editor",
      name: "Open PDF in Editor",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === "pdf") {
          if (!checking) {
            this.openPdf(activeFile);
          }
          return true;
        }
        return false;
      },
    });

    // Add command to create new PDF annotation
    this.addCommand({
      id: "new-pdf-annotation",
      name: "New PDF Annotation",
      callback: () => {
        const activeView = this.app.workspace.getActiveViewOfType(PdfEditorView);
        if (activeView) {
          activeView.setTool("text");
        }
      },
    });

    // Add command to toggle sidebar
    this.addCommand({
      id: "toggle-pdf-sidebar",
      name: "Toggle PDF Sidebar",
      callback: () => {
        const activeView = this.app.workspace.getActiveViewOfType(PdfEditorView);
        if (activeView) {
          activeView.toggleSidebar();
        }
      },
    });

    // Add command to toggle the notes sidebar (Obsidian side dock)
    this.addCommand({
      id: "toggle-pdf-notes-sidebar",
      name: "Toggle PDF Notes Sidebar",
      callback: () => {
        this.toggleNotesSidebar();
      },
    });

    // Add command to manually save annotations
    this.addCommand({
      id: "save-pdf-annotations",
      name: "Save PDF Annotations",
      checkCallback: (checking) => {
        const activeView = this.app.workspace.getActiveViewOfType(PdfEditorView);
        if (activeView) {
          if (!checking) {
            activeView.saveAnnotations().then(() => {
              new Notice("注释已保存");
            });
          }
          return true;
        }
        return false;
      },
    });

    // Add command to export annotations to PDF
    this.addCommand({
      id: "export-pdf-annotations",
      name: "Export Annotations to PDF",
      checkCallback: (checking) => {
        const activeView = this.app.workspace.getActiveViewOfType(PdfEditorView);
        if (activeView) {
          if (!checking) {
            activeView.exportAnnotationsToPdf();
          }
          return true;
        }
        return false;
      },
    });

    // Add command to zoom in
    this.addCommand({
      id: "pdf-zoom-in",
      name: "PDF Zoom In",
      callback: () => {
        const activeView = this.app.workspace.getActiveViewOfType(PdfEditorView);
        if (activeView) {
          activeView.setZoom(activeView.scale + 0.1);
        }
      },
    });

    // Add command to zoom out
    this.addCommand({
      id: "pdf-zoom-out",
      name: "PDF Zoom Out",
      callback: () => {
        const activeView = this.app.workspace.getActiveViewOfType(PdfEditorView);
        if (activeView) {
          activeView.setZoom(activeView.scale - 0.1);
        }
      },
    });

    // Add command to fit to width
    this.addCommand({
      id: "pdf-fit-width",
      name: "PDF Fit to Width",
      callback: () => {
        const activeView = this.app.workspace.getActiveViewOfType(PdfEditorView);
        if (activeView) {
          activeView.fitToWidth();
        }
      },
    });

    // Add command to save annotations
    this.addCommand({
      id: "pdf-save-annotations",
      name: "Save PDF Annotations",
      callback: async () => {
        const activeView = this.app.workspace.getActiveViewOfType(PdfEditorView);
        if (activeView) {
          await activeView.saveAnnotations();
        }
      },
    });

    // Register context menu for PDF files
    this.registerEvent(
      this.app.workspace.on(
        "file-menu",
        (menu: Menu, file: TAbstractFile, _source: string) => {
          if (file instanceof TFile && file.extension === "pdf") {
            menu.addItem((item) => {
              item
                .setTitle("Open in PDF Editor")
                .setIcon("file-text")
                .onClick(() => {
                  this.openPdf(file);
                });
            });
          }
        }
      )
    );

    // Intercept PDF file opens and redirect to our editor
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file && file instanceof TFile && file.extension === "pdf") {
          // If the file is already displayed in one of our editor leaves,
          // there is nothing to do.
          const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PDF_EDITOR);
          const existingLeaf = leaves.find((leaf) => {
            const view = leaf.view as PdfEditorView;
            return view.file?.path === file.path;
          });
          if (existingLeaf) {
            return;
          }

          // Only redirect if the currently active leaf is NOT already our
          // editor view (avoids fighting the user when they switch tabs).
          const activeLeaf = this.app.workspace.activeLeaf;
          if (activeLeaf && activeLeaf.view instanceof PdfEditorView) {
            return;
          }

          // Small delay to avoid conflict with built-in PDF viewer
          setTimeout(() => {
            this.openPdf(file);
          }, 50);
        }
      })
    );

    console.log("PDF Editor plugin loaded");
  }

  onunload(): void {
    console.log("PDF Editor plugin unloaded");
  }

  // Toggle the notes sidebar in Obsidian's right side dock
  async toggleNotesSidebar(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_PDF_NOTES);
    if (existing.length > 0) {
      // Already open: reveal it (or detach to toggle off)
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE_PDF_NOTES,
        active: true,
      });
      workspace.revealLeaf(leaf);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_PDF_EDITOR);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_PDF_EDITOR,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async openPdf(file: TFile): Promise<void> {
    const { workspace } = this.app;

    // Check if already opened
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_PDF_EDITOR);
    let targetLeaf: WorkspaceLeaf | null = null;

    for (const leaf of leaves) {
      const view = leaf.view as PdfEditorView;
      if (view.file?.path === file.path) {
        targetLeaf = leaf;
        break;
      }
    }

    if (!targetLeaf) {
      // Reuse an existing empty PDF editor leaf if one exists, otherwise
      // create a new tab. This avoids stacking many empty leaves when the
      // user opens several different PDFs in succession.
      const emptyLeaf = leaves.find((leaf) => {
        const view = leaf.view as PdfEditorView;
        return !view.file;
      });

      targetLeaf = emptyLeaf ?? workspace.getLeaf("tab");
      if (targetLeaf) {
        await targetLeaf.setViewState({
          type: VIEW_TYPE_PDF_EDITOR,
          active: true,
        });
      }
    }

    if (targetLeaf) {
      workspace.revealLeaf(targetLeaf);
      const view = targetLeaf.view as PdfEditorView;
      // loadFile already loads saved annotations, so no separate call needed.
      await view.loadFile(file);
    }
  }
}
